import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.ts';
import { ConfigService } from '@nestjs/config';
import { Env } from './config/env.ts';
import { configureApp } from './configure-app.ts';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app)
  const PORT = app.get(ConfigService<Env,true>).get("PORT",{infer:true})
  await app.listen(PORT);
}
await bootstrap();
