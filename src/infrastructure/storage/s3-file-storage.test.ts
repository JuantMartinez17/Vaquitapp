import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';

interface RecordedRequest {
  method: string | undefined;
  url: string | undefined;
  body: string;
}

const requests: RecordedRequest[] = [];
let respondWith = 200;

// A stand-in for an S3-compatible endpoint (R2, MinIO): it records what the
// SDK sends and answers with a configurable status.
const fakeS3 = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    requests.push({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString() });
    res.statusCode = respondWith;
    res.end();
  });
});

let storage: InstanceType<typeof import('./s3-file-storage.js').S3FileStorage>;

before(async () => {
  await new Promise<void>((resolve) => fakeS3.listen(0, '127.0.0.1', resolve));
  const { port } = fakeS3.address() as AddressInfo;
  // config.ts reads the environment once, on first import, so S3 settings go
  // in before the storage module (and with it the config) is loaded.
  process.env.S3_ENDPOINT = `http://127.0.0.1:${port}`;
  process.env.S3_REGION = 'auto';
  process.env.S3_BUCKET = 'test-bucket';
  process.env.S3_ACCESS_KEY_ID = 'test-key';
  process.env.S3_SECRET_ACCESS_KEY = 'test-secret';
  const { S3FileStorage } = await import('./s3-file-storage.js');
  storage = new S3FileStorage();
});

after(() => {
  fakeS3.closeAllConnections();
  fakeS3.close();
});

describe('S3FileStorage', () => {
  it('uploads the object with a path-style PUT', async () => {
    requests.length = 0;
    respondWith = 200;
    await storage.upload({
      key: 'attachments/e1/a1.png',
      body: Buffer.from('payload'),
      contentType: 'image/png',
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.method, 'PUT');
    assert.ok(requests[0]?.url?.startsWith('/test-bucket/attachments/e1/a1.png'));
    assert.match(requests[0]?.body ?? '', /payload/);
  });

  it('issues a DELETE for the object', async () => {
    requests.length = 0;
    respondWith = 204;
    await storage.delete('attachments/e1/a1.png');
    assert.equal(requests[0]?.method, 'DELETE');
    assert.ok(requests[0]?.url?.startsWith('/test-bucket/attachments/e1/a1.png'));
  });

  it('signs a time-limited download URL without calling the endpoint', async () => {
    requests.length = 0;
    const url = await storage.getDownloadUrl('attachments/e1/a1.png', 300);
    assert.match(url, /X-Amz-Signature=/);
    assert.match(url, /X-Amz-Expires=300/);
    assert.equal(requests.length, 0);
  });

  it('gives up after two attempts when the endpoint keeps failing', async () => {
    requests.length = 0;
    respondWith = 500;
    await assert.rejects(
      storage.upload({ key: 'k', body: Buffer.from('x'), contentType: 'image/png' }),
    );
    assert.equal(requests.length, 2, 'one attempt plus a single retry');
  });
});

describe('S3 SDK loading', () => {
  it('is only imported lazily, never at module load', async () => {
    const source = await readFile(new URL('./s3-file-storage.ts', import.meta.url), 'utf8');
    const staticValueImports = source
      .split('\n')
      .filter((line) => /^import\s/.test(line) && !/^import type\s/.test(line))
      .filter((line) => line.includes('@aws-sdk/'));
    assert.deepEqual(staticValueImports, [], 'only `import type` and dynamic import() allowed');
  });
});
