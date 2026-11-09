import { Module } from '@nestjs/common';
import { AppController } from './app.controller.ts';
import { ConfigModule } from '@nestjs/config';
import { EnvSchema } from './config/env.ts';
import z from 'zod';
import { ProjectsModule } from './projects/projects.module.ts';
import { TasksModule } from './tasks/tasks.module.ts';
import { APP_FILTER } from '@nestjs/core';
import { ProblemDetailsFilter } from './common/problem-details.filter.ts';
import { CommonModule } from './common/common.module.ts';
import { DatabaseModule } from './database/database.module.ts';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (env) => {
        const result = EnvSchema.safeParse(env);
        if (!result.success)
          throw new Error(
            `Invalid environment:\n${z.prettifyError(result.error)}`,
          );
        return result.data;
      },
    }),
    ProjectsModule,
    TasksModule,
    CommonModule,
    DatabaseModule
  ],
  controllers: [AppController],
  providers:[{provide:APP_FILTER,useClass:ProblemDetailsFilter}]
})
export class AppModule {}
