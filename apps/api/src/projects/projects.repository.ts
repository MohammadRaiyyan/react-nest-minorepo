import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Project } from './project.ts';

// Storage only: no business rules, no HTTP. In memory for now, which breaks
// with two copies or a restart (Chapter 1). Chapter 4 swaps this for Prisma
// without touching the service or controller.
@Injectable()
export class ProjectsRepository {
  private readonly projects = new Map<string, Project>();

  findAll(): Project[] {
    return [...this.projects.values()];
  }

  findById(id: string): Project | undefined {
    return this.projects.get(id);
  }

  findByName(name: string): Project | undefined {
    return [...this.projects.values()].find((p) => p.name === name);
  }

  create(input: { name: string; description: string | null }): Project {
    const now = new Date();
    const project: Project = { id: randomUUID(), ...input, createdAt: now, updatedAt: now };
    this.projects.set(project.id, project);
    return project;
  }

  update(id: string, changes: Partial<Pick<Project, 'name' | 'description'>>): Project {
    const existing = this.projects.get(id)!;
    const updated: Project = { ...existing, ...changes, updatedAt: new Date() };
    this.projects.set(id, updated);
    return updated;
  }

  delete(id: string): void {
    this.projects.delete(id);
  }
}
