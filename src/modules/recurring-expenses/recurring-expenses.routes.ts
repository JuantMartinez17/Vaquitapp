import { Router } from 'express';
import { authMiddleware } from '../../app/middleware/auth.middleware.js';
import { requireHouseholdMember } from '../../app/middleware/authorization.middleware.js';
import { validate } from '../../app/middleware/validate.middleware.js';
import {
  householdIdParam,
  createRecurringExpenseSchema,
  updateRecurringExpenseSchema,
  recurringExpenseIdParam,
} from './recurring-expenses.schema.js';
import * as recurringExpensesController from './recurring-expenses.controller.js';

/**
 * Mounted at `/households/:householdId/recurring-expenses` with
 * `{ mergeParams: true }` so `requireHouseholdMember` can read the parent
 * path's `:householdId`.
 */
export const recurringExpensesRouter = Router({ mergeParams: true });
recurringExpensesRouter.use(authMiddleware);

recurringExpensesRouter.post(
  '/',
  validate(createRecurringExpenseSchema),
  requireHouseholdMember(),
  recurringExpensesController.create,
);
recurringExpensesRouter.get(
  '/',
  validate(householdIdParam),
  requireHouseholdMember(),
  recurringExpensesController.list,
);
recurringExpensesRouter.get(
  '/upcoming',
  validate(householdIdParam),
  requireHouseholdMember(),
  recurringExpensesController.upcoming,
);
recurringExpensesRouter.patch(
  '/:recurringExpenseId',
  validate(updateRecurringExpenseSchema),
  requireHouseholdMember(),
  recurringExpensesController.update,
);
recurringExpensesRouter.delete(
  '/:recurringExpenseId',
  validate(recurringExpenseIdParam),
  requireHouseholdMember(),
  recurringExpensesController.remove,
);
