import { Inject, Injectable } from '@nestjs/common';
import { Position } from '../common/cursor.ts';
import { PRISMA } from '../database/database.module.ts';
import { PrismaClient, Task, TaskStatus } from '@teamboard/db';

@Injectable()
export class TasksRepository {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}
  async list(
    projectId: string,
    opts: { status?: TaskStatus; limit: number; after?: Position },
  ): Promise<Task[]> {
    return await this.prisma.task.findMany({
      where: {
        projectId,
        ...(opts.status && { status: opts.status }),
        ...(opts.after && {
          createdAt: { gte: opts.after.createdAt },
          OR: [
            { createdAt: { gt: opts.after.createdAt } },
            { createdAt: opts.after.createdAt, id: { gt: opts.after.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: opts.limit + 1,
    });
  }
  async getById(id: string): Promise<Task> {
    return await this.prisma.task.findUniqueOrThrow({ where: { id } });
  }

  async create(
    projectId: string,
    input: Pick<Task, 'title' | 'description' | 'number'>,
  ): Promise<Task> {
    return await this.prisma.task.create({
      data: { ...input, projectId },
    });
  }

  async update(
    id: string,
    input: Partial<Pick<Task, 'title' | 'description' | 'status'>>,
  ): Promise<Task> {
    return await this.prisma.task.update({ where: { id }, data: input });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.task.delete({ where: { id } });
  }
}
