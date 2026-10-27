import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../../app/middleware/auth.middleware.js';
import { requireHouseholdMember } from '../../app/middleware/authorization.middleware.js';
import { validate } from '../../app/middleware/validate.middleware.js';
import { env } from '../../app/config.js';
import { expenseIdParam, attachmentIdParam } from './attachments.schema.js';
import { uploadConcurrencyLimiter } from './upload-concurrency.middleware.js';
import * as attachmentsController from './attachments.controller.js';

// Buffered in memory (not streamed to disk) so the service can hash and
// magic-byte-sniff the content directly. limits.fileSize rejects an
// oversized upload before it's fully buffered. The other limits keep a
// hostile multipart body from costing memory: the endpoint takes exactly one
// file and no meaningful text fields, so anything beyond a couple of parts
// is rejected rather than parsed.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 2, fieldSize: 1024, parts: 3 },
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
  uploadConcurrencyLimiter,
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
