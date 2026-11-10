# Chapter 4: Database and ORM

## Lesson 4.1: Thinking in tables and constraints

### Why the in-memory Map has to go

Chapter 1 showed the two ways memory breaks: a second API copy does not see it, and a restart wipes it. A database fixes both. It also gives two things a `Map` never had:

- **Durability.** A committed write survives a crash or power loss.
- **Safe concurrency.** Thousands of requests from many API copies read and write at once, and the database keeps the data consistent.

### The relational model

| Database term | What it is | In Teamboard |
| --- | --- | --- |
| **Table** | One kind of thing | `projects`, `tasks` |
| **Row** | One thing | One task |
| **Column** | One field, with a type | `title text` |
| **Primary key** | The column that identifies a row, unique and never null | `id uuid` |
| **Foreign key** | A column that points at another table's primary key | `tasks.project_id → projects.id` |

```
projects                         tasks
┌──────┬─────────┐               ┌──────┬────────────┬─────────┐
│ id   │ name    │◄──────────────│ ...  │ project_id │ title   │
└──────┴─────────┘               └──────┴────────────┴─────────┘
```

### Constraints: rules the database enforces

| Constraint | Rule | Example |
| --- | --- | --- |
| `NOT NULL` | Must have a value | Every task has a title |
| `UNIQUE` | No two rows share the value | Project names |
| `CHECK (...)` | Any boolean rule | `status IN ('todo', 'in_progress', 'done')` |
| `REFERENCES` (foreign key) | Must point at a row that exists | A task's project exists |

### Why both the app and the database check

The service already checks "is this project name taken?" and "does this project exist?". Those checks give friendly `409` and `404` errors. But they have a gap:

```
Request A: findByName("Website") → none
Request B: findByName("Website") → none
Request A: insert "Website" ✓
Request B: insert "Website" ✓      ← two projects with the same name
```

Both requests checked before either one wrote. This is the **check-then-act race** (Chapter 5 goes deep on it). A `UNIQUE` constraint closes it: the database refuses the second insert, no matter how the requests interleave, which API copy they hit, or which bug skipped the service check.

**App checks give good error messages. Database constraints give guarantees.** Production systems use both.

### What happens to children on delete

A foreign key declares what happens to tasks when their project is deleted:

| Option | Effect |
| --- | --- |
| `ON DELETE CASCADE` | Delete the tasks too |
| `ON DELETE RESTRICT` | Refuse to delete a project that still has tasks |
| `ON DELETE SET NULL` | Keep the tasks, set `project_id` to null (column must allow null) |

Teamboard uses `CASCADE` for tasks: a task has no meaning without its project.

### Exercise: SQL by hand, then break it

Open a SQL shell inside the Postgres container:

```sh
docker compose exec postgres psql -U teamboard
```

Work in a throwaway schema so nothing collides with Prisma later:

```sql
CREATE SCHEMA playground;
SET search_path TO playground;
```

**The projects table, as an example:**

```sql
CREATE TABLE projects (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**Your turn: the tasks table.** Columns:

- `id`: uuid primary key with a generated default.
- `project_id`: uuid, required, references `projects(id)`, deleting a project deletes its tasks.
- `title`: text, required, and not blank. Hint: `CHECK (length(trim(title)) > 0)`.
- `status`: text, required, defaults to `'todo'`, only the three allowed values.
- `created_at`: like in `projects`.

**Then break it.** Predict each result before running it:

```sql
INSERT INTO projects (name) VALUES ('Website') RETURNING id;
INSERT INTO projects (name) VALUES ('Website');                        -- duplicate name
INSERT INTO tasks (project_id, title) VALUES (gen_random_uuid(), 'x'); -- project does not exist
INSERT INTO tasks (project_id, title) VALUES ('<Website id>', '   ');   -- blank title
INSERT INTO tasks (project_id, title, status) VALUES ('<Website id>', 'x', 'banana');
INSERT INTO tasks (project_id, title) VALUES ('<Website id>', 'Hero') RETURNING *;
DELETE FROM projects WHERE name = 'Website';
SELECT count(*) FROM tasks;                                            -- after the delete
```

Clean up at the end:

```sql
DROP SCHEMA playground CASCADE;
```

`\q` exits psql. `\d tasks` shows a table's columns and constraints.

## Lesson 4.2: Prisma and the schema

### What an ORM does

An **ORM** (object-relational mapper) sits between your TypeScript and SQL. You describe tables once, and it gives you:

1. **Typed queries.** `prisma.task.findMany({ where: { projectId } })` returns `Task[]`, checked by TypeScript.
2. **Migrations.** It compares your schema with the database and writes the SQL to change one into the other.

It does not remove the need to understand SQL. Every Prisma call becomes a SQL query, and slow queries, missing indexes, and N+1 problems are SQL problems (Lessons 4.5 and 4.6).

### Where things live

```
packages/db/
├── prisma.config.ts        where the schema and migrations are, and DATABASE_URL
├── prisma/
│   ├── schema.prisma       the models (you write these)
│   └── migrations/         generated SQL, committed to git
└── src/
    ├── index.ts            createPrismaClient(url) + re-exported types
    └── generated/prisma/   the generated client (git-ignored, rebuilt by `prisma generate`)
```

The database lives in its own package because more than one app will use it: the API now, a background worker in Chapter 12.

Prisma 7 specifics, already set up:

- `prisma.config.ts` holds the connection URL. The schema's `datasource` block only names the provider.
- The client is generated as TypeScript into `src/generated/prisma` (`provider = "prisma-client"`).
- Queries go through a **driver adapter**: `@prisma/adapter-pg`, built on the `pg` library, which owns the connection pool.

### Reading a model

```prisma
model Project {
  id          String   @id @default(uuid(7)) @db.Uuid
  name        String   @unique
  description String?
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)
  tasks       Task[]

  @@map("projects")
}
```

| Piece | Meaning | SQL it becomes |
| --- | --- | --- |
| `String?` | Nullable | Column without `NOT NULL` |
| `@id` | Primary key | `PRIMARY KEY` |
| `@unique` | Unique | `UNIQUE` index |
| `@default(uuid(7))` | Prisma generates a UUID v7 on insert | (generated in the client) |
| `@db.Uuid` | Store as the `uuid` type, not text | `uuid` |
| `@updatedAt` | Prisma sets it on every update | (set by the client) |
| `@map("created_at")` | Column name in the database | `created_at` |
| `@@map("projects")` | Table name in the database | `projects` |
| `tasks Task[]` | The other side of a relation. **No column.** | nothing |

### Naming: two conventions, mapped

TypeScript uses `camelCase` fields and `PascalCase` singular models. SQL uses `snake_case` columns and plural table names. `@map` and `@@map` let each side use its own convention. This matters because people outside your code query the database directly: a data team, an analyst, you at 2 a.m. in `psql`.

### Choices worth knowing

- **UUID v7, not v4.** A v4 UUID is fully random, so every insert lands at a random place in the primary key index. A v7 UUID starts with a timestamp, so new rows go at the end of the index, like an auto-increment, while staying unguessable. It also sorts roughly by creation time.
- **`Timestamptz`, not Prisma's default.** Prisma's default `DateTime` on Postgres is `timestamp(3)`, *without* time zone. `timestamptz` stores an exact moment in time. Always use it for "when did this happen" columns.
- **Enums.** A Prisma `enum` becomes a Postgres enum type. Adding a value later is easy. Removing or renaming one is painful. The alternative is `text` with a `CHECK` constraint, which Prisma cannot express in the schema (Lesson 4.3 adds such SQL by hand).

### Relations take two fields on the child

```prisma
projectId String  @map("project_id") @db.Uuid               // the real column
project   Project @relation(fields: [projectId], references: [id], onDelete: Cascade)  // the link
```

`projectId` is the foreign key column. `project` is how Prisma navigates the link in code. It has no column of its own.

### Exercise

1. In `packages/db/prisma/schema.prisma`, write the `Project` model above (type it, do not paste: every attribute should make sense to you).
2. Write the `Task` model and a `TaskStatus` enum (`todo`, `in_progress`, `done`):
   - `id`, `projectId` with the relation (cascade on delete), `title`, `description` (nullable), `status` (default `todo`), `createdAt`, `updatedAt`.
   - Table name `tasks`, snake_case columns.
3. Create the first migration:
   ```sh
   pnpm --filter @teamboard/db db:migrate --name init
   ```
4. Open the generated `packages/db/prisma/migrations/*_init/migration.sql`. Compare it with the SQL you wrote in Lesson 4.1. What did Prisma add? What is missing?
5. Look at the real tables: `docker compose exec postgres psql -U teamboard -c '\d tasks'`.

### What the first migration showed

Prisma's `init` migration matched the hand-written SQL in most ways: primary keys, `NOT NULL`, the unique project name, the foreign key with `ON DELETE CASCADE`, `timestamptz(3)`, and the enum type with values `todo`, `in_progress`, `done`.

What it does **not** contain:

| Missing | Why | Consequence |
| --- | --- | --- |
| `CHECK (length(trim(title)) > 0)` | Prisma's schema language has no `CHECK` | Only the app's zod schema stops blank titles. Lesson 4.3 adds the constraint with hand-written SQL. |
| A default for `id` | `uuid(7)` is generated by the Prisma client, not the database | A raw SQL `INSERT` (psql, another service) must supply an ID |
| A default for `updated_at` | `@updatedAt` is set by the Prisma client | A raw SQL `UPDATE` does not touch it |
| An index on `tasks.project_id` | Postgres does **not** index foreign key columns automatically | Listing a project's tasks scans the whole table. Lesson 4.5. |

Rules that live only in the Prisma client protect only code that goes through Prisma. Rules in the database protect everyone.

**Prisma names vs database names.** `@map` on enum values renames them in the database only. With members named `TODO`, `INPROGRESS`, `DONE`, Prisma returns `status: 'TODO'` in TypeScript while the database and the API contract say `'todo'`. Every read and write would need translating. Naming the members `todo`, `in_progress`, `done` makes all three layers agree. Because the database values do not change, that rename produces no migration at all.

## Lesson 4.3: Migrations in a team

### What a migration is

A **migration** is a versioned SQL file that moves the database from one schema version to the next. Migrations are committed to git and applied in order. The database records which ones ran in a table called `_prisma_migrations`.

```
prisma/migrations/
├── 20261109095449_init/migration.sql
├── 20261110120000_title_not_blank/migration.sql
└── migration_lock.toml
```

### Two commands, two environments

| Command | Where | What it does |
| --- | --- | --- |
| `prisma migrate dev` | Your machine | Compares the schema with the database, **writes** a new migration, applies it. May offer to reset the dev database. |
| `prisma migrate deploy` | CI, staging, production | Applies pending migrations that are already committed. **Never** writes a migration and **never** resets anything. |

### The rules

1. **Never edit a migration that has been applied anywhere.** Other developers and production already ran it. Prisma stores a checksum of each file and refuses to continue if an applied file changed. Fix a mistake with a *new* migration.
2. **Review migration SQL in the pull request** like code. A one-line schema change can produce a statement that locks a large table for minutes.
3. **Two branches, two migrations:** they apply in timestamp order. If both touch the same table, rebase, then run `migrate dev` again to check the result.

### Changing a live database safely

During a rolling deploy, old and new versions of the API run at the same time against one database. So every migration must work with **both** the old code and the new code.

**Expand, then contract.** Renaming `title` to `name`, safely:

```
1. Expand:   add column `name`               old code: uses title  ✓   new code: writes both
2. Backfill: copy title → name for old rows
3. Switch:   new code reads name
4. Contract: drop column `title`             (a later deploy, once no code reads it)
```

A plain `RENAME COLUMN` in one deploy breaks every old API copy still running the moment it applies.

Other traps on large tables:

| Change | Danger | Safe version |
| --- | --- | --- |
| Add a `NOT NULL` column without a default | Fails if rows exist | Add nullable → backfill → set `NOT NULL` |
| `CREATE INDEX` | Blocks writes while building | `CREATE INDEX CONCURRENTLY` (in its own migration) |
| Add a foreign key or `CHECK` on existing data | Scans the whole table under a lock | `ADD CONSTRAINT ... NOT VALID`, then `VALIDATE CONSTRAINT` |

### Hand-written SQL in a migration

When the Prisma schema cannot express something (a `CHECK`, a partial index, a trigger), create an empty migration and write the SQL yourself:

```sh
pnpm --filter @teamboard/db db:migrate --name title_not_blank --create-only
```

`--create-only` writes the file without applying it. Edit it, then run `db:migrate` again to apply.

### Exercise

1. **Rename the enum members** to `todo`, `in_progress`, `done` (no `@map` needed any more). Run `db:migrate`. Prisma should report no changes: only TypeScript names changed.
2. **A CHECK constraint by hand.** Create an empty migration called `title_not_blank` with `--create-only`. In its `migration.sql`, add a constraint on `tasks` so the title cannot be blank, and the same for `projects.name`. Apply it.
3. **Prove it.** In psql: `INSERT INTO tasks (id, project_id, title, updated_at) VALUES (gen_random_uuid(), '<a project id>', '  ', now());` should fail with your constraint's name.
4. **Look at the history:** `SELECT migration_name, finished_at FROM _prisma_migrations;`
5. **Break rule 1.** Add a comment line to the `init` migration file and run `db:migrate`. Read what Prisma says, answer **no** if it offers to reset, then remove the comment.

### What the exercise showed

- Hand-written SQL went into a new `--create-only` migration, `title_not_blank`. Both constraints now reject blank values, from any client:
  ```
  ERROR: new row for relation "tasks" violates check constraint "title_not_blank"
  ERROR: new row for relation "projects" violates check constraint "name_not_blank"
  ```
- **Rule 1 broke for real.** The SQL was first appended to the already-applied `init` migration. Prisma refused: "The migration `…_init` was modified after it was applied. We need to reset the public schema." Removing the lines was not enough: the file had also lost its final newline. Prisma's checksum is a SHA-256 of the exact bytes:
  ```
  stored checksum:          edfb68f5…
  file without final \n:    4f5fa700…   (different: "modified")
  file with final \n:       edfb68f5…   (match)
  ```
  One invisible character counts as a change. In a team, never touch an applied migration, not even whitespace.
- The enum rename (`TODO` → `todo`, and so on) changed TypeScript names only. The database values were already `todo`, `in_progress`, `done`, so no migration was needed.

## Lesson 4.4: Repositories on Prisma

### Step 1: one Prisma client for the whole app

The API needs exactly one Prisma client: it owns the connection pool, and creating one per request would open hundreds of connections (Chapter 18). It should connect when the app starts, so a wrong `DATABASE_URL` fails the deploy immediately (the Chapter 2 fail-fast rule), and disconnect on shutdown (Chapter 1).

NestJS gives you two new DI tools for this:

**A custom injection token.** Until now, the class was the token: asking for `ProjectsService` gets the `ProjectsService` instance. The Prisma client comes from a function, not a class you own, so it gets its own token:

```ts
export const PRISMA = Symbol('PRISMA');
```

**A factory provider.** Instead of `providers: [SomeClass]`, a factory says how to build the value and what it needs:

```ts
{
  provide: PRISMA,                       // the token
  inject: [ConfigService],               // what the factory needs
  useFactory: (config: ConfigService<Env, true>) =>
    createPrismaClient(config.get('DATABASE_URL', { infer: true })),
}
```

Consumers ask for it by token:

```ts
constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}
```

You will also see `class PrismaService extends PrismaClient` in many tutorials. It works too. The factory keeps `@teamboard/db` free of NestJS, so the Chapter 12 worker can use the same package without Nest.

**Lifecycle hooks.** A class can implement:

- `OnModuleInit` → `onModuleInit()` runs once while the app starts.
- `OnApplicationShutdown` → `onApplicationShutdown()` runs on `SIGTERM` (because `enableShutdownHooks()` is on).

### Exercise, step 1

1. Add the package to the API: `pnpm --filter @teamboard/api add '@teamboard/db@workspace:*'`
2. Create `apps/api/src/database/database.module.ts`:
   - Export the `PRISMA` token.
   - A `@Global()` module with the factory provider above, exporting `PRISMA`.
   - The module class itself injects the client and implements both hooks: on init, run a real query, `await this.prisma.$queryRaw\`SELECT 1\``; on shutdown, `await this.prisma.$disconnect()`.
3. Import `DatabaseModule` in `AppModule`.

**Why `SELECT 1` and not `$connect()`.** Connections are lazy: the `pg` pool opens one only when the first query needs it. With Prisma 7's driver adapters, `$connect()` does not open a connection either. Tested with Postgres stopped:

```
$connect()   → resolved OK in 66 ms, no error
SELECT 1     → PrismaClientKnownRequestError
```

So a startup check must run a real query. Never assume a method named "connect" proves anything: test it with the dependency down.

**Check**

- `pnpm dev` starts normally.
- Stop Postgres (`docker compose stop postgres`) and start the API again. It should refuse to start with a connection error, not start and fail later. Start Postgres again afterwards (`docker compose start postgres`).

### What step 1 showed

```
Postgres stopped → API exits with code 1 at startup (PrismaClientKnownRequestError from SELECT 1)
Postgres running → API starts; SIGTERM → disconnects and exits
```

Implement the interfaces, not just the method names: `class DatabaseModule implements OnModuleInit, OnApplicationShutdown`. Nest calls the hooks by name, so a typo like `onModuleinit` would silently never run. With `implements`, TypeScript catches it.

### Step 2: ProjectsRepository on Prisma

The service and controller stay as they are. Only the repository changes, plus `async`/`await` up the chain, because every database call returns a Promise.

| In-memory | Prisma |
| --- | --- |
| `[...map.values()]` | `prisma.project.findMany({ orderBy: { createdAt: 'asc' } })` |
| `map.get(id)` → `undefined` | `prisma.project.findUnique({ where: { id } })` → `null` |
| `find(p => p.name === name)` | `prisma.project.findUnique({ where: { name } })` (works because `name` is `@unique`) |
| `map.set(...)` | `prisma.project.create({ data: { ... } })` |
| spread + `map.set` | `prisma.project.update({ where: { id }, data: changes })` |
| `map.delete(id)` | `prisma.project.delete({ where: { id } })` |

The entity type now comes from the database: `import type { Project } from '@teamboard/db'`. The hand-written `projects/project.ts` interface can go. Prisma creates IDs, `createdAt`, and `updatedAt`, so the repository stops doing that.

### Exercise, step 2

1. In `ProjectsRepository`, inject the client with `@Inject(PRISMA)` and rewrite each method with the table above. Every method becomes `async`.
2. In `ProjectsService`, add `async`/`await` where it calls the repository. Return types become `Promise<Project>` and so on.
3. Delete `projects/project.ts` and import `Project` from `@teamboard/db` instead.
4. The controller needs no change: Nest awaits a returned Promise.

**Check**

- `pnpm --filter @teamboard/api test:e2e`: the tests now run against the real database.
- Create a project, restart the API, list projects. It is still there. That is Chapter 1's restart problem, solved.
- `docker compose exec postgres psql -U teamboard -c 'SELECT id, name, created_at FROM projects;'` shows the rows, with UUID v7 IDs (the third group starts with `7`).

### What step 2 showed

**A floating promise crashed the server.** After the repository became async, `this.assertNameFree(name)` was called without `await`. A second project with the same name produced:

```
2nd create "dup-123" → 500, and the API process exited
```

The duplicate check ran in the background, `create` went ahead, the database's `UNIQUE` constraint rejected the insert (500), and the ignored `ConflictException` became an **unhandled rejection**, which kills a Node process. With every call awaited:

```
same name again → 409 CONFLICT, server alive
delete          → 204, then GET → 404
IDs             → UUID v7 (01a1c00b-9132-758d-…: third group starts with 7)
```

The `no-floating-promises` lint rule had flagged all six missing `await`s. Run `lint` with `typecheck` after every change, and let CI block merges on lint errors.

### Step 3: TasksRepository on Prisma

**A safety net first.** `test/tasks-pagination.e2e-spec.ts` checks pagination through HTTP: 25 tasks created concurrently (so some share a millisecond), paged 10 at a time, every task exactly once; the status filter before the limit; a garbage cursor → `400`. It passes on the in-memory repository today. It must still pass after the switch. Tests that check behavior, not implementation, are what make a rewrite safe.

**The cursor rule moves into SQL.** In memory, `comparePosition` decided "does this task come after the cursor?". In the database, the same rule becomes a `WHERE` clause:

```
task comes after cursor  ⇔  task.createdAt > cursor.createdAt
                            OR (task.createdAt = cursor.createdAt AND task.id > cursor.id)
```

In Prisma:

```ts
where: {
  projectId,
  ...(status && { status }),
  ...(after && {
    OR: [
      { createdAt: { gt: after.createdAt } },
      { createdAt: after.createdAt, id: { gt: after.id } },
    ],
  }),
},
orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
take: limit + 1,
```

The database now filters, sorts, and limits. Only `limit + 1` rows travel to the API, instead of every task in the table. The order of operations from Lesson 3.5 holds by construction: SQL applies `WHERE` before `LIMIT`.

**Why not Prisma's built-in `cursor` option?** `findMany({ cursor: { id }, skip: 1 })` looks up the cursor row by ID to find its position. If that task was deleted between two page requests, the lookup fails. The `WHERE` version only needs the values inside the cursor, so it keeps working.

**Why `Timestamptz(3)` matters here.** JavaScript dates have millisecond precision. Postgres defaults to microseconds. With microsecond columns, a cursor built from a JS `Date` loses the last three digits, and `createdAt > cursor.createdAt` would return rows the client already saw. `(3)` keeps the database and the cursor at the same precision.

### Exercise, step 3

1. Rewrite `TasksRepository` on Prisma, like `ProjectsRepository`: `list` with the query above, plus `getById`, `create`, `update`, `delete`. All `async`.
2. `create` no longer sets `id`, `status`, or timestamps. The database and Prisma do.
3. Add `async`/`await` up through `TasksService`. Delete `tasks/task.ts` and use `Task` and `TaskStatus` from `@teamboard/db`.
4. Delete `src/tasks/tasks.repository.spec.ts`: it tested the in-memory implementation, and the e2e test now covers that behavior through HTTP.
5. `comparePosition` in `common/cursor.ts` is no longer used by the app. Delete it and its tests, or keep it if something still uses it. Lint and typecheck will tell you.

**Check**

```sh
pnpm --filter @teamboard/api lint
pnpm --filter @teamboard/api typecheck
pnpm --filter @teamboard/api test:e2e      # 8 passed, as before the rewrite
```

### What step 3 showed

The pagination e2e test passed before the rewrite (in memory) and after it (Prisma): 8 of 8, unchanged. The implementation changed completely; the behavior did not. The dead in-memory pieces (`tasks.repository.spec.ts`, `comparePosition`) were deleted once nothing used them.

The e2e tests leave rows in the dev database on every run. Chapter 9 gives tests their own database, reset between runs.

## Lesson 4.5: Indexes and query plans

### What an index is

Without an index, the only way to find "tasks of project X" is to read every row in `tasks` and keep the matching ones: a **sequential scan**. An **index** is a separate, sorted structure (a B-tree) that maps column values to rows, like the index at the back of a book. Postgres jumps to the right place and reads only what it needs.

The cost: every insert and update must also update each index, and indexes take disk space. Index what your queries filter and sort on, not every column.

Postgres creates indexes automatically for primary keys and `UNIQUE` columns. It does **not** create one for foreign keys, so `tasks.project_id` has none yet.

### Reading a query plan

`EXPLAIN ANALYZE <query>` runs the query and shows how Postgres executed it:

| Line in the plan | Meaning |
| --- | --- |
| `Seq Scan` | Read the whole table |
| `Index Scan using …` | Walk an index to the matching rows |
| `Index Cond` | The part of the `WHERE` the index answers directly. Fast. |
| `Filter` + `Rows Removed by Filter` | Rows read and then thrown away. The number to watch. |
| `Sort` | Rows sorted in memory after reading. An index in the right order avoids this. |
| `Execution Time` | How long it took |

### Measured: 200,000 tasks, 1,000 projects

The first page of one project's tasks (`WHERE project_id = … ORDER BY created_at, id LIMIT 21`):

| Setup | Plan | Rows read and discarded | Time |
| --- | --- | --- | --- |
| No index | Parallel Seq Scan + Sort | 199,800 | 10.4 ms |
| Index `(project_id, created_at, id)` | Index Scan, no sort | 0 | 0.13 ms |
| Index `(created_at, project_id)` | Index Scan + Incremental Sort | (scans the wrong order) | 1.26 ms |

80× faster with the right index. And this table is small: the sequential scan grows with the whole table, so at 20 million tasks it takes about a second per request, while the index scan stays near 0.1 ms.

### Column order matters

A composite index sorts by its first column, then the second within that, and so on, like a phone book sorted by last name, then first name.

```
(project_id, created_at, id)
 └ jump to project X ┘ └ already in page order ┘   → no sort, stop after 21 rows
```

`(created_at, project_id)` is the same columns in the wrong order: Postgres cannot jump to one project, and has to sort afterwards. Put **equality columns first** (`project_id = …`), then **sort/range columns** in the order of the `ORDER BY`.

### The cursor condition and the index

For a page after the cursor, the shape of the `WHERE` decides whether the index can *start* at the cursor:

| Cursor condition | Index Cond | Rows discarded (page after row 100) |
| --- | --- | --- |
| Prisma `OR` only: `createdAt > c OR (createdAt = c AND id > i)` | `project_id` only | 101 |
| Row comparison (raw SQL): `(created_at, id) > (c, i)` | `project_id` + the row comparison | 0 |
| `OR` **plus** `createdAt >= c` | `project_id` + `created_at >= c` | 1 |

With the plain `OR`, Postgres sometimes reads every row of the project from the start and throws away the ones before the cursor, which makes deep pages cost what offset pagination costs. Prisma cannot write a row comparison, but it can add `createdAt: { gte: after.createdAt }`. That redundant condition gives the index a starting point, and the `OR` only has to remove the few rows that share the cursor's exact timestamp.

### Exercise

1. **Load realistic data** into the dev database (psql):
   ```sql
   INSERT INTO projects (id, name, updated_at)
   SELECT gen_random_uuid(), 'Load ' || g, now() FROM generate_series(1, 1000) g;

   INSERT INTO tasks (id, project_id, title, status, created_at, updated_at)
   SELECT gen_random_uuid(), p.id, 'Task ' || g,
          (CASE WHEN random() < 0.2 THEN 'done' ELSE 'todo' END)::"TaskStatus",
          now() - random() * interval '365 days', now()
   FROM projects p, generate_series(1, 200) g
   WHERE p.name LIKE 'Load %';

   ANALYZE;
   ```
   Note the explicit `id` and `updated_at`: those defaults live in the Prisma client, not the database (Lesson 4.2).
2. **Measure without an index:**
   ```sql
   EXPLAIN ANALYZE
   SELECT * FROM tasks
   WHERE project_id = (SELECT id FROM projects WHERE name = 'Load 500')
   ORDER BY created_at, id
   LIMIT 21;
   ```
   Find `Seq Scan`, `Rows Removed by Filter`, and `Execution Time`.
3. **Add the index in the Prisma schema:** `@@index([projectId, createdAt, id])` on `Task`. Run `db:migrate --name tasks_project_created_index`. Read the generated SQL.
4. **Measure again.** Same `EXPLAIN ANALYZE`. Compare the plan and the time.
5. **Fix the cursor condition** in `TasksRepository.list`: add `createdAt: { gte: opts.after.createdAt }` next to the `OR`, only when there is a cursor. The e2e tests must still pass.

In production, a plain `CREATE INDEX` blocks writes to the table while it builds. On a large live table, use `CREATE INDEX CONCURRENTLY` in its own hand-edited migration (Lesson 4.3).

## My notes

_Write in your own words: why the database checks rules the app already checks._
