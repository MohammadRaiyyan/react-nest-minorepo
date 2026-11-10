import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ProjectsRepository } from './projects.repository.ts';
import { CreateProjectInput, UpdateProjectInput } from '@teamboard/contracts';
import { type Project } from '@teamboard/db';
import {
  isRecordNotFound,
  isUniqueViolation,
} from '../common/prisma-errors.ts';

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
    try {
      return await this.repo.create({
        name: dto.name,
        description: dto.description ?? null,
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `A project named "${dto.name}" already exists`,
        );
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateProjectInput): Promise<Project> {
    await this.findOne(id);

    try {
      const changes: Partial<Pick<Project, 'name' | 'description'>> = {};
      if (dto.name !== undefined) changes.name = dto.name;
      if (dto.description !== undefined) changes.description = dto.description;
      return await this.repo.update(id, changes);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `A project named "${dto.name}" already exists`,
        );
      }
      if (isRecordNotFound(error)) {
        throw new NotFoundException(`The project does not exists`);
      }
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.repo.delete(id);
    } catch (e: unknown) {
      if (isRecordNotFound(e)) {
        throw new NotFoundException('The project is already deleted');
      }
      throw e;
    }
  }
}
