import { prisma } from '../../infrastructure/database/prisma.js';

export const listCurrencies = () => prisma.currency.findMany({ orderBy: { code: 'asc' } });
