import z from "zod";

export const signupSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: z.string().min(12).max(128),
  })
  .meta({ id: "SignupInput" });

export const userSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    name: z.string(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "User" });

export type UserOutput = z.infer<typeof userSchema>;

export type SignupInput = z.infer<typeof signupSchema>;
