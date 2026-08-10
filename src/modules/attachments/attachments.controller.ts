import { asyncHandler } from '../../shared/utils/asyncHandler.js';
import { routeParam } from '../../shared/utils/request.js';
import { BadRequestError } from '../../shared/errors/errors.js';
import * as attachmentsService from './attachments.service.js';

export const upload = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new BadRequestError('No file was uploaded (expected multipart field "file")');
  }
  const attachment = await attachmentsService.uploadAttachment(
    routeParam(req, 'householdId'),
    routeParam(req, 'expenseId'),
    req.user!.id,
    {
      buffer: req.file.buffer,
      originalFilename: req.file.originalname,
      declaredSize: req.file.size,
    },
  );
  res.status(201).json(attachment);
});

export const list = asyncHandler(async (req, res) => {
  res.json(
    await attachmentsService.listAttachments(
      routeParam(req, 'householdId'),
      routeParam(req, 'expenseId'),
    ),
  );
});

export const download = asyncHandler(async (req, res) => {
  res.json(
    await attachmentsService.getAttachmentDownloadUrl(
      routeParam(req, 'householdId'),
      routeParam(req, 'expenseId'),
      routeParam(req, 'attachmentId'),
    ),
  );
});

export const remove = asyncHandler(async (req, res) => {
  await attachmentsService.deleteAttachment(
    routeParam(req, 'householdId'),
    routeParam(req, 'expenseId'),
    routeParam(req, 'attachmentId'),
  );
  res.status(204).send();
});
