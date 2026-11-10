import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.ts';
import { configureApp } from '../src/configure-app.ts';

// Lesson 5.1 checker. Many requests create the same project name at the same
// moment. Exactly one wins with 201; every other one gets a clean 409, never
// a 500. Sequential tests can never catch this: only concurrency interleaves
// the name check and the insert.
describe('POST /api/v1/projects with a duplicate name, concurrently (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    // A real listening server: all requests reach Node at nearly the same time.
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  async function createConcurrently(name: string, copies: number) {
    return await Promise.all(
      Array.from({ length: copies }, () =>
        fetch(`${baseUrl}/api/v1/projects`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        }),
      ),
    );
  }

  // Several rounds: a race does not show up every time, so one round can pass
  // by luck. Ten rounds of 20 make a lucky pass very unlikely.
  it('creates the project once and answers 409 to the rest', async () => {
    for (let round = 0; round < 10; round++) {
      const responses = await createConcurrently(`Race ${crypto.randomUUID()}`, 20);

      const tally: Record<number, number> = {};
      for (const res of responses) tally[res.status] = (tally[res.status] ?? 0) + 1;
      expect(tally, `round ${round + 1}`).toEqual({ 201: 1, 409: 19 });

      for (const res of responses.filter((r) => r.status === 409)) {
        expect(res.headers.get('content-type')).toContain('application/problem+json');
        expect(((await res.json()) as { code: string }).code).toBe('CONFLICT');
      }
    }
  });
});
