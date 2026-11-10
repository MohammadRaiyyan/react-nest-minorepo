import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.ts';
import { configureApp } from '../src/configure-app.ts';

// Lesson 5.2 checker. Every task gets a per-project number (1, 2, 3, …), like
// "TB-42". Numbers must be unique and gap-free even when many tasks are created
// at the same moment: a read-then-write counter loses updates under load.
describe('Task numbers per project (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    // A real listening server, so concurrent requests really overlap (Lesson 5.1).
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  async function post(path: string, body: unknown) {
    return await fetch(`${baseUrl}/api/v1${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function createProject(): Promise<string> {
    const res = await post('/projects', { name: `Numbers ${crypto.randomUUID()}` });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  it('numbers tasks 1, 2, 3 within each project', async () => {
    const a = await createProject();
    const b = await createProject();

    const numbersOf = async (projectId: string, count: number) => {
      const numbers: number[] = [];
      for (let i = 0; i < count; i++) {
        const res = await post(`/projects/${projectId}/tasks`, { title: `T${i}` });
        expect(res.status).toBe(201);
        numbers.push(((await res.json()) as { number: number }).number);
      }
      return numbers;
    };

    expect(await numbersOf(a, 3)).toEqual([1, 2, 3]);
    expect(await numbersOf(b, 2)).toEqual([1, 2]); // each project counts on its own
    expect(await numbersOf(a, 1)).toEqual([4]);
  });

  // Several rounds: one round can pass by luck (Lesson 5.1).
  it('gives 20 concurrent creates the numbers 1 to 20, each exactly once', async () => {
    for (let round = 0; round < 5; round++) {
      const projectId = await createProject();
      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, i) => post(`/projects/${projectId}/tasks`, { title: `T${i}` })),
      );

      const statuses = responses.map((r) => r.status);
      expect(statuses.filter((s) => s !== 201), `round ${round + 1}: non-201 statuses`).toEqual([]);

      const numbers = await Promise.all(
        responses.map(async (r) => ((await r.json()) as { number: number }).number),
      );
      expect(
        numbers.sort((x, y) => x - y),
        `round ${round + 1}`,
      ).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    }
  });

  it('still answers 404 for a project that does not exist', async () => {
    const res = await post('/projects/0190a000-0000-7000-8000-000000000000/tasks', { title: 'x' });
    expect(res.status).toBe(404);
  });
});
