import { asyncHandler } from '../../shared/utils/asyncHandler.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import { ForbiddenError, UnauthorizedError } from '../../shared/errors/errors.js';
import { ErrorCode } from '../../shared/errors/codes.js';
import { routeParam } from '../../shared/utils/request.js';
import type { MemberRole } from '../../generated/prisma/client.js';

const ROLE_RANK: Record<MemberRole, number> = { member: 1, admin: 2 };

/**
 * Middleware factory for household-scoped routes. Verifies that `req.user` is
 * an ACTIVE member of household `:householdId` (not left, household not
 * deleted).
 *
 * If `minRole` is given, it also requires that role or higher (admin >
 * member). Loads the membership onto `req.membership` for later use.
 */
export const requireHouseholdMember = (minRole?: MemberRole) =>
  asyncHandler(async (req, _res, next) => {
    if (!req.user) {
      throw new UnauthorizedError();
    }

    const membership = await prisma.householdMember.findFirst({
      where: {
        householdId: routeParam(req, 'householdId'),
        userId: req.user.id,
        leftAt: null,
        household: { deletedAt: null },
      },
    });

    if (!membership) {
      throw new ForbiddenError('You are not a member of this household', ErrorCode.NOT_A_MEMBER);
    }

    if (minRole && ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
      throw new ForbiddenError('This action requires the admin role', ErrorCode.INSUFFICIENT_ROLE);
    }

    req.membership = membership;
    next();
  });
