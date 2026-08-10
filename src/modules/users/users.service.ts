import { prisma } from '../../infrastructure/database/prisma.js';
import { BadRequestError, NotFoundError } from '../../shared/errors/errors.js';
import type { UpdateUserDto } from './users.schema.js';

export const getUserById = async (id: string) => {
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null } });
  if (!user) {
    throw new NotFoundError('User not found');
  }
  return user;
};

export const updateUser = async (id: string, data: UpdateUserDto) => {
  if (data.preferredCurrencyCode) {
    const currency = await prisma.currency.findUnique({
      where: { code: data.preferredCurrencyCode },
    });
    if (!currency) {
      throw new BadRequestError(`Unsupported currency: ${data.preferredCurrencyCode}`);
    }
  }

  // Make sure the user exists and isn't deleted before updating.
  await getUserById(id);

  return prisma.user.update({ where: { id }, data });
};
