import { Injectable, NotFoundException } from '@nestjs/common';
import { TasksRepository } from './tasks.repository.ts';
import type { Task } from './task.ts';
import { ProjectsService } from '../projects/projects.service.ts';
import { CreateTaskInput, ListTasksQueryInput, UpdateTaskInput } from '@teamboard/contracts';

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
  getAll(projectId: string, query: ListTasksQueryInput): Task[] {
    this.projectsService.findOne(projectId);
    return this.tasksRepository.getAll(projectId, query);
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
    if (input.title  !== undefined) {
      changes.title = input.title;
    }
    if (input.description  !== undefined) {
      changes.description = input.description;
    }
    if (input.status  !== undefined) {
      changes.status = input.status;
    }
    return this.tasksRepository.update(id, changes);
  }

  delete(id: string): void {
    this.findOne(id);

    return this.tasksRepository.delete(id);
  }
}
