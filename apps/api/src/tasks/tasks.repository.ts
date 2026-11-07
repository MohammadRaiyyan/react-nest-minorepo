import { Injectable } from '@nestjs/common';
import type { Task, TaskStatus } from './task.ts';
import { ListTasksQueryInput } from '@teamboard/contracts';

@Injectable()
export class TasksRepository {
  private readonly tasks = new Map<string, Task>();
  getAll(projectId:string,query:ListTasksQueryInput): Task[] {
   let tasks =  [...this.tasks.values()].filter(task=> task.projectId === projectId )
   
    if(query.status){
      tasks = tasks.filter((task)=>  task.status  === query.status)
    }
    return tasks;
  }
  getById(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  create(
    projectId:string,
    input: Pick<Task, 'title' | 'description'>,
  ): Task {
    const id = crypto.randomUUID();
    const now = new Date();
    const task = {
      id,
      ...input,
      projectId,
      status:"todo" as TaskStatus,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(id, task);
    return task;
  }

  update(
    id: string,
    input: Partial<Pick<Task, 'title' | 'description' | 'status'>>,
  ): Task {
    let task = this.getById(id)!;
    task = { ...task,...input, updatedAt:new Date() };
  
    this.tasks.set(id, task);
    return task;
  }

  delete(id:string): void {
    this.tasks.delete(id)
  }
}
