import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '../database/database.module.ts';
import { PrismaClient, type User } from '@teamboard/db';
import { type NewUser, type PublicUser, publicUserSelect } from './users.types.ts';

@Injectable()
export class UsersRepository {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async create(data: NewUser): Promise<PublicUser> {
    return await this.prisma.user.create({ data, select: publicUserSelect });
  }

  // Returns the full row, hash included: login (6.2) needs it to verify.
  async findByEmail(email: string): Promise<User | null> {
    return await this.prisma.user.findUnique({ where: { email } });
  }
}
