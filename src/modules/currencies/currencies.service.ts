import { prisma } from '../../config/prisma.js';

export const listCurrencies = () => prisma.currency.findMany({ orderBy: { code: 'asc' } });
