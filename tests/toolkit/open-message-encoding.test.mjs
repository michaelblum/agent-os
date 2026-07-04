import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { encodeOpenMessageBase64 } from '../../packages/toolkit/components/open-message-encoding.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function decodeOpenMessageBase64(encoded) {
  const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

test('open message base64 encoding preserves UTF-8 JSON payloads', () => {
  const message = {
    type: 'work_record.open',
    record: {
      id: 'record-with-unicode',
      title: 'AOS destiny - café - 你好 - 🚀',
    },
  };

  const encoded = encodeOpenMessageBase64(message);
  const decoded = decodeOpenMessageBase64(encoded);

  assert.deepEqual(decoded, message);
});

test('open-message child posters use UTF-8-safe encoder instead of direct btoa JSON', async () => {
  const files = [
    'packages/toolkit/components/wiki-subject-browser/index.js',
    'packages/toolkit/components/artifact-bundle-workbench/index.js',
    'packages/toolkit/components/step-descriptor-workbench/index.js',
  ];

  for (const file of files) {
    const source = await readFile(path.join(repoRoot, file), 'utf8');
    assert.match(source, /encodeOpenMessageBase64\(openMessage\)/, file);
    assert.doesNotMatch(source, /btoa\(JSON\.stringify\(openMessage\)\)/, file);
  }
});
