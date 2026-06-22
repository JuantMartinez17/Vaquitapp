import { z } from 'zod';

export const updateUserSchema = {
  body: z
    .object({
      displayName: z.string().min(1).max(100),
      avatarUrl: z.string().url().max(2048),
      preferredCurrencyCode: z.string().length(3).toUpperCase(),
    })
    .partial()
    .strict(),
};

export type UpdateUserDto = z.infer<typeof updateUserSchema.body>;
