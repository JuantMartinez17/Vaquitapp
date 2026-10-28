import { z } from 'zod';
import { textSchema } from '../../shared/validation/text.schema.js';
import { BCRYPT_MAX_PASSWORD_BYTES } from './auth.password.js';

export const registerSchema = {
  body: z
    .object({
      email: z.string().email().max(255).toLowerCase(),
      username: z
        .string()
        .min(3)
        .max(50)
        .regex(/^[a-zA-Z0-9_]+$/, 'Only letters, numbers and underscores'),
      password: z
        .string()
        .min(8)
        .refine((value) => Buffer.byteLength(value, 'utf8') <= BCRYPT_MAX_PASSWORD_BYTES, {
          message: `Password must be at most ${BCRYPT_MAX_PASSWORD_BYTES} bytes`,
        }),
      displayName: textSchema(100).optional(),
      preferredCurrencyCode: z
        .string()
        .regex(/^[A-Za-z]{3}$/)
        .toUpperCase()
        .optional(),
    })
    .strict(),
};

// Login keeps a looser cap than registration: accounts created before the
// 72-byte rule may hold longer passwords, and bcrypt compares only their
// first 72 bytes anyway. The cap just bounds the request size.
export const loginSchema = {
  body: z
    .object({
      email: z.string().email().max(255).toLowerCase(),
      password: z.string().min(1).max(256),
    })
    .strict(),
};

export const refreshSchema = {
  body: z.object({ refreshToken: z.string().min(1).max(512) }).strict(),
};

export type RegisterDto = z.infer<typeof registerSchema.body>;
export type LoginDto = z.infer<typeof loginSchema.body>;
