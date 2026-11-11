import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.ts';
import { configureApp } from '../src/configure-app.ts';

// Lesson 5.3 checker. A project allows at most 3 tasks in progress (a Kanban
// WIP limit). The rule spans many rows, so neither an atomic update nor a
// unique constraint can enforce it: concurrent moves must still stop at 3.
const LIMIT = 3;

describe('WIP limit: at most 3 tasks in progress per project (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0); // real server, so concurrent requests overlap (Lesson 5.1)
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  async function call(method: string, path: string, body?: unknown) {
    return await fetch(`${baseUrl}/api/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async function projectWithTasks(count: number): Promise<{ projectId: string; taskIds: string[] }> {
    const project = await call('POST', '/projects', { name: `WIP ${crypto.randomUUID()}` });
    expect(project.status).toBe(201);
    const projectId = ((await project.json()) as { id: string }).id;
    const taskIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const task = await call('POST', `/projects/${projectId}/tasks`, { title: `T${i}` });
      expect(task.status).toBe(201);
      taskIds.push(((await task.json()) as { id: string }).id);
    }
    return { projectId, taskIds };
  }

  const setStatus = (taskId: string, status: string) => call('PATCH', `/tasks/${taskId}`, { status });

  async function inProgressCount(projectId: string): Promise<number> {
    const res = await call('GET', `/projects/${projectId}/tasks?status=in_progress&limit=100`);
    return ((await res.json()) as { data: unknown[] }).data.length;
  }

  it('allows 3 in progress, rejects the 4th with 409, and frees a slot when one moves out', async () => {
    const { projectId, taskIds } = await projectWithTasks(4);

    for (const id of taskIds.slice(0, LIMIT)) expect((await setStatus(id, 'in_progress')).status).toBe(200);

    const fourth = await setStatus(taskIds[3], 'in_progress');
    expect(fourth.status).toBe(409);
    expect(fourth.headers.get('content-type')).toContain('application/problem+json');
    expect(((await fourth.json()) as { code: string }).code).toBe('CONFLICT');

    expect((await setStatus(taskIds[0], 'done')).status).toBe(200);
    expect((await setStatus(taskIds[3], 'in_progress')).status).toBe(200);
    expect(await inProgressCount(projectId)).toBe(LIMIT);
  });

  it('does not count a task against itself when it is already in progress', async () => {
    const { taskIds } = await projectWithTasks(3);
    for (const id of taskIds) expect((await setStatus(id, 'in_progress')).status).toBe(200);

    expect((await setStatus(taskIds[0], 'in_progress')).status).toBe(200);
    expect((await call('PATCH', `/tasks/${taskIds[1]}`, { title: 'Renamed' })).status).toBe(200);
  });

  // Several rounds: one round can pass by luck (Lesson 5.1).
  it('stops at 3 when 6 tasks are moved to in progress at the same moment', async () => {
    for (let round = 0; round < 5; round++) {
      const { projectId, taskIds } = await projectWithTasks(6);

      const responses = await Promise.all(taskIds.map((id) => setStatus(id, 'in_progress')));
      const statuses = responses.map((r) => r.status).sort((a, b) => a - b);

      expect(statuses, `round ${round + 1}`).toEqual([200, 200, 200, 409, 409, 409]);
      expect(await inProgressCount(projectId), `round ${round + 1}`).toBe(LIMIT);
    }
  });
});
