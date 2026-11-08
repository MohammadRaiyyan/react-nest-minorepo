import { Injectable, NotFoundException } from '@nestjs/common';
import { TasksRepository } from './tasks.repository.ts';
import type { Task } from './task.ts';
import { ProjectsService } from '../projects/projects.service.ts';
import {
  CreateTaskInput,
  ListTasksQueryInput,
  UpdateTaskInput,
} from '@teamboard/contracts';
import { decodeCursor, encodeCursor } from '../common/cursor.ts';

@Injectable()
export class TasksService {
  constructor(
    private readonly tasksRepository: TasksRepository,
    private readonly projectsService: ProjectsService,
  ) {}
  private findOne(id: string) {
    const task = this.tasksRepository.getById(id);
    if (!task) throw new NotFoundException(`Task with the ${id} is not found`);
    return task;
  }
  getAll(projectId: string, query: ListTasksQueryInput) {
    this.projectsService.findOne(projectId);
    const decoded = query.cursor ? decodeCursor(query.cursor) : undefined;
    const after = decoded && {
      createdAt: new Date(decoded.createdAt),
      id: decoded.id,
    };
    const rows = this.tasksRepository.list(projectId, {
      status: query.status,
      limit: query.limit,
      after,
    });
    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? encodeCursor(data[data.length - 1]) : null;
    return { data, nextCursor };
  }
  getById(id: string): Task | undefined {
    return this.findOne(id);
  }

  create(projectId: string, input: CreateTaskInput): Task {
    this.projectsService.findOne(projectId);
    return this.tasksRepository.create(projectId, {
      title: input.title,
      description: input.description || null,
    });
  }

  update(id: string, input: UpdateTaskInput): Task {
    this.findOne(id);
    const changes: Partial<Pick<Task, 'title' | 'description' | 'status'>> = {};
    if (input.title !== undefined) {
      changes.title = input.title;
    }
    if (input.description !== undefined) {
      changes.description = input.description;
    }
    if (input.status !== undefined) {
      changes.status = input.status;
    }
    return this.tasksRepository.update(id, changes);
  }

  delete(id: string): void {
    this.findOne(id);

    return this.tasksRepository.delete(id);
  }
}
