import { z } from 'zod';

// Every error response from the API (RFC 9457 Problem Details), as written by
// ProblemDetailsFilter in apps/api.
export const problemSchema = z
  .object({
    type: z.string().meta({ example: 'about:blank' }),
    title: z.string().meta({ example: 'Not Found' }),
    status: z.int().meta({ example: 404 }),
    detail: z.string().meta({ example: 'Project 3f1c… not found' }),
    code: z.enum([
      'VALIDATION_FAILED',
      'BAD_REQUEST',
      'NOT_FOUND',
      'CONFLICT',
      'UNPROCESSABLE_ENTITY',
      'INTERNAL',
    ]),
    // Only on VALIDATION_FAILED: field name → list of messages.
    errors: z.record(z.string(), z.array(z.string())).optional(),
  })
  .meta({ id: 'Problem' });

export type Problem = z.infer<typeof problemSchema>;
