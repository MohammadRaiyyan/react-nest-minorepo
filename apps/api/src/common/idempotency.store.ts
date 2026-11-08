import { Injectable } from '@nestjs/common';

type IdempotencyRecord =
  | { state: 'in_progress'; bodyHash: string }
  | {
      state: 'done';
      bodyHash: string;
      response: unknown;
    };

@Injectable()
export class IdempotencyStore {
  private readonly idempotencyKeys = new Map<string, IdempotencyRecord>();
  get(key: string): IdempotencyRecord | undefined {
    return this.idempotencyKeys.get(key);
  }
  start(key: string, bodyHash: string) {
    this.idempotencyKeys.set(key, { state: 'in_progress', bodyHash });
  }
  finish(key: string, bodyHash: string, response: unknown) {
     this.idempotencyKeys.set(key, { state: 'done', bodyHash, response });
  }
  forget(key: string) {
    this.idempotencyKeys.delete(key);
  }
}
