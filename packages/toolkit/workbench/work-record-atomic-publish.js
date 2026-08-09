import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const nativePath = path.join(moduleDir, 'native', 'build', `${process.platform}-${process.arch}`, 'descriptor-relative-fs.node');
const CAPABILITY_SCHEMA = 'aos.descriptor-relative-fs.v1';

let bindingState = null;
let atomicPublishTestHook = null;

function unavailableError() {
  const error = new Error('Descriptor-relative filesystem publication is unavailable.');
  error.code = process.platform === 'darwin'
    ? 'DESCRIPTOR_RELATIVE_FS_UNAVAILABLE'
    : 'DESCRIPTOR_RELATIVE_FS_UNSUPPORTED_PLATFORM';
  return error;
}

function loadBinding() {
  if (bindingState) return bindingState;
  if (process.platform !== 'darwin') {
    bindingState = { binding: null, error: unavailableError() };
    return bindingState;
  }
  try {
    const binding = require(nativePath);
    const capabilities = binding?.capabilities?.();
    if (capabilities?.schema_version !== CAPABILITY_SCHEMA
      || capabilities?.descriptor_relative !== true
      || capabilities?.rename_detection !== true
      || capabilities?.hardlink_detection !== true
      || capabilities?.atomic_unique_link !== true
      || capabilities?.hardlink_scrubbing !== true
      || typeof binding?.inspect !== 'function'
      || typeof binding?.publish !== 'function') {
      bindingState = { binding: null, error: unavailableError() };
    } else {
      bindingState = { binding, capabilities, error: null };
    }
  } catch {
    bindingState = { binding: null, error: unavailableError() };
  }
  return bindingState;
}

function nativeError(result = {}, cleanup = false) {
  const code = cleanup ? result.cleanup_error_code : result.error_code;
  const message = cleanup ? result.cleanup_error_message : result.error_message;
  if (!code && !message) return null;
  const error = new Error(message || 'Descriptor-relative filesystem operation failed.');
  error.code = code || 'DESCRIPTOR_RELATIVE_FS_FAILED';
  return error;
}

function invalidDestination(message = 'Destination is invalid or ambiguous.') {
  const error = new Error(message);
  error.code = 'INVALID_DESTINATION';
  return error;
}

function hasAmbiguousSegments(rawPath) {
  if (rawPath === path.parse(rawPath).root) return false;
  const segments = rawPath.split(path.sep);
  const relevant = path.isAbsolute(rawPath) ? segments.slice(1) : segments;
  return relevant.some((segment) => !segment || segment === '.' || segment === '..');
}

function normalizeRoute(destination, boundaryRoot = '', { requireBoundaryRoot = false } = {}) {
  const rawDestination = String(destination ?? '');
  const rawBoundaryRoot = String(boundaryRoot ?? '');
  if (!rawDestination || rawDestination.includes('\0') || hasAmbiguousSegments(rawDestination)) {
    throw invalidDestination();
  }
  if (requireBoundaryRoot && !rawBoundaryRoot) {
    throw invalidDestination('An explicit boundary root is required.');
  }
  if (rawBoundaryRoot && (rawBoundaryRoot.includes('\0') || hasAmbiguousSegments(rawBoundaryRoot))) {
    throw invalidDestination('Boundary root is invalid or ambiguous.');
  }
  const absoluteDestination = path.resolve(rawDestination);
  const root = path.resolve(rawBoundaryRoot || path.dirname(absoluteDestination));
  const relative = path.relative(root, absoluteDestination);
  if (!relative || path.isAbsolute(relative) || relative.startsWith('..')) {
    throw invalidDestination('Destination must identify one path below its explicit boundary root.');
  }
  const relativeSegments = relative.split(path.sep);
  if (relativeSegments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\0'))) {
    throw invalidDestination('Destination contains an invalid or ambiguous path segment.');
  }
  return { absoluteDestination, root, relativeSegments };
}

function normalizeResult(result = {}, destination = '') {
  return {
    ...result,
    destination,
    error: nativeError(result),
    cleanup_error: nativeError(result, true),
    bytes: Buffer.isBuffer(result.bytes) ? result.bytes.toString('utf8') : result.bytes,
  };
}

function hook(event) {
  return typeof atomicPublishTestHook === 'function' ? atomicPublishTestHook(Object.freeze({ ...event })) : undefined;
}

export function descriptorRelativeAtomicPublishAvailability() {
  const state = loadBinding();
  return state.binding
    ? { available: true, schema_version: state.capabilities.schema_version, platform: process.platform, arch: process.arch }
    : { available: false, schema_version: CAPABILITY_SCHEMA, platform: process.platform, arch: process.arch, error: state.error };
}

export function installWorkRecordAtomicPublishTestHook(testHook = null) {
  if (testHook !== null && typeof testHook !== 'function') throw new TypeError('testHook must be a function or null.');
  const previous = atomicPublishTestHook;
  atomicPublishTestHook = testHook;
  return () => {
    atomicPublishTestHook = previous;
  };
}

export function readTextFileNoFollow(destination, {
  boundaryRoot = '',
  expectedIdentity = null,
} = {}) {
  let route;
  try {
    route = normalizeRoute(destination, boundaryRoot);
  } catch (error) {
    return { status: 'inspection_failed', existing_kind: 'invalid', error };
  }
  const state = loadBinding();
  if (!state.binding) return { status: 'inspection_failed', existing_kind: 'unavailable', error: state.error };
  const result = state.binding.inspect({
    rootPath: route.root,
    relativeSegments: route.relativeSegments,
    expectedIdentity,
    hook,
  });
  return normalizeResult(result, route.absoluteDestination);
}

export function inspectTextFileDestination(destination, bytes, options = {}) {
  let route;
  try {
    route = normalizeRoute(destination, options.boundaryRoot, { requireBoundaryRoot: true });
  } catch (error) {
    return { status: 'inspection_failed', existing_kind: 'invalid', error };
  }
  const state = loadBinding();
  if (!state.binding) return { status: 'inspection_failed', existing_kind: 'unavailable', error: state.error };
  const result = state.binding.inspect({
    rootPath: route.root,
    relativeSegments: route.relativeSegments,
    bytes: Buffer.from(String(bytes ?? ''), 'utf8'),
    expectedIdentity: options.expectedIdentity ?? null,
    hook,
  });
  return normalizeResult(result, route.absoluteDestination);
}

export function publishTextFileIfAbsent(destination, bytes, { boundaryRoot = '' } = {}) {
  let route;
  try {
    route = normalizeRoute(destination, boundaryRoot, { requireBoundaryRoot: true });
  } catch (error) {
    return { status: 'write_failed', destination: String(destination ?? ''), published: false, error };
  }
  const state = loadBinding();
  if (!state.binding) {
    return {
      status: 'write_failed',
      destination: route.absoluteDestination,
      temp_file: '',
      temp_file_leftover: false,
      published: false,
      error: state.error,
    };
  }
  const result = state.binding.publish({
    rootPath: route.root,
    relativeSegments: route.relativeSegments,
    bytes: Buffer.from(String(bytes ?? ''), 'utf8'),
    hook,
  });
  if (typeof atomicPublishTestHook === 'function') {
    atomicPublishTestHook(Object.freeze({
      operation: 'publish',
      phase: 'after_native_publish',
      root_path: route.root,
      destination_path: route.absoluteDestination,
      temp_file: result.temp_file || '',
      published: result.published === true,
      status: result.status,
    }));
  }
  return normalizeResult(result, route.absoluteDestination);
}
