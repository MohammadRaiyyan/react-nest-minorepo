import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { createPrismaClient, type PrismaClient } from '@teamboard/db';
import { AppModule } from '../src/app.module.ts';
import { configureApp } from '../src/configure-app.ts';

// Lesson 6.1 checker. POST /api/v1/auth/signup creates a user. The password is
// stored only as an argon2id hash, never returned, and emails are unique
// regardless of letter case.
describe('POST /api/v1/auth/signup (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let db: PrismaClient; // a separate client, to look at what was really stored

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0); // real server, so concurrent requests overlap (Lesson 5.1)
    baseUrl = await app.getUrl();
    db = createPrismaClient(process.env.DATABASE_URL!);
  });

  afterAll(async () => {
    await db.$disconnect();
    await app.close();
  });

  const password = 'correct horse battery staple';
  const uniqueEmail = () => `user-${crypto.randomUUID()}@example.com`;

  async function signup(body: unknown) {
    const res = await fetch(`${baseUrl}/api/v1/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  async function storedHash(email: string): Promise<string> {
    const rows = await db.$queryRaw<{ password_hash: string }[]>`
      SELECT password_hash FROM users WHERE email = ${email}`;
    expect(rows).toHaveLength(1);
    return rows[0].password_hash;
  }

  it('creates a user and returns it without any password field', async () => {
    const email = uniqueEmail();
    const res = await signup({ email, name: 'Alice', password });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email, name: 'Alice' });
    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body.createdAt).toEqual(expect.any(String));
    expect(Object.keys(res.body).filter((k) => /password|hash/i.test(k))).toEqual([]);
  });

  it('stores an argon2id hash, never the password itself', async () => {
    const email = uniqueEmail();
    expect((await signup({ email, name: 'Bob', password })).status).toBe(201);

    const hash = await storedHash(email);
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain(password);
  });

  it('gives two users with the same password different hashes (salt)', async () => {
    const a = uniqueEmail();
    const b = uniqueEmail();
    expect((await signup({ email: a, name: 'A', password })).status).toBe(201);
    expect((await signup({ email: b, name: 'B', password })).status).toBe(201);

    expect(await storedHash(a)).not.toBe(await storedHash(b));
  });

  it('stores emails in lower case and treats letter case as the same account', async () => {
    const local = `Mixed-${crypto.randomUUID()}`;
    const first = await signup({ email: `  ${local}@Example.COM `, name: 'Case', password });
    expect(first.status).toBe(201);
    expect(first.body.email).toBe(`${local.toLowerCase()}@example.com`);

    const again = await signup({ email: `${local.toLowerCase()}@example.com`, name: 'Case', password });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('CONFLICT');
  });

  it('rejects invalid input with 400', async () => {
    expect((await signup({ email: 'not-an-email', name: 'X', password })).status).toBe(400);
    expect((await signup({ email: uniqueEmail(), name: 'X', password: 'short' })).status).toBe(400);
    expect((await signup({ email: uniqueEmail(), name: 'X', password: 'x'.repeat(129) })).status).toBe(400);
    expect((await signup({ email: uniqueEmail(), name: '   ', password })).status).toBe(400);
  });

  it('creates one account when the same email signs up 10 times at once', async () => {
    const email = uniqueEmail();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => signup({ email, name: 'Race', password })),
    );
    const statuses = results.map((r) => r.status).sort((x, y) => x - y);
    expect(statuses).toEqual([201, ...Array<number>(9).fill(409)]);
  });
});
