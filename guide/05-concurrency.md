# Chapter 5: Concurrency, race conditions, and locking

Many requests touch the same data at the same time. This chapter is about what goes wrong when they do, and the tools that keep the data correct: constraints, atomic updates, isolation levels, row locks, version columns, and Redis locks.

## Lesson 5.1: One thread, many requests

### How Node runs many requests on one thread

Node runs your JavaScript on **one thread**. It still serves thousands of requests at once, because most of a request's time is spent *waiting*: for Postgres, for Redis, for another HTTP service. While one request waits, the thread runs another request's code.

```
time ─────────────────────────────────────────────────────────────▶

thread │ A: parse, validate │ B: parse, validate │ A: build response │ B: …
       │ A: send query ─┐   │ B: send query ─┐   │        ▲          │
                        │                    │            │
Postgres                └──── A's query ─────┼────────────┘
                                             └──── B's query ────────▶
```

The thread never runs two pieces of JavaScript at the same moment. It switches between requests only at one kind of place: an **`await`** (or a callback) on something that is not ready yet.

### The rule: every `await` is a gap

Between two `await`s, your code runs without interruption. No other request's code can run in the middle of it. At an `await`, the thread can switch to any other request, and that request can change shared state (a row in the database, a key in Redis, a variable in module scope) before your code resumes.

```ts
const existing = await repo.findByName(name);   // ← gap: other requests run here
if (existing) throw new ConflictException();
await repo.create({ name });                    // ← the world may have changed since the check
```

The smallest example, with no database at all:

```ts
let count = 0;
async function increment() {
  const current = count;            // read
  await Promise.resolve();          // gap
  count = current + 1;              // write, based on a stale read
}
await Promise.all(Array.from({ length: 100 }, increment));
console.log(count);                 // 1, not 100
```

All 100 calls read `0` before any of them writes. This is a **race condition**: the result depends on the order in which concurrent work happens to interleave.

### Check-then-act: the race in Teamboard

`ProjectsService.create` does exactly this:

```ts
await this.assertNameFree(dto.name);   // SELECT … WHERE name = $1
return await this.repo.create(…);      // INSERT …
```

Two requests with the same name:

```
Request A                          Request B                          Database
findByName('Apollo') ───────────────────────────────────────────────▶ none
                                   findByName('Apollo') ────────────▶ none
create('Apollo') ───────────────────────────────────────────────────▶ ✅ inserted
                                   create('Apollo') ────────────────▶ ❌ unique violation
201 Created                        500 Internal Server Error
```

Both checks passed, because neither insert had happened yet. The `UNIQUE` constraint on `projects.name` (Lesson 4.2) stops the second insert, so the data stays correct. The response is wrong: the client gets a 500 for an ordinary conflict, and the error log fills with stack traces for something that is not a bug in the server.

Measured with the checker (20 concurrent creates of one name, several rounds), before any fix:

| Round | Result |
| --- | --- |
| a typical bad round | `201: 1, 500: 19` |
| a partly lucky round | `201: 1, 409: 2, 500: 17` |
| first round | often all correct (the app is cold, so requests arrive spread out) |

The first version of the checker sent requests through supertest and passed most of the time. A race shows up only when timing allows it. A test that "passes" once proves nothing. Sending many requests at the same moment, several times, is what makes it visible.

### One thread does not protect you, and neither would a lock in memory

Two reasons:

1. **The shared state is not in your process.** It is in Postgres. The gap at `await` is exactly where another request reads the same row.
2. **Production runs several copies of the API** (Chapter 19). Even if you added an in-process mutex (a lock held in memory) around `create`, two copies would each hold their own mutex and still race against the same database.

```
API copy 1 ──┐
             ├──▶ Postgres (the only place both copies share)
API copy 2 ──┘
```

So the guarantee has to live in the shared place: the database.

### The fix: let the constraint decide

The `UNIQUE` constraint is atomic. Postgres checks and inserts in one step, so two inserts can never both succeed. The application's job is only to **translate** the constraint error into the right HTTP answer:

```
INSERT … ──▶ unique violation ──▶ Prisma error P2002 ──▶ ConflictException ──▶ 409 problem+json
```

Prisma raises `Prisma.PrismaClientKnownRequestError` with `code === 'P2002'` for a unique violation. `e.meta` names the constraint (`projects_name_key`) inside `driverAdapterError.cause.constraint.index`.

```ts
import { Prisma } from '@teamboard/db';

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}
```

Where to translate:

| Place | Pros | Cons |
| --- | --- | --- |
| **In the service**, around the write | Specific message ("A project named X already exists"). The service knows which constraint means what. | Repeat it at every write that can conflict. |
| **In `ProblemDetailsFilter`**, for every P2002 | One place. A forgotten case still returns 409, not 500. | Generic message. The filter must not leak table or constraint names to clients. |

A good default is both: the service handles the cases it knows about, and the filter is the safety net.

**What happens to `assertNameFree`?** Once the constraint error is handled, the check is redundant: it costs one extra query per create and still cannot prevent the race. Some teams keep it anyway, because it makes the common, non-concurrent case avoid an error round trip. It is a choice, not a fix. The fix is handling the constraint.

### The general pattern

| Race | Unsafe (check, then act) | Safe (one atomic step in the database) |
| --- | --- | --- |
| Unique name | `SELECT` name, then `INSERT` | `UNIQUE` constraint + handle the violation |
| Counter | read `count`, then write `count + 1` | `UPDATE … SET count = count + 1` (Lesson 5.2) |
| Read, change in JS, write back | `SELECT`, then `UPDATE` with the new values | atomic update, a row lock (5.4), or a version check (5.5) |

### Exercise

The checker is `apps/api/test/projects-name-race.e2e-spec.ts`: 10 rounds of 20 concurrent `POST /projects` with one name each. Every round must be exactly one `201` and nineteen `409`s with `code: "CONFLICT"`.

0. **Leftover from Lesson 4.5 review:** `ProjectsController.list()` returns `{ data: this.projects.findAll() }` without `await`, so `GET /api/v1/projects` answers `{"data":{}}`. Fix it.
1. **Feel the gap (2 minutes).** Run the counter example above with `node --input-type=module -e '…'`. Then move `await Promise.resolve()` *above* `const current = count` and run it again. Explain the difference to yourself.
2. **See the race in Teamboard.** Start the API (`pnpm dev`) and send 20 creates at once:
   ```sh
   seq 20 | xargs -P20 -I{} curl -s -o /dev/null -w '%{http_code}\n' \
     -XPOST localhost:3000/api/v1/projects -H 'content-type: application/json' \
     -d '{"name":"Race demo"}' | sort | uniq -c
   ```
   Find the P2002 stack trace in the API log. Run the checker and read its failure.
3. **Fix it in the service.** In `ProjectsService.create` and `ProjectsService.update` (a rename can race the same way), catch the P2002 error from the repository write and throw `ConflictException` with the same message `assertNameFree` uses. Rethrow anything else unchanged. Decide whether to keep `assertNameFree`, and write down why.
4. **Safety net in the filter.** In `ProblemDetailsFilter`, map any `P2002` that reaches it to `409` / `CONFLICT` with a generic `detail` (no table or constraint names). It must not log it as an error.
5. **Break it.** Temporarily add `await new Promise((r) => setTimeout(r, 50))` inside `assertNameFree`, after the `findByName`. That widens the gap. Run the checker: it still passes, because the fix does not depend on timing. Now remove your `catch` from step 3 and the filter mapping from step 4, and run it again with the sleep in place. Restore both, and remove the sleep.

**Check**

```sh
pnpm --filter @teamboard/api lint
pnpm --filter @teamboard/api typecheck
pnpm --filter @teamboard/api test:e2e      # 9 passed, 6 skipped
```

### What 5.1 showed

Measured over HTTP after the fix, 20 concurrent requests each:

| Request | Before | After |
| --- | --- | --- |
| `POST /projects`, one name | `201: 1, 500: 19` (typical round) | `201: 1, 409: 19` |
| `PATCH` 20 projects to one name | not measured | `200: 1, 409: 19` |
| `DELETE` one project | `204: 1, 404: 16, 500: 3` | `204: 1, 404: 19` (5 rounds) |

**A `catch` that does not rethrow swallows every other error.** The first version of the fix handled P2002 and fell through for everything else. The method then resolved to `undefined`, and the controller would answer `201` with an empty body for a database outage. TypeScript caught it (`TS2366: Function lacks ending return statement`). Rule: catch the errors you recognize, rethrow the rest unchanged.

**The same race was hiding in `remove()`.** It checked with `findOne`, then deleted. Concurrent deletes made the losers fail inside Prisma with `P2025` ("No record was found for a delete") and return 500. This is the same check-then-act shape as the name check. Same fix: let the database decide, then translate `P2025` to `404`. The `findOne` before `delete` became unnecessary. `update` has the same shape (a delete between `findOne` and `update` gives `P2025`), and now translates it too.

**Two layers, two jobs.** The service catch gives the specific message (`A project named "X" already exists`), because only the service knows what `projects_name_key` means. The filter branch (`isUniqueViolation`) is the safety net for a write someone forgets to wrap: a correct `409` with a generic detail, without logging a stack trace, and without leaking table or constraint names. A `ConflictException` from a service never reaches that branch: it is an `HttpException`, so the earlier branch handles it. And a raw Prisma error never matches `instanceof HttpException`, which is why it fell through to `500` before.

Final state of `common/prisma-errors.ts`: `isUniqueViolation` (P2002) and `isRecordNotFound` (P2025). `assertNameFree` was deleted. The constraint is the check.

## My notes

_Write in your own words: why a check in application code cannot replace a constraint in the database._
