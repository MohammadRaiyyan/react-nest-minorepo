import { Module } from "@nestjs/common";
import { TasksController } from "./tasks.controller.ts";
import { TasksService } from "./tasks.service.ts";
import { TasksRepository } from "./tasks.repository.ts";
import { ProjectsModule } from "../projects/projects.module.ts";

@Module({
    controllers:[TasksController],
    providers:[TasksService,TasksRepository],
    imports:[ProjectsModule]
})
export class TasksModule{



}