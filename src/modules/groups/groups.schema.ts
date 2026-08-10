import { z } from 'zod';

const groupId = z.object({ groupId: z.string().uuid() });
const groupAndMember = z.object({ groupId: z.string().uuid(), userId: z.string().uuid() });
const role = z.enum(['admin', 'member']);

export const createGroupSchema = {
  body: z
    .object({
      name: z.string().min(1).max(100),
      description: z.string().max(2000).optional(),
      defaultCurrencyCode: z.string().length(3).toUpperCase().optional(),
    })
    .strict(),
};

export const groupIdParam = {
  params: groupId,
};

export const updateGroupSchema = {
  params: groupId,
  body: z
    .object({
      name: z.string().min(1).max(100),
      description: z.string().max(2000).nullable(),
      defaultCurrencyCode: z.string().length(3).toUpperCase(),
    })
    .partial()
    .strict(),
};

export const addMemberSchema = {
  params: groupId,
  body: z
    .object({
      email: z.string().email().toLowerCase(),
      role: role.optional(),
    })
    .strict(),
};

export const memberParam = {
  params: groupAndMember,
};

export const updateMemberRoleSchema = {
  params: groupAndMember,
  body: z.object({ role }).strict(),
};

export type CreateGroupDto = z.infer<typeof createGroupSchema.body>;
export type UpdateGroupDto = z.infer<typeof updateGroupSchema.body>;
