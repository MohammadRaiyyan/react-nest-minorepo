import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { TasksService } from './tasks.service.ts';
import { ZodValidationPipe } from '../common/zod-validation.pipe.ts';
import {
  type CreateTaskInput,
  createTaskSchema,
  type ListTasksQueryInput,
  listTasksQuerySchema,
  type UpdateTaskInput,
  updateTaskSchema,
} from '@teamboard/contracts';

@Controller()
export class TasksController {
  constructor(private readonly taskService: TasksService) {}

  @Get('projects/:projectId/tasks')
  getAll(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query(new ZodValidationPipe(listTasksQuerySchema))
    query: ListTasksQueryInput,
  ) {
    return { data: this.taskService.getAll(projectId, query) };
  }

  @Post('projects/:projectId/tasks')
  create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(new ZodValidationPipe(createTaskSchema)) task: CreateTaskInput,
  ) {
    return this.taskService.create(projectId, task);
  }
  @Get('tasks/:id')
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.taskService.getById(id);
  }
  @Patch('/tasks/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTaskSchema)) task: UpdateTaskInput,
  ) {
    return this.taskService.update(id, task);
  }
  @Delete('tasks/:id')
  @HttpCode(204)
  delete(@Param('id', ParseUUIDPipe) id: string) {
    return this.taskService.delete(id);
  }
}
