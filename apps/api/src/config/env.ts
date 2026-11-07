import z from "zod";

export const EnvSchema = z.object({
    NODE_ENV: z.enum(["development","test","production"]),
    PORT: z.coerce.number(),
    DATABASE_URL:z.string(),
    REDIS_URL:z.string()
})

export type Env = z.infer<typeof EnvSchema>