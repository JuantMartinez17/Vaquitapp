import { prisma } from '../../config/prisma.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/errors.js';
import type { MemberRole } from '../../generated/prisma/client.js';
import { toGroupDto, toMemberDto } from './groups.mapper.js';
import type { GroupDto, MemberDto } from './groups.mapper.js';
import type { CreateGroupDto, UpdateGroupDto } from './groups.schema.js';

const assertCurrencyExists = async (code: string): Promise<void> => {
  const currency = await prisma.currency.findUnique({ where: { code } });
  if (!currency) {
    throw new BadRequestError(`Moneda no soportada: ${code}`);
  }
};

const countActiveMembers = (groupId: string): Promise<number> =>
  prisma.groupMember.count({ where: { groupId, leftAt: null } });

export const createGroup = async (userId: string, dto: CreateGroupDto): Promise<GroupDto> => {
  if (dto.defaultCurrencyCode) {
    await assertCurrencyExists(dto.defaultCurrencyCode);
  }

  const group = await prisma.$transaction(async (tx) => {
    const created = await tx.group.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        defaultCurrencyCode: dto.defaultCurrencyCode ?? 'ARS',
        createdBy: userId,
      },
    });
    await tx.groupMember.create({ data: { groupId: created.id, userId, role: 'admin' } });
    return created;
  });

  return toGroupDto(group, { role: 'admin', memberCount: 1 });
};

export const listGroupsForUser = async (userId: string): Promise<GroupDto[]> => {
  const memberships = await prisma.groupMember.findMany({
    where: { userId, leftAt: null, group: { deletedAt: null } },
    include: { group: true },
    orderBy: { joinedAt: 'desc' },
  });

  const counts = await prisma.groupMember.groupBy({
    by: ['groupId'],
    where: { groupId: { in: memberships.map((m) => m.groupId) }, leftAt: null },
    _count: { _all: true },
  });
  const countByGroup = new Map(counts.map((c) => [c.groupId, c._count._all]));

  return memberships.map((m) =>
    toGroupDto(m.group, { role: m.role, memberCount: countByGroup.get(m.groupId) ?? 1 }),
  );
};

export const getGroup = async (groupId: string, role: MemberRole): Promise<GroupDto> => {
  const group = await prisma.group.findFirst({ where: { id: groupId, deletedAt: null } });
  if (!group) {
    throw new NotFoundError('Grupo no encontrado');
  }
  return toGroupDto(group, { role, memberCount: await countActiveMembers(groupId) });
};

export const updateGroup = async (groupId: string, dto: UpdateGroupDto): Promise<GroupDto> => {
  if (dto.defaultCurrencyCode) {
    await assertCurrencyExists(dto.defaultCurrencyCode);
  }
  const group = await prisma.group.update({ where: { id: groupId }, data: dto });
  return toGroupDto(group, { memberCount: await countActiveMembers(groupId) });
};

export const softDeleteGroup = async (groupId: string): Promise<void> => {
  await prisma.group.update({ where: { id: groupId }, data: { deletedAt: new Date() } });
};

export const listMembers = async (groupId: string): Promise<MemberDto[]> => {
  const members = await prisma.groupMember.findMany({
    where: { groupId, leftAt: null },
    include: { user: true },
    orderBy: { joinedAt: 'asc' },
  });
  return members.map(toMemberDto);
};

export const addMember = async (
  groupId: string,
  email: string,
  role: MemberRole,
): Promise<MemberDto> => {
  const user = await prisma.user.findFirst({ where: { email, deletedAt: null } });
  if (!user) {
    throw new NotFoundError('No existe un usuario con ese email');
  }

  const existing = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: user.id } },
  });

  if (existing && !existing.leftAt) {
    throw new ConflictError('El usuario ya es miembro del grupo');
  }

  // Si ya existía pero se había ido, lo reactivamos; si no, lo creamos.
  const member = existing
    ? await prisma.groupMember.update({
        where: { id: existing.id },
        data: { leftAt: null, role, joinedAt: new Date() },
        include: { user: true },
      })
    : await prisma.groupMember.create({
        data: { groupId, userId: user.id, role },
        include: { user: true },
      });

  return toMemberDto(member);
};

export const removeMember = async (groupId: string, targetUserId: string): Promise<void> => {
  const member = await prisma.groupMember.findFirst({
    where: { groupId, userId: targetUserId, leftAt: null },
  });
  if (!member) {
    throw new NotFoundError('El usuario no es miembro del grupo');
  }

  if (member.role === 'admin') {
    const adminCount = await prisma.groupMember.count({
      where: { groupId, role: 'admin', leftAt: null },
    });
    if (adminCount <= 1) {
      throw new BadRequestError('No podés quitar al último administrador del grupo');
    }
  }

  await prisma.groupMember.update({ where: { id: member.id }, data: { leftAt: new Date() } });
};

export const changeMemberRole = async (
  groupId: string,
  targetUserId: string,
  role: MemberRole,
): Promise<MemberDto> => {
  const member = await prisma.groupMember.findFirst({
    where: { groupId, userId: targetUserId, leftAt: null },
    include: { user: true },
  });
  if (!member) {
    throw new NotFoundError('El usuario no es miembro del grupo');
  }

  if (member.role === 'admin' && role === 'member') {
    const adminCount = await prisma.groupMember.count({
      where: { groupId, role: 'admin', leftAt: null },
    });
    if (adminCount <= 1) {
      throw new BadRequestError('No podés dejar al grupo sin administradores');
    }
  }

  if (member.role === role) {
    return toMemberDto(member);
  }

  const updated = await prisma.groupMember.update({
    where: { id: member.id },
    data: { role },
    include: { user: true },
  });
  return toMemberDto(updated);
};
