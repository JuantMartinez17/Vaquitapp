import { z } from 'zod';
import { civilDateSchema } from '../../shared/validation/civil-date.schema.js';

const MAX_RANGE_DAYS = 366;

const householdId = z.object({ householdId: z.string().uuid() });

// SPECS §27: analytics never runs unbounded — every query requires an
// explicit, capped date range.
const dateRange = z
  .object({
    from: civilDateSchema,
    to: civilDateSchema,
  })
  .refine((v) => new Date(v.from).getTime() <= new Date(v.to).getTime(), {
    message: 'from must not be after to',
  })
  .refine(
    (v) => {
      const days = (new Date(v.to).getTime() - new Date(v.from).getTime()) / 86_400_000;
      return days <= MAX_RANGE_DAYS;
    },
    { message: `Range must not exceed ${MAX_RANGE_DAYS} days` },
  );

export const dateRangeSchema = {
  params: householdId,
  query: dateRange,
};

export const overTimeSchema = {
  params: householdId,
  query: dateRange.and(z.object({ granularity: z.enum(['day', 'week', 'month']).default('day') })),
};

export type DateRangeQuery = z.infer<typeof dateRange>;
export type OverTimeQuery = DateRangeQuery & { granularity: 'day' | 'week' | 'month' };
