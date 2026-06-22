import { prisma } from '../../config/prisma.js';
import { BadRequestError, NotFoundError } from '../../utils/errors.js';
import type { UpdateUserDto } from './users.schema.js';

export const getUserById = async (id: string) => {
  const user = await prisma.user.findFirst({ where: { id, deletedAt: null } });
  if (!user) {
    throw new NotFoundError('Usuario no encontrado');
  }
  return user;
};

export const updateUser = async (id: string, data: UpdateUserDto) => {
  if (data.preferredCurrencyCode) {
    const currency = await prisma.currency.findUnique({
      where: { code: data.preferredCurrencyCode },
    });
    if (!currency) {
      throw new BadRequestError(`Moneda no soportada: ${data.preferredCurrencyCode}`);
    }
  }

  // Aseguramos que exista y no esté borrado antes de actualizar.
  await getUserById(id);

  return prisma.user.update({ where: { id }, data });
};
