import { INestApplication, VersioningType } from "@nestjs/common";
import { apiReference } from "@scalar/nestjs-api-reference";
import type { Request, Response } from "express";
import { openApiDocument } from "@teamboard/contracts";

export function configureApp(app: INestApplication){
    // Every route lives under /api, so a load balancer can send /api/* to this
  // service and everything else to the web app, on one domain.
  app.setGlobalPrefix('api');
  app.enableVersioning({type:VersioningType.URI,defaultVersion:"1"})
  // On SIGTERM, Nest stops taking requests and runs onModuleDestroy hooks
  // (closing DB connections, etc.) before exiting. Lesson 1.3 in one line.
  app.enableShutdownHooks();

  // Docs are generated from @teamboard/contracts (zod), not from decorators.
  // Raw OpenAPI document: what client generators and other teams consume.
  app.use('/api/docs-json', (_req: Request, res: Response) => res.json(openApiDocument));
  // Interactive docs (Scalar), rendering the same document.
  app.use('/api/docs', apiReference({ content: openApiDocument }));
}