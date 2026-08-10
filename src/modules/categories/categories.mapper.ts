import type { Category } from '../../generated/prisma/client.js';

export interface CategoryDto {
  id: string;
  householdId: string | null;
  name: string;
  icon: string | null;
  color: string | null;
  isSystem: boolean;
}

export const toCategoryDto = (category: Category): CategoryDto => ({
  id: category.id,
  householdId: category.householdId,
  name: category.name,
  icon: category.icon,
  color: category.color,
  isSystem: category.isSystem,
});
