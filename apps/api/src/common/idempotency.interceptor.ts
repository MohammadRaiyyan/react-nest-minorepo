import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { catchError, Observable, of, tap, throwError } from 'rxjs';
import { IdempotencyStore } from './idempotency.store.ts';
import { createHash } from 'crypto';
import {Request,Response} from "express"

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly store: IdempotencyStore) {}
  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string') return next.handle();

    const scopedKey = `${req.method} ${req.url} ${key}`;
    const existing = this.store.get(scopedKey);
    const bodyHash = createHash('sha256')
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (existing) {
      if (existing.bodyHash !== bodyHash) {
        throw new UnprocessableEntityException("Idempotency-Key was already used with a different body");
      }
      if (existing.state === 'in_progress') {
        throw new ConflictException("A request with this Idempotency-Key is still in progress");
      }
      res.setHeader("Idempotent-Replayed","true")
      return of(existing.response);
    }
 
    this.store.start(scopedKey, bodyHash);
    return next.handle().pipe(
      tap((response) => this.store.finish(scopedKey, bodyHash, response)),
      catchError((error) => {
        this.store.forget(scopedKey);
        return throwError(() => error);
      }),
    );
  }
}
