import 'express';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
      };
      /**
       * Query string already validated and coerced by `validate.middleware`.
       * In Express 5 `req.query` is read-only, so the validated result is
       * exposed here instead. Controllers cast it to the schema's inferred type.
       */
      validatedQuery?: unknown;
      /**
       * Household membership for the route's `:householdId`, loaded by
       * `requireHouseholdMember`. Lets controllers/services use the role
       * without querying the database again.
       */
      membership?: {
        id: string;
        householdId: string;
        userId: string;
        role: 'admin' | 'member';
      };
    }
  }
}

export {};
