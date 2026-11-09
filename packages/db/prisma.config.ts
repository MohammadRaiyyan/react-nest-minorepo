import { defineConfig, env } from 'prisma/config';

// Prisma 7 does not read .env files on its own. Node can (v21+).
try {
  process.loadEnvFile('.env');
} catch {
  // No .env file: in CI and production, DATABASE_URL comes from the real environment.
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
