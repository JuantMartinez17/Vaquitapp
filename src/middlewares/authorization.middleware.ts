import { asyncHandler } from '../utils/asyncHandler.js';
import { prisma } from '../config/prisma.js';
import { ForbiddenError, UnauthorizedError } from '../utils/errors.js';
import { routeParam } from '../utils/request.js';
import type { MemberRole } from '../generated/prisma/client.js';

const ROLE_RANK: Record<MemberRole, number> = { member: 1, admin: 2 };

/**
 * Middleware factory para rutas group-scoped. Verifica que `req.user` sea
 * miembro ACTIVO del grupo `:groupId` (no dado de baja y grupo no borrado).
 *
 * Si se pasa `minRole`, además exige ese rol o superior (admin > member).
 * Carga la membresía en `req.membership` para uso posterior.
 */
export const requireGroupMember = (minRole?: MemberRole) =>
  asyncHandler(async (req, _res, next) => {
    if (!req.user) {
      throw new UnauthorizedError();
    }

    const membership = await prisma.groupMember.findFirst({
      where: {
        groupId: routeParam(req, 'groupId'),
        userId: req.user.id,
        leftAt: null,
        group: { deletedAt: null },
      },
    });

    if (!membership) {
      throw new ForbiddenError('No sos miembro de este grupo');
    }

    if (minRole && ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
      throw new ForbiddenError('Esta acción requiere rol de administrador');
    }

    req.membership = membership;
    next();
  });
