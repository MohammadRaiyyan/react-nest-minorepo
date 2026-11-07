# Chapter 2: Monorepo and Local Setup

## Lesson 2.1: What a monorepo is

A **monorepo** is one Git repository that holds several apps and shared packages. The alternative, a **polyrepo** setup, gives each app its own repository.

The main reason teams pick a monorepo is shared code without publishing. The web app and the API both need the same types (what a `Task` looks like, what `/tasks` returns). In a polyrepo, you publish a package, bump versions in two repos, and hope both upgrade. In a monorepo, both apps import the same folder, and one pull request changes the API and the web app together.

### Teamboard's layout

```
teamboard/
├── package.json            root: scripts only, no app code
├── pnpm-workspace.yaml     which folders are workspace packages
├── turbo.json              how tasks run across packages
├── docker-compose.yml      local Postgres and Redis
├── apps/
│   ├── api/                NestJS   (@teamboard/api)
│   └── web/                React SPA (@teamboard/web)
├── packages/               shared code, added from Chapter 3 on
│   ├── contracts/          API types shared by web and api
│   └── db/                 Prisma schema and client
└── guide/                  these notes
```

- **`apps/`** are things that run and get deployed.
- **`packages/`** are libraries that apps import. They never deploy on their own.

### How pnpm workspaces work

`pnpm-workspace.yaml` lists the folders that hold packages. Each package has its own `package.json` with a scoped name like `@teamboard/api`. When one package depends on another, it writes:

```json
"dependencies": { "@teamboard/contracts": "workspace:*" }
```

`workspace:*` means "the copy in this repo", never a version from npm. pnpm links it with a symlink, so changes show up instantly.

There is **one lockfile** (`pnpm-lock.yaml`) for the whole repo. Every app resolves the same version of every dependency, so "works in web, broken in api" version drift cannot happen.

Useful commands:

```sh
pnpm install                              # install everything
pnpm --filter @teamboard/api add zod      # add a dependency to one app
pnpm --filter @teamboard/api test         # run a script in one app
pnpm add -Dw turbo                        # add a dev tool to the root (-w)
```

## Lesson 2.2: Turborepo

pnpm knows *what* the packages are. **Turborepo** knows how to run tasks across them: in the right order, in parallel, and without redoing work.

### The task graph

```json
"build": { "dependsOn": ["^build"], "outputs": ["dist/**"] }
```

`^build` means "first build every package I depend on". If `api` depends on `contracts`, Turbo builds `contracts` first, then `api`. Packages with no link between them build in parallel.

### Caching

Turbo hashes each package's inputs (source files, dependencies, env). If the hash matches a previous run, it replays the saved output instead of running the task:

```
First build:   Cached: 0 cached, 2 total    Time: 2.6s
Second build:  Cached: 2 cached, 2 total    Time: 20ms   >>> FULL TURBO
```

With 20 packages in a real company, this is the difference between a 15-minute CI run and a 1-minute one. CI shares the cache across machines (remote cache), so one developer's build speeds up everyone else's.

### `dev` is special

```json
"dev": { "cache": false, "persistent": true }
```

Dev servers never finish and should never be cached. `pnpm dev` at the root starts both apps at once with prefixed logs.

## Lesson 2.3: Local infrastructure with Docker Compose

Your apps run directly on your machine, for fast reloads and easy debugging. The **infrastructure** they need (Postgres, Redis) runs in containers, so nobody installs Postgres by hand and everyone runs the same version.

```sh
pnpm infra:up      # docker compose up -d
pnpm infra:down    # docker compose down (data survives)
docker compose down -v   # also delete the data volume (fresh database)
```

What each part of `docker-compose.yml` does:

- **`image: postgres:18`** pins the major version. Production should run the same one.
- **`ports: "5432:5432"`** exposes the container's port on your machine, so `localhost:5432` reaches it.
- **`volumes`** keeps database files outside the container. Deleting the container does not delete your data.
- **`healthcheck`** lets `docker compose up --wait` block until Postgres actually accepts connections, not just until the process starts.

## Lesson 2.4: One origin, no CORS

In development the browser talks only to Vite on port 5173. Vite forwards anything under `/api` to NestJS on port 3000:

```
Browser ──> Vite :5173
```

```
Browser ──> Vite :5173 ──/api/*──> NestJS :3000
```

```
Browser ──> Vite :5173 ──/api/*──> NestJS :3000 ──> Postgres :5432
                                                └──> Redis :6379
```

To the browser, the page and the API share one origin, so CORS never applies. Production does the same thing with a load balancer rule: `/api/*` goes to the API service, everything else goes to the static web files. Same paths in dev and prod, so the frontend code never changes between environments.

This is why NestJS sets `app.setGlobalPrefix('api')`. Every route lives under `/api`.

## Lesson 2.5: Config and secrets

The **twelve-factor** rule: config that changes between environments (database URL, API keys, ports) comes from **environment variables**, never from code.

- **`.env.example`** is committed. It lists every variable the app needs, with safe local values. New developers copy it to `.env`.
- **`.env`** is git-ignored. It may hold real secrets.
- **In production** there is no `.env` file. The platform injects variables from a secret manager (AWS Secrets Manager, Vault, Kubernetes Secrets).

### Fail fast at startup

If `DATABASE_URL` is missing, an unvalidated app starts fine, passes its health check, takes traffic, and crashes at 3 a.m. on the first query. A validated app refuses to start, so the deploy fails in seconds and the old version keeps serving.

The rule: **validate all config at boot, and crash with a clear message if anything is wrong.** After validation, the rest of the code reads typed values and never touches `process.env` directly.

### Exercise: validate the API's environment

`@nestjs/config` and `zod` are installed in `apps/api`.

1. Create `apps/api/src/config/env.ts`. Export a zod schema:
   - `NODE_ENV`: one of `development`, `test`, `production`.
   - `PORT`: a number, default `3000`. Env vars are always strings, so use `z.coerce.number()`.
   - `DATABASE_URL` and `REDIS_URL`: valid URLs.
   - Also export the type: `export type Env = z.infer<typeof envSchema>`.
2. In `app.module.ts`, import `ConfigModule.forRoot({ isGlobal: true, validate: ... })`. `validate` receives the raw env object and must return the parsed config or throw.
3. In `main.ts`, read the port with `app.get(ConfigService<Env, true>).get('PORT', { infer: true })` instead of `process.env.PORT`.

**Experiments**

1. Comment out `DATABASE_URL` in `apps/api/.env` and run `pnpm dev`. The API should refuse to start and name the missing variable.
2. Set `PORT=abc`. Same result.
3. Restore both. The API starts normally.

## Lesson 2.6: Ownership in a multi-team repo

A monorepo puts every team's code in one place, so ownership must be explicit.

**CODEOWNERS.** A file at `.github/CODEOWNERS` maps folders to teams. GitHub then requires a review from the owning team on any pull request that touches their folder:

```
/apps/web/              @teamboard/frontend
/apps/api/src/billing/  @teamboard/payments
/packages/db/           @teamboard/platform
```

**Boundaries.** Apps may import packages. Packages never import apps. One app never imports another app's internals. When two apps need the same code, it moves to `packages/`, gets its own owner, and changes there get reviewed by everyone who depends on it.

**Inside the API,** NestJS modules play the same role on a smaller scale. A `TasksModule` exports a `TasksService`. Other modules use that service, never the Tasks module's database tables directly. Chapter 3 builds on this.

## Production checklist

- One lockfile, committed. CI runs `pnpm install --frozen-lockfile`, so it fails if the lockfile is out of date.
- Infrastructure versions in Compose match production.
- `.env.example` lists every variable. `.env` is never committed.
- Config is validated at startup. The app never reads `process.env` outside the config module.
- Every route sits under `/api`, so the web and the API can share one domain.
- CODEOWNERS covers every top-level folder.

## Common mistakes

- Importing from another app's `src/` instead of moving shared code into `packages/`.
- Committing `.env`, or putting real secrets in `.env.example`.
- Reading `process.env.X` all over the code, so a missing variable is only discovered at runtime.
- Using `localhost` in config that runs inside a container. Inside a container, `localhost` is the container itself (Chapter 15).
- Turning on CORS with `origin: '*'` to "fix" a dev error that a proxy would have avoided.

## My notes

_Write in your own words: why a monorepo, what Turbo's cache saves, and why config is validated at boot._
