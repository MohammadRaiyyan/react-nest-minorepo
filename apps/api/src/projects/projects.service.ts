import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProjectsRepository } from './projects.repository.ts';
import { CreateProjectInput, UpdateProjectInput } from '@teamboard/contracts';
import {type  Project } from '@teamboard/db';


@Injectable()
export class ProjectsService {
  constructor(private readonly repo: ProjectsRepository) {}

  async findAll(): Promise<Project[]> {
    return await this.repo.findAll();
  }

  async findOne(id: string): Promise<Project> {
    const project = await this.repo.findById(id);
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    return project;
  }

  async create(dto: CreateProjectInput): Promise<Project> {
    await this.assertNameFree(dto.name);
    return await this.repo.create({
      name: dto.name,
      description: dto.description ?? null,
    });
  }

  async update(id: string, dto: UpdateProjectInput): Promise<Project> {
    const project = await this.findOne(id);
    if (dto.name !== undefined && dto.name !== project.name)
      await this.assertNameFree(dto.name);
    const changes: Partial<Pick<Project, 'name' | 'description'>> = {};
    if (dto.name !== undefined) changes.name = dto.name;
    if (dto.description !== undefined) changes.description = dto.description;
    return await this.repo.update(id, changes);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.repo.delete(id);
  }


  private async assertNameFree(name: string): Promise<void> {
    if (await this.repo.findByName(name))
      throw new ConflictException(`A project named "${name}" already exists`);
  }
}
