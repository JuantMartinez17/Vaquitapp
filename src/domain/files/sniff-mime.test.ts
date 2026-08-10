import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sniffMimeType } from './sniff-mime.js';

describe('sniffMimeType', () => {
  it('recognizes a JPEG by its magic bytes', () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    assert.equal(sniffMimeType(buffer), 'image/jpeg');
  });

  it('recognizes a PNG by its magic bytes', () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    assert.equal(sniffMimeType(buffer), 'image/png');
  });

  it('recognizes a WEBP by its RIFF/WEBP markers', () => {
    const buffer = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]), // chunk size, irrelevant to sniffing
      Buffer.from('WEBP', 'ascii'),
    ]);
    assert.equal(sniffMimeType(buffer), 'image/webp');
  });

  it('recognizes a PDF by its header', () => {
    const buffer = Buffer.from('%PDF-1.7\n%rest of file', 'ascii');
    assert.equal(sniffMimeType(buffer), 'application/pdf');
  });

  it('rejects content that matches no signature, regardless of a spoofed extension', () => {
    const buffer = Buffer.from('#!/bin/sh\nrm -rf /', 'ascii');
    assert.equal(sniffMimeType(buffer), null);
  });

  it('rejects an empty or too-short buffer', () => {
    assert.equal(sniffMimeType(Buffer.alloc(0)), null);
    assert.equal(sniffMimeType(Buffer.from([0xff, 0xd8])), null);
  });
});
