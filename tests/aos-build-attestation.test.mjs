import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  repoBuildAttestation,
  repoBuildInputs,
  swiftSourceFingerprint,
} from '../scripts/lib/aos-build-attestation.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-build-attestation-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'shared/swift/ipc'), { recursive: true });
  fs.mkdirSync(path.join(root, '.build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/main.swift'), 'print("one")\n');
  fs.writeFileSync(path.join(root, 'shared/swift/ipc/runtime.swift'), 'let runtime = true\n');
  fs.writeFileSync(path.join(root, 'aos'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, '.build/aos-build-mode'), 'dev\n');
  return root;
}

test('repo build attestation matches the sanctioned Swift fingerprint receipt', (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const expected = swiftSourceFingerprint(root, 'dev');
  fs.writeFileSync(path.join(root, '.build/aos-build-fingerprint'), `${expected.fingerprint}\n`);

  assert.deepEqual(repoBuildAttestation(root), {
    schema_version: 1,
    runtime_mode: 'repo',
    status: 'current',
    current: true,
    build_mode: 'dev',
    source_fingerprint: expected.fingerprint,
    recorded_fingerprint: expected.fingerprint,
    source_file_count: 2,
  });
});

test('repo build attestation fails closed for changed sources, missing binaries, and invalid receipts', (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const expected = swiftSourceFingerprint(root, 'dev');
  fs.writeFileSync(path.join(root, '.build/aos-build-fingerprint'), `${expected.fingerprint}\n`);
  fs.appendFileSync(path.join(root, 'src/main.swift'), 'print("two")\n');

  assert.equal(repoBuildAttestation(root).current, false);
  fs.rmSync(path.join(root, 'aos'));
  assert.equal(repoBuildAttestation(root).current, false);
  fs.writeFileSync(path.join(root, '.build/aos-build-mode'), 'unknown\n');
  assert.deepEqual(repoBuildAttestation(root), {
    schema_version: 1,
    runtime_mode: 'repo',
    status: 'stale',
    current: false,
    build_mode: null,
    source_fingerprint: null,
    recorded_fingerprint: expected.fingerprint,
    source_file_count: 0,
  });
});

test('repo build fingerprint includes raw-runtime link metadata when present', (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'packaging'), { recursive: true });
  const metadataPath = path.join(root, 'packaging/RepoRuntimeLinkInfo.plist');
  fs.writeFileSync(metadataPath, '<plist><dict><key>NSMicrophoneUsageDescription</key><string>one</string></dict></plist>\n');

  assert.deepEqual(repoBuildInputs(root), [
    'src/main.swift',
    'shared/swift/ipc/runtime.swift',
    'packaging/RepoRuntimeLinkInfo.plist',
  ]);
  const before = swiftSourceFingerprint(root, 'dev');
  fs.writeFileSync(metadataPath, '<plist><dict><key>NSMicrophoneUsageDescription</key><string>two</string></dict></plist>\n');
  const after = swiftSourceFingerprint(root, 'dev');

  assert.equal(before.inputs.length, 3);
  assert.equal(after.inputs.length, 3);
  assert.notEqual(before.fingerprint, after.fingerprint);
});
