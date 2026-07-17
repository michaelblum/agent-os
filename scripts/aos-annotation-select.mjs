#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import {
  followDaemonLease,
} from './lib/aos-voice-follow.mjs';
import {
  createPendingAnnotation,
} from './lib/pending-annotations-lifecycle.mjs';
import {
  normalizeDesktopSelection,
} from './lib/pending-annotations-model.mjs';

const MODES = new Set(['point', 'rectangle', 'freehand', 'text']);
const TERMINAL_EVENTS = new Set(['selection_completed', 'selection_canceled', 'selection_failed']);
const FAILURE_EVENTS = new Set(['selection_failed']);
const SAFE_ERRORS = new Map([
  ['ANNOTATION_SELECTION_BUSY', 'another desktop annotation selection is active'],
  ['ANNOTATION_SELECTION_CANCELED', 'desktop annotation selection was canceled before startup'],
  ['ANNOTATION_SELECTION_NOT_OWNED', 'desktop annotation selection is not owned by this command'],
  ['ANNOTATION_DISPLAY_UNAVAILABLE', 'no desktop display is available for annotation selection'],
  ['ANNOTATION_SELECTION_FAILED', 'desktop annotation selection failed'],
  ['INVALID_ANNOTATION_MODE', 'annotation mode must be point, rectangle, freehand, or text'],
  ['INVALID_ANNOTATION_EVENT', 'daemon returned an invalid annotation event'],
  ['PENDING_ANNOTATION_EXISTS', 'the selected annotation already exists'],
  ['PENDING_ANNOTATION_STATE_CORRUPT', 'pending annotation storage is unavailable'],
  ['INVALID_ARG', 'desktop annotation evidence is invalid'],
]);
const SOURCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

function fail(message, code = 'INVALID_ARG') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function valueAfter(args, token) {
  const index = args.indexOf(token);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) fail(`${token} requires a value`, 'MISSING_ARG');
  return value;
}

function parseArgs(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--follow') {
      values.set(arg, true);
      continue;
    }
    if (arg === '--mode' || arg === '--source') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) fail(`${arg} requires a value`, 'MISSING_ARG');
      values.set(arg, value);
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      values.set('--help', true);
      continue;
    }
    if (arg.startsWith('--')) fail(`Unknown flag: ${arg}`, 'UNKNOWN_FLAG');
    fail(`Unexpected positional argument: ${arg}`, 'UNKNOWN_ARG');
  }
  return values;
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`, 'INVALID_ANNOTATION_EVENT');
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.length !== wanted.length || keys.some((key, index) => key !== wanted[index])) {
    fail(`${label} has an unexpected shape`, 'INVALID_ANNOTATION_EVENT');
  }
}

function normalizedText(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value, 'utf8') > 4 * 1024) {
    fail('annotation text is invalid', 'INVALID_ANNOTATION_EVENT');
  }
  return value;
}

function transformAnnotationEvent(payload, source) {
  const data = payload.data;
  if (payload.event === 'selection_started') {
    assertExactKeys(data, ['mode'], 'selection_started data');
    if (!MODES.has(data.mode)) fail('annotation mode is invalid', 'INVALID_ANNOTATION_EVENT');
    return payload;
  }
  if (payload.event === 'selection_canceled') {
    assertExactKeys(data, ['reason'], 'selection_canceled data');
    if (!['escape', 'canceled', 'owner_disconnect', 'daemon_shutdown', 'invalid_selection'].includes(data.reason)) {
      fail('annotation cancellation reason is invalid', 'INVALID_ANNOTATION_EVENT');
    }
    return payload;
  }
  if (payload.event === 'selection_failed') {
    assertExactKeys(data, ['code'], 'selection_failed data');
    if (typeof data.code !== 'string' || !/^[A-Z][A-Z0-9_]{1,63}$/.test(data.code)) {
      fail('annotation failure code is invalid', 'INVALID_ANNOTATION_EVENT');
    }
    return payload;
  }
  if (payload.event !== 'selection_completed') fail('annotation event is unknown', 'INVALID_ANNOTATION_EVENT');
  assertExactKeys(data, ['application', 'geometry', 'mode', 'selection_id', 'text', 'window'], 'selection_completed data');
  const text = normalizedText(data.text);
  const desktopSelection = normalizeDesktopSelection({
    kind: 'desktop_annotation_selection',
    selection_id: data.selection_id,
    mode: data.mode,
    geometry: data.geometry,
    application: data.application,
    window: data.window,
  });
  if ((desktopSelection.mode === 'text') !== (text !== null)) {
    fail('annotation text does not match selection mode', 'INVALID_ANNOTATION_EVENT');
  }
  const targetSummary = `Desktop ${desktopSelection.mode} annotation`;
  const created = createPendingAnnotation({
    source,
    comment: text,
    target_kind: 'region',
    target_summary: targetSummary,
    capability: {
      status: 'fallback_only',
      reasons: ['native_selection_without_saved_ref'],
    },
    fallback_evidence: [{
      kind: desktopSelection.geometry.kind,
      reason: 'semantic_ref_unavailable',
      summary: targetSummary,
    }],
    desktop_selection: desktopSelection,
  });
  return {
    ...payload,
    data: {
      annotation_id: created.annotation.id,
      selection_id: desktopSelection.selection_id,
      mode: desktopSelection.mode,
      geometry: desktopSelection.geometry,
      application: desktopSelection.application,
      window: desktopSelection.window,
      has_text: text !== null,
    },
  };
}

function usage() {
  process.stdout.write('Usage: aos see annotation select --mode <point|rectangle|freehand|text> [--source <token>] --follow\n');
}

async function main(args) {
  const values = parseArgs(args);
  if (values.has('--help')) {
    usage();
    return;
  }
  if (!values.has('--follow')) fail('annotation selection requires --follow', 'MISSING_ARG');
  const mode = valueAfter(args, '--mode');
  if (!MODES.has(mode)) fail('annotation mode must be point, rectangle, freehand, or text', 'INVALID_ANNOTATION_MODE');
  const source = valueAfter(args, '--source') ?? 'operator_annotation';
  if (!SOURCE.test(source)) fail('annotation source is invalid', 'INVALID_ARG');
  await followDaemonLease({
    service: 'annotation',
    action: 'select',
    data: { mode },
    stopAction: { service: 'annotation', action: 'cancel' },
    cancelAction: { service: 'annotation', action: 'cancel' },
    eventService: 'annotation',
    terminalEvents: TERMINAL_EVENTS,
    failureEvents: FAILURE_EVENTS,
    safeDaemonErrors: SAFE_ERRORS,
    eventTooLargeCode: 'ANNOTATION_EVENT_TOO_LARGE',
    eventTooLargeMessage: 'annotation event exceeded the line limit',
    invalidEventCode: 'INVALID_ANNOTATION_EVENT',
    invalidEventMessage: 'daemon returned malformed annotation JSON',
    fallbackErrorCode: 'ANNOTATION_SELECTION_FAILED',
    fallbackErrorMessage: 'desktop annotation selection failed',
    transformEvent: (payload) => transformAnnotationEvent(payload, source),
  });
}

main(process.argv.slice(2)).catch((error) => {
  const code = error?.code ?? 'ANNOTATION_SELECTION_FAILED';
  process.stderr.write(`${JSON.stringify({ code, error: SAFE_ERRORS.get(code) ?? 'desktop annotation selection failed' })}\n`);
  process.exitCode = 1;
});
