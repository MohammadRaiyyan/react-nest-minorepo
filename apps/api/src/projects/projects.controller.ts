import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ProjectsService } from './projects.service.ts';
import { ZodValidationPipe } from '../common/zod-validation.pipe.ts';
import { type CreateProjectInput, createProjectSchema, type UpdateProjectInput, updateProjectSchema } from '@teamboard/contracts';

// HTTP only: routes, params, status codes. Each method is one line that hands
// off to the service.
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list() {
    // Lists are wrapped in { data }, never returned as a bare array, so
    // pagination fields can be added later without breaking clients.
    return { data: this.projects.findAll() };
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.findOne(id);
  }

  @Post()
  create(@Body(new ZodValidationPipe(createProjectSchema)) body: CreateProjectInput) {
    return this.projects.create(body); // POST returns 201 by default
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateProjectSchema)) body: UpdateProjectInput) {
    return this.projects.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    this.projects.remove(id);
  }
}
