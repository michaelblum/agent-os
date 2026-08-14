import crypto from 'node:crypto';
import {
  allowlistedAOSCommandErrorFromText,
  isAOSCommandErrorCode,
  isAOSPrecommitRejectionCode,
} from './exact-focus-channel-proof-contract.mjs';

export const SNAPSHOT_KEY_ENV = 'AOS_EXACT_FOCUS_CHANNEL_SNAPSHOT_KEY';
export const FIXTURE_RESULT_MAX_BYTES = 2_048;
export const FIXTURE_METADATA_SCHEMA = 'aos.exact-focus-channel-native-fixture.v1';
export const MISSING_TARGET_CAPTURE_CHANNEL_TTL_MS = 10_000;
export const MISSING_TARGET_CAPTURE_MAX_PUBLICATION_AGE_MS = 2_000;
export const MISSING_TARGET_CAPTURE_MAX_LAUNCH_DELAY_MS = 4_000;
export const MISSING_TARGET_CAPTURE_COMMAND_TIMEOUT_MS = 3_000;
const FIXTURE_READINESS_FAILURE_CODES = Object.freeze([
  'FIXTURE_WINDOW_LIST_UNAVAILABLE',
  'FIXTURE_WINDOW_OWNERSHIP_MISMATCH',
  'FIXTURE_WINDOW_LAYER_MISMATCH',
  'FIXTURE_TARGET_CONTROL_WINDOW_MISMATCH',
  'FIXTURE_TARGET_CONTROL_IDENTIFIER_MISMATCH',
  'FIXTURE_TARGET_CONTROL_NOT_ACCESSIBILITY_ELEMENT',
  'FIXTURE_TARGET_CONTROL_ROLE_MISMATCH',
  'FIXTURE_TARGET_CONTROL_FRAME_INVALID',
  'FIXTURE_SIBLING_CONTROL_WINDOW_MISMATCH',
  'FIXTURE_SIBLING_CONTROL_IDENTIFIER_MISMATCH',
  'FIXTURE_SIBLING_CONTROL_NOT_ACCESSIBILITY_ELEMENT',
  'FIXTURE_SIBLING_CONTROL_ROLE_MISMATCH',
  'FIXTURE_SIBLING_CONTROL_FRAME_INVALID',
  'FIXTURE_WINDOW_ORDER_MISMATCH',
  'FIXTURE_WINDOW_GEOMETRY_INVALID',
  'FIXTURE_DISPLAY_UNAVAILABLE',
]);
export const FIXTURE_FAILURE_CODE_LIST = Object.freeze([
  'FIXTURE_ARGUMENTS_INVALID',
  'FIXTURE_HELPER_FAILED',
  ...FIXTURE_READINESS_FAILURE_CODES,
]);
const FIXTURE_FAILURE_CODES = new Set(FIXTURE_FAILURE_CODE_LIST);
const FIXTURE_METADATA_KEYS = Object.freeze([
  'display_id',
  'layer_zero_windows',
  'overlap_fraction',
  'ownership_token',
  'pid',
  'same_process_windows',
  'scale_factor',
  'schema',
  'sibling_above_target',
  'sibling_bounds',
  'sibling_identifier',
  'sibling_window_id',
  'target_bounds',
  'target_center_occluded',
  'target_identifier',
  'target_window_id',
]);
export class ProofError extends Error {
  constructor(
    code,
    {
      ambiguous = false,
      commandAdmissionAmbiguous = false,
      commandErrorCode = null,
    } = {},
  ) {
    super(code);
    this.code = code;
    this.ambiguous = ambiguous;
    this.commandAdmissionAmbiguous = commandAdmissionAmbiguous === true;
    this.commandErrorCode = isAOSCommandErrorCode(commandErrorCode)
      ? commandErrorCode
      : null;
  }
}
export function fail(condition, code, options) {
  if (!condition) throw new ProofError(code, options);
}
export function missingTargetCaptureFreshnessIsValid({
  updatedAt,
  observedAtMilliseconds,
  launchAtMilliseconds,
  commandTimeoutMilliseconds = MISSING_TARGET_CAPTURE_COMMAND_TIMEOUT_MS,
}) {
  const updatedAtMilliseconds = Date.parse(updatedAt);
  if (![updatedAtMilliseconds, observedAtMilliseconds, launchAtMilliseconds,
    commandTimeoutMilliseconds].every(Number.isSafeInteger)) return false;
  const publicationAgeMilliseconds = observedAtMilliseconds - updatedAtMilliseconds;
  const launchDelayMilliseconds = launchAtMilliseconds - observedAtMilliseconds;
  return publicationAgeMilliseconds >= 0
    && publicationAgeMilliseconds < MISSING_TARGET_CAPTURE_MAX_PUBLICATION_AGE_MS
    && launchDelayMilliseconds >= 0
    && launchDelayMilliseconds < MISSING_TARGET_CAPTURE_MAX_LAUNCH_DELAY_MS
    && commandTimeoutMilliseconds > 0
    && commandTimeoutMilliseconds <= MISSING_TARGET_CAPTURE_COMMAND_TIMEOUT_MS
    && publicationAgeMilliseconds
      + launchDelayMilliseconds
      + commandTimeoutMilliseconds < MISSING_TARGET_CAPTURE_CHANNEL_TTL_MS;
}
export function parseJSON(text, code = 'INVALID_JSON') {
  try {
    return JSON.parse(String(text).trim());
  } catch {
    throw new ProofError(code);
  }
}
function nestedData(payload) {
  return payload && typeof payload.data === 'object' && payload.data !== null
    ? payload.data
    : payload;
}
export function allowlistedAOSCommandError(result) {
  return allowlistedAOSCommandErrorFromText(result?.stderr)
    ?? allowlistedAOSCommandErrorFromText(result?.stdout);
}
export function aosCommandMayAdmitMutation(args) {
  return (args[0] === 'focus' && ['create', 'remove', 'update'].includes(args[1]))
    || (args[0] === 'see' && args[1] === 'capture');
}
export function aosCommandProofError(
  code,
  args,
  result,
  { executionAmbiguous = false, unexpectedSuccess = false } = {},
) {
  const commandErrorCode = unexpectedSuccess
    ? null
    : allowlistedAOSCommandError(result);
  const commandAdmissionAmbiguous = unexpectedSuccess
    || (aosCommandMayAdmitMutation(args)
      && !isAOSPrecommitRejectionCode(commandErrorCode));
  return new ProofError(code, {
    ambiguous: executionAmbiguous || commandAdmissionAmbiguous,
    commandAdmissionAmbiguous,
    commandErrorCode,
  });
}
export function commandFailureFields(error) {
  return {
    error_code: error instanceof ProofError ? error.code : 'NATIVE_PROOF_FAILED',
    command_error_code: error instanceof ProofError ? error.commandErrorCode : null,
    command_admission_ambiguous: error instanceof ProofError
      ? error.commandAdmissionAmbiguous
      : false,
  };
}
export function focusEntries(payload) {
  const data = nestedData(payload);
  fail(Array.isArray(data?.channels), 'FOCUS_LIST_INVALID');
  return data.channels;
}
export function stableFocusProjection(entry) {
  return {
    app: entry.app,
    elements_count: entry.elements_count,
    id: entry.id,
    kind: entry.kind,
    window_id: entry.window_id,
  };
}
function canonicalJSON(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalJSON(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalJSON(value[key])]),
    );
  }
  return value;
}
function stablePublicChannelEntry(entry) {
  const stable = { ...entry };
  if (stable.kind === 'window') {
    delete stable.elements_count;
    delete stable.updated_at;
  }
  return canonicalJSON(stable);
}
function stablePublicChannelSnapshots(entries, excludedIDs) {
  const snapshots = entries
    .filter((entry) => !excludedIDs.includes(entry?.id))
    .map((entry) => stablePublicChannelEntry(entry));
  return snapshots.sort((left, right) => String(left.id).localeCompare(String(right.id)));
}
export function stablePublicChannelDigests(entries, excludedIDs, key) {
  return stablePublicChannelSnapshots(entries, excludedIDs)
    .map((entry) => crypto.createHmac('sha256', key)
      .update(JSON.stringify(entry))
      .digest('hex'));
}
export function equalJSON(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
export function boundsEqual(actual, expected) {
  return actual
    && Number(actual.x) === expected.x
    && Number(actual.y) === expected.y
    && Number(actual.width) === expected.width
    && Number(actual.height) === expected.height;
}
export function elementCarriesIdentifier(element, identifier) {
  return element?.identifier === identifier
    || element?.handle?.query?.identifier === identifier;
}
export function canonicalAXProjection(elements) {
  return elements
    .map((element) => ({
      app_pid: element.app_pid ?? null,
      window_id: element.window_id ?? null,
      role: element.role ?? null,
      title: element.title ?? null,
      label: element.label ?? null,
      identifier: element.identifier ?? null,
      enabled: element.enabled ?? null,
      bounds: element.bounds ? {
        x: element.bounds.x,
        y: element.bounds.y,
        width: element.bounds.width,
        height: element.bounds.height,
      } : null,
      handle: element.handle ? {
        kind: element.handle.kind ?? null,
        backend: element.handle.backend ?? null,
        query: element.handle.query ? {
          pid: element.handle.query.pid ?? null,
          window_id: element.handle.query.window_id ?? null,
          role: element.handle.query.role ?? null,
          title: element.handle.query.title ?? null,
          label: element.handle.query.label ?? null,
          identifier: element.handle.query.identifier ?? null,
        } : null,
      } : null,
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}
export function assertExactTargetAX(capture, metadata, analysis, scale, codePrefix) {
  const targets = capture.elements.filter(
    (element) => element?.identifier === metadata.target_identifier,
  );
  fail(targets.length === 1, `${codePrefix}_TARGET_AX_CARDINALITY`);
  fail(
    !capture.elements.some((element) => elementCarriesIdentifier(element, metadata.sibling_identifier)),
    `${codePrefix}_SIBLING_AX_PRESENT`,
  );
  const target = targets[0];
  fail(target.app_pid === metadata.pid, `${codePrefix}_TARGET_AX_OWNER`);
  fail(target.window_id === metadata.target_window_id, `${codePrefix}_TARGET_AX_WINDOW`);
  fail(target.role === 'AXButton', `${codePrefix}_TARGET_AX_ROLE`);
  fail(target.title === 'Exact Target', `${codePrefix}_TARGET_AX_TITLE`);
  fail(target.enabled === true, `${codePrefix}_TARGET_AX_DISABLED`);

  const bounds = target.bounds;
  fail(
    bounds
      && Number.isInteger(bounds.x)
      && Number.isInteger(bounds.y)
      && Number.isInteger(bounds.width)
      && Number.isInteger(bounds.height)
      && bounds.x >= 0
      && bounds.y >= 0
      && bounds.width > 0
      && bounds.height > 0
      && bounds.x + bounds.width <= analysis.width + 1
      && bounds.y + bounds.height <= analysis.height + 1,
    `${codePrefix}_TARGET_AX_BOUNDS`,
  );
  fail(Math.abs(bounds.width - 150 * scale) <= 2, `${codePrefix}_TARGET_AX_WIDTH`);
  fail(Math.abs(bounds.height - 42 * scale) <= 2, `${codePrefix}_TARGET_AX_HEIGHT`);

  const handle = target.handle;
  const query = handle?.query;
  fail(handle?.kind === 'locator', `${codePrefix}_TARGET_HANDLE_KIND`);
  fail(handle?.backend === 'native_ax', `${codePrefix}_TARGET_HANDLE_BACKEND`);
  fail(query?.pid === metadata.pid, `${codePrefix}_TARGET_HANDLE_OWNER`);
  fail(query?.window_id === metadata.target_window_id, `${codePrefix}_TARGET_HANDLE_WINDOW`);
  fail(query?.role === 'AXButton', `${codePrefix}_TARGET_HANDLE_ROLE`);
  fail(query?.title === 'Exact Target', `${codePrefix}_TARGET_HANDLE_TITLE`);
  fail(query?.identifier === metadata.target_identifier, `${codePrefix}_TARGET_HANDLE_IDENTIFIER`);
  return canonicalAXProjection([target])[0];
}

function hasExactKeys(value, keys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys);
}

export function fixtureMetadataFromResultBytes(bytes) {
  fail(
    Buffer.isBuffer(bytes)
      && bytes.length >= 1
      && bytes.length <= FIXTURE_RESULT_MAX_BYTES,
    'FIXTURE_METADATA_INVALID',
  );
  const text = bytes.toString('utf8');
  fail(Buffer.from(text, 'utf8').equals(bytes), 'FIXTURE_METADATA_INVALID');
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new ProofError('FIXTURE_METADATA_INVALID');
  }
  if (envelope?.status === 'failed') {
    fail(hasExactKeys(envelope, ['error_code', 'status']), 'FIXTURE_METADATA_INVALID');
    fail(FIXTURE_FAILURE_CODES.has(envelope.error_code), 'FIXTURE_METADATA_INVALID');
    throw new ProofError(envelope.error_code);
  }
  fail(envelope?.status === 'ready', 'FIXTURE_METADATA_INVALID');
  fail(hasExactKeys(envelope, ['metadata', 'status']), 'FIXTURE_METADATA_INVALID');
  const metadata = envelope.metadata;
  fail(hasExactKeys(metadata, FIXTURE_METADATA_KEYS), 'FIXTURE_METADATA_INVALID');
  fail(metadata.schema === FIXTURE_METADATA_SCHEMA, 'FIXTURE_METADATA_INVALID');
  fail(hasExactKeys(metadata.target_bounds, ['height', 'width', 'x', 'y']), 'FIXTURE_METADATA_INVALID');
  fail(hasExactKeys(metadata.sibling_bounds, ['height', 'width', 'x', 'y']), 'FIXTURE_METADATA_INVALID');
  return metadata;
}
