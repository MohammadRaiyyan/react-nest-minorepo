import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller.ts';
import { ProjectsRepository } from './projects.repository.ts';
import { ProjectsService } from './projects.service.ts';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectsRepository],
  // Only the service is public. Other modules never touch the repository,
  // so the Projects team can change storage without breaking anyone.
  exports: [ProjectsService],
})
export class ProjectsModule {}
