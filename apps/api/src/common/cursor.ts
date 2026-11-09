import z from 'zod';
import { BadRequestException } from '@nestjs/common';

const cursorSchema = z.object({
  createdAt: z.iso.datetime(),
  id: z.uuid(),
});

export type Cursor = z.infer<typeof cursorSchema>;
export type Position = { createdAt: Date; id: string };

export function encodeCursor(position:Position) {
  return Buffer.from(
    JSON.stringify({
      createdAt: position.createdAt.toISOString(),
      id: position.id,
    }),
  ).toString('base64url');
}

export function decodeCursor(cursor: string): Cursor {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    return cursorSchema.parse(JSON.parse(json));
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}

