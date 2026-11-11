import { Module } from '@nestjs/common';
import { UsersService } from './users.service.ts';
import { UsersRepository } from './users.repository.ts';

@Module({
  providers: [UsersRepository, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
