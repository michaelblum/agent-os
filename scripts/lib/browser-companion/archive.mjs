import crypto from 'node:crypto';
import path from 'node:path';
import zlib from 'node:zlib';

import { fail } from './errors.mjs';

const BLOCK = 512;

function parseOctal(bytes, label) {
  const text = bytes.toString('ascii').replaceAll('\0', '').trim();
  if (!/^[0-7]+$/u.test(text)) fail('COMPANION_ARCHIVE_INVALID', `${label} is not octal`);
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) fail('COMPANION_ARCHIVE_INVALID', `${label} is out of range`);
  return value;
}

function tarString(bytes) {
  const zero = bytes.indexOf(0);
  return bytes.subarray(0, zero < 0 ? bytes.length : zero).toString('utf8');
}

function safeArchivePath(header) {
  const name = tarString(header.subarray(0, 100));
  const prefix = tarString(header.subarray(345, 500));
  const joined = prefix ? `${prefix}/${name}` : name;
  if (!joined || joined.includes('\\') || joined.startsWith('/') || /^[A-Za-z]:/u.test(joined)) {
    fail('COMPANION_ARCHIVE_INVALID', 'archive path is absolute or empty');
  }
  const parts = joined.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    fail('COMPANION_ARCHIVE_INVALID', 'archive path traverses');
  }
  if (parts[0] !== 'package' || parts.length < 2) {
    fail('COMPANION_ARCHIVE_INVALID', 'archive entry is outside package root');
  }
  return parts.slice(1).join('/');
}

function verifyHeaderChecksum(header) {
  const expected = parseOctal(header.subarray(148, 156), 'tar checksum');
  const copy = Buffer.from(header);
  copy.fill(0x20, 148, 156);
  const actual = copy.reduce((sum, value) => sum + value, 0);
  if (actual !== expected) fail('COMPANION_ARCHIVE_INVALID', 'tar checksum differs');
}

export function verifySRI(bytes, integrity) {
  const [algorithm, encoded] = String(integrity).split('-', 2);
  if (algorithm !== 'sha512' || !encoded) fail('COMPANION_DESCRIPTOR_INVALID', 'integrity is unsupported');
  const expected = Buffer.from(encoded, 'base64');
  const actual = crypto.createHash('sha512').update(bytes).digest();
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    fail('COMPANION_INTEGRITY_MISMATCH', 'tarball SRI differs');
  }
}

export function inspectTarball(bytes, pkg, limits) {
  verifySRI(bytes, pkg.integrity);
  let tar;
  try {
    tar = zlib.gunzipSync(bytes, { maxOutputLength: limits.max_extracted_bytes + (BLOCK * 4) });
  } catch (error) {
    if (error?.code === 'ERR_BUFFER_TOO_LARGE') fail('COMPANION_ARCHIVE_LIMIT', 'expanded archive is too large');
    fail('COMPANION_ARCHIVE_INVALID', 'gzip payload is invalid', { cause: error });
  }
  const entries = [];
  const seen = new Set();
  let files = 0;
  let totalBytes = 0;
  let offset = 0;
  let zeroBlocks = 0;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    offset += BLOCK;
    if (header.every((value) => value === 0)) {
      zeroBlocks += 1;
      if (zeroBlocks === 2) break;
      continue;
    }
    if (zeroBlocks) fail('COMPANION_ARCHIVE_INVALID', 'archive continues after a zero block');
    verifyHeaderChecksum(header);
    const relative = safeArchivePath(header);
    const size = parseOctal(header.subarray(124, 136), 'tar size');
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156]);
    if (type !== '0' && type !== '5') fail('COMPANION_ARCHIVE_INVALID', 'archive contains a link or special entry');
    if (type === '5' && size !== 0) fail('COMPANION_ARCHIVE_INVALID', 'archive directory has payload');
    if (offset + size > tar.length) fail('COMPANION_ARCHIVE_INVALID', 'archive payload is truncated');
    if (seen.has(relative)) fail('COMPANION_ARCHIVE_INVALID', 'archive path is duplicated');
    seen.add(relative);
    const skipped = pkg.excluded_prefixes.some((prefix) => relative.startsWith(prefix));
    if (!skipped) {
      files += type === '0' ? 1 : 0;
      totalBytes += size;
      if (files > limits.max_extracted_files || totalBytes > limits.max_extracted_bytes) {
        fail('COMPANION_ARCHIVE_LIMIT', 'archive extraction budget exceeded');
      }
      entries.push(Object.freeze({
        path: path.posix.normalize(relative),
        type: type === '5' ? 'directory' : 'file',
        bytes: type === '0' ? Buffer.from(tar.subarray(offset, offset + size)) : null,
      }));
    }
    offset += Math.ceil(size / BLOCK) * BLOCK;
  }
  if (zeroBlocks !== 2) fail('COMPANION_ARCHIVE_INVALID', 'archive terminator is missing');
  return Object.freeze({ entries, fileCount: files, totalBytes });
}
