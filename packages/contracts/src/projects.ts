import { z } from 'zod';

// What the client may send to create a project. z.object strips unknown keys,
// so { id: "x" } in the body is silently dropped, never stored.
export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).optional(),
});

// PATCH: every field optional. null clears the description.
export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});

// What the client receives. Dates are ISO strings on the wire, not Date objects.
export const projectSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'Project' });

export const projectListSchema = z
  .object({ data: z.array(projectSchema) })
  .meta({ id: 'ProjectList' });

export type Project = z.infer<typeof projectSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
