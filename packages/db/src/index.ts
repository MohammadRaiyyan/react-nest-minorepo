import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from './generated/prisma/client.ts';

export * from './generated/prisma/client.ts';

export interface PrismaClientOptions {
  /** Print every SQL query Prisma sends (dev only, noisy). */
  logQueries?: boolean;
  /** Called once per SQL query. Tests use it to count queries per request. */
  onQuery?: (event: Prisma.QueryEvent) => void;
}

// Prisma 7 talks to Postgres through a driver adapter (node-postgres here).
// The adapter owns the connection pool.
export function createPrismaClient(
  databaseUrl: string,
  options: PrismaClientOptions = {},
): PrismaClient {
  const listen = options.logQueries || options.onQuery;
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
    log: listen ? [{ emit: 'event', level: 'query' }] : [],
  });
  if (listen) {
    client.$on('query', (event) => {
      options.onQuery?.(event);
      if (options.logQueries) console.log(`prisma:query (${event.duration.toFixed(1)}ms) ${event.query}`);
    });
  }
  return client as PrismaClient;
}
