import { ConflictException, Injectable } from '@nestjs/common';
import type { SignupInput } from '@teamboard/contracts';
import { hash } from '@node-rs/argon2';
import { UsersService } from '../users/users.service.ts';
import type { PublicUser } from '../users/users.types.ts';
import { isUniqueViolation } from '../common/prisma-errors.ts';

@Injectable()
export class AuthService {
  constructor(private readonly usersService: UsersService) {}

  async signup(input: SignupInput): Promise<PublicUser> {
    const passwordHash = await hash(input.password);
    try {
      return await this.usersService.create({ email: input.email, name: input.name, passwordHash });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('An account with this email already exists');
      }
      throw error;
    }
  }
}
