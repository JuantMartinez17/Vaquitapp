export interface UploadInput {
  key: string;
  body: Buffer;
  contentType: string;
}

/**
 * Storage abstraction for attachments (D7). The domain and service layers
 * never import an S3 or filesystem API directly — only this interface —
 * so switching STORAGE_PROVIDER never touches business logic.
 */
export interface FileStorage {
  upload(input: UploadInput): Promise<void>;
  /** A short-lived URL the client can download from directly, issued only after authorization has already been checked. */
  getDownloadUrl(key: string, expiresInSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}
