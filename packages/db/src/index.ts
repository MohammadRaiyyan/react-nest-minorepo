import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.ts';

export * from './generated/prisma/client.ts';

// Prisma 7 talks to Postgres through a driver adapter (node-postgres here).
// The adapter owns the connection pool.
export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
