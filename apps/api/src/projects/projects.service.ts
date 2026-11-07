import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Project } from './project.ts';
import { ProjectsRepository } from './projects.repository.ts';
import { CreateProjectInput, UpdateProjectInput } from '@teamboard/contracts';

// Business rules. Knows nothing about HTTP, so a cron job or queue worker can
// call it too. It throws Nest exceptions, which the framework turns into
// status codes.
@Injectable()
export class ProjectsService {
  constructor(private readonly repo: ProjectsRepository) {}

  findAll(): Project[] {
    return this.repo.findAll();
  }

  findOne(id: string): Project {
    const project = this.repo.findById(id);
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    return project;
  }

  create(dto: CreateProjectInput): Project {
    this.assertNameFree(dto.name);
    return this.repo.create({ name: dto.name, description: dto.description ?? null });
  }

  update(id: string, dto: UpdateProjectInput): Project {
    const project = this.findOne(id);
    if (dto.name !== undefined && dto.name !== project.name) this.assertNameFree(dto.name);
    // Copy only the fields the client sent. `{ name: undefined }` spread over
    // the existing project would wipe its name.
    const changes: Partial<Pick<Project, 'name' | 'description'>> = {};
    if (dto.name !== undefined) changes.name = dto.name;
    if (dto.description !== undefined) changes.description = dto.description;
    return this.repo.update(id, changes);
  }

  remove(id: string): void {
    this.findOne(id);
    this.repo.delete(id);
  }

  // Rule: project names are unique. 409 Conflict means "valid request, but it
  // clashes with the current state".
  private assertNameFree(name: string): void {
    if (this.repo.findByName(name)) throw new ConflictException(`A project named "${name}" already exists`);
  }
}
