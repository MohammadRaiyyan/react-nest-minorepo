import { Prisma } from '@teamboard/db';

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

export function isRecordNotFound(e:unknown):boolean{
    return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025';
}