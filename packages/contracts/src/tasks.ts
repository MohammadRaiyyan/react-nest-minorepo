import { z } from "zod";

export const taskStatusSchema = z.enum(["todo", "in_progress", "done"]);
export const taskSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  status: taskStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).meta({id:"Task"});
export const taskPageSchema = z.object({
    data:z.array(taskSchema),
    nextCursor:z.string().nullable()
}).meta({id:"TaskPage"})

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().optional(),
});
export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().optional().nullable(),
  status: taskStatusSchema.optional(),
});
export const listTasksQuerySchema = z.object({
  status: taskStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ListTasksQueryInput = z.infer<typeof listTasksQuerySchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
