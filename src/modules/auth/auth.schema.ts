import { z } from 'zod';

export const registerSchema = {
  body: z
    .object({
      email: z.string().email().max(255).toLowerCase(),
      username: z
        .string()
        .min(3)
        .max(50)
        .regex(/^[a-zA-Z0-9_]+$/, 'Solo letras, números y guión bajo'),
      password: z.string().min(8).max(128),
      displayName: z.string().min(1).max(100).optional(),
      preferredCurrencyCode: z.string().length(3).toUpperCase().optional(),
    })
    .strict(),
};

export const loginSchema = {
  body: z
    .object({
      email: z.string().email().toLowerCase(),
      password: z.string().min(1),
    })
    .strict(),
};

export const refreshSchema = {
  body: z.object({ refreshToken: z.string().min(1) }).strict(),
};

export type RegisterDto = z.infer<typeof registerSchema.body>;
export type LoginDto = z.infer<typeof loginSchema.body>;
