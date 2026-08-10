import { Router } from 'express';
import { authMiddleware } from '../../app/middleware/auth.middleware.js';
import { requireHouseholdMember } from '../../app/middleware/authorization.middleware.js';
import { validate } from '../../app/middleware/validate.middleware.js';
import {
  householdIdParam,
  createCategorySchema,
  updateCategorySchema,
  categoryIdParam,
} from './categories.schema.js';
import * as categoriesController from './categories.controller.js';

/** Public global catalog, mounted at `/categories` — no auth required. */
export const categoriesRouter = Router();
categoriesRouter.get('/', categoriesController.listGlobal);

/**
 * Household-scoped categories. Mounted at `/households/:householdId/categories`
 * with `{ mergeParams: true }` so `requireHouseholdMember` can read the parent
 * path's `:householdId`.
 */
export const householdCategoriesRouter = Router({ mergeParams: true });
householdCategoriesRouter.use(authMiddleware);

householdCategoriesRouter.get(
  '/',
  validate(householdIdParam),
  requireHouseholdMember(),
  categoriesController.listForHousehold,
);
householdCategoriesRouter.post(
  '/',
  validate(createCategorySchema),
  requireHouseholdMember('admin'),
  categoriesController.create,
);
householdCategoriesRouter.patch(
  '/:categoryId',
  validate(updateCategorySchema),
  requireHouseholdMember('admin'),
  categoriesController.update,
);
householdCategoriesRouter.delete(
  '/:categoryId',
  validate(categoryIdParam),
  requireHouseholdMember('admin'),
  categoriesController.remove,
);
