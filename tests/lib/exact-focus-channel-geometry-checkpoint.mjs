import crypto from 'node:crypto';
import fs from 'node:fs';

export const GEOMETRY_CHECKPOINT_SCHEMA = 'aos.exact-focus-channel-native-fixture-geometry-checkpoint.v1';
export const GEOMETRY_CHECKPOINT_KEY_ENV = 'AOS_EXACT_FOCUS_CHANNEL_FIXTURE_GEOMETRY_KEY';
export const GEOMETRY_CHECKPOINT_REQUEST_MAX_BYTES = 256;
export const GEOMETRY_CHECKPOINT_RECEIPT_MAX_BYTES = 512;
export const GEOMETRY_CHECKPOINT_PHASES = Object.freeze([
  'initial_pre',
  'initial_post',
  'preserved_pre',
  'preserved_post',
]);
export const GEOMETRY_CHECKPOINT_FAILURE_CODES = Object.freeze([
  'FIXTURE_GEOMETRY_CHECKPOINT_READINESS_UNAVAILABLE',
]);

const failureCodeSet = new Set(GEOMETRY_CHECKPOINT_FAILURE_CODES);

export class GeometryCheckpointError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function requireCheckpoint(condition, code = 'FIXTURE_GEOMETRY_CHECKPOINT_INVALID') {
  if (!condition) throw new GeometryCheckpointError(code);
}

function hasExactKeys(value, keys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys);
}

function exactUTF8JSON(bytes, errorCode = 'FIXTURE_GEOMETRY_CHECKPOINT_INVALID') {
  requireCheckpoint(Buffer.isBuffer(bytes), errorCode);
  const text = bytes.toString('utf8');
  requireCheckpoint(Buffer.from(text, 'utf8').equals(bytes), errorCode);
  try {
    return JSON.parse(text);
  } catch {
    throw new GeometryCheckpointError(errorCode);
  }
}

export function readGeometryCheckpointFile(file, maximumBytes) {
  const errorCode = 'FIXTURE_GEOMETRY_CHECKPOINT_INVALID';
  const noFollow = fs.constants.O_NOFOLLOW;
  requireCheckpoint(Number.isInteger(noFollow) && noFollow !== 0, errorCode);
  let descriptor = null;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
    const metadata = fs.fstatSync(descriptor);
    requireCheckpoint(
      metadata.isFile() && metadata.size >= 1 && metadata.size <= maximumBytes,
      errorCode,
    );
    const bytes = Buffer.alloc(metadata.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, null);
      requireCheckpoint(count > 0, errorCode);
      offset += count;
    }
    const trailingByte = Buffer.alloc(1);
    requireCheckpoint(fs.readSync(descriptor, trailingByte, 0, 1, null) === 0, errorCode);
    return bytes;
  } catch (error) {
    if (error instanceof GeometryCheckpointError) throw error;
    throw new GeometryCheckpointError(errorCode);
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

export function validGeometryCheckpointHex(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

export function validGeometryBounds(bounds) {
  return hasExactKeys(bounds, ['height', 'width', 'x', 'y'])
    && Number.isSafeInteger(bounds.x)
    && Number.isSafeInteger(bounds.y)
    && Number.isSafeInteger(bounds.width)
    && Number.isSafeInteger(bounds.height)
    && bounds.width > 0
    && bounds.height > 0;
}

export function validGeometryScale(value) {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value > 0
    && !Object.is(value, -0);
}

function validGeometryFact(fact) {
  return fact !== null
    && typeof fact === 'object'
    && Number.isSafeInteger(fact.ownerPID)
    && fact.ownerPID > 0
    && Number.isSafeInteger(fact.windowID)
    && fact.windowID > 0
    && validGeometryBounds(fact.bounds)
    && Number.isSafeInteger(fact.displayID)
    && fact.displayID > 0
    && fact.displayID <= 0xffff_ffff
    && validGeometryScale(fact.scaleFactor);
}

function uint32BE(value) {
  const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes;
}

function uint64BE(value) {
  const bytes = Buffer.alloc(8); bytes.writeBigUInt64BE(BigInt(value)); return bytes;
}

function int64BE(value) {
  const bytes = Buffer.alloc(8); bytes.writeBigInt64BE(BigInt(value)); return bytes;
}

function geometryFactRecord(fact, tag = null) {
  requireCheckpoint(validGeometryFact(fact), 'FIXTURE_GEOMETRY_FACT_INVALID');
  const scaleBits = Buffer.alloc(8);
  scaleBits.writeDoubleBE(fact.scaleFactor);
  return Buffer.concat([
    ...(tag === null ? [] : [Buffer.from([tag])]),
    uint64BE(fact.ownerPID),
    uint64BE(fact.windowID),
    int64BE(fact.bounds.x),
    int64BE(fact.bounds.y),
    int64BE(fact.bounds.width),
    int64BE(fact.bounds.height),
    uint32BE(fact.displayID),
    scaleBits,
  ]);
}

export function targetGeometryFactBytes(fact) {
  return Buffer.concat([
    Buffer.from('aos.exact-focus.fixture-target-fact.v1\0', 'utf8'),
    geometryFactRecord(fact),
  ]);
}

export function fullFixtureGeometryFactBytes(targetFact, siblingFact) {
  return Buffer.concat([
    Buffer.from('aos.exact-focus.fixture-full-fact.v2\0', 'utf8'),
    geometryFactRecord(targetFact, 1),
    geometryFactRecord(siblingFact, 2),
  ]);
}

export function geometryCheckpointHMAC(bytes, key) {
  return crypto.createHmac('sha256', key).update(bytes).digest('hex');
}

export function geometryFactHMACs(targetFact, siblingFact, key) {
  return {
    target: geometryCheckpointHMAC(targetGeometryFactBytes(targetFact), key),
    full: geometryCheckpointHMAC(fullFixtureGeometryFactBytes(targetFact, siblingFact), key),
  };
}

function phaseTag(phase) {
  const index = GEOMETRY_CHECKPOINT_PHASES.indexOf(phase);
  requireCheckpoint(index >= 0);
  return index + 1;
}

function lengthPrefixedUTF8(value) {
  const bytes = Buffer.from(value, 'utf8');
  requireCheckpoint(bytes.length <= 0xffff);
  const count = Buffer.alloc(2);
  count.writeUInt16BE(bytes.length);
  return Buffer.concat([count, bytes]);
}

function receiptPrefix(receipt, variant) {
  requireCheckpoint(validGeometryCheckpointHex(receipt.nonce));
  return Buffer.concat([
    Buffer.from('aos.exact-focus.fixture-checkpoint-receipt.v1\0', 'utf8'),
    lengthPrefixedUTF8(receipt.schema),
    lengthPrefixedUTF8(receipt.status),
    Buffer.from(receipt.nonce, 'hex'),
    Buffer.from([phaseTag(receipt.phase), variant]),
  ]);
}

export function readyGeometryReceiptMAC(receipt, key) {
  requireCheckpoint(validGeometryCheckpointHex(receipt.target_fact_hmac));
  requireCheckpoint(validGeometryCheckpointHex(receipt.full_fixture_fact_hmac));
  return geometryCheckpointHMAC(Buffer.concat([
    receiptPrefix(receipt, 1),
    Buffer.from(receipt.target_fact_hmac, 'hex'),
    Buffer.from(receipt.full_fixture_fact_hmac, 'hex'),
  ]), key);
}

export function failureGeometryReceiptMAC(receipt, key) {
  requireCheckpoint(failureCodeSet.has(receipt.error_code));
  return geometryCheckpointHMAC(Buffer.concat([
    receiptPrefix(receipt, 2),
    lengthPrefixedUTF8(receipt.error_code),
  ]), key);
}

export function geometryCheckpointRequestJSON(phase, nonce) {
  requireCheckpoint(GEOMETRY_CHECKPOINT_PHASES.includes(phase));
  requireCheckpoint(validGeometryCheckpointHex(nonce));
  const request = `${JSON.stringify({
    nonce,
    phase,
    schema: GEOMETRY_CHECKPOINT_SCHEMA,
  })}\n`;
  requireCheckpoint(
    Buffer.byteLength(request, 'utf8') <= GEOMETRY_CHECKPOINT_REQUEST_MAX_BYTES,
  );
  return request;
}

function removeCheckpointFile(file) {
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function publishCheckpointRequest(file, contents, nonce) {
  const temporary = `${file}.${nonce}.tmp`;
  let descriptor = null;
  let removeTemporary = true;
  try {
    descriptor = fs.openSync(
      temporary,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600,
    );
    fs.writeFileSync(descriptor, contents, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, file);
    removeTemporary = false;
  } catch {
    throw new GeometryCheckpointError('FIXTURE_GEOMETRY_CHECKPOINT_REQUEST_INVALID');
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch {}
    }
    if (removeTemporary) {
      try { fs.unlinkSync(temporary); } catch {}
    }
  }
}

export class GeometryCheckpointRequester {
  #requestFile;
  #receiptFile;
  #key;
  #issuedNonces = new Set();

  constructor({ requestFile, receiptFile, key }) {
    requireCheckpoint(typeof requestFile === 'string' && requestFile.length > 0);
    requireCheckpoint(typeof receiptFile === 'string' && receiptFile.length > 0);
    requireCheckpoint(Buffer.isBuffer(key) && key.length === 32, 'FIXTURE_GEOMETRY_CHECKPOINT_KEY_UNAVAILABLE');
    this.#requestFile = requestFile;
    this.#receiptFile = receiptFile;
    this.#key = key;
  }

  begin(phase) {
    requireCheckpoint(Buffer.isBuffer(this.#key) && this.#key.length === 32, 'FIXTURE_GEOMETRY_CHECKPOINT_KEY_UNAVAILABLE');
    let nonce;
    do {
      nonce = crypto.randomBytes(32).toString('hex');
    } while (this.#issuedNonces.has(nonce));
    this.#issuedNonces.add(nonce);
    const request = geometryCheckpointRequestJSON(phase, nonce);
    removeCheckpointFile(this.#receiptFile);
    removeCheckpointFile(this.#requestFile);
    publishCheckpointRequest(this.#requestFile, request, nonce);
    return Object.freeze({ nonce, phase });
  }

  read(transaction) {
    requireCheckpoint(
      transaction !== null
        && typeof transaction === 'object'
        && validGeometryCheckpointHex(transaction.nonce)
        && GEOMETRY_CHECKPOINT_PHASES.includes(transaction.phase),
    );
    return parseGeometryCheckpointReceiptFile(
      this.#receiptFile,
      transaction.nonce,
      transaction.phase,
      this.#key,
    );
  }

  cleanup() {
    removeCheckpointFile(this.#requestFile);
    removeCheckpointFile(this.#receiptFile);
  }
}

export function parseGeometryCheckpointReceiptBytes(bytes, expectedNonce, expectedPhase, key) {
  const invalidCode = 'FIXTURE_GEOMETRY_CHECKPOINT_INVALID';
  requireCheckpoint(
    Buffer.isBuffer(bytes)
      && bytes.length >= 1
      && bytes.length <= GEOMETRY_CHECKPOINT_RECEIPT_MAX_BYTES,
    invalidCode,
  );
  const envelope = exactUTF8JSON(bytes, invalidCode);
  if (envelope?.status === 'failed') {
    requireCheckpoint(hasExactKeys(envelope, [
      'error_code', 'nonce', 'phase', 'receipt_mac', 'schema', 'status',
    ]), invalidCode);
    requireCheckpoint(envelope.schema === GEOMETRY_CHECKPOINT_SCHEMA, invalidCode);
    requireCheckpoint(failureCodeSet.has(envelope.error_code), invalidCode);
    requireCheckpoint(envelope.nonce === expectedNonce && envelope.phase === expectedPhase, invalidCode);
    requireCheckpoint(validGeometryCheckpointHex(envelope.receipt_mac), invalidCode);
    const expectedMAC = failureGeometryReceiptMAC(envelope, key);
    requireCheckpoint(
      crypto.timingSafeEqual(
        Buffer.from(envelope.receipt_mac, 'hex'),
        Buffer.from(expectedMAC, 'hex'),
      ),
      invalidCode,
    );
    throw new GeometryCheckpointError(envelope.error_code);
  }
  requireCheckpoint(hasExactKeys(envelope, [
    'full_fixture_fact_hmac',
    'nonce',
    'phase',
    'receipt_mac',
    'schema',
    'status',
    'target_fact_hmac',
  ]), invalidCode);
  requireCheckpoint(envelope.schema === GEOMETRY_CHECKPOINT_SCHEMA, invalidCode);
  requireCheckpoint(envelope.status === 'ready', invalidCode);
  requireCheckpoint(envelope.nonce === expectedNonce && envelope.phase === expectedPhase, invalidCode);
  requireCheckpoint(validGeometryCheckpointHex(envelope.target_fact_hmac), invalidCode);
  requireCheckpoint(validGeometryCheckpointHex(envelope.full_fixture_fact_hmac), invalidCode);
  requireCheckpoint(validGeometryCheckpointHex(envelope.receipt_mac), invalidCode);
  const expectedMAC = readyGeometryReceiptMAC(envelope, key);
  requireCheckpoint(
    crypto.timingSafeEqual(Buffer.from(envelope.receipt_mac, 'hex'), Buffer.from(expectedMAC, 'hex')),
    invalidCode,
  );
  return envelope;
}

export function parseGeometryCheckpointReceiptFile(file, expectedNonce, expectedPhase, key) {
  return parseGeometryCheckpointReceiptBytes(
    readGeometryCheckpointFile(file, GEOMETRY_CHECKPOINT_RECEIPT_MAX_BYTES),
    expectedNonce,
    expectedPhase,
    key,
  );
}

function equalBounds(actual, expected) {
  return actual
    && actual.x === expected.x
    && actual.y === expected.y
    && actual.width === expected.width
    && actual.height === expected.height;
}

export function verifyCaptureGeometryCheckpoint({
  capture,
  channel,
  decodedHeight,
  decodedWidth,
  ownerPID,
  targetWindowID,
  pre,
  post,
  key,
}) {
  const verify = (condition, code) => requireCheckpoint(condition, code);
  verify(capture.window === undefined, 'CAPTURE_WINDOW_UNEXPECTED');
  verify(Array.isArray(capture.surfaces) && capture.surfaces.length === 1, 'CAPTURE_SURFACE_INVALID');
  const surface = capture.surfaces[0];
  verify(surface.kind === 'channel' && surface.id === channel, 'CAPTURE_SURFACE_IDENTITY_MISMATCH');
  verify(surface.window_id === targetWindowID, 'CAPTURE_SURFACE_WINDOW_MISMATCH');
  verify(validGeometryBounds(surface.bounds_global), 'CAPTURE_BOUNDS_INVALID');
  verify(Array.isArray(surface.displays) && surface.displays.length === 1, 'CAPTURE_DISPLAY_CARDINALITY');
  verify(Array.isArray(surface.segments) && surface.segments.length === 1, 'CAPTURE_SEGMENT_CARDINALITY');
  verify(Array.isArray(capture.perceptions) && capture.perceptions.length === 1, 'CAPTURE_PERCEPTION_MISSING');
  const segment = surface.segments[0];
  const perception = capture.perceptions[0];
  verify(
    Array.isArray(perception.segments) && perception.segments.length === 1,
    'CAPTURE_PERCEPTION_SEGMENT_CARDINALITY',
  );
  const perceptionSegment = perception.segments[0];
  verify(validGeometryBounds(segment.bounds_global), 'CAPTURE_SEGMENT_BOUNDS_INVALID');
  verify(validGeometryBounds(perception.capture_bounds_global), 'CAPTURE_PERCEPTION_BOUNDS_INVALID');
  verify(
    validGeometryBounds(perceptionSegment.bounds_global),
    'CAPTURE_PERCEPTION_SEGMENT_BOUNDS_INVALID',
  );
  verify(
    equalBounds(segment.bounds_global, surface.bounds_global)
      && equalBounds(perception.capture_bounds_global, surface.bounds_global)
      && equalBounds(perceptionSegment.bounds_global, surface.bounds_global),
    'CAPTURE_GEOMETRY_INCOHERENT',
  );
  verify(validGeometryBounds(surface.bounds_local), 'CAPTURE_LOCAL_BOUNDS_INVALID');
  verify(validGeometryBounds(segment.bounds_local), 'CAPTURE_SEGMENT_LOCAL_BOUNDS_INVALID');
  verify(validGeometryBounds(perception.capture_bounds_local), 'CAPTURE_PERCEPTION_LOCAL_BOUNDS_INVALID');
  verify(
    validGeometryBounds(perceptionSegment.bounds_local),
    'CAPTURE_PERCEPTION_SEGMENT_LOCAL_BOUNDS_INVALID',
  );
  verify(
    surface.bounds_local.x === 0
      && surface.bounds_local.y === 0
      && equalBounds(segment.bounds_local, surface.bounds_local)
      && equalBounds(perception.capture_bounds_local, surface.bounds_local)
      && equalBounds(perceptionSegment.bounds_local, surface.bounds_local),
    'CAPTURE_LOCAL_GEOMETRY_INCOHERENT',
  );
  verify(
    Number.isSafeInteger(segment.display_id)
      && segment.display_id > 0
      && segment.display_id <= 0xffff_ffff
      && segment.display_id === perceptionSegment.display_id
      && Number.isSafeInteger(segment.display)
      && segment.display > 0
      && segment.display === perceptionSegment.display
      && surface.display === segment.display
      && surface.displays[0] === segment.display,
    'CAPTURE_DISPLAY_INCOHERENT',
  );
  const scaleFactor = surface.capture_scale_factor;
  verify(
    validGeometryScale(scaleFactor)
      && validGeometryScale(surface.scale_factor)
      && validGeometryScale(segment.scale_factor)
      && validGeometryScale(perception.capture_scale_factor)
      && validGeometryScale(perceptionSegment.scale_factor)
      && surface.scale_factor === scaleFactor
      && segment.scale_factor === scaleFactor
      && perception.capture_scale_factor === scaleFactor
      && perceptionSegment.scale_factor === scaleFactor,
    'CAPTURE_SCALE_INCOHERENT',
  );
  verify(
    Number.isSafeInteger(decodedWidth)
      && decodedWidth > 0
      && Number.isSafeInteger(decodedHeight)
      && decodedHeight > 0
      && surface.bounds_local.width === decodedWidth
      && surface.bounds_local.height === decodedHeight,
    'CAPTURE_LOCAL_BOUNDS_MISMATCH',
  );
  verify(
    Math.round(surface.bounds_global.width * scaleFactor) === decodedWidth
      && Math.round(surface.bounds_global.height * scaleFactor) === decodedHeight,
    'CAPTURE_PIXEL_GEOMETRY_MISMATCH',
  );
  const targetFact = {
    ownerPID,
    windowID: surface.window_id,
    bounds: surface.bounds_global,
    displayID: segment.display_id,
    scaleFactor,
  };
  const expectedTargetHMAC = geometryCheckpointHMAC(targetGeometryFactBytes(targetFact), key);
  verify(
    pre.target_fact_hmac === expectedTargetHMAC && post.target_fact_hmac === expectedTargetHMAC,
    'CAPTURE_TARGET_FACT_MISMATCH',
  );
  verify(
    pre.full_fixture_fact_hmac === post.full_fixture_fact_hmac,
    'CAPTURE_FULL_FIXTURE_CHANGED',
  );
  return {
    bounds: surface.bounds_global,
    displayID: segment.display_id,
    localBounds: surface.bounds_local,
    ownerPID,
    scaleFactor,
    surface,
    windowID: surface.window_id,
  };
}
