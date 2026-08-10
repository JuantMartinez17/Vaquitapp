import type { ExpenseAttachment } from '../../generated/prisma/client.js';

export interface AttachmentDto {
  id: string;
  expenseId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: string;
  uploadedBy: string;
  uploadedAt: string;
}

export const toAttachmentDto = (attachment: ExpenseAttachment): AttachmentDto => ({
  id: attachment.id,
  expenseId: attachment.expenseId,
  originalFilename: attachment.originalFilename,
  mimeType: attachment.mimeType,
  sizeBytes: attachment.sizeBytes.toString(),
  uploadedBy: attachment.uploadedBy,
  uploadedAt: attachment.uploadedAt.toISOString(),
});
