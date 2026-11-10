import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { createPrismaClient } from '@teamboard/db';
import { AppModule } from '../src/app.module.ts';
import { configureApp } from '../src/configure-app.ts';
import { PRISMA } from '../src/database/database.module.ts';

// Lesson 4.6 checker. GET /projects returns each project with openTaskCount
// (tasks not done), and the number of SQL queries per request does not grow
// with the number of projects. A growing count is the N+1 signature.
// Skipped: the 4.6 exercise was skipped. Remove .skip to use it as a checker.
describe.skip('GET /api/v1/projects with openTaskCount (e2e)', () => {
  let app: INestApplication<App>;
  let queries = 0;

  beforeAll(async () => {
    // Same app, but the Prisma client reports every query it sends.
    const prisma = createPrismaClient(process.env.DATABASE_URL!, {
      onQuery: () => {
        queries++;
      },
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PRISMA)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function createProject(taskStatuses: ('todo' | 'in_progress' | 'done')[]) {
    const project = (
      await http().post('/api/v1/projects').send({ name: `Count ${crypto.randomUUID()}` }).expect(201)
    ).body as { id: string };
    for (const status of taskStatuses) {
      const task = (
        await http().post(`/api/v1/projects/${project.id}/tasks`).send({ title: 't' }).expect(201)
      ).body as { id: string };
      if (status !== 'todo') {
        await http().patch(`/api/v1/tasks/${task.id}`).send({ status }).expect(200);
      }
    }
    return project.id;
  }

  async function listProjects() {
    queries = 0;
    const res = await http().get('/api/v1/projects').expect(200);
    return { body: res.body as { data: { id: string; openTaskCount: number }[] }, queries };
  }

  it('returns each project with the count of tasks that are not done', async () => {
    const busy = await createProject(['todo', 'in_progress', 'done']);
    const empty = await createProject([]);

    const { body } = await listProjects();
    expect(Array.isArray(body.data)).toBe(true);

    const byId = new Map(body.data.map((p) => [p.id, p]));
    expect(byId.get(busy)?.openTaskCount).toBe(2);
    expect(byId.get(empty)?.openTaskCount).toBe(0);
  });

  it('runs the same number of queries no matter how many projects exist', async () => {
    const before = await listProjects();
    for (let i = 0; i < 5; i++) await createProject(['todo']);
    const after = await listProjects();

    expect(after.body.data.length).toBeGreaterThanOrEqual(before.body.data.length + 5);
    expect(after.queries).toBe(before.queries);
    expect(after.queries).toBeLessThanOrEqual(2);
  });
});
