import { Global, Inject, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.ts';
import { createPrismaClient, PrismaClient } from '@teamboard/db';

export const PRISMA = Symbol('PRISMA');

@Global()
@Module({
  providers: [
    {
      provide: PRISMA,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        return createPrismaClient(config.get('DATABASE_URL', { infer: true }), {
          logQueries: config.get('LOG_QUERIES', { infer: true }),
        });
      },
    },
  ],
  exports:[PRISMA]
})
export class DatabaseModule implements OnModuleInit, OnApplicationShutdown {
    constructor(@Inject(PRISMA) private readonly prisma:PrismaClient){}
    async onModuleInit(){
        await this.prisma.$queryRaw`SELECT 1`;
    }

    async onApplicationShutdown(){
        await this.prisma.$disconnect()
    }
}
