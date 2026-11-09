import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.ts';
import { configureApp } from '../src/configure-app.ts';

describe('Idempotency-Key on POST /api/v1/projects/:projectId/tasks (e2e)', () => {
  let app: INestApplication<App>;
  let tasksUrl: string;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app)
    await app.init();

    const project = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .send({ name: `Project ${crypto.randomUUID()}` })
      .expect(201);
    tasksUrl = `/api/v1/projects/${project.body.id}/tasks`;
  });

  afterEach(async () => {
    await app.close();
  });

  const post = (body: object, key?: string) => {
    const req = request(app.getHttpServer()).post(tasksUrl).send(body);
    return key ? req.set('Idempotency-Key', key) : req;
  };
  const countTasks = async () => (await request(app.getHttpServer()).get(tasksUrl)).body.data.length;

  it('creates the task once when the same key is sent twice', async () => {
    const key = crypto.randomUUID();
    const first = await post({ title: 'Hero' }, key).expect(201);
    const second = await post({ title: 'Hero' }, key).expect(201);

    expect(second.body.id).toBe(first.body.id);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(await countTasks()).toBe(1);
  });

  it('creates two tasks when no key is sent', async () => {
    await post({ title: 'Hero' }).expect(201);
    await post({ title: 'Hero' }).expect(201);
    expect(await countTasks()).toBe(2);
  });

  it('rejects the same key with a different body', async () => {
    const key = crypto.randomUUID();
    await post({ title: 'Hero' }, key).expect(201);
    const res = await post({ title: 'Footer' }, key).expect(422);

    expect(res.body.code).toBe('UNPROCESSABLE_ENTITY');
    expect(await countTasks()).toBe(1);
  });

  it('lets the client retry with the same key after a failed request', async () => {
    const key = crypto.randomUUID();
    await post({}, key).expect(400); // invalid body: the key must be forgotten
    await post({ title: 'Hero' }, key).expect(201);
    expect(await countTasks()).toBe(1);
  });
});
