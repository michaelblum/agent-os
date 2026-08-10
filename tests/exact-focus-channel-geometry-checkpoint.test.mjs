import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  GEOMETRY_CHECKPOINT_FAILURE_CODES,
  GEOMETRY_CHECKPOINT_PHASES,
  GEOMETRY_CHECKPOINT_RECEIPT_MAX_BYTES,
  GEOMETRY_CHECKPOINT_SCHEMA,
  GeometryCheckpointError,
  GeometryCheckpointRequester,
  failureGeometryReceiptMAC,
  fullFixtureGeometryFactBytes,
  geometryFactHMACs,
  parseGeometryCheckpointReceiptBytes,
  parseGeometryCheckpointReceiptFile,
  readyGeometryReceiptMAC,
  targetGeometryFactBytes,
  verifyCaptureGeometryCheckpoint,
} from './lib/exact-focus-channel-geometry-checkpoint.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const swiftHelperPath = path.join(root, 'tests/lib/exact-focus-channel-geometry-checkpoint.swift');
const swiftHarnessPath = path.join(root, 'tests/lib/exact-focus-channel-geometry-checkpoint-harness.swift');
const rawSentinel = 'RAW_GEOMETRY_CHECKPOINT_SENTINEL_MUST_NOT_LEAK';
const key = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
const wrongKey = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1));
const nonce = '01'.repeat(32);
const targetFact = Object.freeze({
  bounds: Object.freeze({ height: 348, width: 480, x: -1440, y: -120 }),
  displayID: 42,
  ownerPID: 4242,
  scaleFactor: 2,
  windowID: 77,
});
const siblingFact = Object.freeze({
  bounds: Object.freeze({ height: 278, width: 340, x: -1370, y: -80 }),
  displayID: 43,
  ownerPID: 4242,
  scaleFactor: 1.5,
  windowID: 78,
});
const expectedVector = Object.freeze({
  failure_receipt_mac: 'a71609f75ad25b66dd9a5742fac5193e6617432ea623fc0c2e610b04ee3cd4eb',
  full_fixture_fact_hmac: '207b10175767ef3c4d2f204dab076ff7efc37d25ad48305f087127bae53a3243',
  ready_receipt_mac: 'd4be9d5ef0fc43e629ffa3f38d844ec244280ddb29bfaf576069e58fe1c38e54',
  target_fact_hmac: '61c7cbe1cd21819dcd0dab92a1d2a118432ec062a0d1b154cff7c6c5d21d8efd',
});

function caughtCode(operation) {
  try {
    operation();
    return null;
  } catch (error) {
    return error instanceof GeometryCheckpointError ? error.code : null;
  }
}

function readyReceipt(overrides = {}, signingKey = key) {
  const hmacs = geometryFactHMACs(targetFact, siblingFact, key);
  const receipt = {
    full_fixture_fact_hmac: hmacs.full,
    nonce,
    phase: 'initial_pre',
    schema: GEOMETRY_CHECKPOINT_SCHEMA,
    status: 'ready',
    target_fact_hmac: hmacs.target,
    ...overrides,
  };
  return { ...receipt, receipt_mac: readyGeometryReceiptMAC(receipt, signingKey) };
}

function failureReceipt(overrides = {}, signingKey = key) {
  const receipt = {
    error_code: GEOMETRY_CHECKPOINT_FAILURE_CODES[0],
    nonce,
    phase: 'initial_pre',
    schema: GEOMETRY_CHECKPOINT_SCHEMA,
    status: 'failed',
    ...overrides,
  };
  return { ...receipt, receipt_mac: failureGeometryReceiptMAC(receipt, signingKey) };
}

function exactReceiptBytes(value) {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function mutateFact(fact, field) {
  const candidate = structuredClone(fact);
  if (field.startsWith('bounds.')) {
    candidate.bounds[field.slice('bounds.'.length)] += 1;
  } else if (field === 'scaleFactor') {
    candidate[field] += 0.5;
  } else {
    candidate[field] += 1;
  }
  return candidate;
}

function makeCapture() {
  const global = { height: 348, width: 480, x: -1440, y: -120 };
  const local = { height: 696, width: 960, x: 0, y: 0 };
  return {
    perceptions: [{
      capture_bounds_global: { ...global },
      capture_bounds_local: { ...local },
      capture_scale_factor: 2,
      segments: [{
        bounds_global: { ...global },
        bounds_local: { ...local },
        display: 1,
        display_id: 42,
        scale_factor: 2,
      }],
    }],
    surfaces: [{
      bounds_global: { ...global },
      bounds_local: { ...local },
      capture_scale_factor: 2,
      display: 1,
      displays: [1],
      id: 'proof-channel',
      kind: 'channel',
      scale_factor: 2,
      segments: [{
        bounds_global: { ...global },
        bounds_local: { ...local },
        display: 1,
        display_id: 42,
        scale_factor: 2,
      }],
      window_id: 77,
    }],
  };
}

test('geometry checkpoint Node protocol is exact, authenticated, bounded, and content-free', () => {
  const hmacs = geometryFactHMACs(targetFact, siblingFact, key);
  const ready = readyReceipt();
  const failed = failureReceipt();
  assert.deepEqual({
    failure_receipt_mac: failed.receipt_mac,
    full_fixture_fact_hmac: hmacs.full,
    ready_receipt_mac: ready.receipt_mac,
    target_fact_hmac: hmacs.target,
  }, expectedVector);
  assert.deepEqual(GEOMETRY_CHECKPOINT_PHASES, [
    'initial_pre', 'initial_post', 'preserved_pre', 'preserved_post',
  ]);
  assert.deepEqual(GEOMETRY_CHECKPOINT_FAILURE_CODES, [
    'FIXTURE_GEOMETRY_CHECKPOINT_READINESS_UNAVAILABLE',
  ]);
  assert.equal(
    parseGeometryCheckpointReceiptBytes(exactReceiptBytes(ready), nonce, 'initial_pre', key).receipt_mac,
    expectedVector.ready_receipt_mac,
  );

  const canonicalFields = [
    'ownerPID', 'windowID', 'bounds.x', 'bounds.y', 'bounds.width', 'bounds.height',
    'displayID', 'scaleFactor',
  ];
  for (const field of canonicalFields) {
    const targetMutation = mutateFact(targetFact, field);
    assert.notDeepEqual(targetGeometryFactBytes(targetMutation), targetGeometryFactBytes(targetFact));
    assert.notEqual(geometryFactHMACs(targetMutation, siblingFact, key).full, hmacs.full);
    const siblingMutation = mutateFact(siblingFact, field);
    assert.notDeepEqual(
      fullFixtureGeometryFactBytes(targetFact, siblingMutation),
      fullFixtureGeometryFactBytes(targetFact, siblingFact),
    );
    assert.notEqual(geometryFactHMACs(targetFact, siblingMutation, key).full, hmacs.full);
  }
  assert.notEqual(geometryFactHMACs(targetFact, siblingFact, wrongKey).target, hmacs.target);
  assert.notEqual(geometryFactHMACs(targetFact, siblingFact, wrongKey).full, hmacs.full);

  const invalidReady = [
    { ...ready, nonce: '02'.repeat(32) },
    { ...ready, phase: 'initial_post' },
    { ...ready, target_fact_hmac: '00'.repeat(32) },
    { ...ready, full_fixture_fact_hmac: '00'.repeat(32) },
    { ...ready, receipt_mac: '00'.repeat(32) },
    { ...ready, extra: rawSentinel },
  ];
  assert.ok(invalidReady.every((value) => caughtCode(() => (
    parseGeometryCheckpointReceiptBytes(exactReceiptBytes(value), nonce, 'initial_pre', key)
  )) === 'FIXTURE_GEOMETRY_CHECKPOINT_INVALID'));
  assert.equal(caughtCode(() => (
    parseGeometryCheckpointReceiptBytes(exactReceiptBytes(ready), nonce, 'initial_pre', wrongKey)
  )), 'FIXTURE_GEOMETRY_CHECKPOINT_INVALID');
  assert.equal(caughtCode(() => (
    parseGeometryCheckpointReceiptBytes(exactReceiptBytes(failureReceipt({ nonce: '02'.repeat(32) })), nonce, 'initial_pre', key)
  )), 'FIXTURE_GEOMETRY_CHECKPOINT_INVALID');
  assert.equal(caughtCode(() => (
    parseGeometryCheckpointReceiptBytes(exactReceiptBytes(failureReceipt({ phase: 'initial_post' })), nonce, 'initial_pre', key)
  )), 'FIXTURE_GEOMETRY_CHECKPOINT_INVALID');
  assert.equal(caughtCode(() => (
    parseGeometryCheckpointReceiptBytes(exactReceiptBytes(failureReceipt({}, wrongKey)), nonce, 'initial_pre', key)
  )), 'FIXTURE_GEOMETRY_CHECKPOINT_INVALID');
  const tamperedFailure = { ...failed, error_code: rawSentinel };
  assert.equal(caughtCode(() => (
    parseGeometryCheckpointReceiptBytes(exactReceiptBytes(tamperedFailure), nonce, 'initial_pre', key)
  )), 'FIXTURE_GEOMETRY_CHECKPOINT_INVALID');
  assert.equal(caughtCode(() => (
    parseGeometryCheckpointReceiptBytes(exactReceiptBytes(failed), nonce, 'initial_pre', key)
  )), GEOMETRY_CHECKPOINT_FAILURE_CODES[0]);

  const exactBoundary = Buffer.from(JSON.stringify(ready).padEnd(GEOMETRY_CHECKPOINT_RECEIPT_MAX_BYTES, ' '));
  assert.equal(exactBoundary.length, GEOMETRY_CHECKPOINT_RECEIPT_MAX_BYTES);
  assert.equal(
    parseGeometryCheckpointReceiptBytes(exactBoundary, nonce, 'initial_pre', key).nonce,
    nonce,
  );
  assert.equal(caughtCode(() => parseGeometryCheckpointReceiptBytes(
    Buffer.concat([exactBoundary, Buffer.from(' ')]), nonce, 'initial_pre', key,
  )), 'FIXTURE_GEOMETRY_CHECKPOINT_INVALID');
  assert.equal(caughtCode(() => parseGeometryCheckpointReceiptBytes(
    Buffer.from([0xc3]), nonce, 'initial_pre', key,
  )), 'FIXTURE_GEOMETRY_CHECKPOINT_INVALID');
  assert.equal(caughtCode(() => parseGeometryCheckpointReceiptBytes(
    Buffer.from(`{"${rawSentinel}":true}`), nonce, 'initial_pre', key,
  )), 'FIXTURE_GEOMETRY_CHECKPOINT_INVALID');
  assert.equal(JSON.stringify([
    ...invalidReady.map((value) => caughtCode(() => (
      parseGeometryCheckpointReceiptBytes(exactReceiptBytes(value), nonce, 'initial_pre', key)
    ))),
  ]).includes(rawSentinel), false);
});

test('geometry checkpoint production requester projects authenticated failure and scrubs files', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-geometry-requester-'));
  const requestFile = path.join(temporaryRoot, 'request.json');
  const receiptFile = path.join(temporaryRoot, 'receipt.json');
  try {
    const requester = new GeometryCheckpointRequester({ key, receiptFile, requestFile });
    const transaction = requester.begin('initial_pre');
    const request = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
    assert.deepEqual(Object.keys(request).sort(), ['nonce', 'phase', 'schema']);
    assert.equal(request.nonce, transaction.nonce);
    const receipt = failureReceipt({ nonce: transaction.nonce });
    fs.writeFileSync(receiptFile, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
    assert.equal(caughtCode(() => requester.read(transaction)), GEOMETRY_CHECKPOINT_FAILURE_CODES[0]);
    requester.cleanup();
    assert.equal(fs.existsSync(requestFile), false);
    assert.equal(fs.existsSync(receiptFile), false);
    assert.equal(JSON.stringify({ request, code: GEOMETRY_CHECKPOINT_FAILURE_CODES[0] }).includes(rawSentinel), false);
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('geometry checkpoint public capture projections are mutually coherent and pixel-bound', () => {
  const hmacs = geometryFactHMACs(targetFact, siblingFact, key);
  const checkpoint = { full_fixture_fact_hmac: hmacs.full, target_fact_hmac: hmacs.target };
  const verify = (capture) => verifyCaptureGeometryCheckpoint({
    capture,
    channel: 'proof-channel',
    decodedHeight: 696,
    decodedWidth: 960,
    key,
    ownerPID: 4242,
    post: checkpoint,
    pre: checkpoint,
    targetWindowID: 77,
  });
  assert.deepEqual(verify(makeCapture()).localBounds, { height: 696, width: 960, x: 0, y: 0 });
  assert.equal(caughtCode(() => verifyCaptureGeometryCheckpoint({
    capture: makeCapture(), channel: 'proof-channel', decodedHeight: 696, decodedWidth: 960,
    key, ownerPID: 4242,
    post: { ...checkpoint, target_fact_hmac: '00'.repeat(32) },
    pre: { ...checkpoint, target_fact_hmac: '00'.repeat(32) }, targetWindowID: 77,
  })), 'CAPTURE_TARGET_FACT_MISMATCH');
  const coherentlyShifted = makeCapture();
  coherentlyShifted.surfaces[0].bounds_global.x += 1;
  coherentlyShifted.surfaces[0].segments[0].bounds_global.x += 1;
  coherentlyShifted.perceptions[0].capture_bounds_global.x += 1;
  coherentlyShifted.perceptions[0].segments[0].bounds_global.x += 1;
  assert.equal(caughtCode(() => verify(coherentlyShifted)), 'CAPTURE_TARGET_FACT_MISMATCH');
  const mutations = [
    (value) => { value.surfaces[0].bounds_global.x += 1; },
    (value) => { value.surfaces[0].segments[0].bounds_global.y += 1; },
    (value) => { value.perceptions[0].capture_bounds_global.width += 1; },
    (value) => { value.perceptions[0].segments[0].bounds_global.height += 1; },
    (value) => { value.surfaces[0].bounds_local.x = 1; },
    (value) => { value.surfaces[0].segments[0].bounds_local.width += 1; },
    (value) => { value.perceptions[0].capture_bounds_local.height += 1; },
    (value) => { value.perceptions[0].segments[0].bounds_local.y = 1; },
    (value) => { value.surfaces[0].segments[0].display = null; },
    (value) => { value.surfaces[0].segments[0].display = 1.5; },
    (value) => { value.surfaces[0].segments[0].display_id = 43; },
    (value) => { value.surfaces[0].capture_scale_factor = -0; },
    (value) => { value.perceptions[0].capture_scale_factor = 1; },
  ];
  for (const mutate of mutations) {
    const capture = makeCapture();
    mutate(capture);
    assert.match(caughtCode(() => verify(capture)), /^CAPTURE_/u);
  }
  assert.equal(caughtCode(() => verifyCaptureGeometryCheckpoint({
    capture: makeCapture(), channel: 'proof-channel', decodedHeight: 696, decodedWidth: 959,
    key, ownerPID: 4242, post: checkpoint, pre: checkpoint, targetWindowID: 77,
  })), 'CAPTURE_LOCAL_BOUNDS_MISMATCH');
  assert.equal(caughtCode(() => verifyCaptureGeometryCheckpoint({
    capture: makeCapture(), channel: 'proof-channel', decodedHeight: 696, decodedWidth: 960,
    key, ownerPID: 4242, post: { ...checkpoint, full_fixture_fact_hmac: '00'.repeat(32) },
    pre: checkpoint, targetWindowID: 77,
  })), 'CAPTURE_FULL_FIXTURE_CHANGED');
});

test('Swift helper matches fixed vectors and enforces request/service publication invariants', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-geometry-swift-helper-'));
  const binary = path.join(temporaryRoot, 'geometry-checkpoint-helper-self-test');
  const harness = swiftHarnessPath;
  try {
    execFileSync('swiftc', [
      '-parse-as-library',
      '-module-cache-path', path.join(temporaryRoot, 'module-cache'),
      swiftHelperPath,
      harness,
      '-o', binary,
    ], { cwd: root, stdio: 'pipe', timeout: 45_000 });
    const result = spawnSync(binary, [], { cwd: root, encoding: 'utf8', timeout: 5_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      ...expectedVector,
      immediate_consumer_unlink_committed: true,
      request_boundaries_and_lifecycle: true,
      status: 'passed',
    });
    assert.equal(result.stdout.includes(rawSentinel), false);
    const swiftSource = fs.readFileSync(swiftHelperPath, 'utf8');
    const publisher = swiftSource.slice(swiftSource.indexOf('private func publishFixtureGeometryReceipt'));
    const afterRename = publisher.slice(publisher.indexOf('guard Darwin.rename'));
    assert.match(afterRename, /guard Darwin\.rename\(temporaryURL\.path, url\.path\) == 0/u);
    assert.doesNotMatch(afterRename, /setAttributes|chmod|FileManager/u);
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('geometry checkpoint file reader rejects malformed, oversized, and symlink receipts', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-geometry-reader-'));
  const receiptFile = path.join(temporaryRoot, 'receipt.json');
  const link = path.join(temporaryRoot, 'receipt-link.json');
  try {
    fs.writeFileSync(receiptFile, exactReceiptBytes(readyReceipt()));
    assert.equal(parseGeometryCheckpointReceiptFile(receiptFile, nonce, 'initial_pre', key).nonce, nonce);
    fs.symlinkSync(receiptFile, link);
    assert.equal(caughtCode(() => (
      parseGeometryCheckpointReceiptFile(link, nonce, 'initial_pre', key)
    )), 'FIXTURE_GEOMETRY_CHECKPOINT_INVALID');
    fs.writeFileSync(receiptFile, Buffer.alloc(GEOMETRY_CHECKPOINT_RECEIPT_MAX_BYTES + 1, 0x20));
    assert.equal(caughtCode(() => (
      parseGeometryCheckpointReceiptFile(receiptFile, nonce, 'initial_pre', key)
    )), 'FIXTURE_GEOMETRY_CHECKPOINT_INVALID');
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
