import { isDeepStrictEqual } from 'node:util';
import { SCHEMA_VERSION } from './core.mjs';
import {
  TargetHandleError,
  browserObservationHandle,
  canvasLocatorHandle,
  nativeAXLocatorHandle,
  validateTargetHandle,
} from '../target-handle-runtime.mjs';
import {
  CAPTURE_MODE_VALUES,
  CAPTURE_SOURCE_KIND_VALUES,
  SAVED_HANDLE_V1_ACTIONS_BY_BACKEND,
  SAVED_REF_CONFIDENCE_VALUES,
  SAVED_REF_ANNOTATION_TARGET_KIND_BY_BACKEND,
  savedRefSupportedActionsForBackend,
} from './contracts.mjs';

const LOCAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const REF_SUMMARY_REQUIRED_KEYS = [
  'ref', 'ref_scope', 'workspace_id', 'snapshot_id', 'capture_target',
  'capture_mode', 'copyable_action_target', 'backend', 'handle', 'confidence',
  'supported_actions', 'target_summary', 'hint_facts', 'artifact_refs',
  'warnings', 'known_limits',
];
const REF_SUMMARY_ALLOWED_KEYS = new Set([...REF_SUMMARY_REQUIRED_KEYS, 'capture_source']);

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function stringArray(value) {
  return Array.isArray(value) && value.every(nonEmptyString);
}

function validCaptureSource(value) {
  return value === undefined || (
    plainObject(value)
    && CAPTURE_SOURCE_KIND_VALUES.includes(value.kind)
    && Array.isArray(value.argv)
    && value.argv.length > 0
    && value.argv.every(nonEmptyString)
    && nonEmptyString(value.display)
  );
}

export function isSavedRefSummaryV1(record, workspaceID = null, snapshotID = null) {
  if (
    !plainObject(record)
    || REF_SUMMARY_REQUIRED_KEYS.some((key) => !Object.hasOwn(record, key))
    || Object.keys(record).some((key) => !REF_SUMMARY_ALLOWED_KEYS.has(key))
    || !/^r[1-9][0-9]*$/.test(String(record.ref ?? ''))
    || record.ref_scope !== 'snapshot'
    || !LOCAL_ID_PATTERN.test(String(record.workspace_id ?? ''))
    || !LOCAL_ID_PATTERN.test(String(record.snapshot_id ?? ''))
    || (workspaceID !== null && record.workspace_id !== workspaceID)
    || (snapshotID !== null && record.snapshot_id !== snapshotID)
    || !nonEmptyString(record.capture_target)
    || !validCaptureSource(record.capture_source)
    || !CAPTURE_MODE_VALUES.includes(record.capture_mode)
    || record.copyable_action_target !== `ref:${record.snapshot_id}:${record.ref}`
    || !Object.hasOwn(SAVED_HANDLE_V1_ACTIONS_BY_BACKEND, record.backend)
    || !SAVED_REF_CONFIDENCE_VALUES.includes(record.confidence)
    || !stringArray(record.supported_actions)
    || new Set(record.supported_actions).size !== record.supported_actions.length
    || record.supported_actions.some((action) => !SAVED_HANDLE_V1_ACTIONS_BY_BACKEND[record.backend].includes(action))
    || !nonEmptyString(record.target_summary)
    || !plainObject(record.hint_facts)
    || !Array.isArray(record.artifact_refs)
    || record.artifact_refs.some((artifact) => !plainObject(artifact) || !nonEmptyString(artifact.role) || !nonEmptyString(artifact.path))
    || !stringArray(record.warnings)
    || !stringArray(record.known_limits)
  ) {
    return false;
  }
  try {
    validateTargetHandle(record.handle);
  } catch {
    return false;
  }
  if (record.handle.backend !== record.backend) return false;
  if (record.backend === 'browser') {
    return record.supported_actions.length === 0
      && record.known_limits.includes('browser_observation_identity_unproven');
  }
  return true;
}

function textValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function numberValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function arrayValue(...values) {
  for (const value of values) {
    if (!value) continue;
    if (Array.isArray(value)) return value.filter(Boolean);
    return [value];
  }
  return [];
}

function nativeActions(element) {
  return [...new Set(arrayValue(element.action_names, element.actionNames).flatMap((action) => {
    switch (String(action)) {
      case 'AXPress': return ['press'];
      case 'AXSetValue': return ['set-value'];
      case 'AXFocus': return ['focus'];
      default: return [];
    }
  }))];
}

function browserSessionFromTarget(target) {
  if (!target?.startsWith?.('browser:')) return null;
  const remainder = target.slice('browser:'.length);
  return remainder.split('/')[0] || process.env.PLAYWRIGHT_CLI_SESSION || null;
}

function savedAddress(context, ref) {
  return `ref:${context.snapshot_id}:${ref}`;
}

function emittedHandleOrExpected(emitted, expected) {
  if (emitted === null || emitted === undefined) return expected;
  validateTargetHandle(emitted);
  if (!isDeepStrictEqual(emitted, expected)) {
    throw new TargetHandleError(
      'TARGET_HANDLE_INVALID',
      'capture emitted a target handle that does not match its canonical source facts',
    );
  }
  return emitted;
}

function baseRecord(context, ref, backend, handle, supportedActions, targetSummary, hintFacts, warnings, knownLimits) {
  return {
    schema_version: SCHEMA_VERSION,
    ref,
    ref_scope: 'snapshot',
    workspace_id: context.workspace_id,
    snapshot_id: context.snapshot_id,
    capture_target: context.capture_target ?? context.target,
    capture_source: context.capture_source,
    capture_mode: context.capture_mode,
    query: context.query ?? null,
    copyable_action_target: savedAddress(context, ref),
    backend,
    handle,
    confidence: backend === 'aos_canvas' ? 'high' : 'medium',
    supported_actions: supportedActions,
    target_summary: targetSummary,
    hint_facts: hintFacts,
    artifact_refs: context.artifact_refs ?? [],
    warnings,
    known_limits: knownLimits,
  };
}

export function refSummary(record) {
  return {
    ref: record.ref,
    ref_scope: record.ref_scope,
    workspace_id: record.workspace_id,
    snapshot_id: record.snapshot_id,
    capture_target: record.capture_target,
    capture_source: record.capture_source,
    capture_mode: record.capture_mode,
    copyable_action_target: record.copyable_action_target,
    backend: record.backend,
    handle: record.handle,
    confidence: record.confidence,
    supported_actions: record.supported_actions,
    target_summary: record.target_summary,
    hint_facts: record.hint_facts,
    artifact_refs: record.artifact_refs,
    warnings: record.warnings,
    known_limits: record.known_limits,
  };
}

export function annotationCapabilityFromSavedRef(record = {}) {
  const targetKind = SAVED_REF_ANNOTATION_TARGET_KIND_BY_BACKEND[record.backend] ?? null;
  let validHandle = false;
  try {
    validateTargetHandle(record.handle);
    validHandle = record.handle.backend === record.backend;
  } catch {
    validHandle = false;
  }
  if (!targetKind || !validHandle) {
    return {
      status: 'unsupported',
      target_kind: targetKind,
      reasons: [`unsupported_saved_handle:${record.backend || 'unknown'}`],
      saved_ref_available: false,
    };
  }
  return {
    status: 'saved_ref',
    target_kind: targetKind,
    reasons: [],
    saved_ref_available: true,
  };
}

function searchableValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(searchableValue).join(' ');
  if (typeof value === 'object') return Object.values(value).map(searchableValue).join(' ');
  return String(value);
}

export function queryMatches(record, query) {
  if (!query) return true;
  const haystack = searchableValue(refSummary(record)).toLowerCase();
  return haystack.includes(String(query).toLowerCase());
}

export function generateRefRecords(capture, context) {
  const records = [];
  const nextRef = () => `r${records.length + 1}`;

  for (const target of capture.semantic_targets ?? []) {
    const sourceRef = textValue(target.ref);
    const canvasID = textValue(target.provenance?.canvas_id);
    if (!canvasID || !sourceRef) continue;
    const ref = nextRef();
    const producerActions = Array.isArray(target.actions) ? target.actions.filter(Boolean) : [];
    const supportedActions = savedRefSupportedActionsForBackend('aos_canvas', producerActions);
    records.push(baseRecord(
      context,
      ref,
      'aos_canvas',
      emittedHandleOrExpected(target.handle, canvasLocatorHandle(canvasID, sourceRef)),
      supportedActions,
      [target.role, target.name, sourceRef].filter(Boolean).join(' ') || sourceRef,
      { role: target.role ?? null, name: target.name ?? null, enabled: target.enabled ?? null },
      producerActions.length > 0 && supportedActions.length === 0
        ? ['captured canvas actions do not map to a supported saved Locator action']
        : [],
      ['the canvas Locator is re-resolved at action time and requires exactly one current match'],
    ));
  }

  const browserSession = browserSessionFromTarget(context.target);
  const stateID = textValue(capture.state_id);
  for (const element of capture.elements ?? []) {
    const sourceRef = textValue(element.ref);
    const isBrowser = Boolean(browserSession && sourceRef);
    if (isBrowser) {
      if (!stateID) continue;
      const ref = nextRef();
      records.push(baseRecord(
        context,
        ref,
        'browser',
        emittedHandleOrExpected(element.handle, browserObservationHandle(browserSession, stateID, sourceRef)),
        [],
        [element.role, element.title, element.label, element.value, sourceRef].filter(Boolean).join(' ') || sourceRef,
        {
          role: element.role ?? null,
          title: element.title ?? null,
          label: element.label ?? null,
          value: element.value ?? null,
          enabled: element.enabled ?? null,
        },
        ['browser Observation Ref actions are disabled until backend identity can be proven atomically'],
        [
          'the Observation Ref is valid only for its original browser session and current AOS capture generation',
          'browser_observation_identity_unproven',
        ],
      ));
      continue;
    }

    const pid = numberValue(element.app_pid, element.pid);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const role = textValue(element.role);
    if (!role) continue;
    const ref = nextRef();
    const supportedActions = savedRefSupportedActionsForBackend('native_ax', nativeActions(element));
    const query = {
      pid,
      window_id: numberValue(element.window_id, element.windowID),
      role,
      title: textValue(element.title),
      label: textValue(element.label),
      identifier: textValue(element.ax_identifier, element.identifier),
    };
    records.push(baseRecord(
      context,
      ref,
      'native_ax',
      emittedHandleOrExpected(element.handle, nativeAXLocatorHandle(query)),
      supportedActions,
      [element.role, element.title, element.label, element.value].filter(Boolean).join(' ') || 'native AX element',
      {
        role: element.role ?? null,
        title: element.title ?? null,
        label: element.label ?? null,
        value: element.value ?? null,
        enabled: element.enabled ?? null,
      },
      supportedActions.length === 0 ? ['captured AX actions do not map to a supported saved Locator action'] : [],
      [
        'the native AX Locator is re-resolved at action time and requires exactly one current match',
        'no foreground, focus, cursor, or Space preservation guarantee is claimed',
      ],
    ));
  }

  return records;
}

export function omittedPayloads(capture) {
  const omitted = [];
  if (capture.elements) omitted.push('elements');
  if (capture.semantic_targets) omitted.push('semantic_targets');
  if (capture.annotations) omitted.push('annotations');
  if (capture.perceptions) omitted.push('perceptions');
  if (capture.base64_artifacts) omitted.push('base64');
  return omitted;
}
