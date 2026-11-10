import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { ValidationException } from './validation.exception.ts';
import { STATUS_CODES } from 'http';
import { isUniqueViolation } from './prisma-errors.ts';
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    let error: {
      status: number;
      code: string;
      errors?: unknown;
      detail: string;
    } | null = null;
    if (exception instanceof ValidationException) {
      error = {
        status: 400,
        code: 'VALIDATION_FAILED',
        errors: exception.fieldErrors,
        detail: exception.message,
      };
    } else if (exception instanceof HttpException) {
      error = {
        status: exception.getStatus(),
        code: codeFor(exception.getStatus()),
        detail: exception.message,
      };
    } else if (isUniqueViolation(exception)) {
      error = {
        status: 409,
        code: 'CONFLICT',
        detail: 'The request conflicts with an existing resource.',
      };
    } else {
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
      );
      error = {
        status: 500,
        code: 'INTERNAL',
        detail: 'Something went wrong',
      };
    }
    response
      .status(error.status)
      .type('application/problem+json')
      .json({
        type: 'about:blank',
        title: STATUS_CODES[error.status],
        ...error,
      });
  }
}

function codeFor(status: number): string {
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 422) return 'UNPROCESSABLE_ENTITY';
  if (status >= 500) return 'INTERNAL';
  return 'BAD_REQUEST';
}
