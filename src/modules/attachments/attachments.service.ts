import { randomUUID, createHash } from 'node:crypto';
import { prisma } from '../../infrastructure/database/prisma.js';
import { fileStorage } from '../../infrastructure/storage/create-file-storage.js';
import { sniffMimeType } from '../../domain/files/sniff-mime.js';
import { env } from '../../app/config.js';
import { BadRequestError, NotFoundError, ValidationError } from '../../shared/errors/errors.js';
import { ErrorCode } from '../../shared/errors/codes.js';
import { toAttachmentDto } from './attachments.mapper.js';
import type { AttachmentDto } from './attachments.mapper.js';

const MAX_ATTACHMENTS_PER_EXPENSE = 5;
const DOWNLOAD_URL_TTL_SECONDS = 300;

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

export interface UploadedFile {
  buffer: Buffer;
  originalFilename: string;
  declaredSize: number;
}

const assertExpenseInHousehold = async (householdId: string, expenseId: string) => {
  const expense = await prisma.expense.findFirst({ where: { id: expenseId, householdId } });
  if (!expense) {
    throw new NotFoundError('Expense not found');
  }
  return expense;
};

export const uploadAttachment = async (
  householdId: string,
  expenseId: string,
  userId: string,
  file: UploadedFile,
): Promise<AttachmentDto> => {
  const expense = await assertExpenseInHousehold(householdId, expenseId);
  if (expense.status === 'voided') {
    throw new BadRequestError('Cannot attach a file to a voided expense');
  }

  if (file.declaredSize > env.MAX_UPLOAD_BYTES) {
    throw new ValidationError(
      `File exceeds the ${env.MAX_UPLOAD_BYTES}-byte limit`,
      ErrorCode.ATTACHMENT_TOO_LARGE,
    );
  }

  const existingCount = await prisma.expenseAttachment.count({
    where: { expenseId, deletedAt: null },
  });
  if (existingCount >= MAX_ATTACHMENTS_PER_EXPENSE) {
    throw new ValidationError(
      `An expense can have at most ${MAX_ATTACHMENTS_PER_EXPENSE} attachments`,
      ErrorCode.TOO_MANY_ATTACHMENTS,
    );
  }

  // The whitelist is enforced against the file's actual bytes, never the
  // client-supplied Content-Type (SPECS §29, D7).
  const mimeType = sniffMimeType(file.buffer);
  if (!mimeType) {
    throw new ValidationError(
      'Unsupported file type — only JPEG, PNG, WEBP and PDF are allowed',
      ErrorCode.UNSUPPORTED_MEDIA_TYPE,
    );
  }

  const sha256Hash = createHash('sha256').update(file.buffer).digest('hex');

  // Deduplicate: re-uploading a file already attached to this expense
  // returns the existing row instead of storing a second copy.
  const duplicate = await prisma.expenseAttachment.findFirst({
    where: { expenseId, sha256Hash, deletedAt: null },
  });
  if (duplicate) {
    return toAttachmentDto(duplicate);
  }

  const attachmentId = randomUUID();
  const storageKey = `attachments/${expenseId}/${attachmentId}${EXTENSION_BY_MIME[mimeType]}`;

  await fileStorage.upload({ key: storageKey, body: file.buffer, contentType: mimeType });

  const attachment = await prisma.expenseAttachment.create({
    data: {
      id: attachmentId,
      expenseId,
      storageKey,
      storageProvider: env.STORAGE_PROVIDER,
      bucket: env.STORAGE_PROVIDER === 's3' ? (env.S3_BUCKET ?? '') : 'local',
      originalFilename: file.originalFilename,
      mimeType,
      sizeBytes: BigInt(file.buffer.length),
      sha256Hash,
      uploadedBy: userId,
    },
  });
  return toAttachmentDto(attachment);
};

export const listAttachments = async (
  householdId: string,
  expenseId: string,
): Promise<AttachmentDto[]> => {
  await assertExpenseInHousehold(householdId, expenseId);
  const attachments = await prisma.expenseAttachment.findMany({
    where: { expenseId, deletedAt: null },
    orderBy: { uploadedAt: 'asc' },
  });
  return attachments.map(toAttachmentDto);
};

const loadActiveAttachment = async (
  householdId: string,
  expenseId: string,
  attachmentId: string,
) => {
  await assertExpenseInHousehold(householdId, expenseId);
  const attachment = await prisma.expenseAttachment.findFirst({
    where: { id: attachmentId, expenseId, deletedAt: null },
  });
  if (!attachment) {
    throw new NotFoundError('Attachment not found');
  }
  return attachment;
};

export const getAttachmentDownloadUrl = async (
  householdId: string,
  expenseId: string,
  attachmentId: string,
): Promise<{ url: string; expiresInSeconds: number }> => {
  const attachment = await loadActiveAttachment(householdId, expenseId, attachmentId);
  const url = await fileStorage.getDownloadUrl(attachment.storageKey, DOWNLOAD_URL_TTL_SECONDS);
  return { url, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS };
};

export const deleteAttachment = async (
  householdId: string,
  expenseId: string,
  attachmentId: string,
): Promise<void> => {
  const attachment = await loadActiveAttachment(householdId, expenseId, attachmentId);
  await prisma.expenseAttachment.update({
    where: { id: attachment.id },
    data: { deletedAt: new Date() },
  });
  await fileStorage.delete(attachment.storageKey);
};
