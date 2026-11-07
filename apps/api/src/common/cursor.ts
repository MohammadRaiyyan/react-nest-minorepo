import z from 'zod';
import { ValidationException } from './validation.exception.ts';
import { BadRequestException } from '@nestjs/common';

const cursorSchema = z.object({
      createdAt: z.iso.datetime(),
      id: z.uuid(),
    })

    export type Cursor = z.infer<typeof cursorSchema>;
export function encodeCursor(position: { createdAt: Date; id: string }) {
  return Buffer.from(JSON.stringify(position)).toString('base64url');
}

export function decodeCursor(cursor: string): Cursor {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    return cursorSchema.parse(JSON.parse(json));
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}
