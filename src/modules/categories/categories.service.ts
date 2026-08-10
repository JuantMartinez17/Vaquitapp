import { prisma } from '../../infrastructure/database/prisma.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors/errors.js';
import { ErrorCode } from '../../shared/errors/codes.js';
import { toCategoryDto } from './categories.mapper.js';
import type { CategoryDto } from './categories.mapper.js';
import type { CreateCategoryDto, UpdateCategoryDto } from './categories.schema.js';

export const listGlobalCategories = async (): Promise<CategoryDto[]> => {
  const categories = await prisma.category.findMany({
    where: { isSystem: true, deletedAt: null },
    orderBy: { name: 'asc' },
  });
  return categories.map(toCategoryDto);
};

export const listHouseholdCategories = async (householdId: string): Promise<CategoryDto[]> => {
  const categories = await prisma.category.findMany({
    where: { deletedAt: null, OR: [{ isSystem: true }, { householdId }] },
    orderBy: { name: 'asc' },
  });
  return categories.map(toCategoryDto);
};

export const createCategory = async (
  householdId: string,
  dto: CreateCategoryDto,
): Promise<CategoryDto> => {
  const category = await prisma.category.create({
    data: {
      householdId,
      name: dto.name,
      icon: dto.icon ?? null,
      color: dto.color ?? null,
      isSystem: false,
    },
  });
  return toCategoryDto(category);
};

/**
 * Confirms a category is usable by this household — either global or owned
 * by it. Reused by every module that tags activity with a category
 * (expenses, incomes, recurring expenses).
 */
export const assertValidCategory = async (
  householdId: string,
  categoryId: string,
): Promise<void> => {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, deletedAt: null, OR: [{ isSystem: true }, { householdId }] },
  });
  if (!category) {
    throw new ValidationError(
      'Category must be global or belong to this household',
      ErrorCode.INVALID_CATEGORY,
    );
  }
};

/** Loads a category owned by this household, rejecting system or other-household ones. */
const loadOwnCategory = async (householdId: string, categoryId: string) => {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, deletedAt: null },
  });
  if (!category) {
    throw new NotFoundError('Category not found');
  }
  if (category.isSystem || category.householdId !== householdId) {
    throw new ForbiddenError("Only the household's own categories can be modified");
  }
  return category;
};

export const updateCategory = async (
  householdId: string,
  categoryId: string,
  dto: UpdateCategoryDto,
): Promise<CategoryDto> => {
  await loadOwnCategory(householdId, categoryId);
  const category = await prisma.category.update({ where: { id: categoryId }, data: dto });
  return toCategoryDto(category);
};

export const deleteCategory = async (householdId: string, categoryId: string): Promise<void> => {
  await loadOwnCategory(householdId, categoryId);
  // Soft delete: any expense that already references this category keeps a
  // valid categoryId (SPECS §25 lifecycle); it just stops being offered for
  // new expenses and drops out of listings.
  await prisma.category.update({ where: { id: categoryId }, data: { deletedAt: new Date() } });
};
