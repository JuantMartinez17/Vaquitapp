import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../../app/middleware/auth.middleware.js';
import { requireHouseholdMember } from '../../app/middleware/authorization.middleware.js';
import { validate } from '../../app/middleware/validate.middleware.js';
import { env } from '../../app/config.js';
import { expenseIdParam, attachmentIdParam } from './attachments.schema.js';
import * as attachmentsController from './attachments.controller.js';

// Buffered in memory (not streamed to disk) so the service can hash and
// magic-byte-sniff the content directly. limits.fileSize rejects an
// oversized upload before it's fully buffered.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES },
});

/**
 * Mounted at `/households/:householdId/expenses/:expenseId/attachments`
 * with `{ mergeParams: true }` so `requireHouseholdMember` can read the
 * parent path's `:householdId`.
 */
export const attachmentsRouter = Router({ mergeParams: true });
attachmentsRouter.use(authMiddleware);

attachmentsRouter.post(
  '/',
  validate(expenseIdParam),
  requireHouseholdMember(),
  upload.single('file'),
  attachmentsController.upload,
);
attachmentsRouter.get(
  '/',
  validate(expenseIdParam),
  requireHouseholdMember(),
  attachmentsController.list,
);
attachmentsRouter.get(
  '/:attachmentId/download',
  validate(attachmentIdParam),
  requireHouseholdMember(),
  attachmentsController.download,
);
attachmentsRouter.delete(
  '/:attachmentId',
  validate(attachmentIdParam),
  requireHouseholdMember(),
  attachmentsController.remove,
);
