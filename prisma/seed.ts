import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Seeding database...');

  // Monedas base
  const currencies = [
    { code: 'ARS', name: 'Peso Argentino', symbol: '$', decimalPlaces: 2 },
    { code: 'USD', name: 'Dólar Estadounidense', symbol: 'US$', decimalPlaces: 2 },
    { code: 'EUR', name: 'Euro', symbol: '€', decimalPlaces: 2 },
    { code: 'BRL', name: 'Real Brasileño', symbol: 'R$', decimalPlaces: 2 },
    { code: 'CLP', name: 'Peso Chileno', symbol: 'CLP$', decimalPlaces: 0 },
    { code: 'UYU', name: 'Peso Uruguayo', symbol: '$U', decimalPlaces: 2 },
  ];

  for (const currency of currencies) {
    await prisma.currency.upsert({
      where: { code: currency.code },
      update: currency,
      create: currency,
    });
  }
  console.log(`✓ ${currencies.length} monedas`);

  // Categorías de sistema (SPECS.md §2, catálogo inicial).
  const systemCategories = [
    { name: 'Vivienda', icon: 'home', color: '#4ECDC4' },
    { name: 'Comida', icon: 'utensils', color: '#FF6B6B' },
    { name: 'Transporte', icon: 'car', color: '#95E1D3' },
    { name: 'Ocio', icon: 'film', color: '#AA96DA' },
    { name: 'Salud', icon: 'heart', color: '#F38181' },
    { name: 'Higiene', icon: 'droplet', color: '#FFD3B6' },
    { name: 'Educación', icon: 'book', color: '#A8D8EA' },
    { name: 'Tecnología', icon: 'cpu', color: '#6C5CE7' },
    { name: 'Servicios', icon: 'zap', color: '#FFE66D' },
    { name: 'Otros', icon: 'more-horizontal', color: '#B8B8B8' },
  ];

  for (const category of systemCategories) {
    const existing = await prisma.category.findFirst({
      where: { name: category.name, isSystem: true, householdId: null },
    });
    if (!existing) {
      await prisma.category.create({
        data: { ...category, isSystem: true },
      });
    }
  }
  console.log(`✓ ${systemCategories.length} categorías de sistema`);

  console.log('🎉 Seeding completo');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
