import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ConfigService } from '@nestjs/config';
import { Env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Every route lives under /api, so a load balancer can send /api/* to this
  // service and everything else to the web app, on one domain.
  app.setGlobalPrefix('api');
  // On SIGTERM, Nest stops taking requests and runs onModuleDestroy hooks
  // (closing DB connections, etc.) before exiting. Lesson 1.3 in one line.
  app.enableShutdownHooks();
  const PORT = app.get(ConfigService<Env,true>).get("PORT",{infer:true})
  await app.listen(PORT ?? 3000);
}
await bootstrap();
