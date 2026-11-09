# Chapter 3: Production API Design

## Lesson 3.1: Designing resources

**REST** is a convention for HTTP APIs: URLs name *things* (resources), and HTTP methods say what to do with them. The value of following it is that every developer on every team can guess your API before reading the docs.

### Teamboard's first resources

| Method and path | Meaning | Success |
| --- | --- | --- |
| `GET /api/projects` | List projects | `200` |
| `POST /api/projects` | Create a project | `201` with the new project |
| `GET /api/projects/:id` | One project | `200` |
| `PATCH /api/projects/:id` | Change some fields | `200` with the updated project |
| `DELETE /api/projects/:id` | Delete | `204`, no body |
| `GET /api/projects/:projectId/tasks` | Tasks in a project | `200` |
| `POST /api/projects/:projectId/tasks` | Create a task in a project | `201` |
| `GET /api/tasks/:id` | One task | `200` |
| `PATCH /api/tasks/:id` | Change a task | `200` |
| `DELETE /api/tasks/:id` | Delete a task | `204` |

**Nest one level, at most.** A collection that belongs to a parent goes under it (`/projects/:projectId/tasks`). A single item is addressed by its own ID (`/tasks/:id`), because the ID is already unique. `/projects/1/tasks/42/comments/7` forces every client to know the whole chain.

### Status codes that matter

| Code | Meaning | Teamboard example |
| --- | --- | --- |
| `200 OK` | Success with a body | Get or update a task |
| `201 Created` | A new resource exists | Create a project |
| `204 No Content` | Success, nothing to return | Delete a task |
| `400 Bad Request` | The input is malformed | Missing `name`, ID is not a UUID |
| `401 Unauthorized` | We do not know who you are | No session (Chapter 6) |
| `403 Forbidden` | We know you, and the answer is no | Viewer tries to delete (Chapter 7) |
| `404 Not Found` | No such resource | Unknown project ID |
| `409 Conflict` | Valid, but clashes with current state | Project name already taken |
| `422 Unprocessable Entity` | Valid shape, breaks a business rule | Closing a task with open subtasks |
| `429 Too Many Requests` | Rate limited | Chapter 11 |
| `500 Internal Server Error` | Our bug | Anything unexpected |

The split that matters: **4xx means the client must change the request. 5xx means the server failed, and retrying might work.** Clients, load balancers, and monitoring all act on that difference.

### PATCH vs PUT

- **PUT** replaces the whole resource. Fields you leave out are reset.
- **PATCH** changes only the fields you send.

Most APIs use PATCH, because a client editing one field should not need to know every other field.

### Response shapes

- Single resource: return the object.
- **Lists: always wrap them**, `{ "data": [...] }`. A bare array cannot grow. When you add pagination later, you need somewhere to put `nextCursor`, and changing an array to an object breaks every client.

## Lesson 3.2: Anatomy of a feature module

A NestJS **module** is one feature's folder plus a class that declares what is inside and what other modules may use.

```
src/projects/
├── projects.module.ts       wiring: what's inside, what's exported
├── projects.controller.ts   HTTP: routes, params, status codes
├── projects.service.ts      business rules
├── projects.repository.ts   storage (in memory now, Prisma in Chapter 4)
├── project.ts               the Project type
└── dto/                     input shapes (DTO = data transfer object)
```

### Three layers, one direction

```
Controller
```

```
Controller ──> Service
```

```
Controller ──> Service ──> Repository ──> storage
```

Each layer only calls the one below it.

| Layer | Knows about | Never knows about |
| --- | --- | --- |
| Controller | HTTP: routes, params, status codes | Business rules, storage |
| Service | Business rules (unique names, what may be deleted) | HTTP, how storage works |
| Repository | How to read and write data | Rules, HTTP |

What this buys you:

- **Chapter 4 replaces the repository** with Prisma. The service and controller do not change.
- **The service runs from anywhere.** A cron job or a queue worker calls `projectsService.create()` with the same rules as HTTP.
- **Tests replace one layer.** Test the service with a fake repository, no database needed.

### Dependency injection

A class lists what it needs in its constructor:

```ts
constructor(private readonly repo: ProjectsRepository) {}
```

Nest creates one instance of each provider and passes it in. You never write `new ProjectsRepository()`. If you know React, it is close to Context: the module *provides*, and the constructor *consumes*.

The module controls visibility:

```ts
@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectsRepository],
  exports: [ProjectsService],
})
```

Only `ProjectsService` is exported. Another module that imports `ProjectsModule` can use the service but cannot reach the repository. In a multi-team company, this is the contract: the Projects team can rewrite their storage and nobody else breaks.

### Errors from the service

The service throws Nest's built-in exceptions. Nest turns them into status codes:

```ts
throw new NotFoundException(`Project ${id} not found`);       // 404
throw new ConflictException(`A project named "x" exists`);    // 409
```

### A bug worth remembering

The first version of `update` did this:

```ts
this.repo.update(id, { name: dto.name, description: dto.description });
```

A PATCH with only `{ "description": "New" }` made `dto.name` `undefined`. The repository spread `{ name: undefined }` over the project and **wiped its name**. In JavaScript, `{ ...a, ...{ x: undefined } }` sets `x` to `undefined`; it does not skip it. The fix copies only the fields the client actually sent. Every PATCH handler needs this.

### TypeScript types do not exist at runtime

The controller declares `@Body() body: CreateProjectDto`. That type is erased when TypeScript compiles. `POST /api/projects` with `{}` returns `201` and creates a project with no name. Lesson 3.3 fixes this with runtime validation.

### Exercise: the Tasks module

Build `src/tasks/` following the Projects module's shape.

**The Task type**

```ts
interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: 'todo' | 'in_progress' | 'done';
  createdAt: Date;
  updatedAt: Date;
}
```

**Routes:** the five task routes from the table in Lesson 3.1. A new task starts as `todo`.

**Rules**

1. Creating or listing tasks for a project that does not exist returns `404`. `TasksService` must ask `ProjectsService`, so `TasksModule` imports `ProjectsModule`.
2. `GET /api/projects/:projectId/tasks?status=done` filters by status.
3. PATCH copies only the fields the client sent.

**Hints**

- One controller can serve both URL shapes: `@Controller()` with no prefix, then `@Get('projects/:projectId/tasks')` and `@Get('tasks/:id')`.
- `@Query('status') status?: string` reads the query string.
- Import DTO types with `import type`, or TypeScript complains about decorator metadata.
- Register `TasksModule` in `app.module.ts`.

**Experiments**

1. Create a project, then two tasks in it, then list them.
2. Create a task in a random UUID project. Expect `404`.
3. Mark one task `done`, then list with `?status=done`.
4. PATCH only `status`. Check that `title` survived.
5. POST a task with `{}`. Note what happens. Lesson 3.3 fixes it.

### What the review found

Two root causes explained almost every bug in the first version of the Tasks module.

**1. The DTO copied the entity.** `CreateTaskDto` had `id`, `projectId`, `status`, `createdAt`, and `updatedAt`, and the repository spread the request body into the new task. So the client controlled fields only the server should set:

- `POST` with an existing task's `id` created a second task claiming the same ID.
- `PATCH { "projectId": "<other>" }` moved a task into a project that does not exist.
- No default `status`, so tasks had none.

The rule: **an entity is what you store. A DTO is what the client is allowed to send.** They are different types.

| | Entity `Task` | `CreateTaskDto` | `UpdateTaskDto` |
| --- | --- | --- | --- |
| `id` | ✓ | server generates | never |
| `projectId` | ✓ | from the URL | never |
| `title` | ✓ | required | optional |
| `description` | ✓ | optional | optional |
| `status` | ✓ | server sets `todo` | optional |
| `createdAt`, `updatedAt` | ✓ | server sets | server sets |

And never spread a request body into stored data. Copy the allowed fields one by one.

**2. "Not found" was not checked on every path.** The same fail-closed lesson as Chapter 1:

- `GET /tasks/:id` returned `200` with an empty body (the service returned nothing).
- `PATCH` on an unknown ID returned `200` and created a ghost task `{ "title": "x" }`.
- `DELETE` on an unknown ID returned `200`.
- A task could be created in a project that does not exist.

The fix is one private `findOne(id)` in the service that throws `404`, called by get, update, and delete. Creation calls `projectsService.findOne(projectId)` first.

## Lesson 3.3: Validation at the boundary

### Parse, don't validate

Everything that enters the API is `unknown`: body, query string, params, headers. The rule is to **parse it once, at the edge**, into a typed value or a `400`. After that, every layer inside trusts the type and never re-checks.

```
unknown JSON ──> [ pipe: parse ] ──> typed DTO ──> controller ──> service
                      │
                      └── invalid ──> 400 with field errors
```

This is what a NestJS **pipe** is for. It sits between the request and the controller method, and it can transform the value or reject it.

### Why zod, and why a shared package

One zod schema gives three things:

1. **Runtime validation** on the API (the pipe).
2. **A TypeScript type** for both apps (`z.infer<typeof schema>`), so the hand-written DTO interfaces go away.
3. **Form validation in React**, using the exact same rules the API enforces.

The schemas live in `packages/contracts` (`@teamboard/contracts`). Both apps depend on it with `workspace:*`. When the API team makes `title` required, the web app gets a type error in the same pull request, not a bug report next week. In a multi-team company, this package is the contract between frontend and backend, and both teams review changes to it.

You will also meet **class-validator** in many NestJS codebases: decorators like `@IsString()` on DTO classes, run by Nest's built-in `ValidationPipe`. It works, but the rules cannot be shared with a React app, and the class and the type can drift. The idea is the same: parse at the boundary.

### Strip or reject unknown fields

- `z.object` **strips** unknown keys. `{ "title": "x", "id": "hacked" }` becomes `{ "title": "x" }`. Lenient, and old clients sending an extra field keep working.
- `z.strictObject` **rejects** unknown keys with a `400`. Strict, and it tells clients about typos (`titel`).

Either one closes the mass-assignment hole from Lesson 3.2. Teamboard uses stripping.

### How the contracts package is built

`packages/contracts` compiles to `dist/` with `tsc`. Its `package.json` `exports` points at `dist/index.js`. Turbo builds it before the apps because of `"dependsOn": ["^build"]`, on both `build` and `dev`. During `pnpm dev`, its own `dev` task (`tsc --watch`) rebuilds it on every change.

### Exercise

1. **Schemas.** Fill in `packages/contracts/src/tasks.ts`: `taskStatusSchema`, `createTaskSchema`, `updateTaskSchema`, `listTasksQuerySchema`, and their `z.infer` types. Follow `projects.ts`.
2. **The pipe.** Write `apps/api/src/common/zod-validation.pipe.ts`:
   - A class implementing `PipeTransform`, taking a zod schema in its constructor.
   - `transform(value)` runs `schema.safeParse(value)`.
   - On failure, throw `BadRequestException` with the field errors (`z.flattenError(result.error).fieldErrors`).
   - On success, return `result.data`, the parsed value, not the original.
3. **Use it** in both controllers: `@Body(new ZodValidationPipe(createTaskSchema)) body: CreateTaskInput`. For the list route, validate the whole query object: `@Query(new ZodValidationPipe(listTasksQuerySchema)) query: ListTasksQuery`.
4. **Delete** both `dto/` folders. Services import the contract types instead.

**Experiments**

| Request | Expect |
| --- | --- |
| `POST /projects/:id/tasks` with `{}` | `400`, `title` listed as the problem |
| Title `"   "` | `400` (trimmed to empty) |
| `{ "title": "x", "id": "hacked" }` | `201`, a server-generated ID |
| `?status=banana` | `400` |
| `PATCH { "description": null }` | `200`, description cleared |

### What the experiments showed

Validation removed a whole class of bugs at once: `{}`, unknown fields, bad statuses, and broken JSON all stop at the edge with a `400`. Two lessons from the run:

- **`.min(1)` does not reject `"   "`.** Three spaces is three characters. Add `.trim()` before `.min(1)`, so the schema both cleans and checks.
- **The API now returns three different error shapes.** That is the next lesson.

```
Validation pipe:   {"title":["Invalid input: expected string, received undefined"]}
Nest exceptions:   {"message":"Project … not found","error":"Not Found","statusCode":404}
Body parser:       {"message":"Unexpected token 'o', \"oops\" is not valid JSON","error":"Bad Request","statusCode":400}
```

## Lesson 3.4: One error format

Every client of the API (the React app, a mobile app, a partner's integration) has to read errors. If each part of the API returns a different shape, each client writes special cases, and a new error path breaks them.

### Problem Details (RFC 9457)

**Problem Details** is the standard JSON error format for HTTP APIs, served as `Content-Type: application/problem+json`. Teamboard uses it with two extra fields:

```json
{
  "type": "about:blank",
  "title": "Validation failed",
  "status": 400,
  "detail": "The request body has invalid fields.",
  "code": "VALIDATION_FAILED",
  "errors": { "title": ["Too small: expected string to have >=1 characters"] }
}
```

| Field | Purpose |
| --- | --- |
| `status` | The HTTP status, repeated in the body for logging and clients that lose headers |
| `title` | Short, human summary of this kind of error. Same for every `404`. |
| `detail` | Human explanation of this occurrence ("Project 123 not found") |
| `code` | **Machine-readable** and stable: `VALIDATION_FAILED`, `NOT_FOUND`, `CONFLICT`, `INTERNAL` |
| `errors` | Field errors, only for validation failures |

**Clients branch on `code`, never on message text.** Messages get reworded and translated. `code` is part of the contract and only changes with a version bump.

### One filter catches everything

A NestJS **exception filter** runs when anything throws. A global filter decorated with `@Catch()` (no arguments) catches every error in the app and is the one place that writes error responses.

```
Pipe throws ────────┐
Service throws ─────┼──> Global exception filter ──> application/problem+json
Unknown bug throws ─┘
```

Two kinds of errors reach it:

1. **Expected errors**: an `HttpException` you or Nest threw (`NotFoundException`, the validation pipe). Use its status, map it to a `code`, and show its message as `detail`.
2. **Unexpected errors**: anything else (a `TypeError`, a database driver crash). Return `500` with a generic message. **Log the full error and stack on the server, and never send it to the client.** Stack traces leak file paths, library versions, and sometimes data.

### Exercise

1. **A validation exception.** In `common/`, create `ValidationException extends BadRequestException`, carrying the zod field errors in a property. The pipe throws it instead of a plain `BadRequestException`.
2. **The filter.** Create `common/problem-details.filter.ts`: a class with `@Catch()` implementing `ExceptionFilter`.
   - Get the response object: `host.switchToHttp().getResponse<Response>()` (type from `express`).
   - `ValidationException` → `400`, `VALIDATION_FAILED`, with `errors`.
   - Any other `HttpException` → its status, and a `code` derived from the status (`404` → `NOT_FOUND`, `409` → `CONFLICT`, other 4xx → `BAD_REQUEST`).
   - Anything else → `500`, `INTERNAL`, `detail: "Something went wrong"`. Log it with Nest's `Logger`.
   - Send with `response.status(status).type('application/problem+json').json(body)`.
3. **Register it globally** in `app.module.ts`, as a provider: `{ provide: APP_FILTER, useClass: ProblemDetailsFilter }`. This form lets the filter use dependency injection later (Chapter 10 injects a logger).

**Experiments**

| Request | Expect |
| --- | --- |
| Create a task with `{}` | `400`, `VALIDATION_FAILED`, `errors.title` |
| Unknown project ID | `404`, `NOT_FOUND` |
| Duplicate project name | `409`, `CONFLICT` |
| Body `oops` | `400`, `BAD_REQUEST` |
| Temporarily add `throw new Error("db password is hunter2")` to `/health` | `500`, `INTERNAL`, generic detail. The secret appears only in the server log. |

Check the `Content-Type` header with `curl -i`.

### What the experiments showed

| Request | Response |
| --- | --- |
| Unknown project | `404 NOT_FOUND`, detail names the ID |
| Duplicate name | `409 CONFLICT` |
| Body `oops` | `400 BAD_REQUEST` |
| `/health` throwing `Error("db password is hunter2")` | `500 INTERNAL`, "Something went wrong". The secret appeared only in the server log, tagged `[ProblemDetailsFilter]`. |

Every response came back as `application/problem+json`. Two details to get right:

- The pipe must throw `ValidationException`, or validation errors fall into the generic `HttpException` branch and the field errors are lost (`"detail": "Bad Request Exception"`).
- Field errors go in their own `errors` property. `detail` is always a human-readable string, so clients can show it without checking its type.

## Lesson 3.5: Pagination, filtering, and sorting

### Why every list needs a limit

A list endpoint without a limit returns everything. With 50,000 tasks, that is one slow database query, megabytes over the network, and a frozen browser tab. **Every list endpoint has a default limit and a maximum**, enforced by the schema, so no client can ask for everything.

### Offset pagination

```
GET /tasks?page=3&limit=20      →  SQL: ORDER BY created_at LIMIT 20 OFFSET 40
```

- **Good:** jump to any page, show "page 3 of 12".
- **Slow on deep pages:** the database reads and throws away all the skipped rows. Page 5,000 reads 100,000 rows to return 20.
- **Unstable:** if a task is inserted while the user is on page 1, every row shifts by one. Page 2 then repeats the last item of page 1. A deletion skips one instead.

### Cursor pagination

The client sends back a **cursor**: a marker for the last item it saw. The server returns the items *after* that item.

```
GET /tasks?limit=20                   → { data: [20 tasks], nextCursor: "eyJj…" }
GET /tasks?limit=20&cursor=eyJj…      → { data: [next 20],  nextCursor: "eyJk…" }
…                                     → { data: [last 7],   nextCursor: null }
```

In SQL (Chapter 4), "after the cursor" is a `WHERE` on an indexed column, so page 5,000 costs the same as page 1:

```sql
WHERE (created_at, id) > ('2026-11-07T10:00:00Z', 'abc…')
ORDER BY created_at, id
LIMIT 21
```

- **Fast at any depth**, and **stable** while rows are inserted or deleted.
- **No page numbers** and no total count. Fine for feeds, infinite scroll, and most APIs.

Rule of thumb: offset for small admin tables with page numbers; cursor for everything else. Teamboard uses cursors.

### Three details that make cursors correct

1. **A tie-breaker.** Two tasks can share the same `createdAt` (created in the same millisecond). Sorting by `createdAt` alone, the order between them is undefined, and paging can skip or repeat one. Sort by `(createdAt, id)`: `id` is unique, so the order is total.
2. **Fetch one extra.** Ask storage for `limit + 1` rows. If you got more than `limit`, there is a next page: return the first `limit` and build `nextCursor` from the last one returned. Otherwise `nextCursor` is `null`. No extra count query needed.
3. **Opaque cursors.** Encode the position as base64url JSON: `{ "createdAt": "…", "id": "…" }`. Clients pass it back untouched and never build one. You can change what is inside without breaking anyone. A cursor that does not decode is a `400`.

### Filtering and sorting

Filter and sort only on fields the schema allows: `status: z.enum([...])`, `sort: z.enum(['createdAt', '-createdAt'])`. Never pass raw query strings into a database query. An allow-list prevents injection, and it keeps clients on indexed columns (Chapter 4).

### Exercise: cursor pagination for tasks

1. **Schema.** Extend `listTasksQuerySchema`: `limit` (`z.coerce.number().int().min(1).max(100).default(20)`) and `cursor` (optional string).
2. **Cursor helpers.** In `apps/api/src/common/cursor.ts`, write `encodeCursor({ createdAt, id })` and `decodeCursor(cursor)`. Use `Buffer.from(json).toString('base64url')` and back. `decodeCursor` throws `BadRequestException` if the cursor is not valid.
3. **Repository.** For the project and optional status: sort by `createdAt`, then `id`. Keep only items after the cursor. Take `limit + 1`.
4. **Service and controller.** Return `{ data, nextCursor }`.

**Experiments**

```sh
for i in $(seq 1 25); do curl -s -X POST localhost:3000/api/projects/$P/tasks \
  -H 'Content-Type: application/json' -d "{\"title\":\"Task $i\"}" > /dev/null; done
```

1. Page through with `?limit=10`. Expect 10, 10, 5, then `nextCursor: null`. No task appears twice.
2. Tasks created in a fast loop often share a millisecond. Remove the `id` tie-breaker and page again. Watch for a repeated or missing task.
3. Send `?cursor=garbage`. Expect `400`.
4. Send `?limit=500`. Expect `400`.

### What the build showed

**One compare function, used twice.** `comparePosition(a, b)` decides the order (`createdAt`, then `id`). The repository uses it to sort and to keep only rows after the cursor. Because both use the same function, pages can never overlap or leave gaps. Tests in `common/cursor.spec.ts` and `tasks/tasks.repository.spec.ts` prove it: removing the `id` tie-breaker makes "pages through everything exactly once" fail.

**A precedence trap.** The first version was one expression:

```ts
timeDiff || a.id < b.id ? -1 : a.id > b.id ? 1 : 0
```

`? :` binds looser than `||`, so JavaScript read it as `(timeDiff || a.id < b.id) ? -1 : …` and returned `-1` whenever the times differed, even when `a` was later. Two statements, one per rule, fixed it and read better.

**Narrow first, limit last.** The first `list` took `limit + 1` rows and then filtered by status. With 7 `todo` tasks followed by 3 `done`, `?status=done&limit=2` returned an empty page and `nextCursor: null`, telling the client there were no done tasks. Every narrowing step (project, status, cursor) runs before the limit. SQL works the same way: `WHERE` before `LIMIT`.

**Over HTTP, 25 tasks, `limit=10`:**

```
page 1: 10 tasks (Task 1 .. Task 10),  nextCursor=yes
page 2: 10 tasks (Task 11 .. Task 20), nextCursor=yes
page 3:  5 tasks (Task 21 .. Task 25), nextCursor=null
total 25, unique 25
?cursor=garbage → 400 BAD_REQUEST "Invalid cursor"
?limit=500      → 400 VALIDATION_FAILED
?limit=0        → 400 VALIDATION_FAILED
?limit=2.5      → 200   (needs .int() in the schema)
```

**Query strings are always strings.** Replacing `z.coerce.number().int()` with `z.int()` broke every request with a limit: `?limit=10` arrives as the string `"10"`, and `z.int()` rejects strings. Only the default (no `limit` at all) still worked, so the bug hid from a quick test. Body JSON keeps numbers as numbers. Query strings, path params, and headers never do, so their schemas need `z.coerce`.

## Lesson 3.6: Idempotency keys

### The problem

An operation is **idempotent** when doing it twice has the same effect as doing it once.

| Method | Idempotent? | Twice means |
| --- | --- | --- |
| `GET` | Yes | Read twice, nothing changes |
| `PUT` | Yes | Same full replacement twice |
| `DELETE` | Yes | Deleted once; the second call finds nothing |
| `PATCH` | Usually | `status: "done"` twice is the same. `count += 1` twice is not. |
| `POST` | **No** | **Two resources created** |

`POST` gets sent twice more often than you think:

```
Client ──POST──> Server: task created ✓
Client <──201─── ✗ network drops the response
Client ──POST──> Server: task created again ✗ (the client retried)
```

Double-clicks, mobile networks, load balancer timeouts, and automatic retries all cause it. For tasks it is a nuisance. For payments it charges a customer twice.

### The fix: Idempotency-Key

1. The client generates a unique ID per *user action* (`crypto.randomUUID()`) and sends it as a header: `Idempotency-Key: 7f3c…`. A retry of the same action sends the same key.
2. The first time the server sees a key, it does the work and stores **key → response**.
3. When the same key arrives again, the server skips the work and returns the stored response.

```
POST + key 7f3c ──> new key:   create the task, store the response ──> 201 {task}
POST + key 7f3c ──> known key: return the stored response          ──> 201 {same task}
```

Stripe, PayPal, and most payment APIs work this way.

### Edge cases a real implementation handles

| Situation | Response |
| --- | --- |
| Same key, same body, first request finished | Replay the stored response |
| Same key, **different body** | `422`: the client reused a key for a different action, a client bug |
| Same key while the first request is **still running** | `409`: try again shortly |
| First request **failed** | Forget the key, so a retry can succeed |
| Key older than 24 hours | Expired and forgotten (Redis TTL, Chapter 11) |

Keys are scoped by route (and by user, from Chapter 6), so two users can never collide.

### Interceptors

A NestJS **interceptor** wraps the route handler. It runs code *before* the handler and *after* it, and it can skip the handler entirely.

```
request ──> Interceptor (before) ──> Controller ──> Interceptor (after) ──> response
```

```
request ──> Interceptor: "seen this key" ──> stored response   (controller never runs)
```

The handler's result arrives as an **Observable**, from the RxJS library. For an HTTP request, it behaves like a Promise that emits one value. Two operators cover almost everything:

- `tap(fn)`: look at the value without changing it (store the response).
- `catchError(fn)`: react to an error (forget the key), then rethrow it.

`of(value)` creates an Observable that emits `value` immediately. Returning `of(stored)` from an interceptor sends `stored` as the response without running the controller.

### Exercise, step 1: feel the interceptor

Create `apps/api/src/common/idempotency.interceptor.ts`:

```ts
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    console.log('BEFORE', req.method, req.url, req.headers['idempotency-key']);

    return next.handle().pipe(
      tap((body) => console.log('AFTER', body)),
    );
  }
}
```

Put `@UseInterceptors(IdempotencyInterceptor)` on the create-task route. Create a task with an `Idempotency-Key` header and watch the server log.

Then replace the `return` with `return of({ fake: true });` (import `of` from `rxjs`). Create a task again, then list tasks. The client got `{ fake: true }`, and no task was created: the controller never ran. That is how a replay works. Undo it afterwards.

### What the build showed

The finished interceptor, in order:

1. No `Idempotency-Key` header: run the handler normally.
2. Scope the key with method and URL. Hash the body with `sha256`.
3. Known key: different hash → `422`; still running → `409`; done → set `Idempotent-Replayed: true` and `return of(savedResponse)`. The controller never runs.
4. New key: `start()`, run the handler, `tap` → `finish()`, `catchError` → `forget()` and rethrow.

Over HTTP, two requests sent at the same moment with the same key: one `201` that created the task, one `201` with `Idempotent-Replayed: true`. One task in the list. A third request with the same key and a different title: `422 UNPROCESSABLE_ENTITY`.

Mistakes made on the way, each worth remembering:

- **Encoding is not hashing.** Base64 is reversible and grows with the input. A hash (`sha256`) is a fixed-size fingerprint, made for "are these two the same?".
- **`throwError()` alone does nothing.** It only creates an Observable. Outside a `pipe`, use a plain `throw`. Inside `catchError`, `return throwError(() => err)`.
- **`catchError` must return an Observable.** Returning nothing crashed RxJS (a `500` replaced the real `400`). An `async` callback returns a Promise, which RxJS treats as success, silently swallowing the error.
- **Without an early return for "no key", every keyless request shares one entry** (`"undefined"`), and one user would receive another user's response.

### Why this version is not production-ready yet

- **Check-then-set.** `get()` then `start()` is safe here only because nothing `await`s between them, and Node runs one thing at a time. With Redis, both calls are network round trips, and two requests can both see "no record". The fix is one atomic operation, `SET key value NX` ("set only if missing"), covered with race conditions in Chapter 5 and Redis in Chapter 11.
- **Memory store.** Lost on restart and not shared between API copies (Chapter 1). Redis fixes both and adds a 24-hour expiry.
- **Scope by user** once auth exists (Chapter 6), so two users can never share a key.

## Lesson 3.7: Versioning and OpenAPI

### Breaking vs non-breaking changes

An API change is **breaking** when a client that worked yesterday fails today without changing its code.

| Change | Breaking? |
| --- | --- |
| Add a new endpoint | No |
| Add an optional field to a request | No |
| Add a field to a response | No (clients ignore unknown fields) |
| Remove or rename a response field | **Yes** |
| Change a field's type (`"5"` → `5`) | **Yes** |
| Make an optional request field required | **Yes** |
| Change a status code or an error `code` | **Yes** |
| Tighten validation (max 200 → max 100 chars) | **Yes** |

The best versioning strategy is to **not need a new version**: make additive changes, and keep old fields working while clients move.

### Even your own SPA is an "old client"

The React app and the API deploy separately. During a deploy, and for hours after, users still have the old JavaScript bundle open in their tabs, calling the new API. A breaking API change breaks every open tab. So even with one team and one frontend, the API must stay compatible for a window.

### When you must break: versions

| Strategy | Example | Used by |
| --- | --- | --- |
| **URI** | `/api/v1/tasks`, `/api/v2/tasks` | Most public APIs. Visible, easy to route and cache. |
| Header | `Accept: application/vnd.teamboard.v2+json` | Some enterprise APIs |
| Date-based | `Stripe-Version: 2026-10-01` | Stripe |

Teamboard uses URI versioning. NestJS supports it directly:

```ts
app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
```

Every route becomes `/api/v1/...`. A controller or route can opt into another version with `@Version('2')`, so v1 and v2 handlers live side by side. Routes that are not part of the product API, like `/health`, use `@Version(VERSION_NEUTRAL)` and stay at `/api/health`.

Retiring an old version: announce it, add `Deprecation` and `Sunset` response headers with the shutdown date, watch the logs until traffic on it reaches zero, then remove it.

### One place that configures the app

`main.ts` calls `setGlobalPrefix('api')`. Each e2e test calls it again on its own. Add versioning to `main.ts` only, and the tests silently test a different app than production. Put all app-level setup in one function that both use:

```ts
// src/configure-app.ts
export function configureApp(app: INestApplication) { /* prefix, versioning, shutdown hooks */ }
```

### Exercise, step 1: versioning

1. Create `apps/api/src/configure-app.ts` exporting `configureApp(app)`. Move the global prefix and shutdown hooks there, and add URI versioning with default version `'1'`.
2. Call it from `main.ts` and from `beforeEach` in both e2e test files, instead of `setGlobalPrefix`.
3. Make `/health` version-neutral with `@Version(VERSION_NEUTRAL)` on the route.
4. Update the e2e test URLs to `/api/v1/...` (the health test stays `/api/health`).

**Check**

```sh
pnpm --filter @teamboard/api test:e2e        # all pass
curl localhost:3000/api/health                # 200
curl localhost:3000/api/v1/projects           # 200
curl localhost:3000/api/projects              # 404
```

### What step 1 showed

```
/api/health       200   (VERSION_NEUTRAL)
/api/v1/health    404
/api/v1/projects  200
/api/projects     404   (no unversioned routes any more)
```

`configureApp(app)` is now the only place that sets the prefix, versioning, and shutdown hooks. `main.ts` and every e2e test call it, so tests run the same app as production.

### OpenAPI

**OpenAPI** (formerly called Swagger) is a standard, machine-readable description of an HTTP API: every path, method, parameter, request body, response, and error, as one JSON or YAML document. From that one file, tools generate:

- **Interactive docs** (Swagger UI, Scalar): every endpoint, with a "try it" button.
- **Typed clients** for any language: a mobile team in Kotlin or Swift, a partner in Python.
- **Mock servers**, so a frontend team can start before the backend is done.
- **Contract tests** that fail when the API stops matching its description.

Two ways to produce it:

| Approach | How | Risk |
| --- | --- | --- |
| **Code-first** | Generate the document from code (decorators or schemas) | Docs only as good as the annotations |
| **Spec-first** | Write the YAML by hand first, generate code from it | Spec and code drift unless generation is enforced |

Teamboard is code-first, from the zod schemas in `@teamboard/contracts`. The `zod-openapi` library turns them into an OpenAPI 3.1 document, so validation, TypeScript types, and docs all come from one source.

### The wire format is not the entity

The API's `Task` has `createdAt: Date`. On the wire it is JSON, and JSON has no dates: the client receives a string like `"2026-11-09T10:00:00.000Z"`. The response schema in the contract describes what the client actually receives: `createdAt: z.iso.datetime()`, a string. This is the third shape of a task, next to the entity and the input DTOs.

### Exercise, step 2: describe and serve the API

Install:

```sh
pnpm --filter @teamboard/contracts add zod-openapi@6.0.2
pnpm --filter @teamboard/api add @nestjs/swagger@12.1.1
```

**2a. Response schemas** in `packages/contracts`:

- `taskSchema`: every field a client receives. Dates as `z.iso.datetime()`. Add `.meta({ id: 'Task' })` so it becomes a named, reusable component in the document.
- `taskPageSchema`: `{ data: Task[], nextCursor: string | null }`, id `TaskPage`.
- `problemSchema` in a new `problem.ts`: `type`, `title`, `status`, `detail`, `code`, and optional `errors` (`z.record(z.string(), z.array(z.string()))`), id `Problem`.

**2b. The document** in `packages/contracts/src/openapi.ts`: call `createDocument` from `zod-openapi` and export the result as `openApiDocument`.

- `openapi: '3.1.0'`, an `info` with title and version, and `servers: [{ url: '/api/v1' }]`.
- `paths` for the five task routes. OpenAPI writes path params as `{projectId}`, not `:projectId`.
- For each operation: `requestParams` (`path`, `query`, and for POST the `header` `idempotency-key`), `requestBody` where there is one, and `responses` with the success response plus the errors it can return (`400`, `404`, `409`, `422`) as `application/problem+json` with `problemSchema`.
- Export it from `index.ts`.

**2c. Serve it.** In `configureApp`, call `SwaggerModule.setup('api/docs', app, openApiDocument)` from `@nestjs/swagger`.

**Check**

- Open `http://localhost:3000/api/docs`. Every task route is listed with its schemas.
- Use "Try it out" on `GET /projects/{projectId}/tasks` with a real project ID.
- `curl localhost:3000/api/docs-json` returns the raw document. This file is what a mobile team or a client generator would use.

### What step 2 built

- `packages/contracts/src/problem.ts`: `problemSchema`, the error shape.
- `projectSchema`, `projectListSchema`, `taskSchema`, `taskPageSchema`: response shapes, dates as ISO strings.
- `packages/contracts/src/openapi.ts`: `openApiDocument`, built with `createDocument` from `zod-openapi`. All 10 routes, their params, bodies, success responses, and `application/problem+json` errors.
- `configureApp` serves the raw document at `/api/docs-json` and interactive docs at `/api/docs`.

The generated document (OpenAPI 3.1) has 5 named components (`Project`, `ProjectList`, `Task`, `TaskPage`, `Problem`), and the list route's `limit`, `status`, and `cursor` query params come straight from `listTasksQuerySchema`.

**Why Scalar and not `@nestjs/swagger`.** `@nestjs/swagger` builds documents from decorators on DTO classes, and its TypeScript types for a document did not match the ones `zod-openapi` produces (`paths` optional vs required, and deeper differences). Making it compile would have meant casting with `as unknown as`, which tells the compiler to stop checking. Scalar takes the document as plain content, so nothing is forced. Swagger UI and Scalar are both just viewers: they render the same OpenAPI JSON. "Swagger" is also still the common name people use for OpenAPI itself.

**What can still drift.** The route table in `openapi.ts` is written by hand. If someone adds a route to a controller and forgets the document, nothing fails. A contract test that compares Nest's registered routes with the document's `paths` closes that gap (Chapter 9).

## Chapter 3 production checklist

- Resources are nouns, methods are verbs, nesting is one level at most.
- Lists are wrapped (`{ data, nextCursor }`), have a default limit and a maximum, and use cursor pagination with a unique tie-breaker.
- Controllers only translate HTTP. Services hold rules. Repositories hold storage.
- Every input (body, query, params, headers) is parsed by a schema at the edge. Unknown fields are stripped or rejected.
- Entities, input DTOs, and response schemas are three separate types.
- Every error is `application/problem+json` with a stable `code`. Unexpected errors return a generic `500` and are logged in full on the server.
- `POST` endpoints that create things accept an `Idempotency-Key`.
- Routes are versioned (`/api/v1`). Changes are additive. A breaking change gets a new version and a deprecation period.
- The API has an OpenAPI document generated from the same schemas it validates with.

## Chapter 3 common mistakes

- Spreading a request body into stored data (mass assignment).
- Checking "is it truthy?" instead of "was it sent?" (`!== undefined`) in PATCH handlers.
- Applying a limit before a filter.
- Forgetting that query strings, params, and headers are always strings (`z.coerce`).
- Returning raw errors or stack traces to clients.
- Branching on error message text in the frontend instead of `code`.
- Configuring the app in `main.ts` only, so tests run a different app.

## My notes

_Write in your own words: what each layer owns, and why lists are wrapped._
