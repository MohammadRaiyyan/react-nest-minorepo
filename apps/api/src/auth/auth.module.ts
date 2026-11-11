import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.ts';
import { AuthService } from './auth.service.ts';
import { AuthController } from './auth.controller.ts';

@Module({
  controllers: [AuthController],
  imports: [UsersModule],
  providers: [AuthService],
})
export class AuthModule {}
