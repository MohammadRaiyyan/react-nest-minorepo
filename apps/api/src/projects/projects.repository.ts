import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '../database/database.module.ts';
import { PrismaClient, type Project } from '@teamboard/db';

@Injectable()
export class ProjectsRepository {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async findAll(): Promise<Project[]> {
    return await this.prisma.project.findMany({
      orderBy: { createdAt: 'asc' },
    });
  }

  async findById(id: string): Promise<Project | null> {
    return await this.prisma.project.findUnique({ where: { id } });
  }

  async create(input: {
    name: string;
    description: string | null;
  }): Promise<Project> {
    return await this.prisma.project.create({
      data: { name: input.name, description: input.description },
    });
  }

  async update(
    id: string,
    changes: Partial<Pick<Project, 'name' | 'description'>>,
  ): Promise<Project> {
    return await this.prisma.project.update({ where: { id }, data: changes });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.project.delete({ where: { id } });
  }
}
