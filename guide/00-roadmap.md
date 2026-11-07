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
| Separate notification service | Microservices, events |
| Running it on a cluster | Docker, Kubernetes, CI/CD |

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
| Deployment | Docker, then a VM, then a managed container platform, then Kubernetes | Each step solves a problem the previous one has. |

### Why a separate SPA and API

The React app is only static files (HTML, JS, CSS). It has no server of its own. Every piece of data comes from the NestJS API over HTTP or WebSocket. This is the most common split in companies: a frontend team ships the SPA, backend teams ship the API, and the API contract sits between them.

The split brings real problems you will solve along the way. The browser and API live on different origins, so you need CORS. Auth cookies need the right `SameSite` and domain settings. The frontend cannot trust anything, so every check happens on the API.

### Deployment options, simplest to most powerful

Every option answers the same five questions. Where does the container run? How many copies run? How does traffic reach them? How do you replace them without downtime? Where do config and secrets come from?

1. **A VM with Docker Compose (or Kamal).** You rent one server and run containers on it. Cheap and simple. You handle scaling, restarts across machines, and OS updates yourself.
2. **Managed container platforms.** AWS ECS/Fargate, Google Cloud Run, Azure Container Apps, Fly.io, Render, Railway. You hand over a container image. The platform runs, scales, and replaces it.
3. **Orchestrators.** Kubernetes (EKS, GKE, AKS, or self-hosted), HashiCorp Nomad, Docker Swarm (mostly legacy). You describe the desired state. The orchestrator keeps the cluster matching it across many machines.

Kubernetes answers the five questions most explicitly, so learning it teaches the concepts behind every other option.

## Frequency map

Not everything gets used every day. Spend depth where the frequency is.

- **Daily:** API design, validation, database queries, migrations, auth checks, logging, error handling.
- **Weekly:** caching, background jobs, file uploads, notifications, tests.
- **Monthly:** WebSockets, rate limit tuning, alert rules, CI pipeline changes.
- **Rare, but you must understand them:** GraphQL setup, splitting a microservice, Kubernetes manifests, database scaling.

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
12. **Background jobs, cron, and webhooks.** Queues, workers, retries, backoff, idempotent jobs, dead-letter queues, scheduled jobs, the outbox pattern. Receiving webhooks (Stripe as the example): signature checks, duplicate deliveries, fast acknowledgement then async processing. Sending webhooks to your own customers with retries.
13. **File uploads.** Presigned URLs, multipart uploads, processing jobs, access control on files.
14. **Notifications and alerts.** In-app, email, push. User preferences. Operational alerts for the team (metrics, alert rules, on-call).
15. **Search.** Postgres full-text search, trigram matching for typos, ranking. When to move to a dedicated engine (Meilisearch, OpenSearch) and how to keep it in sync with the database.

### Part 3: Realtime and API styles (occasional work)

16. **WebSockets.** Gateway setup, auth on connect, rooms per org, scaling across instances with Redis, SSE as the simpler option.
17. **GraphQL.** Schema, resolvers, DataLoader, auth in resolvers, when REST is the better choice.

### Part 4: Scaling, architecture, and deployment (rare, high impact)

18. **Containers.** Dockerfiles, multi-stage builds, images, twelve-factor apps.
19. **Scaling the app tier and load balancing.** Vertical vs horizontal scaling. Why horizontal scaling needs stateless servers. What a load balancer is, L4 vs L7, balancing algorithms, health checks, sticky sessions, TLS termination. Finding the bottleneck with load tests (k6). Queues as shock absorbers. Autoscaling rules. Capacity planning.
20. **Scaling the database.** Why the database is the hardest part to scale. Fix queries and indexes first. Connection pooling (PgBouncer, Prisma limits). Caching to cut reads. Read replicas and replication lag. Vertical scaling of the database. Partitioning and sharding. Managed options (RDS, Aurora, Neon, Citus). Backups, point-in-time recovery, and testing a restore.
21. **Modular monolith to microservices.** When to split, sync vs async communication, events, failure handling, contracts between teams.
22. **VMs, containers, and pods.** Deploy to a VM with Compose first and hit its limits. Then managed platforms (Cloud Run, ECS). Then Kubernetes objects (Pod, Deployment, Service, Ingress, ConfigMap, Secret), probes, autoscaling, rolling deploys, running migrations during deploys.
23. **CI/CD and environments.** GitHub Actions, preview environments, deploy pipelines, rollbacks, feature flags.

### Capstone

Deploy Teamboard to a local Kubernetes cluster with every piece running: SPA, API, worker, notification service, Postgres, Redis, MinIO.

## Progress

- [x] Chapter 1: The backend mindset ([notes](01-backend-mindset.md))
  - [x] 1.1 The life of one request
  - [x] 1.2 Statelessness and where state lives
  - [x] 1.3 How servers fail (read, exercise skipped)
- [ ] Chapter 2: Monorepo and local setup ([notes](02-monorepo-setup.md))
  - [x] 2.1 to 2.4 Monorepo, Turborepo, Docker Compose, one origin (scaffold built)
  - [ ] 2.5 Config validation (exercise)
  - [ ] 2.6 Ownership
