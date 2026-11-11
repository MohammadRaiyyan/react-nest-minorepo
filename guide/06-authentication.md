# Chapter 6: Authentication

**Authentication** answers "who is making this request?". **Authorization** (Chapter 7) answers "is this person allowed to do it?". This chapter builds the first one for Teamboard: sign up, log in, stay logged in, log out.

The whole flow, built across the chapter:

```
6.1  signup     email + password ──▶ API ──▶ users table (password stored as a hash)
6.2  login      email + password ──▶ API ──▶ verify hash ──▶ create session ──▶ Set-Cookie
6.3  requests   Cookie: session=… ──▶ API ──▶ look up session ──▶ request.user
6.2  logout     ──▶ API ──▶ delete session ──▶ cookie cleared
```

Teamboard uses **server-side sessions in an `HttpOnly` cookie**. The SPA and the API share one origin (Lesson 2.4), which makes cookies the simplest and safest choice. Lesson 6.4 covers JWTs, and when they are the better tool.

## Lesson 6.1: Users and password hashing

### Rule 1: never store the password

Databases leak: a backup left in a public bucket, an SQL injection, a stolen laptop with a dump on it. Assume yours will one day. Most people reuse passwords, so a leaked Teamboard password often also opens the same person's email or bank.

So the database must hold something that lets you **check** a password, without being able to **get it back**. That is a **hash**: a one-way function. `hash("hunter2")` always gives the same output, and there is no function that turns the output back into `"hunter2"`.

```
signup:  password ──hash──▶ stored hash
login:   password ──hash──▶ compare with stored hash  →  equal? correct password
```

**Why not encryption?** Encrypted data can be decrypted, and the key has to live somewhere the server can read, usually right next to the database. Whoever steals one usually gets both.

### Why not SHA-256: it is too fast

SHA-256 is one-way, and it is built to be fast. Measured on this machine:

| Hash | Hashes per second, one CPU core |
| --- | --- |
| SHA-256 | about **2,070,000** |
| argon2id (default settings) | about **83** (12 ms each) |

An attacker with a leaked table does not "reverse" a hash. They guess: hash every password from a leaked-password list and look for matches. At two million guesses per second per core, and far more on a GPU, a 10-million-word list against one SHA-256 hash takes a few seconds. Against argon2id, the same list takes about a day and a half per core, for **each** user, because of salt (next section).

For the real user, 12 ms once per login is invisible. Password hashing should be **deliberately slow**.

### Why salt: the same password must not give the same hash

Without salt, everyone with the password `password123` has the same hash. An attacker hashes a word list **once** and matches it against every user at the same time (a precomputed table of this is a **rainbow table**). It also shows which users share a password.

A **salt** is a random value, generated for each hash and stored with it. The function hashes `salt + password`, so the same password gives a different hash for every user, and the attacker has to start over for each one.

```
Alice: salt=cuzbUm… + "password123" → $argon2id$…$cuzbUm…$SuxRoh…
Bob:   salt=Q9fT2a… + "password123" → $argon2id$…$Q9fT2a…$kP0vWe…   (different)
```

Measured: hashing the same string twice with argon2 gave two different results.

### argon2id: slow and memory-hard

**argon2id** won the Password Hashing Competition and is the first choice in the OWASP password storage guide. Its key property is that it is **memory-hard**: every hash needs a block of memory (19 MiB with the defaults here). GPUs are fast because they run thousands of small computations in parallel, but each of those has very little memory, so memory-hard hashing removes most of their advantage.

`bcrypt` and `scrypt` are older, acceptable choices that you will see in existing codebases.

### Reading the hash string

`@node-rs/argon2` produced this for one password:

```
$argon2id$v=19$m=19456,t=2,p=1$cuzbUmu225j5iWT1gdjupg$SuxRohKp341UbdTacugi4RCxDP9ikQP4wEPDzVT/z48
 └ algo  └ ver └ params       └ salt (base64)        └ hash (base64)
```

| Part | Meaning |
| --- | --- |
| `argon2id` | Algorithm |
| `m=19456` | Memory per hash, in KiB (19 MiB) |
| `t=2` | Iterations (time cost) |
| `p=1` | Parallel lanes |
| salt, hash | The random salt, and the result |

Everything needed to verify is inside the string. You store **one column**. If you raise the cost later, old hashes still verify with their own parameters, and you re-hash each one with the new settings the next time that user logs in.

### The API

```ts
import { hash, verify } from '@node-rs/argon2';

const stored = await hash(password);                 // signup: a new salt every call
const ok = await verify(stored, attemptedPassword);  // login (6.2): true or false
```

Never compare hashes yourself (`hash(attempt) === stored`): a new salt means it would never match. `verify` reads the salt and parameters from the stored string, recomputes, and compares in constant time.

### Password rules

Current guidance (NIST SP 800-63B, OWASP) has moved away from "one uppercase, one digit, one symbol":

- **Length matters most.** Teamboard requires at least **12** characters.
- **Allow long passphrases**, and set a sane maximum: **128**. The maximum is there because hashing costs CPU, and nobody should be able to send a 10 MB "password".
- **No composition rules, no forced periodic changes.** They push people to `Password1!`, then `Password2!`.
- **Do not trim passwords.** Spaces are valid characters.
- Later: reject passwords found in breach lists (the Have I Been Pwned range API).

### Emails: one account per address, whatever the case

`Alice@Example.com` and `alice@example.com` are the same mailbox in practice. Normalize **before** storing and before every lookup: trim, then lower-case. In zod:

```ts
email: z.string().trim().toLowerCase().pipe(z.email())
```

Then a `UNIQUE` constraint on `users.email`. Two signups with one email at the same moment is the Lesson 5.1 race again: the constraint decides, and `P2002` becomes `409`.

### User enumeration

A `409 "An account with this email already exists"` tells anyone that this email has an account. That is called **user enumeration**. Most products accept it at signup, because the person signing up needs to know, and they limit how fast anyone can ask (rate limiting, Chapter 11). At **login** (6.2) the rule is strict: wrong email and wrong password must give the same answer.

### The hash never leaves the server

Prisma returns every column by default, including `passwordHash`. The service must turn a user row into a **public user** before anything reaches a controller:

```ts
{ id, email, name, createdAt }   // what clients see
```

You can do it with an explicit mapping, or with Prisma's `omit: { passwordHash: true }` on the query. Either way, `passwordHash` should exist only inside the auth code. (The same problem already exists in a milder form: project responses include the internal `lastTaskNumber`. Chapter 8 handles response shaping in general.)

### Where the code goes

```
users/                    owns the users table
  users.module.ts         exports UsersService only
  users.repository.ts     create, findByEmail
  users.service.ts
auth/                     owns the flows: signup now, login and logout in 6.2
  auth.module.ts          imports UsersModule
  auth.controller.ts      POST /auth/signup
  auth.service.ts         hash the password, create the user, P2002 → 409, return the public user
```

Users stores whatever hash it is given. Only Auth knows how passwords are hashed. This is the same ownership split as Projects and Tasks.

### Exercise

The checker is `apps/api/test/auth-signup.e2e-spec.ts`:
- signup returns `201` with no field whose name contains "password" or "hash"
- the stored value starts with `$argon2id$` and does not contain the password
- two users with the same password get different hashes
- emails are stored in lower case, and a different-case duplicate gets `409 CONFLICT`
- bad email, short password, 129-character password, and blank name each get `400`
- 10 concurrent signups with one email give one `201` and nine `409`s

1. **Install the hashing library** (Claude installed it on 2026-11-11 before the "learner installs" rule; check that `@node-rs/argon2` is in `apps/api/package.json`, and if not, run `pnpm --filter @teamboard/api add @node-rs/argon2@2.0.2`).
2. **Schema.** A `User` model mapped to `users`: `id` (uuid v7, like the others), `email String @unique`, `name String`, `passwordHash String @map("password_hash")`, `createdAt`, `updatedAt` (both `Timestamptz(3)`, mapped to snake_case). Run `pnpm --filter @teamboard/db db:migrate --name users`, read the SQL, then build the db package.
3. **Contracts.** A new `packages/contracts/src/auth.ts`, exported from the package index:
   - `signupSchema`: `email` (normalized as above), `name` (trimmed, 1 to 100), `password` (12 to 128, not trimmed)
   - `userSchema`: `{ id, email, name, createdAt }` with `.meta({ id: 'User' })`
   - the inferred types

   Build contracts.
4. **Users module.** Repository (`create`, `findByEmail`), a service, and the module exporting only the service.
5. **Auth module.** `POST /auth/signup` returns `201`. The service hashes with `hash()`, creates the user, translates `P2002` into `ConflictException('An account with this email already exists')`, and returns the public user. Register both modules in `AppModule`.
6. **Break it.**
   - Return the Prisma user straight from the service, without mapping it, and run the checker. Read exactly what the first test prints. Put the mapping back.
   - In a Node one-liner, time `verify` with the right password and with a wrong one, a few times each. Is a wrong password faster to reject? Why does that matter?

**Check**

```sh
docker compose up -d --wait
pnpm lint && pnpm typecheck
pnpm --filter @teamboard/api test:e2e      # 18 passed, 9 skipped
```

### What 6.1 showed

- **Do not pass a salt.** A salt read from `.env` is the same for every user, which is the same as no salt: hashing one password twice with a fixed salt gave identical strings; without the option, each call gave a different one. The library generates a random salt per call and stores it inside the hash string. A `secret` (pepper) is an optional extra layer that Teamboard skips.
- **Review found what the checker did not:** a 101-character name was accepted (`.max(100)` missing), and `omit: { passwordHash: true }` still sent `updatedAt`. Prefer `select` (an allow-list) for anything security-related: a column added later stays hidden until someone opts it in.
- **Type the boundary.** The repository first took the signup body, whose `password` field held a hash. One wrong call would have stored a plain password, with no type error. Now three shapes, each in the place that owns it:

  ```
  SignupInput { email, name, password }      contracts (on the wire)
  NewUser     { email, name, passwordHash }  users/users.types.ts (never on the wire)
  PublicUser  derived from publicUserSelect  users/users.types.ts (Date, before JSON)
  ```

  `PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>`, so the type cannot drift from the select. Rule: contracts hold wire shapes, Prisma holds row shapes, and a third shape lives in the module that owns the data.
- Keep `try` around only the call that can throw the error you catch (the create), not the hash.
- Lint and typecheck clean, e2e 18 passed, 9 skipped. Signup was added to the OpenAPI document (Auth tag).
- **Still to do:** break-it step 6 (remove the `select` and read the checker output; time `verify` with right and wrong passwords).

## My notes

_Write in your own words: why a password hash must be slow, and what the salt protects against._
