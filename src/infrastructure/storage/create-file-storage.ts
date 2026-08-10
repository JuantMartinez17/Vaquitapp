import { env } from '../../app/config.js';
import { LocalFileStorage } from './local-file-storage.js';
import { S3FileStorage } from './s3-file-storage.js';
import type { FileStorage } from './file-storage.js';

export const createFileStorage = (): FileStorage =>
  env.STORAGE_PROVIDER === 's3' ? new S3FileStorage() : new LocalFileStorage();

/** Single shared instance — matches how `prisma`/`logger` are exported as one instance per process. */
export const fileStorage: FileStorage = createFileStorage();
