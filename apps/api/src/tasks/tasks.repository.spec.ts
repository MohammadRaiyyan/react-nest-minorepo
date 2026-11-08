import { TasksRepository } from './tasks.repository.ts';

const PROJECT = '00000000-0000-4000-8000-000000000001';
const OTHER_PROJECT = '00000000-0000-4000-8000-000000000002';

// Creates tasks in a tight loop, so many share the same createdAt millisecond.
// That is exactly the case the id tie-breaker exists for.
function seed(repo: TasksRepository, count: number) {
  for (let i = 1; i <= count; i++) {
    repo.create(PROJECT, { title: `Task ${i}`, description: null });
  }
  repo.create(OTHER_PROJECT, { title: 'Not mine', description: null });
}

describe('TasksRepository.list', () => {
  let repo: TasksRepository;
  beforeEach(() => {
    repo = new TasksRepository();
  });

  it('returns limit + 1 rows when more exist', () => {
    seed(repo, 5);
    expect(repo.list(PROJECT, { limit: 2 })).toHaveLength(3);
  });

  it('returns only what exists when fewer than limit + 1', () => {
    seed(repo, 2);
    expect(repo.list(PROJECT, { limit: 10 })).toHaveLength(2);
  });

  it('only returns tasks from the given project', () => {
    seed(repo, 3);
    const rows = repo.list(PROJECT, { limit: 100 });
    expect(rows.every((t) => t.projectId === PROJECT)).toBe(true);
  });

  it('returns only the tasks after the cursor position', () => {
    seed(repo, 5);
    const all = repo.list(PROJECT, { limit: 100 });
    const rest = repo.list(PROJECT, { limit: 100, after: all[1] });
    expect(rest.map((t) => t.id)).toEqual(all.slice(2).map((t) => t.id));
  });

  it('pages through everything exactly once, even with createdAt ties', () => {
    seed(repo, 25);
    const seen: string[] = [];
    let after: { createdAt: Date; id: string } | undefined;
    for (let page = 0; page < 10; page++) {
      const rows = repo.list(PROJECT, { limit: 10, after });
      const pageRows = rows.slice(0, 10);
      seen.push(...pageRows.map((t) => t.id));
      if (rows.length <= 10) break;
      after = pageRows[pageRows.length - 1];
    }
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });

  it('filters by status', () => {
    seed(repo, 3);
    const [first] = repo.list(PROJECT, { limit: 100 });
    repo.update(first.id, { status: 'done' });
    const done = repo.list(PROJECT, { limit: 100, status: 'done' });
    expect(done.map((t) => t.id)).toEqual([first.id]);
  });

  it('applies the limit after the status filter', () => {
    seed(repo, 10);
    const all = repo.list(PROJECT, { limit: 100 });
    // Only the last 3 tasks are done. The first 7 are todo.
    for (const t of all.slice(7)) repo.update(t.id, { status: 'done' });
    const done = repo.list(PROJECT, { limit: 2, status: 'done' });
    expect(done).toHaveLength(3); // 2 + 1 extra: there is a next page
  });
});
