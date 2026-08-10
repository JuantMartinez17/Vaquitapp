/**
 * Determines a file's real MIME type from its content (magic bytes), never
 * from the client-supplied header — SPECS §29 / D7: an upload whitelist
 * checked against a spoofable `Content-Type` isn't a whitelist.
 */

interface Signature {
  mimeType: string;
  matches: (buffer: Buffer) => boolean;
}

const SIGNATURES: Signature[] = [
  {
    mimeType: 'image/jpeg',
    matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mimeType: 'image/png',
    matches: (b) =>
      b.length >= 8 &&
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mimeType: 'image/webp',
    matches: (b) =>
      b.length >= 12 &&
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    mimeType: 'application/pdf',
    matches: (b) => b.length >= 5 && b.subarray(0, 5).toString('ascii') === '%PDF-',
  },
];

export const ALLOWED_ATTACHMENT_MIME_TYPES: readonly string[] = SIGNATURES.map((s) => s.mimeType);

/** Returns the sniffed MIME type, or null if it matches none of the allowed signatures. */
export const sniffMimeType = (buffer: Buffer): string | null =>
  SIGNATURES.find((sig) => sig.matches(buffer))?.mimeType ?? null;
