import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { env } from '../../app/config.js';
import type { FileStorage, UploadInput } from './file-storage.js';

const ROOT = resolve(env.LOCAL_STORAGE_DIR);

// Keys are always server-generated (attachments/<expenseId>/<attachmentId>),
// but resolving defensively means a bug elsewhere can never turn into a
// path-traversal read/write outside LOCAL_STORAGE_DIR.
const pathFor = (key: string): string => {
  const path = resolve(ROOT, key);
  if (path !== ROOT && !path.startsWith(ROOT + '/') && !path.startsWith(ROOT + '\\')) {
    throw new Error(`Refusing to resolve a storage key outside the storage root: ${key}`);
  }
  return path;
};

const sign = (key: string, expiresAt: number): string =>
  createHmac('sha256', env.LOCAL_STORAGE_SECRET!).update(`${key}:${expiresAt}`).digest('hex');

/**
 * Emulates an S3 presigned URL for local dev: a token signed with
 * LOCAL_STORAGE_SECRET, valid until `expiresAt`, that the `/files/local`
 * route in app.ts verifies on its own — no membership re-check at download
 * time, matching how a real presigned URL behaves once issued.
 */
export const verifyLocalDownloadToken = (
  key: string,
  expiresAt: number,
  signature: string,
): boolean => {
  if (Date.now() > expiresAt) {
    return false;
  }
  const expected = Buffer.from(sign(key, expiresAt));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
};

export const readLocalFile = (key: string): Promise<Buffer> => readFile(pathFor(key));

export class LocalFileStorage implements FileStorage {
  async upload({ key, body }: UploadInput): Promise<void> {
    const path = pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  // Not async: signing is synchronous, but the FileStorage interface
  // returns a Promise since the S3 implementation genuinely awaits a call.
  getDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
    const expiresAt = Date.now() + expiresInSeconds * 1000;
    const signature = sign(key, expiresAt);
    const encodedKey = encodeURIComponent(key);
    return Promise.resolve(
      `/api/v1/files/local/${encodedKey}?expiresAt=${expiresAt}&signature=${signature}`,
    );
  }

  async delete(key: string): Promise<void> {
    await rm(pathFor(key), { force: true });
  }
}
