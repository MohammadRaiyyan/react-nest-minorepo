import { Injectable } from '@nestjs/common';
import { UsersRepository } from './users.repository.ts';
import type { NewUser, PublicUser } from './users.types.ts';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async create(data: NewUser): Promise<PublicUser> {
    return await this.usersRepository.create(data);
  }
}
