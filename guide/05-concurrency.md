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

## Lesson 5.2: Lost updates and atomic updates

### The feature: task numbers

Tasks get a number per project, like Jira's `TB-42`: the first task in a project is 1, the next is 2, and so on. People say "TB-42" in standups and commit messages, so a number must never be reused.

The storage: a counter on the project, and the number on each task.

```
projects                          tasks
┌────┬──────────────────┐         ┌────┬────────────┬────────┐
│ id │ last_task_number │         │ id │ project_id │ number │   UNIQUE (project_id, number)
├────┼──────────────────┤         ├────┼────────────┼────────┤
│ P1 │        5         │ ◀────── │ …  │     P1     │   5    │
└────┴──────────────────┘         └────┴────────────┴────────┘
```

### The obvious code, and the lost update

```ts
const project = await repo.findById(projectId);           // read:  5
const next = project.lastTaskNumber + 1;                   // compute in JS: 6
await repo.update(projectId, { lastTaskNumber: next });    // write: 6
await tasks.create({ projectId, number: next, … });        // task 6
```

**Read, change in JavaScript, write back** (read-modify-write). The value written depends on the value read. Two requests at once:

```
Request A                        Request B                        projects.last_task_number
read            → 5                                                5
                                 read            → 5               5
write 5 + 1     → 6                                                6
                                 write 5 + 1     → 6               6   ← A's increment is lost
insert task #6  ✅
                                 insert task #6  ❌ UNIQUE (project_id, number)
```

This is a **lost update**: B overwrote A's write with a value computed from stale data. Two tasks were requested, the counter moved by one.

What the user sees depends on the constraints:

| Constraint on `(project_id, number)` | Result |
| --- | --- |
| none | Two tasks both called `TB-6`. Silent, and found weeks later. |
| `UNIQUE` | Data stays correct, but B gets `409` (the filter's P2002 safety net from 5.1) for creating a task, which conflicts with nothing the user did. |

### Why this is not the 5.1 problem

In 5.1 the request *inserted* a value the client chose (a name). The constraint was the whole answer: one insert wins, the rest get a correct `409`.

Here the request *computes* a value from what it read. The constraint can detect the damage, but cannot repair it: B's correct answer is `201` with number 7, not an error. The fix has to remove the gap between the read and the write.

### Atomic update: let the database do read + write in one step

```sql
UPDATE projects
SET    last_task_number = last_task_number + 1
WHERE  id = $1
RETURNING last_task_number;
```

`last_task_number + 1` is computed **inside** Postgres, from the row as it is at that moment, not from a value the app read earlier. There is nothing in between for another request to slip into.

Why two such updates cannot collide:

```
Request A                                Request B
UPDATE … +1 ──▶ locks row P1, 5 → 6
                                         UPDATE … +1 ──▶ row P1 is locked: WAIT
COMMIT ──────▶ lock released
                                         re-reads the latest committed row: 6
                                         6 → 7, RETURNING 7
```

An `UPDATE` takes a **row lock** (a lock on that single row). A second `UPDATE` of the same row waits until the first one commits, then reads the **newest committed** value and applies its `+ 1` to that. Both requests get a different number, and neither is lost. (Every statement is its own transaction, Lesson 4.7, so "commit" here is the end of the statement.)

In Prisma, number fields support atomic operations: `increment`, `decrement`, `multiply`, `divide`, `set`.

```ts
const { lastTaskNumber } = await this.prisma.project.update({
  where: { id },
  data: { lastTaskNumber: { increment: 1 } },
  select: { lastTaskNumber: true },
});
```

Compare `data: { lastTaskNumber: project.lastTaskNumber + 1 }`: that is a value computed in JavaScript, so it is the read-modify-write again. The atomic version uses `{ increment: 1 }`, and the arithmetic happens in Postgres.

The same `update` also replaces the "does the project exist?" check: a missing project throws `P2025` (5.1), which becomes `404`. One query instead of two, and no check-then-act gap.

### The general shape: put the condition and the change in one statement

| Need | Unsafe | Atomic |
| --- | --- | --- |
| Counter | read `n`, write `n + 1` | `SET n = n + 1` (`increment`) |
| Stock, balance | read, check `>= qty`, write `stock - qty` | `UPDATE … SET stock = stock - $q WHERE id = $1 AND stock >= $q` → 0 rows updated means "not enough" |
| Claim a task | read `assignee IS NULL`, then set it | `UPDATE … SET assignee = $me WHERE id = $1 AND assignee IS NULL` → 0 rows means someone else claimed it |

The last two use a **conditional update**: the `WHERE` holds the check, and the row count tells you if it passed. In Prisma that is `updateMany` (it returns `{ count }`). Lesson 5.5 builds optimistic locking on exactly this.

### Gaps are fine

If the counter increments and then the task insert fails, that number is never used: `TB-6, TB-8`. Postgres sequences behave the same way, and so does Jira. A number must never be **reused**; skipping one is harmless. To have no gaps you would wrap the increment and the insert in one transaction (4.7). The row lock is then held until the insert commits, so task creation in one project runs one at a time. That is acceptable here, but not needed.

### Adding a `NOT NULL` column to a table that has rows

`tasks.number` is required, but 188 tasks already exist. `ALTER TABLE tasks ADD COLUMN number INTEGER NOT NULL` fails, because the existing rows would have no value. The safe migration has three steps (Lesson 4.3: hand-edit the SQL with `--create-only`):

```
1. ADD COLUMN number INTEGER            (nullable for now)
2. UPDATE … SET number = …              (backfill every existing row)
3. ALTER COLUMN number SET NOT NULL     (now every row has one)
```

The backfill numbers existing tasks by creation order inside each project, with `ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at, id)`, then sets each project's counter to its highest number.

### Exercise

The checker is `apps/api/test/task-numbers.e2e-spec.ts`: sequential numbers per project; five rounds of 20 concurrent creates that must get exactly 1 to 20; and `404` for a missing project.

0. **Fix the regression from commit `9cf06f8`.** `ProjectsService.findOne` now relies on `P2025`, but `findUnique` never throws: it returns `null` for a missing row. Only writes (`update`, `delete`) and `findUniqueOrThrow` throw `P2025`. Measured on the API:

   | Request for a missing project | Should be | Is |
   | --- | --- | --- |
   | `GET /projects/:id` | 404 | **200, empty body** |
   | `GET /projects/:id/tasks` | 404 | **200, `{"data":[]}`** |
   | `POST /projects/:id/tasks` | 404 | **500** (foreign key violation on insert) |

   Make `findOne` return `Promise<Project>` again and throw `404` for a missing project. Either check for `null`, or use `findUniqueOrThrow` and keep your `P2025` catch.

1. **Schema.** `Project`: `lastTaskNumber Int @default(0) @map("last_task_number")`. `Task`: `number Int`, and `@@unique([projectId, number])`.
2. **Migration.** `pnpm --filter @teamboard/db db:migrate --create-only --name task_numbers`. Read the generated SQL, and see why it would fail on a table with rows. Replace the `tasks` part with this (tested on your current data in a rolled-back transaction: 188 tasks, 188 distinct numbers, every counter matches):
   ```sql
   -- AlterTable
   ALTER TABLE "projects" ADD COLUMN "last_task_number" INTEGER NOT NULL DEFAULT 0;

   -- 1. Add the column as nullable
   ALTER TABLE "tasks" ADD COLUMN "number" INTEGER;

   -- 2. Backfill: number existing tasks 1, 2, 3 … per project, in creation order
   UPDATE "tasks" t SET "number" = n.rn
   FROM (
     SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at, id) AS rn
     FROM "tasks"
   ) n
   WHERE t.id = n.id;

   UPDATE "projects" p
   SET "last_task_number" = COALESCE((SELECT MAX("number") FROM "tasks" WHERE project_id = p.id), 0);

   -- 3. Now every row has a value
   ALTER TABLE "tasks" ALTER COLUMN "number" SET NOT NULL;

   -- CreateIndex
   CREATE UNIQUE INDEX "tasks_project_id_number_key" ON "tasks"("project_id", "number");
   ```
   Then `pnpm --filter @teamboard/db db:migrate` to apply it, and `pnpm --filter @teamboard/db build`.
3. **Contract.** `taskSchema` gets `number: z.number().int().positive()`. Build contracts.
4. **The naive version, on purpose.** `ProjectsService.nextTaskNumber(projectId)`: `findOne`, then `repo.update(id, { lastTaskNumber: project.lastTaskNumber + 1 })`, return the new number. `TasksService.create` calls it and passes `number` to the repository. Run the checker. The sequential test passes. The concurrent one fails: read its statuses. Then compare the counter with the real task count in psql for one of the test's projects.
5. **The atomic version.** Replace it with a repository method that uses `{ increment: 1 }` and `select`. Translate `P2025` to `404` in the service. `TasksService.create` no longer needs its own `findOne`, because the increment is the existence check. Turn on `LOG_QUERIES`, create one task, and read the SQL Prisma sends for the increment. Run the checker.
6. **Break it, in psql (two terminals).** Pick a project: `SELECT id, last_task_number FROM projects LIMIT 1;`
   - **Atomic:** A: `BEGIN; UPDATE projects SET last_task_number = last_task_number + 1 WHERE id = '…' RETURNING last_task_number;` B: the same `UPDATE` (without `BEGIN`). Watch B hang. A: `COMMIT;` Watch B return immediately. Which number did each get?
   - **Read-modify-write:** A: `BEGIN; SELECT last_task_number FROM projects WHERE id = '…';` B: `BEGIN;` and the same `SELECT`. Both see `n`. A: `UPDATE projects SET last_task_number = n+1 WHERE id = '…'; COMMIT;` (type the number). B: the same `UPDATE` with the same number, then `COMMIT;`. Two increments happened, and the counter moved by one.

**Check**

```sh
pnpm --filter @teamboard/contracts build
pnpm lint && pnpm typecheck
pnpm --filter @teamboard/api test:e2e      # 12 passed, 6 skipped
```

### What 5.2 showed

> Step 6 (the psql experiments) was skipped.

**The naive version passed every sequential test and failed under load.** 20 concurrent creates in a fresh project, read-modify-write counter:

```
counter=2 | tasks=2 | numbers=1,2      (17–18 of 20 requests got 409, over 3 runs)
```

Twenty increments were requested, and the counter moved by two. Almost every request read the same `0` in the gap between `findOne` and `update`, so they all wrote `1` and all tried to insert task #1. `UNIQUE(project_id, number)` kept the data correct and turned every loser into a `409`. The constraint detected the damage, but it could not give those users their task.

**The atomic version:** five rounds of 20, every project `counter=20 | tasks=20 | distinct=20`, no `409`s. The SQL Prisma sends for `{ increment: 1 }` with `select`:

```sql
UPDATE "public"."projects"
SET "last_task_number" = ("public"."projects"."last_task_number" + $1), "updated_at" = $2
WHERE ("public"."projects"."id" = $3 AND 1=1)
RETURNING "public"."projects"."id", "public"."projects"."last_task_number"
```

One statement: the arithmetic happens in Postgres, and `RETURNING` hands back the new value, so no follow-up `SELECT` is needed.

**Side effect found in the SQL:** `@updatedAt` makes Prisma set `updated_at` on every update, so creating a task now bumps the project's `updatedAt`. That can be a feature ("recent activity") or a bug ("last edited 2 minutes ago" when nobody edited the project). Reading the generated SQL is how you find these.

**Things that came up along the way:**

- **`findUnique` never throws P2025; it returns `null`.** Only writes (`update`, `delete`) and `findUniqueOrThrow` throw it. A `findOne` that caught P2025 around `findUnique` made `GET /projects/:missing` return `200` with an empty body, and `POST /projects/:missing/tasks` return `500` (foreign key violation). Fixed with `findUniqueOrThrow`.
- **A failed `migrate dev` did not touch the dev database.** A migration that kept both the hand-written `ADD COLUMN number` and Prisma's generated one failed in the **shadow database** with `42701 column already exists`, before anything reached the dev data. `migrate deploy` (production) has no shadow database, so the same mistake there leaves a half-applied migration. Always read migration SQL before applying it.
- **Prisma's generated types caught the new required column.** Once `number` was required, `TasksRepository.create` stopped typechecking until a number was passed.
- **The type keeps the unsafe path closed.** `'lastTaskNumber'` was removed from `ProjectsRepository.update`'s `changes` type once the atomic method existed, so nobody can write a counter value computed in JavaScript.
- **Ownership:** the counter belongs to Projects, so `ProjectsService.nextTaskNumber` hands Tasks a ready number. Tasks never sees how it was produced.

## My notes

_Write in your own words: why a check in application code cannot replace a constraint in the database._
