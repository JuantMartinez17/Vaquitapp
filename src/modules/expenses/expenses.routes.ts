import { Router } from 'express';
import { authMiddleware } from '../../app/middleware/auth.middleware.js';
import { requireHouseholdMember } from '../../app/middleware/authorization.middleware.js';
import { validate } from '../../app/middleware/validate.middleware.js';
import { idempotent } from '../../app/middleware/idempotency.middleware.js';
import {
  householdIdParam,
  createExpenseSchema,
  updateExpenseSchema,
  expenseIdParam,
  listExpensesQuerySchema,
} from './expenses.schema.js';
import * as expensesController from './expenses.controller.js';

/**
 * Mounted at `/households/:householdId/expenses` with `{ mergeParams: true }`
 * so `requireHouseholdMember` can read the parent path's `:householdId`.
 */
export const expensesRouter = Router({ mergeParams: true });
expensesRouter.use(authMiddleware);

expensesRouter.post(
  '/',
  validate(createExpenseSchema),
  requireHouseholdMember(),
  idempotent('POST /households/:householdId/expenses'),
  expensesController.create,
);
expensesRouter.get(
  '/',
  validate({ params: householdIdParam.params, query: listExpensesQuerySchema }),
  requireHouseholdMember(),
  expensesController.list,
);
expensesRouter.get(
  '/:expenseId',
  validate(expenseIdParam),
  requireHouseholdMember(),
  expensesController.getOne,
);
expensesRouter.patch(
  '/:expenseId',
  validate(updateExpenseSchema),
  requireHouseholdMember(),
  expensesController.update,
);
expensesRouter.delete(
  '/:expenseId',
  validate(expenseIdParam),
  requireHouseholdMember(),
  expensesController.remove,
);
expensesRouter.post(
  '/:expenseId/confirm',
  validate(expenseIdParam),
  requireHouseholdMember(),
  expensesController.confirm,
);
expensesRouter.post(
  '/:expenseId/skip',
  validate(expenseIdParam),
  requireHouseholdMember(),
  expensesController.skip,
);
