import { Injectable, NotFoundException } from '@nestjs/common';
import { TasksRepository } from './tasks.repository.ts';
import { ProjectsService } from '../projects/projects.service.ts';
import {
  CreateTaskInput,
  ListTasksQueryInput,
  TaskPage,
  UpdateTaskInput,
} from '@teamboard/contracts';
import { decodeCursor, encodeCursor } from '../common/cursor.ts';
import { Task } from '@teamboard/db';
import { isRecordNotFound } from '../common/prisma-errors.ts';

@Injectable()
export class TasksService {
  constructor(
    private readonly tasksRepository: TasksRepository,
    private readonly projectsService: ProjectsService,
  ) {}
  private async findOne(id: string): Promise<Task> {
    try {
      return await this.tasksRepository.getById(id);
    } catch (error: unknown) {
      if (isRecordNotFound(error))
        throw new NotFoundException(`Task does not exist`);
      throw error;
    }
  }
  async getAll(
    projectId: string,
    query: ListTasksQueryInput,
  ): Promise<TaskPage> {
    await this.projectsService.findOne(projectId);
    const decoded = query.cursor ? decodeCursor(query.cursor) : undefined;
    const after = decoded && {
      createdAt: new Date(decoded.createdAt),
      id: decoded.id,
    };
    const rows = await this.tasksRepository.list(projectId, {
      status: query.status,
      limit: query.limit,
      after,
    });
    const hasMore = rows.length > query.limit;
    const data = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? encodeCursor(data[data.length - 1]) : null;
    return { data, nextCursor };
  }
  async getById(id: string): Promise<Task> {
    return await this.findOne(id);
  }

  async create(projectId: string, input: CreateTaskInput): Promise<Task> {
    const number = await this.projectsService.nextTaskNumber(projectId);

    return await this.tasksRepository.create(projectId, {
      title: input.title,
      description: input.description || null,
      number,
    });
  }

  async update(id: string, input: UpdateTaskInput): Promise<Task> {
    try {
      const changes: Partial<Pick<Task, 'title' | 'description' | 'status'>> =
        {};
      if (input.title !== undefined) {
        changes.title = input.title;
      }
      if (input.description !== undefined) {
        changes.description = input.description;
      }
      if (input.status !== undefined) {
        changes.status = input.status;
      }
      return await this.tasksRepository.update(id, changes);
    } catch (error: unknown) {
      if (isRecordNotFound(error)) {
        throw new NotFoundException('Task does not exist');
      }
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      return await this.tasksRepository.delete(id);
    } catch (error: unknown) {
      if (isRecordNotFound(error)) {
        throw new NotFoundException('Task does not exist');
      }
      throw error;
    }
  }
}
