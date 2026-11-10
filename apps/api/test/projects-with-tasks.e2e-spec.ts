import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.ts';
import { configureApp } from '../src/configure-app.ts';

// Lesson 4.7 checker. POST /projects accepts optional starter tasks, and the
// project and its tasks are saved together or not at all.
// Skipped: the 4.7 exercise was skipped. Remove .skip to use it as a checker.
describe.skip('POST /api/v1/projects with starter tasks (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const uniqueName = () => `Starter ${crypto.randomUUID()}`;

  async function taskTitles(projectId: string): Promise<string[]> {
    const res = await http().get(`/api/v1/projects/${projectId}/tasks?limit=100`).expect(200);
    return (res.body.data as { title: string }[]).map((t) => t.title).sort();
  }

  it('creates the project and its starter tasks', async () => {
    const res = await http()
      .post('/api/v1/projects')
      .send({ name: uniqueName(), tasks: [{ title: 'Design' }, { title: 'Build', description: 'v1' }] })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(await taskTitles(res.body.id)).toEqual(['Build', 'Design']);
  });

  it('still creates a project without tasks', async () => {
    const res = await http().post('/api/v1/projects').send({ name: uniqueName() }).expect(201);
    expect(await taskTitles(res.body.id)).toEqual([]);
  });

  it('rejects more than 50 starter tasks with 400', async () => {
    const tasks = Array.from({ length: 51 }, (_, i) => ({ title: `T${i}` }));
    await http().post('/api/v1/projects').send({ name: uniqueName(), tasks }).expect(400);
  });

  it('saves nothing when a task insert fails, so a retry succeeds', async () => {
    const name = uniqueName();

    // zod accepts a NUL character, Postgres text columns reject it: the
    // project insert succeeds, then the task insert fails.
    await http()
      .post('/api/v1/projects')
      .send({ name, tasks: [{ title: 'Fine' }, { title: 'Bad \u0000 byte' }] })
      .expect(500);

    const list = await http().get('/api/v1/projects').expect(200);
    expect(Array.isArray(list.body.data)).toBe(true);
    const names = (list.body.data as { name: string }[]).map((p) => p.name);
    expect(names).not.toContain(name); // no half-created project left behind

    // The client retries with fixed input. Without a transaction this is a 409:
    // the orphan project from the first attempt already holds the name.
    const retry = await http()
      .post('/api/v1/projects')
      .send({ name, tasks: [{ title: 'Fine' }] })
      .expect(201);
    expect(await taskTitles(retry.body.id)).toEqual(['Fine']);
  });
});
