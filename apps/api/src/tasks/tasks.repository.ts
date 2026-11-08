import { Injectable } from '@nestjs/common';
import type { Task, TaskStatus } from './task.ts';
import { comparePosition, Position } from '../common/cursor.ts';

@Injectable()
export class TasksRepository {
  private readonly tasks = new Map<string, Task>();
  list(
    projectId: string,
    opts: { status?: TaskStatus; limit: number; after?: Position },
  ): Task[] {
    let tasks = [...this.tasks.values()]
      .filter((task) => task.projectId === projectId)
      .filter(t=> !opts.status || t.status === opts.status)
      .sort(comparePosition)
      .filter((t) => !opts.after || comparePosition(t, opts.after) > 0)
      .slice(0, opts.limit + 1);

    if (opts.status) {
      tasks = tasks.filter((task) => task.status === opts.status);
    }
    return tasks;
  }
  getById(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  create(projectId: string, input: Pick<Task, 'title' | 'description'>): Task {
    const id = crypto.randomUUID();
    const now = new Date();
    const task = {
      id,
      ...input,
      projectId,
      status: 'todo' as TaskStatus,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(id, task);
    return task;
  }

  update(
    id: string,
    input: Partial<Pick<Task, 'title' | 'description' | 'status'>>,
  ): Task {
    let task = this.getById(id)!;
    task = { ...task, ...input, updatedAt: new Date() };

    this.tasks.set(id, task);
    return task;
  }

  delete(id: string): void {
    this.tasks.delete(id);
  }
}
