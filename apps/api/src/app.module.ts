import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { ConfigModule } from '@nestjs/config';
import { EnvSchema } from './config/env.js';

@Module({
  imports: [ConfigModule.forRoot({isGlobal:true,validate:EnvSchema.parse})],
  controllers: [AppController],
})
export class AppModule {}
