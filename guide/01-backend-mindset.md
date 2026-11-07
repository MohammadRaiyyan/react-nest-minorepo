# Chapter 1: The Backend Mindset

## Lesson 1.1: The life of one request

A backend is a long-running program that waits for requests, works against shared data, and sends back responses. React code runs for one user in one browser tab. Backend code runs for every user at the same time, and the data it writes outlives every request.

We follow one request through Teamboard. A user ticks off task 42. React sends:

```http
PATCH /tasks/42
Content-Type: application/json
Cookie: session=abc123

{ "status": "done" }
```

### Stage 1: Reaching your code

```
Browser ──> DNS ──> gets an IP address
Browser ──> Load balancer (HTTPS) ──> Node process (plain HTTP)
```

- **DNS** turns `api.teamboard.com` into an IP address. That IP usually belongs to the load balancer, not your server.
- **The load balancer** accepts the HTTPS connection, decrypts it (TLS termination), and forwards plain HTTP to one of your Node processes. Your code never touches certificates.

### Stage 2: Inside NestJS

NestJS runs every request through a fixed pipeline. Each stage has one job, and each stage can stop the request.

```
Request
  │
  ▼
Middleware ──> Guard ──> Interceptor (before) ──> Pipe ──> Controller ──> Service ──> Prisma ──> Postgres
```

| Stage | Its one job | In Teamboard | Stops the request with |
| --- | --- | --- | --- |
| Middleware | Work every request needs | Attach a request ID, log the start | Rarely |
| Guard | Who are you, and are you allowed? | Read the session cookie, check the user belongs to task 42's org | 401 or 403 |
| Interceptor (before) | Wrap the handler | Start a timer | Rarely |
| Pipe | Is the input valid? | `status` must be `todo`, `doing`, or `done` | 400 |
| Controller | Turn HTTP into a function call | Call `tasksService.update(42, { status })` | Never on its own |
| Service | Business rules | A task with open subtasks cannot be closed. Write an activity log entry. | 409 or 422 |
| Prisma + Postgres | Persist the change | `UPDATE tasks SET status = 'done' WHERE id = 42` | 500 if the database is down |

### Stage 3: The way back

```
Postgres ──> Service ──> Controller ──> Interceptor (after) ──> JSON response
                                              │
                    any thrown error ──> Exception filter ──> JSON error response
```

- **Interceptor (after)** shapes the response and logs how long the request took.
- **Exception filter** catches any error thrown anywhere above and turns it into one consistent JSON error. Clients never see a stack trace or a raw Prisma error.

### Why the pipeline is split this way

**Checks become structural.** If every controller did its own auth check, one forgotten line would leak data. A guard applied to the whole controller cannot be forgotten.

**It matches team ownership.** In a multi-team company, a platform team owns middleware, guards, pipes, and filters. Feature teams write controllers and services. Every team gets auth, validation, logging, and error handling for free.

**Services do not know about HTTP.** The same `tasksService.update` gets called from an HTTP request, a cron job, a queue worker, and a WebSocket message. Business rules live in the service so they work from all four.

### The client cannot be trusted

Anyone can send this exact request with `curl`, without your React app at all. They can change the body, the task ID, or the cookie. Validation in React is for user experience. Validation on the API is for security. The guard and the pipe exist because of this.

### Where the time goes

| Operation | Rough time |
| --- | --- |
| Your controller and service code | Microseconds |
| One query to Postgres on the same network | 1 to 5 ms |
| One call to an external API (Stripe, email) | 100 ms or more |

A request spends almost all of its time waiting on I/O. This is why one Node thread can serve thousands of users (waiting costs nothing). It is also why 21 small queries are much slower than 1 (Chapter 4, the N+1 problem).

### Production checklist

- Every request gets a request ID. It goes back in a response header and into every log line.
- Auth and validation happen in guards and pipes, never as ad hoc checks inside controllers.
- The whole API uses one error format.
- Controllers stay thin. No business rules and no database calls in them.
- Every outgoing call (database, HTTP) has a timeout.

### Common mistakes

- Trusting validation done in the frontend.
- Putting business logic in controllers, so the cron job and queue worker cannot reuse it.
- Returning raw database errors or stack traces to the client.
- Doing slow work, like sending an email, inside the request instead of a background job (Chapter 12).

### Exercise: a server with no framework

Build `playground/ch01/server.mjs` with Node's built-in `node:http` module. No Express, no packages.

**Spec**

- Listen on the port in `process.env.PORT`, default `3000`.
- For every request, log the method, URL, headers, and body.
- `GET /health` returns `200` with `{ "ok": true }`.
- `PATCH /tasks/:id` parses the JSON body and returns `200` with `{ "id": "<id>", ...body }`.
- Anything else returns `404` with `{ "error": "Not found" }`.
- Every response has `Content-Type: application/json`.

**Hints**

- `req` is a stream. The body arrives in chunks: `for await (const chunk of req)` collects them.
- `new URL(req.url, "http://localhost")` parses the path.
- `res.writeHead(status, headers)` then `res.end(text)`.

**Experiments**

```sh
curl -i localhost:3000/health
curl -i -X PATCH localhost:3000/tasks/42 -H 'Content-Type: application/json' -d '{"status":"done"}'
curl -i -X PATCH localhost:3000/tasks/42 -H 'User-Agent: Mozilla/5.0 Chrome' -H 'Cookie: session=anything' -d '{"status":"done"}'
curl -i -X PATCH localhost:3000/tasks/42 -d '{"status": broken'
```

The third request pretends to be a browser with a session cookie. The fourth sends broken JSON. Build without a `try/catch` around `JSON.parse` first and see what the fourth one does to the server.

### What the experiments showed

**Headers are just text the client chose.** The server logged `user-agent: Mozilla/5.0 Chrome` and `cookie: session=anything` exactly as curl sent them. Nothing in a request proves it came from a browser, from your React app, or from a logged-in user. Identity must come from something only the server can check: a session ID the server looks up in its own storage, or a token signed with the server's secret key (Chapter 6).

**CORS does not protect your API.** CORS is a rule browsers enforce on JavaScript running in a page. curl, Postman, scripts, and other servers ignore it completely. It stops a malicious website from making a user's browser call your API, nothing more.

**One bad request took the server down for everyone.** Broken JSON made `JSON.parse` throw inside the handler. Nothing caught it, so Node exited. The next `/health` call could not even connect. In React, an uncaught error breaks one user's tab. On a server, one process serves every user, so one user's bad input became an outage for all of them.

Two fixes, used together in production:

1. Catch errors per request and turn them into a proper response (`400` for bad input, `500` for bugs). NestJS does this globally with exception filters, so no handler can forget.
2. Run the process under something that restarts it when it dies (systemd, Docker, Kubernetes). Lesson 1.3 covers this.

**The server trusted the client about the body format.** `curl -d` without a header sends `Content-Type: application/x-www-form-urlencoded`. The server parsed it as JSON anyway. A strict API checks `Content-Type` and returns `415 Unsupported Media Type` when it is wrong.

### My notes

_Write the life of a request in your own words here._


## Lesson 1.2: Statelessness and where state lives

A **stateless server** keeps nothing in its own memory between requests that another copy of the server would need. Any copy can handle any request, and a copy can die or restart without anyone noticing.

**State** is any data that must outlive one request: who is logged in, what is in a cart, how many requests a user made this minute, a half-finished upload.

### Why memory is the wrong place

One copy with logins in memory works:

```
Browser ──> API #1 (sessions in memory) ✓
```

Add a second copy behind a load balancer. The login landed on #1. The next request lands on #2, which has never seen this user:

```
                ┌──> API #1 (knows the user)
Browser ──> LB ─┤
                └──> API #2 (does not) ──> 401
```

Restart #1 for a deploy and its memory is wiped, so every user is logged out. Memory breaks in two ways: **more than one copy**, and **any restart**.

Move the state out of the process, and every copy sees the same thing:

```
                ┌──> API #1 ──┐
Browser ──> LB ─┤             ├──> Redis (sessions)
                └──> API #2 ──┘
```

### Where each kind of state lives

| State | Lives in | Why |
| --- | --- | --- |
| Business data (users, tasks, orgs) | Postgres | Durable, shared, transactions |
| Short-lived shared data (sessions, rate limit counts, cache, job queues) | Redis | Fast, shared, built-in expiry |
| Files | S3 or similar object storage | Large, cheap, shared |
| UI state (open tabs, form drafts, filters) | The client (React state, URL, localStorage) | Belongs to one user's screen |
| Proof of identity | A cookie holding a session ID, or a signed token | Sent with every request |

What is fine to keep in memory: config read at startup, the database connection pool, and small caches where a stale or missing value is harmless.

### Exercise: in-memory sessions, two copies

Add to `server.mjs`:

- `POST /login` with `{ "username": "..." }`. Create an ID with `crypto.randomUUID()`, store it in a `Map` (`sessions.set(id, { username })`), and reply with the header `Set-Cookie: session=<id>; HttpOnly; Path=/`.
- `GET /me` reads the `session` value from the `cookie` header, looks it up, and returns `200 { "username": ... }` or `401 { "error": "Not logged in" }`.

Hints: `headers.cookie` looks like `"a=1; session=abc"`. Split it on `"; "` and find the part starting with `session=`. `sendResponse` needs an optional extra-headers argument for `Set-Cookie`.

**Experiments**

Run two copies in two terminals:

```sh
PORT=3000 node playground/ch01/server.mjs
PORT=3001 node playground/ch01/server.mjs
```

Then:

```sh
curl -i -c cookies.txt -X POST localhost:3000/login -d '{"username":"raiyyan"}'
curl -i -b cookies.txt localhost:3000/me     # same copy
curl -i -b cookies.txt localhost:3001/me     # the other copy
# now stop and restart the 3000 server
curl -i -b cookies.txt localhost:3000/me     # same copy, after a restart
```

`-c` saves cookies to a file and `-b` sends them back, like a browser does. Cookies ignore the port, so both servers receive the same cookie, just like two copies behind one load balancer.

### What the experiments showed

**Copy #2 did not know the user.** The login lived in copy #1's `Map`. Copy #2 received the same cookie but had nothing stored under that ID. A restart of copy #1 had the same effect, because restarting wipes memory. In production every deploy restarts every copy, so in-memory sessions log everyone out on every deploy.

**The first version failed open.** When the session ID was not in the `Map`, `userMap.get` returned `undefined` and the server replied `200` with an empty body. A request with an unknown session was treated as success. Auth code must **fail closed**: start from "denied" and allow only when you positively found a valid user. Every unexpected path (missing cookie, unknown ID, expired session, thrown error) ends in `401`.

**Returning the session ID in the JSON body undoes `HttpOnly`.** `HttpOnly` stops page JavaScript from reading the cookie, so an XSS bug cannot steal the session. Putting the same ID in the response body hands it to JavaScript anyway.

**`JSON.stringify(new Error("x"))` is `{}`.** Error objects have no enumerable properties. Send a fixed message instead. Never send raw errors to clients: they leak internals when they do serialize.

### The two real fixes (Chapter 6)

1. **Shared session store.** Keep the `Map` idea, but in Redis. Every copy reads the same sessions, and they survive restarts. Logging out deletes the key, so revoking access is instant.
2. **Signed tokens (JWT).** Put `{ userId, expiresAt }` in the token and sign it with a secret. Any copy can verify it with no lookup at all. The cost: you cannot revoke a token before it expires without adding a lookup back.

## Lesson 1.3: How servers fail

A Node server fails in three main ways. Each one has a standard production fix.

| Failure | What happens | Cause | Fix |
| --- | --- | --- | --- |
| **Crash** | The process exits. Every user gets connection errors. | An uncaught exception or unhandled promise rejection. | Catch errors per request. Run the process under a supervisor that restarts it. |
| **Freeze** | The process is alive but answers nobody. | Synchronous CPU work blocks the single JavaScript thread. | Keep heavy CPU work out of request handlers: worker threads or a background job. |
| **Hang** | Requests wait forever and pile up. Memory and connections run out. | Waiting on a slow database or external API with no limit. | A timeout on every outgoing call. |

### Waiting vs working

Node's one thread is free while a request *waits* (database, network, timers). It is busy while a request *works* (loops, parsing huge JSON, hashing, image resizing). Waiting requests share the thread. A working request owns it, and every other user waits behind it.

```
Waiting:  req A ──await DB── · · · · · ──> done
          req B ──> done   (runs during A's wait)

Working:  req A ████████████████████████──> done
          req B                          ──> done   (stuck behind A)
```

### Graceful shutdown

Every deploy stops the old process. The platform sends `SIGTERM` first, then kills the process a few seconds later. A graceful shutdown uses those seconds:

1. Stop accepting new connections.
2. Let in-flight requests finish.
3. Close database and Redis connections.
4. Exit.

Without it, every deploy cuts off whatever requests were running at that moment.

### Exercise

Add three things to `server.mjs`:

1. `GET /slow-cpu`: block the thread for 5 seconds with a busy loop.
   `const end = Date.now() + 5000; while (Date.now() < end) {}`
2. `GET /slow-io`: wait 5 seconds without blocking.
   `await new Promise((r) => setTimeout(r, 5000));`
3. Graceful shutdown: on `SIGTERM` and `SIGINT`, log it, call `server.close()`, and exit in its callback.

**Experiments**

1. `curl localhost:3000/slow-cpu`, then quickly `curl localhost:3000/health` in another terminal. Note how long `/health` takes.
2. Same with `/slow-io`. Compare.
3. Start `curl localhost:3000/slow-io`, then press Ctrl+C on the server within 5 seconds. Do it once without the shutdown handler and once with it. Watch whether curl gets its response.
4. A tiny supervisor. Run the server like this, then hit the broken-JSON crash from 1.1 by temporarily removing the `try/catch`:
   ```sh
   until node playground/ch01/server.mjs; do echo "crashed, restarting"; sleep 1; done
   ```
   systemd, Docker's restart policy, and Kubernetes do exactly this, with more care.
