import { z } from 'zod';
import { createDocument, type oas32 } from 'zod-openapi';
import { signupSchema, userSchema } from './auth.ts';
import { problemSchema } from './problem.ts';
import {
  createProjectSchema,
  projectListSchema,
  projectSchema,
  updateProjectSchema,
} from './projects.ts';
import {
  createTaskSchema,
  listTasksQuerySchema,
  taskPageSchema,
  taskSchema,
  updateTaskSchema,
} from './tasks.ts';

// The machine-readable description of the API, generated from the same zod
// schemas the API validates with. Served by apps/api at /api/docs.

const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: problemSchema } },
});

const ok = <T extends z.ZodType>(description: string, schema: T) => ({
  description,
  content: json(schema),
});

const projectIdParam = z.object({ projectId: z.uuid() });
const idParam = z.object({ id: z.uuid() });

const idempotencyHeader = z.object({
  'idempotency-key': z.string().optional().meta({
    description:
      'Unique per user action. Retrying with the same key returns the first response instead of creating a duplicate.',
  }),
});

export const openApiDocument: oas32.OpenAPIObject = createDocument({
  openapi: '3.1.0',
  info: {
    title: 'Teamboard API',
    version: '1.0.0',
    description: 'Every error response uses application/problem+json. Clients branch on `code`, never on message text.',
  },
  servers: [{ url: '/api/v1' }],
  tags: [{ name: 'Auth' }, { name: 'Projects' }, { name: 'Tasks' }],
  paths: {
    '/auth/signup': {
      post: {
        tags: ['Auth'],
        summary: 'Create an account',
        requestBody: { content: json(signupSchema) },
        responses: {
          '201': ok('The new user (never includes the password hash)', userSchema),
          '400': problem('Invalid body'),
          '409': problem('An account with this email already exists'),
        },
      },
    },
    '/projects': {
      get: {
        tags: ['Projects'],
        summary: 'List projects',
        responses: { '200': ok('All projects', projectListSchema) },
      },
      post: {
        tags: ['Projects'],
        summary: 'Create a project',
        requestBody: { content: json(createProjectSchema) },
        responses: {
          '201': ok('The created project', projectSchema),
          '400': problem('Invalid body'),
          '409': problem('A project with this name already exists'),
        },
      },
    },
    '/projects/{id}': {
      get: {
        tags: ['Projects'],
        summary: 'Get a project',
        requestParams: { path: idParam },
        responses: {
          '200': ok('The project', projectSchema),
          '400': problem('ID is not a UUID'),
          '404': problem('No such project'),
        },
      },
      patch: {
        tags: ['Projects'],
        summary: 'Change some fields of a project',
        requestParams: { path: idParam },
        requestBody: { content: json(updateProjectSchema) },
        responses: {
          '200': ok('The updated project', projectSchema),
          '400': problem('Invalid body or ID'),
          '404': problem('No such project'),
          '409': problem('A project with this name already exists'),
        },
      },
      delete: {
        tags: ['Projects'],
        summary: 'Delete a project',
        requestParams: { path: idParam },
        responses: {
          '204': { description: 'Deleted' },
          '404': problem('No such project'),
        },
      },
    },
    '/projects/{projectId}/tasks': {
      get: {
        tags: ['Tasks'],
        summary: 'List tasks in a project (cursor pagination)',
        requestParams: { path: projectIdParam, query: listTasksQuerySchema },
        responses: {
          '200': ok('One page of tasks. Pass nextCursor back as ?cursor= for the next page.', taskPageSchema),
          '400': problem('Invalid query or cursor'),
          '404': problem('No such project'),
        },
      },
      post: {
        tags: ['Tasks'],
        summary: 'Create a task in a project',
        requestParams: { path: projectIdParam, header: idempotencyHeader },
        requestBody: { content: json(createTaskSchema) },
        responses: {
          '201': ok('The created task, or the replayed first response for a repeated Idempotency-Key', taskSchema),
          '400': problem('Invalid body'),
          '404': problem('No such project'),
          '409': problem('A request with this Idempotency-Key is still in progress'),
          '422': problem('Idempotency-Key reused with a different body'),
        },
      },
    },
    '/tasks/{id}': {
      get: {
        tags: ['Tasks'],
        summary: 'Get a task',
        requestParams: { path: idParam },
        responses: {
          '200': ok('The task', taskSchema),
          '400': problem('ID is not a UUID'),
          '404': problem('No such task'),
        },
      },
      patch: {
        tags: ['Tasks'],
        summary: 'Change some fields of a task',
        requestParams: { path: idParam },
        requestBody: { content: json(updateTaskSchema) },
        responses: {
          '200': ok('The updated task', taskSchema),
          '400': problem('Invalid body or ID'),
          '404': problem('No such task'),
        },
      },
      delete: {
        tags: ['Tasks'],
        summary: 'Delete a task',
        requestParams: { path: idParam },
        responses: {
          '204': { description: 'Deleted' },
          '404': problem('No such task'),
        },
      },
    },
  },
});
