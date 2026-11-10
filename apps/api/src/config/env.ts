import z from "zod";

export const EnvSchema = z.object({
    NODE_ENV: z.enum(["development","test","production"]),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL:z.url(),
    REDIS_URL:z.url(),
    // Print every SQL query (Lesson 4.6). "true"/"false" in .env.
    LOG_QUERIES: z.stringbool().default(false),
})

export type Env = z.infer<typeof EnvSchema>