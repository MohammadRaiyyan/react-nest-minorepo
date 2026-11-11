import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service.ts';
import { ZodValidationPipe } from '../common/zod-validation.pipe.ts';
import { type SignupInput, signupSchema } from '@teamboard/contracts';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  signup(@Body(new ZodValidationPipe(signupSchema)) input: SignupInput) {
    return this.authService.signup(input);
  }
}
