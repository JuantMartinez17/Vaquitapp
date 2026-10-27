import { z } from 'zod';

/**
 * `?includeVoided=true` on list endpoints. Voided rows are hidden by default.
 * A string enum instead of `z.coerce.boolean()`, which would turn the string
 * "false" into `true`.
 */
export const includeVoidedSchema = z.enum(['true', 'false']).optional();
