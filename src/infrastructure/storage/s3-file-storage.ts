import type { S3Client } from '@aws-sdk/client-s3';
import { env } from '../../app/config.js';
import type { FileStorage, UploadInput } from './file-storage.js';

// Connecting to the endpoint must be quick; sending up to MAX_UPLOAD_BYTES
// over a small instance's uplink may legitimately take a while. Without
// these the SDK would wait on a stalled socket indefinitely, pinning the
// request (and its buffered file) in memory.
const CONNECTION_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 30_000;
// One retry rides out a transient blip; more would multiply the time a
// request holds its upload buffer when R2 is genuinely down.
const MAX_ATTEMPTS = 2;

// The AWS SDK is large (tens of MB of modules to parse and keep resident).
// It is loaded on first use, never at import, so a deployment with
// STORAGE_PROVIDER=local does not pay for it, and boot stays fast.
const loadSdk = async () => {
  const [clientS3, presigner] = await Promise.all([
    import('@aws-sdk/client-s3'),
    import('@aws-sdk/s3-request-presigner'),
  ]);
  return { ...clientS3, getSignedUrl: presigner.getSignedUrl };
};

export class S3FileStorage implements FileStorage {
  private clientPromise: Promise<{
    client: S3Client;
    sdk: Awaited<ReturnType<typeof loadSdk>>;
  }> | null = null;

  // Memoized promise (not the resolved value): concurrent first uploads must
  // share one load and one client instead of racing to build several.
  private connect() {
    this.clientPromise ??= loadSdk()
      .then((sdk) => ({
        sdk,
        client: new sdk.S3Client({
          region: env.S3_REGION,
          endpoint: env.S3_ENDPOINT,
          forcePathStyle: env.S3_FORCE_PATH_STYLE,
          maxAttempts: MAX_ATTEMPTS,
          requestHandler: {
            connectionTimeout: CONNECTION_TIMEOUT_MS,
            requestTimeout: REQUEST_TIMEOUT_MS,
          },
          credentials:
            env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
              ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
              : undefined,
        }),
      }))
      .catch((err: unknown) => {
        // Do not cache a failed load: the next call gets a fresh attempt.
        this.clientPromise = null;
        throw err;
      });
    return this.clientPromise;
  }

  async upload({ key, body, contentType }: UploadInput): Promise<void> {
    const { client, sdk } = await this.connect();
    await client.send(
      new sdk.PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
    const { client, sdk } = await this.connect();
    return sdk.getSignedUrl(client, new sdk.GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }

  async delete(key: string): Promise<void> {
    const { client, sdk } = await this.connect();
    await client.send(new sdk.DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  }
}
