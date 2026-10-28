import { z } from 'zod';
import { textSchema } from '../../shared/validation/text.schema.js';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const householdId = z.object({ householdId: z.string().uuid() });
const categoryParam = z.object({
  householdId: z.string().uuid(),
  categoryId: z.string().uuid(),
});

export const householdIdParam = {
  params: householdId,
};

export const createCategorySchema = {
  params: householdId,
  body: z
    .object({
      name: textSchema(50),
      icon: textSchema(50, 0).optional(),
      color: z.string().regex(HEX_COLOR).optional(),
    })
    .strict(),
};

export const updateCategorySchema = {
  params: categoryParam,
  body: z
    .object({
      name: textSchema(50),
      icon: textSchema(50, 0).nullable(),
      color: z.string().regex(HEX_COLOR).nullable(),
    })
    .partial()
    .strict(),
};

export const categoryIdParam = {
  params: categoryParam,
};

export type CreateCategoryDto = z.infer<typeof createCategorySchema.body>;
export type UpdateCategoryDto = z.infer<typeof updateCategorySchema.body>;
