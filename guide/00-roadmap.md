# Fullstack Roadmap

A personal reference guide, written one lesson at a time while building a real project.

## How this course works

- **One project, start to finish.** Every chapter adds a feature to the same app, so each concept lands in code you wrote.
- **Each lesson has four steps:**
  1. The idea, explained short, with diagrams.
  2. You build it from a small spec. Claude writes only boilerplate (config, Docker) and reviews your code like a senior engineer on a PR.
  3. You break it on purpose and watch the failure.
  4. You write a "My notes" section in your own words.
- **The guide is written alongside each lesson,** so it reflects what you actually built and understood.
- **Pace:** one lesson per session, 45 to 90 minutes.

## The project: Teamboard

A multi-tenant project and task tracker. Companies sign up as organizations, invite members, create projects and tasks, comment, attach files, and get notified.

It is a good teaching project because it needs almost everything real apps need:

| Feature in Teamboard | Concept it teaches |
| --- | --- |
| Organizations, members, roles | Auth, RBAC, multi-tenancy |
| Projects, tasks, comments | API design, ORM, migrations, pagination |
| "Who changed what" history | Activity and audit logging |
| Live task updates on the board | WebSockets |
| Attachments on tasks | File uploads, background processing |
| "Task due tomorrow" emails | Cron, queues, notifications |
| Dashboard with nested data | GraphQL (as a comparison to REST) |
| A worker running as its own service | Service boundaries, events between services |
| Running it in the cloud | Docker, a managed platform (Railway or Render), CI/CD |

## The stack

| Layer | Choice | Why |
| --- | --- | --- |
| Monorepo | pnpm workspaces + Turborepo | Standard for TypeScript teams. Shared types between web and API. |
| Frontend | React 19 + Vite + React Router 8 (SPA) | Pure client app. Built to static files, served from a CDN. |
| Backend | NestJS 12 | Opinionated modules map to team ownership. Built-in pieces for guards, queues, WebSockets, GraphQL, cron. |
| Database | PostgreSQL | The default relational database for new products. |
| ORM | Prisma 7 (stable), upgrade to 8 when it is final | Most common in TypeScript teams. Clear migration workflow. |
| Cache, queues, rate limits | Redis + BullMQ | One tool covers three chapters. |
| File storage | S3 (MinIO locally) | Same API locally and in the cloud. |
| Observability | Pino, OpenTelemetry, Sentry | Structured logs, traces, error tracking. |
| Deployment | Docker + a managed platform (Railway or Render) + GitHub Actions | What early and mid-size startups actually run. |

### Why a separate SPA and API

The React app is only static files (HTML, JS, CSS). It has no server of its own. Every piece of data comes from the NestJS API over HTTP or WebSocket. This is the most common split in companies: a frontend team ships the SPA, backend teams ship the API, and the API contract sits between them.

The split brings real problems you will solve along the way. The browser and API live on different origins, so you need CORS. Auth cookies need the right `SameSite` and domain settings. The frontend cannot trust anything, so every check happens on the API.

### Deployment options, simplest to most powerful

Every option answers the same five questions. Where does the container run? How many copies run? How does traffic reach them? How do you replace them without downtime? Where do config and secrets come from?

1. **A VM with Docker Compose (or Kamal).** You rent one server and run containers on it. Cheap and simple. You handle scaling, restarts, and OS updates yourself.
2. **Managed platforms.** Railway, Render, Fly.io, Google Cloud Run, AWS ECS/Fargate. You hand over a container image. The platform runs, scales, and replaces it, and offers managed Postgres and Redis.
3. **Orchestrators.** Kubernetes, Nomad. You describe the desired state across many machines. Usually run by a platform team.

Teamboard deploys to option 2. That is where early and mid-size startups run, and where a full-stack developer does real deployment work. Option 3 is covered as concepts only (Chapter 21), so you can follow the conversation when you meet it.

### Scope decision (2026-11-10)

Infrastructure that a platform team or a cloud provider runs (Kubernetes hands-on, load-testing labs, database partitioning and sharding) is out of scope. The scaling work a full-stack developer does every week stays in: indexes and query plans, N+1, caching, rate limiting, queues, stateless servers, connection pooling, and adding instances on a managed platform.

## Frequency map

Not everything gets used every day. Spend depth where the frequency is.

- **Daily:** API design, validation, database queries, migrations, auth checks, logging, error handling.
- **Weekly:** caching, background jobs, file uploads, notifications, tests.
- **Monthly:** WebSockets, rate limit tuning, alert rules, CI pipeline changes, deploy configuration.
- **Rare, but you must understand them:** GraphQL setup, splitting out a service, what Kubernetes does.

## Chapters

### Part 1: Foundations (daily work)

1. **The backend mindset.** Request lifecycle, statelessness, where state lives, how servers fail.
2. **Monorepo and local setup.** pnpm workspaces, Turborepo, Docker Compose for Postgres and Redis, config and secret validation, code ownership across teams.
3. **Production API design.** NestJS modules, DTO validation, error format, pagination, filtering, idempotency, versioning, OpenAPI as the contract between teams.
4. **Database and ORM.** Postgres fundamentals (constraints, indexes, transactions), Prisma schema, migration workflow in a team, safe schema changes, N+1 queries, multi-tenancy.
5. **Concurrency, race conditions, and locking.** How Node handles many requests on one thread. Where interleaving happens (every `await`). Real parallelism across API copies. Race conditions (lost updates, double bookings, double charges). Atomic updates, unique constraints, transactions and isolation levels. Pessimistic locking (`SELECT ... FOR UPDATE`) vs optimistic locking (version columns). Distributed locks in Redis. N+1 queries and how to spot them.
6. **Authentication.** Sessions vs JWT, access and refresh tokens, cookies, password hashing, OAuth login, when to use an auth library or provider.
7. **Authorization and RBAC.** Roles, permissions, org membership, resource ownership, where checks live, tenant isolation.
8. **API security.** The OWASP API Top 10 in practice. Injection, broken object-level authorization, mass assignment. CSRF and CORS done right. Security headers. Secret management and rotation. Dependency scanning. Validating everything that crosses a boundary.
9. **Testing the backend.** Unit vs integration vs end-to-end, testing against a real database.

### Part 2: Production operations (weekly work)

10. **Logging, tracing, activity tracking.** Structured logs, request IDs, audit log table, OpenTelemetry, error tracking.
11. **Caching and rate limiting.** Cache-aside with Redis, invalidation, HTTP caching, CDN, rate limit algorithms.
12. **Background jobs, cron, and webhooks.** The worker as its own service (Teamboard's second service). Queues, workers, retries, backoff, idempotent jobs, dead-letter queues, scheduled jobs, the outbox pattern. Receiving webhooks (Stripe as the example): signature checks, duplicate deliveries, fast acknowledgement then async processing. Sending webhooks to your own customers with retries.
13. **File uploads.** Presigned URLs, multipart uploads, processing jobs, access control on files.
14. **Notifications and alerts.** In-app, email, push. User preferences. Operational alerts for the team (metrics, alert rules, on-call).
15. **Search.** Postgres full-text search, trigram matching for typos, ranking. When to move to a dedicated engine (Meilisearch, OpenSearch) and how to keep it in sync with the database.

### Part 3: Realtime and API styles (occasional work)

16. **WebSockets.** Gateway setup, auth on connect, rooms per org, scaling across instances with Redis, SSE as the simpler option.
17. **GraphQL.** Schema, resolvers, DataLoader, auth in resolvers, when REST is the better choice.

### Part 4: Shipping it (Docker, cloud, CI/CD)

18. **Docker.** Dockerfiles for the API, the worker, and the web app. Multi-stage builds, small images, twelve-factor config. The whole stack in Compose.
19. **Deploying to a managed platform (Railway or Render).** Web, API, and worker as services. Managed Postgres and Redis. Secrets. Running migrations on deploy. Health checks and zero-downtime deploys. Adding instances, and what breaks when you do. Connection pooling. Backups and restoring a managed database. Custom domain and TLS.
20. **CI/CD with GitHub Actions.** Lint, typecheck, and tests (with a real Postgres) on every pull request. Preview environments. Deploy on merge. Rollbacks. Feature flags.
21. **Architecture concepts (reading).** Modular monolith vs microservices, and when to split. Sync vs async communication between services. VMs, containers, pods, deployments, and services: what each one is, so you can follow the conversation.

### Capstone

Teamboard live on a managed platform: SPA, API, and worker deployed from GitHub Actions, with managed Postgres and Redis, object storage, logs, and alerts.

## Progress

- [x] Chapter 1: The backend mindset ([notes](01-backend-mindset.md))
  - [x] 1.1 The life of one request
  - [x] 1.2 Statelessness and where state lives
  - [x] 1.3 How servers fail (read, exercise skipped)
- [x] Chapter 2: Monorepo and local setup ([notes](02-monorepo-setup.md))
  - [x] 2.1 to 2.4 Monorepo, Turborepo, Docker Compose, one origin (scaffold built)
  - [x] 2.5 Config validation (exercise)
  - [x] 2.6 Ownership (read)
- [x] Chapter 3: Production API design ([notes](03-api-design.md))
  - [x] 3.1 Designing resources
  - [x] 3.2 Feature modules (exercise: Tasks module)
  - [x] 3.3 Validation with zod and a shared contracts package
  - [x] 3.4 One error format
  - [x] 3.5 Pagination, filtering, sorting
  - [x] 3.6 Idempotency keys
  - [x] 3.7 OpenAPI and versioning
- [ ] Chapter 4: Database and ORM ([notes](04-database-orm.md))
  - [x] 4.1 Tables and constraints (SQL by hand)
  - [x] 4.2 Prisma setup and the schema
  - [x] 4.3 Migrations in a team
  - [x] 4.4 Repositories on Prisma
  - [x] 4.5 Indexes and query plans
  - [x] 4.6 N+1 queries (read, exercise skipped)
  - [ ] 4.7 Transactions ← **resume here**
