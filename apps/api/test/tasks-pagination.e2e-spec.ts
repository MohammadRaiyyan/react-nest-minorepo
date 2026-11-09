import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request, { type Response } from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.ts';
import { configureApp } from '../src/configure-app.ts';

// Behavior through HTTP, against the real database. It does not care whether
// the repository uses a Map or Prisma, only what the client sees.
describe('GET /api/v1/projects/:projectId/tasks pagination (e2e)', () => {
  let app: INestApplication<App>;
  let tasksUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    const project = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .send({ name: `Pagination ${crypto.randomUUID()}` })
      .expect(201);
    tasksUrl = `/api/v1/projects/${project.body.id}/tasks`;

    // Created concurrently, so several share the same createdAt millisecond:
    // only the id tie-breaker keeps the order total.
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        request(app.getHttpServer()).post(tasksUrl).send({ title: `Task ${i + 1}` }).expect(201),
      ),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (query: string) => request(app.getHttpServer()).get(`${tasksUrl}${query}`);

  it('pages through every task exactly once', async () => {
    const seen: string[] = [];
    const pageSizes: number[] = [];
    let cursor: string | null = null;
    do {
      const res: Response = await get(`?limit=10${cursor ? `&cursor=${cursor}` : ''}`).expect(200);
      pageSizes.push(res.body.data.length);
      seen.push(...res.body.data.map((t: { id: string }) => t.id));
      cursor = res.body.nextCursor;
    } while (cursor);

    expect(pageSizes).toEqual([10, 10, 5]);
    expect(new Set(seen).size).toBe(25);
  });

  it('applies the status filter before the limit', async () => {
    const all = (await get('?limit=100').expect(200)).body.data as { id: string }[];
    for (const task of all.slice(-3)) {
      await request(app.getHttpServer()).patch(`/api/v1/tasks/${task.id}`).send({ status: 'done' }).expect(200);
    }

    const page = await get('?status=done&limit=2').expect(200);
    expect(page.body.data).toHaveLength(2);
    expect(page.body.nextCursor).not.toBeNull();
  });

  it('rejects a garbage cursor with 400', async () => {
    const res = await get('?cursor=garbage').expect(400);
    expect(res.body.code).toBe('BAD_REQUEST');
  });
});
