import { z } from 'zod';
import { textSchema } from '../../shared/validation/text.schema.js';

// The avatar is rendered by clients as an image/link; any other scheme
// (`javascript:`, `data:`) would be a script-injection vector.
const avatarUrl = z
  .string()
  .max(2048)
  .url()
  .refine((value) => /^https?:\/\//i.test(value), 'Must be an http(s) URL');

export const updateUserSchema = {
  body: z
    .object({
      displayName: textSchema(100),
      avatarUrl,
      preferredCurrencyCode: z.string().length(3).toUpperCase(),
    })
    .partial()
    .strict(),
};

export type UpdateUserDto = z.infer<typeof updateUserSchema.body>;
