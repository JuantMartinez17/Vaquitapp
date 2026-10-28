import {
  householdIdParam,
  createCategorySchema,
  updateCategorySchema,
  categoryIdParam,
} from '../../../modules/categories/categories.schema.js';
import type { RouteSpec } from '../openapi.builder.js';
import { Category, CategoryList, CurrencyList } from '../response-schemas.js';

export const catalogRoutes: RouteSpec[] = [
  {
    operationId: 'listGlobalCategories',
    method: 'get',
    path: '/categories',
    tag: 'Categories',
    summary: 'List the global category catalog',
    description:
      'The system categories shared by every household (food, transport...), sorted by name. ' +
      'Cacheable: it rarely changes.',
    auth: false,
    success: { status: 200, description: 'Global (system) categories', schema: CategoryList },
  },
  {
    operationId: 'listHouseholdCategories',
    method: 'get',
    path: '/households/{householdId}/categories',
    tag: 'Categories',
    summary: 'List categories available to a household',
    description:
      'Global categories plus the household’s own, sorted by name. These are the ids accepted as ' +
      '`categoryId` on expenses, incomes and recurring expenses. Deleted categories are not listed.',
    request: householdIdParam,
    success: {
      status: 200,
      description: 'Global categories plus the household’s own',
      schema: CategoryList,
    },
  },
  {
    operationId: 'createCategory',
    method: 'post',
    path: '/households/{householdId}/categories',
    tag: 'Categories',
    summary: 'Create a household category',
    description:
      '`color` is a 6-digit hex such as `#FFAA00`; `icon` is a free identifier of at most 50 ' +
      'characters that the client interprets.',
    role: 'admin',
    request: createCategorySchema,
    success: { status: 201, description: 'Category created', schema: Category },
  },
  {
    operationId: 'updateCategory',
    method: 'patch',
    path: '/households/{householdId}/categories/{categoryId}',
    tag: 'Categories',
    summary: 'Update a household category',
    description:
      'Partial update; `icon` and `color` can be cleared with `null`. Only the household’s own ' +
      'categories can be changed: a global one (or another household’s) answers 403 `FORBIDDEN`.',
    role: 'admin',
    request: updateCategorySchema,
    success: { status: 200, description: 'Updated category', schema: Category },
    errors: { 403: ['FORBIDDEN'], 404: ['NOT_FOUND'] },
  },
  {
    operationId: 'deleteCategory',
    method: 'delete',
    path: '/households/{householdId}/categories/{categoryId}',
    tag: 'Categories',
    summary: 'Delete a household category',
    description:
      'Soft delete: expenses that already use the category keep it; it just stops being offered. ' +
      'Global categories cannot be deleted (403 `FORBIDDEN`).',
    role: 'admin',
    request: categoryIdParam,
    success: { status: 204, description: 'Category soft-deleted' },
    errors: { 403: ['FORBIDDEN'], 404: ['NOT_FOUND'] },
  },

  {
    operationId: 'listCurrencies',
    method: 'get',
    path: '/currencies',
    tag: 'Currencies',
    summary: 'List supported currencies',
    description:
      'Catalog sorted by code. `decimalPlaces` tells how many decimals money in that currency ' +
      'is printed with. Use it to fill currency pickers.',
    auth: false,
    success: { status: 200, description: 'Currency catalog', schema: CurrencyList },
  },
];
