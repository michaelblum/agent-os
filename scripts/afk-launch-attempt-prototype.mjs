#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import http from 'node:http';

const SUPPORTED_PROVIDERS = new Set(['codex', 'claude', 'gemini']);
const PROVIDER_BINARY_PATTERN = /(^|[/\s'"`])(codex|claude|gemini)(\s|$)/i;
const DEFAULT_TIMESTAMP = null;
const NOT_OBSERVED = 'not_observed';
const NOT_ATTEMPTED = 'not_attempted';
const NOT_APPLICABLE_NO_PROVIDER = 'not_applicable: no-provider-launch';
const LIVE_INPUT_TIMING_PROFILE = Object.freeze({
  startupSettleMs: 2000,
  charDelayMs: 10,
  preSubmitDelayMs: 300,
});
const attemptRegistry = new Map();

function usage() {
  return `Experimental AFK launch-attempt prototype.

Usage:
  node scripts/afk-launch-attempt-prototype.mjs --packet <packet.json> --provider <name> --dock <dock> --json [--repo <path>] [--timestamp <iso>] [--out <path>] [--duplicate-in-process] [--catalog-fixture <path>] [--bridge-visibility-fixture <path>] [--provider-session-id <id>] [--launch-observed-at <iso>] [--codex-home-fixture <path>|--codex-home <path>]

This local prototype creates an aos.afk_launch_attempt record, observes terminal substrate through the Sigil codex-terminal bridge, and launches no provider unless an internal supervised provider launch mode is supplied by the guarded session trigger.`;
}

function parseArgs(argv) {
  const options = {
    json: false,
    timestamp: DEFAULT_TIMESTAMP,
    duplicateInProcess: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--duplicate-in-process') {
      options.duplicateInProcess = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }
    index += 1;
    options[key] = value;
  }

  return options;
}

function runGit(repoRoot, args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    command: `git ${args.join(' ')}`,
    exitCode: result.status ?? 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || result.error?.message || '').trim(),
  };
}

function resolveRepoRoot(startPath) {
  const cwd = resolve(startPath ?? process.cwd());
  const result = runGit(cwd, ['rev-parse', '--show-toplevel']);
  if (result.exitCode !== 0 || !result.stdout) {
    throw new Error(`Unable to resolve repo root from ${cwd}: ${result.stderr || 'git rev-parse failed'}`);
  }
  return resolve(result.stdout);
}

function stableHash(value, length = 32) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, length);
}

async function readJsonFile(path, label) {
  const raw = await readFile(path, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${label} ${path}: ${error.message}`);
  }
}

function repoPath(repoRoot, candidate) {
  if (!candidate || typeof candidate !== 'string') return null;
  return isAbsolute(candidate) ? resolve(candidate) : resolve(repoRoot, candidate);
}

function isWithinRepo(repoRoot, candidate) {
  const rel = relative(repoRoot, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function normalizeRef(packet) {
  return packet.required_start_ref ?? packet.requiredStartRef ?? packet.start_ref ?? packet.startRef;
}

function normalizePacketId(packet) {
  return packet.packet_id ?? packet.packetId ?? packet.packet_ref ?? packet.packetRef ?? packet.id ?? packet.ref;
}

function normalizeSourceArtifact(packet) {
  return packet.source_artifact ?? packet.sourceArtifact ?? packet.source_event?.artifact ?? packet.sourceEvent?.artifact;
}

function normalizeRequestedDock(packet) {
  return packet.requested_recipient ?? packet.requestedRecipient ?? packet.dock;
}

function normalizeResultRoutes(packet) {
  const route = packet.result_route ?? packet.resultRoute ?? packet.result_routes ?? packet.resultRoutes;
  if (Array.isArray(route)) return route;
  return route ? [route] : [];
}

function normalizeProviderHint(packet) {
  return packet.provider_hint ?? packet.providerHint ?? packet.provider;
}

function normalizeSessionId(session) {
  return session.session_id ?? session.sessionId ?? session.id;
}

function normalizeSessionUpdatedAt(session) {
  return session.updated_at ?? session.updatedAt ?? session.last_updated_at ?? session.lastUpdatedAt;
}

function normalizeSessionCwd(session) {
  return session.cwd ?? session.worktree ?? session.launch_cwd ?? session.launchCwd;
}

function resolveObservedSessionCwd(session) {
  const sessionCwd = normalizeSessionCwd(session);
  return sessionCwd ? resolve(sessionCwd) : NOT_OBSERVED;
}

function normalizeSessionProvider(session) {
  return session.provider ? String(session.provider).toLowerCase() : null;
}

function normalizeCatalogFixture(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.sessions)) return value.sessions;
  if (Array.isArray(value.catalog_sessions)) return value.catalog_sessions;
  if (Array.isArray(value.requested_cwd_sessions)) return value.requested_cwd_sessions;
  if (Array.isArray(value.requestedCwdSessions)) return value.requestedCwdSessions;
  throw new Error('Catalog fixture must be an array or object with sessions');
}

function normalizeAllCwdCatalogFixture(value) {
  if (!value || Array.isArray(value)) return [];
  if (Array.isArray(value.all_cwd_sessions)) return value.all_cwd_sessions;
  if (Array.isArray(value.allCwdSessions)) return value.allCwdSessions;
  if (Array.isArray(value.all_cwd_catalog_sessions)) return value.all_cwd_catalog_sessions;
  return [];
}

function normalizeCodexHomeOption(repoRoot, options) {
  const codexHome = options.codexHomeFixture ?? options.codexHome;
  return codexHome ? repoPath(repoRoot, codexHome) : null;
}

function bridgeFixtureCatalogInput(value) {
  if (!value || typeof value !== 'object') return value;
  if (value.catalog) return value.catalog;
  return value.bridge ? null : value;
}

function bridgeFixtureBridgeInput(value) {
  return value && typeof value === 'object' && value.bridge ? value.bridge : value;
}

function inferProviderFromCommand(command) {
  const match = String(command || '').match(PROVIDER_BINARY_PATTERN);
  return match ? match[2].toLowerCase() : null;
}

function compactLines(...values) {
  return values
    .flat()
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim())
    .join('\n');
}

function fixtureSnapshotText(bridge) {
  const snapshot = bridge?.snapshot ?? {};
  return compactLines(
    snapshot.text,
    snapshot.title,
    snapshot.status,
    bridge?.title,
    bridge?.status,
    bridge?.status_text,
    bridge?.statusText,
  );
}

function firstTextMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return NOT_OBSERVED;
}

function parseBridgeVisibilityText(text) {
  const providerSessionId = firstTextMatch(text, [
    /\bprovider[_\s-]*session[_\s-]*id\s*[:=]\s*([A-Za-z0-9._:-]+)/i,
    /\bsession[_\s-]*id\s*[:=]\s*([A-Za-z0-9._:-]+)/i,
    /\bsession\s+([0-9a-f]{8}-[0-9a-f-]{18,})\b/i,
  ]);
  return {
    provider_session_id: providerSessionId,
    provider_reported_cwd: firstTextMatch(text, [
      /\bcwd\s*[:=]\s*([^\n]+)/i,
      /\bcwd\s+([^\n]+)/i,
    ]),
    provider_reported_branch: firstTextMatch(text, [
      /\bbranch\s*[:=]\s*([^\n]+)/i,
      /\bbranch\s+([^\n]+)/i,
    ]),
    provider_reported_head: firstTextMatch(text, [
      /\bhead\s*[:=]\s*([0-9a-f]{7,40})\b/i,
      /\bhead\s+([0-9a-f]{7,40})\b/i,
      /\brepo\s+head\s*[:=]?\s*([0-9a-f]{7,40})\b/i,
    ]),
    provider_version: firstTextMatch(text, [
      /\bCodex CLI\s+([0-9][^\s\n]*)/i,
      /\bversion\s*[:=]\s*([^\s\n]+)/i,
    ]),
    model: firstTextMatch(text, [
      /\bmodel\s*[:=]\s*([^\s\n]+)/i,
      /\bmodel\s+([^\s\n]+)/i,
    ]),
  };
}

function mergeProviderAcceptance(current, next) {
  const merged = { ...current };
  for (const [key, value] of Object.entries(next)) {
    if (key === 'status' || key === 'provider_session_id') {
      merged[key] = value;
      continue;
    }
    if (
      merged[key] === undefined
      || merged[key] === NOT_OBSERVED
      || merged[key] === NOT_APPLICABLE_NO_PROVIDER
    ) {
      merged[key] = value;
    }
  }
  return merged;
}

function boundedSnapshotExcerpt(text, lineLimit = 6) {
  return String(text || '').split('\n').slice(0, lineLimit).join('\n') || NOT_OBSERVED;
}

function boundedInlineText(value, limit = 240) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return NOT_OBSERVED;
  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text;
}

function buildLiveProviderPrompt(context) {
  const sourceArtifact = context.sourceArtifact ?? normalizeSourceArtifact(context.packet) ?? NOT_OBSERVED;
  return `Your work card is at ${sourceArtifact}. Read it first, then begin.`;
}

function inputSubmissionRecord({
  prompt,
  inputResult = null,
  keyResult = null,
  promptSource = {},
  timing = LIVE_INPUT_TIMING_PROFILE,
  typedCharacterCount = Buffer.byteLength(prompt),
}) {
  const inputOk = inputResult?.ok === true || inputResult?.text_accepted === true || inputResult?.textAccepted === true;
  const keyOk = keyResult?.ok === true;
  return {
    status: inputOk && keyOk ? 'submitted' : 'prompt_submission_unobserved',
    prompt_transport: 'file_pointer',
    prompt_ref: promptSource.sourceArtifact ?? NOT_OBSERVED,
    pointer_prompt_bytes: Buffer.byteLength(prompt),
    startup_settle_ms: timing.startupSettleMs,
    char_delay_ms: timing.charDelayMs,
    typed_character_count: typedCharacterCount,
    pre_submit_delay_ms: timing.preSubmitDelayMs,
    submit_key_separate_write: true,
    prompt_summary: {
      packet_id_or_ref: promptSource.packetId ?? NOT_OBSERVED,
      source_artifact: promptSource.sourceArtifact ?? NOT_OBSERVED,
      goal_excerpt: boundedInlineText(promptSource.goal, 160),
      prompt_sha256: createHash('sha256').update(prompt).digest('hex'),
      prompt_bytes: Buffer.byteLength(prompt),
    },
    text_accepted: inputResult?.text_accepted ?? inputResult?.textAccepted ?? inputOk,
    enter_sent: false,
    enter_accepted: false,
    extra_enter_needed: true,
    key_accepted: keyResult
      ? (keyResult.key_accepted ?? keyResult.keyAccepted ?? keyOk)
      : NOT_OBSERVED,
    typed_observed: NOT_OBSERVED,
    submitted_observed: inputOk && keyOk,
    provider_execution_observed: false,
    response_marker: NOT_OBSERVED,
    response_marker_observed: false,
  };
}

function providerObservationFromBridgeSnapshot(snapshot, fallback = {}) {
  const text = compactLines(snapshot?.text, snapshot?.title, snapshot?.status);
  const parsed = parseBridgeVisibilityText(text);
  const snapshotRef = text ? 'inline:terminal_substrate.snapshot_summary' : NOT_OBSERVED;
  const observed = parsed.provider_session_id !== NOT_OBSERVED;
  return {
    provider_acceptance: {
      status: observed ? 'provider_session_observed' : 'provider_acceptance_unobserved',
      provider_session_id: parsed.provider_session_id,
      provider_reported_cwd: parsed.provider_reported_cwd,
      provider_reported_branch: parsed.provider_reported_branch,
      provider_reported_head: parsed.provider_reported_head,
      provider_version: parsed.provider_version,
      model: parsed.model,
    },
    snapshot_ref: snapshotRef,
    snapshot_summary: {
      session: snapshot?.session ?? fallback.session ?? NOT_OBSERVED,
      driver: snapshot?.driver ?? fallback.driver ?? NOT_OBSERVED,
      command: snapshot?.command ?? fallback.command ?? NOT_OBSERVED,
      includes_marker: fallback.responseMarker ? text.includes(fallback.responseMarker) : false,
      text_excerpt: boundedSnapshotExcerpt(text),
    },
    mismatch: observed
      ? null
      : {
        code: 'provider_session_id_not_observed',
        severity: 'info',
        source: 'provider_acceptance',
        expected: { provider_session_id: 'parseable from bridge snapshot/title' },
        observed: { terminal_substrate: fallback.observedTerminalSubstrate ?? 'observed' },
        effect: 'not_observed',
        evidence_ref: snapshotRef,
      },
  };
}

function normalizeBridgeVisibilityFixture(fixture, fallbackCwd) {
  if (!fixture) return null;
  const bridge = bridgeFixtureBridgeInput(fixture);
  const health = bridge.health ?? {};
  const ensure = bridge.ensure ?? {};
  const resize = bridge.resize ?? bridge.resize_result ?? bridge.resizeResult ?? null;
  const input = bridge.input ?? bridge.input_result ?? bridge.inputResult ?? null;
  const key = bridge.key ?? bridge.key_result ?? bridge.keyResult ?? null;
  const snapshot = bridge.snapshot ?? {};
  const command = bridge.command ?? snapshot.command ?? health.defaultCommand ?? health.command ?? NOT_OBSERVED;
  const cwd = ensure.cwd ?? health.defaultCwd ?? snapshot.cwd ?? fallbackCwd;
  const session = ensure.session ?? snapshot.session ?? health.defaultSession ?? NOT_OBSERVED;
  const driver = ensure.driver ?? snapshot.driver ?? health.driver ?? NOT_OBSERVED;
  const terminal = snapshot.terminal ?? resize?.terminal ?? health.terminal ?? {};
  const text = fixtureSnapshotText(bridge);
  const responseMarker = bridge.response_marker
    ?? bridge.responseMarker
    ?? fixture.response_marker
    ?? fixture.responseMarker
    ?? NOT_OBSERVED;
  const providerObservation = providerObservationFromBridgeSnapshot(
    { ...snapshot, text },
    {
      session,
      driver,
      command,
      responseMarker,
      observedTerminalSubstrate: 'observed',
    },
  );
  const markerObserved = responseMarker !== NOT_OBSERVED && text.includes(responseMarker);
  const cleanup = normalizeCleanupProofFixture(
    fixture.cleanup ?? fixture.cleanup_proof ?? fixture.cleanupProof ?? bridge.cleanup ?? bridge.cleanup_proof ?? bridge.cleanupProof,
    { session, command },
  );
  return {
    bridge_session_started: true,
    command,
    provider_launch_performed: Boolean(
      bridge.provider_launch_performed
        ?? bridge.providerLaunchPerformed
        ?? bridge.supervised_live
        ?? bridge.supervisedLive,
    ),
    providerSessionId: providerObservation.provider_acceptance.provider_session_id,
    terminal_substrate: {
      status: 'observed',
      driver,
      session_handle: session,
      cwd,
      command,
      snapshot_ref: text ? 'inline:terminal_substrate.synthetic_snapshot' : NOT_OBSERVED,
      geometry: {
        cols: terminal.cols ?? terminal.columns ?? health.terminal?.cols ?? NOT_OBSERVED,
        rows: terminal.rows ?? health.terminal?.rows ?? NOT_OBSERVED,
      },
      resize: resize ? {
        status: resize.resize_accepted ?? resize.resizeAccepted ? 'accepted' : 'not_accepted',
        cols: resize.cols ?? resize.columns ?? resize.requested?.cols ?? NOT_OBSERVED,
        rows: resize.rows ?? resize.requested?.rows ?? NOT_OBSERVED,
        resize_accepted: resize.resize_accepted ?? resize.resizeAccepted ?? false,
      } : NOT_OBSERVED,
      input_submission: input || key || markerObserved ? {
        status: (input?.text_accepted ?? input?.textAccepted) && (key?.key_accepted ?? key?.keyAccepted)
          ? 'submitted'
          : 'prompt_submission_unobserved',
        prompt_transport: input?.prompt_transport ?? input?.promptTransport ?? 'file_pointer',
        prompt_ref: input?.prompt_ref ?? input?.promptRef ?? NOT_OBSERVED,
        pointer_prompt_bytes: input?.pointer_prompt_bytes ?? input?.pointerPromptBytes ?? NOT_OBSERVED,
        startup_settle_ms: input?.startup_settle_ms ?? input?.startupSettleMs ?? LIVE_INPUT_TIMING_PROFILE.startupSettleMs,
        char_delay_ms: input?.char_delay_ms ?? input?.charDelayMs ?? LIVE_INPUT_TIMING_PROFILE.charDelayMs,
        typed_character_count: input?.typed_character_count ?? input?.typedCharacterCount ?? NOT_OBSERVED,
        pre_submit_delay_ms: input?.pre_submit_delay_ms ?? input?.preSubmitDelayMs ?? LIVE_INPUT_TIMING_PROFILE.preSubmitDelayMs,
        submit_key_separate_write: input?.submit_key_separate_write ?? input?.submitKeySeparateWrite ?? Boolean(key),
        text_accepted: input?.text_accepted ?? input?.textAccepted ?? NOT_OBSERVED,
        enter_sent: false,
        enter_accepted: false,
        extra_enter_needed: true,
        key_accepted: key?.key_accepted ?? key?.keyAccepted ?? NOT_OBSERVED,
        typed_observed: bridge.typed_observed ?? bridge.typedObserved ?? NOT_OBSERVED,
        submitted_observed: bridge.submitted_observed ?? bridge.submittedObserved ?? NOT_OBSERVED,
        provider_execution_observed: providerObservation.provider_acceptance.status === 'provider_session_observed',
        response_marker: responseMarker,
        response_marker_observed: markerObserved,
      } : NOT_OBSERVED,
      snapshot_summary: {
        session,
        driver,
        command: snapshot.command ?? command,
        includes_marker: markerObserved,
        text_excerpt: boundedSnapshotExcerpt(text),
      },
      bridge_health: {
        ok: health.ok ?? NOT_OBSERVED,
        default_session: health.defaultSession ?? NOT_OBSERVED,
        default_cwd: health.defaultCwd ?? NOT_OBSERVED,
        driver: health.driver ?? driver,
        terminal: health.terminal ?? NOT_OBSERVED,
      },
    },
    provider_acceptance: providerObservation.provider_acceptance,
    catalog_status: NOT_OBSERVED,
    telemetry_status: NOT_OBSERVED,
    cleanup,
    mismatch: providerObservation.mismatch
      ? {
        ...providerObservation.mismatch,
        evidence_ref: text ? 'inline:terminal_substrate.synthetic_snapshot' : NOT_OBSERVED,
      }
      : null,
  };
}

function deriveLifecycleState(record) {
  if (record.lifecycle_state === 'rejected') return 'rejected';
  if (record.mismatches.some((mismatch) => mismatch.effect === 'failed')) return 'failed';
  if (record.result_route.status === 'delivered' || record.result_route.status === 'completed') return 'completed';
  if (record.catalog.status === 'catalog_matched') return 'catalog_matched';
  if (
    record.provider_acceptance.status === 'provider_session_observed'
    || record.codex_adapter.correlation_status === 'matched_by_provider_session_id'
  ) {
    return 'provider_session_observed';
  }
  return 'provider_acceptance_unobserved';
}

function timestampMs(value) {
  if (!value || value === NOT_OBSERVED) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function deriveAdapterTimeWindow(context) {
  const after = context.launchObservedAtForCorrelation;
  const afterMs = timestampMs(after);
  if (afterMs == null) return undefined;
  const beforeMs = timestampMs(context.timestamp);
  return {
    after,
  ...(beforeMs != null && beforeMs > afterMs ? { before: context.timestamp } : {}),
  };
}

function bridgeVisibilityForAdapter(context) {
  const commandArgv = context.terminal_substrate?.command
    ? String(context.terminal_substrate.command).split(/\s+/).filter(Boolean)
    : context.launch_intent?.command_argv;
  return {
    selected_provider: context.selection.selected_provider,
    command_argv: commandArgv,
    terminal_substrate: {
      driver: context.terminal_substrate.driver,
      session_handle: context.terminal_substrate.session_handle,
    },
    provider_acceptance: {
      provider_session_id: context.provider_acceptance.provider_session_id === NOT_APPLICABLE_NO_PROVIDER
        ? NOT_OBSERVED
        : context.provider_acceptance.provider_session_id,
      provider_reported_cwd: context.provider_acceptance.provider_reported_cwd,
      provider_reported_branch: context.provider_acceptance.provider_reported_branch,
      provider_reported_head: context.provider_acceptance.provider_reported_head,
      provider_version: context.provider_acceptance.provider_version,
      model: context.provider_acceptance.model,
    },
  };
}

function runCodexAdapterCommand(repoRoot, payload) {
  const adapterUrl = pathToFileURL(join(repoRoot, 'packages/host/src/codex-thread-adapter.ts')).href;
  const runner = `
const payload = JSON.parse(await new Promise((resolve) => {
  let data = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { data += chunk; });
  process.stdin.on('end', () => resolve(data));
}));
const adapter = await import(${JSON.stringify(adapterUrl)});
let result;
if (payload.command === 'correlateLaunch') {
  result = adapter.correlateLaunch(payload.input);
} else if (payload.command === 'emitThreadReference') {
  result = adapter.emitThreadReference(payload.input);
} else {
  throw new Error('Unsupported Codex adapter command: ' + payload.command);
}
process.stdout.write(JSON.stringify(result));
`;
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', runner], {
    cwd: repoRoot,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`Codex adapter bridge failed: ${String(result.stderr || result.stdout || result.error?.message || '').trim()}`);
  }
  return JSON.parse(result.stdout);
}

function adapterEvidenceRefStrings(correlation, reference) {
  const refs = [];
  if (reference?.status === 'ok') {
    refs.push(reference.deeplink, reference.local_ref);
  }
  return refs.filter(Boolean);
}

function adapterMismatchObjects(correlation, timestamp) {
  return correlation.mismatches.map((mismatch) => ({
    observed_at: timestamp,
    code: mismatch.code,
    severity: mismatch.code === 'wrong_cwd' ? 'error' : 'info',
    source: 'codex_adapter',
    expected: mismatch.expected ? { value: mismatch.expected } : {},
    observed: mismatch.observed ? { value: mismatch.observed } : {},
    effect: correlation.status === 'wrong_cwd' ? 'failed' : 'not_observed',
    evidence_ref: mismatch.evidence_refs?.[0]?.ref ?? 'inline:codex_adapter.evidence_refs',
  }));
}

function buildCodexAdapterRecord({ status, correlation = null, reference = null, codexHome = null, timeWindow = null }) {
  const matched = correlation?.status === 'matched_by_provider_session_id'
    || correlation?.status === 'matched_by_cwd_time_window';
  const codexHomeRef = codexHome
    ? (resolve(codexHome).startsWith(resolve(homedir()))
        ? `codex-home:${codexHome}`
        : `fixture:${codexHome}`)
    : NOT_OBSERVED;
  return {
    status,
    codex_home_ref: codexHomeRef,
    correlation_status: correlation?.status ?? NOT_OBSERVED,
    confidence: correlation?.confidence ?? 'none',
    matched_thread_id: matched ? correlation.thread.thread_id : NOT_OBSERVED,
    matched_thread_ref: matched ? (reference?.local_ref ?? NOT_OBSERVED) : NOT_OBSERVED,
    matched_deeplink: matched ? (reference?.deeplink ?? NOT_OBSERVED) : NOT_OBSERVED,
    matched_cwd_basis: matched ? (correlation.cwd_match_basis ?? NOT_OBSERVED) : NOT_OBSERVED,
    candidate_thread_ids: correlation?.candidate_threads?.map((thread) => thread.thread_id) ?? [],
    time_window: timeWindow ?? NOT_OBSERVED,
    evidence_refs: correlation?.evidence_refs ?? [],
    diagnostics: correlation?.diagnostics ?? [],
    mismatches: correlation?.mismatches ?? [],
  };
}

function promptSubmissionSucceeded(record) {
  const inputSubmission = record.terminal_substrate?.input_submission;
  if (!inputSubmission || inputSubmission === NOT_OBSERVED) return false;
  return inputSubmission.status === 'submitted'
    || inputSubmission.submitted_observed === true
    || (
      inputSubmission.text_accepted === true
      && inputSubmission.submit_key_separate_write === true
      && inputSubmission.key_accepted === true
    );
}

function providerExecutionUnobservedMismatch(record, timestamp) {
  if (
    !promptSubmissionSucceeded(record)
    || record.provider_acceptance.status === 'provider_session_observed'
  ) {
    return null;
  }
  return {
    observed_at: timestamp,
    code: 'provider_execution_unobserved',
    severity: 'info',
    source: 'provider_acceptance',
    expected: { provider_execution: 'snapshot provider session id or metadata-backed Codex thread identity' },
    observed: {
      bridge_byte_delivery: 'accepted',
      key_accepted: record.terminal_substrate.input_submission.key_accepted,
      provider_acceptance: record.provider_acceptance.status,
    },
    effect: 'not_observed',
    evidence_ref: 'inline:terminal_substrate.input_submission',
  };
}

function shouldPromoteCodexMetadataProviderAcceptance(record, correlation) {
  return record.selection.selected_provider === 'codex'
    && record.launch_intent.launch_mode === 'supervised-provider'
    && record.launch_intent.provider_launch_performed === true
    && promptSubmissionSucceeded(record)
    && record.provider_acceptance.status === 'provider_acceptance_unobserved'
    && correlation?.status === 'matched_by_cwd_time_window'
    && correlation.confidence === 'strong'
    && correlation.thread?.thread_id;
}

function promoteCodexMetadataProviderAcceptance(record, correlation, reference, timestamp) {
  const thread = correlation.thread;
  const evidenceRefs = [
    reference?.local_ref,
    reference?.deeplink,
    thread.source_ref,
    ...correlation.evidence_refs.map((ref) => ref.ref),
  ].filter(Boolean).slice(0, 8);
  record.provider_acceptance = {
    ...record.provider_acceptance,
    status: 'provider_session_observed',
    provider_session_id: thread.thread_id,
    provider_reported_cwd: thread.cwd ?? record.provider_acceptance.provider_reported_cwd,
    evidence_refs: evidenceRefs,
    evidence_ref: evidenceRefs[0] ?? 'inline:codex_adapter',
    observed_at: timestamp,
    observation_source: 'codex_adapter_metadata',
  };
  record.mismatches = record.mismatches.filter((mismatch) => !(
    (
      mismatch.code === 'provider_session_id_not_observed'
      && (mismatch.source === 'provider_acceptance' || mismatch.source === 'codex_adapter')
    )
    || mismatch.code === 'provider_execution_unobserved'
  ));
  if (record.terminal_substrate?.input_submission && record.terminal_substrate.input_submission !== NOT_OBSERVED) {
    record.terminal_substrate.input_submission.provider_execution_observed = true;
  }
}

function sessionRef(session) {
  const provider = normalizeSessionProvider(session) ?? NOT_OBSERVED;
  const id = normalizeSessionId(session) ?? NOT_OBSERVED;
  return `${provider}:${id}`;
}

function sessionTelemetryObserved(session) {
  return Boolean(
    session.telemetry_observed
      ?? session.telemetryObserved
      ?? session.telemetry?.observed
      ?? (Array.isArray(session.telemetry_event_refs) && session.telemetry_event_refs.length > 0),
  );
}

function classifyCatalogAndTelemetry({
  sessions,
  allCwdSessions = [],
  provider,
  cwd,
  launchObservedAt,
  providerSessionId,
}) {
  if (!sessions) {
    return {
      catalog: {
        status: NOT_OBSERVED,
        catalog_record_refs: NOT_OBSERVED,
        match_count: NOT_OBSERVED,
        matched_session_id: NOT_OBSERVED,
        source_file: NOT_OBSERVED,
        resume_command: NOT_OBSERVED,
      },
      telemetry: {
        status: NOT_OBSERVED,
        telemetry_event_refs: NOT_OBSERVED,
        lifecycle_event_refs: NOT_OBSERVED,
        capability_event_refs: NOT_OBSERVED,
        mismatch_refs: [],
      },
      mismatches: [],
    };
  }

  const normalizedProvider = String(provider).toLowerCase();
  const matchingProviderSessionId = providerSessionId && providerSessionId !== NOT_OBSERVED
    ? sessions.filter((session) => (
      normalizeSessionProvider(session) === normalizedProvider
        && normalizeSessionId(session) === providerSessionId
    ))
    : [];
  const observedProviderSession = matchingProviderSessionId.length === 1
    ? matchingProviderSessionId[0]
    : null;
  const observedProviderSessionCwd = observedProviderSession
    ? resolveObservedSessionCwd(observedProviderSession)
    : NOT_OBSERVED;
  const observedProviderSessionWrongCwd = Boolean(
    observedProviderSession
      && observedProviderSessionCwd !== NOT_OBSERVED
      && observedProviderSessionCwd !== cwd,
  );
  const providerAcceptance = providerSessionId && providerSessionId !== NOT_OBSERVED
    ? {
      status: observedProviderSessionWrongCwd
        ? 'provider_session_wrong_cwd'
        : 'provider_session_observed',
      provider_session_id: providerSessionId,
      provider_reported_cwd: observedProviderSessionCwd,
    }
    : null;
  const matchingProviderCwd = sessions.filter((session) => (
    normalizeSessionProvider(session) === normalizedProvider
      && resolveObservedSessionCwd(session) === cwd
  ));
  const currentThreshold = timestampMs(launchObservedAt);
  const allCwdCurrentCandidates = currentThreshold == null
    ? []
    : allCwdSessions.filter((session) => {
      const updatedAt = timestampMs(normalizeSessionUpdatedAt(session));
      return normalizeSessionProvider(session) === normalizedProvider
        && updatedAt != null
        && updatedAt >= currentThreshold;
    });
  const unrelatedCurrentSessions = allCwdCurrentCandidates.filter((session) => (
    resolveObservedSessionCwd(session) !== cwd
  ));
  const unrelatedCurrentSessionEvidence = unrelatedCurrentSessions.map((session) => ({
    provider_session_id: normalizeSessionId(session) ?? NOT_OBSERVED,
    catalog_record_ref: sessionRef(session),
    cwd: resolveObservedSessionCwd(session),
    updated_at: normalizeSessionUpdatedAt(session) ?? NOT_OBSERVED,
  }));
  const currentCandidates = currentThreshold == null
    ? matchingProviderCwd
    : matchingProviderCwd.filter((session) => {
      const updatedAt = timestampMs(normalizeSessionUpdatedAt(session));
      return updatedAt != null && updatedAt >= currentThreshold;
    });
  const catalogRecordRefs = matchingProviderCwd.map(sessionRef);
  const reviewableCatalogRecordRefs = observedProviderSessionWrongCwd
    ? [sessionRef(observedProviderSession)]
    : catalogRecordRefs;

  let status;
  let matched = null;
  let mismatch = null;

  if (observedProviderSessionWrongCwd) {
    status = 'catalog_provider_session_wrong_cwd';
    mismatch = {
      code: 'provider_session_wrong_cwd',
      severity: 'error',
      source: 'catalog',
      expected: {
        provider_session_id: providerSessionId,
        cwd,
      },
      observed: {
        provider_session_id: providerSessionId,
        cwd: observedProviderSessionCwd,
        catalog_record_ref: sessionRef(observedProviderSession),
      },
      effect: 'failed',
      evidence_ref: 'inline:catalog.provider_session_mismatch',
    };
  } else if (matchingProviderCwd.length === 0 && unrelatedCurrentSessionEvidence.length > 0) {
    status = 'catalog_current_launch_not_observed';
    mismatch = {
      code: 'catalog_current_launch_not_observed',
      severity: 'info',
      source: 'catalog',
      expected: { cwd, updated_at_or_after: launchObservedAt },
      observed: { unrelated_current_session_refs: unrelatedCurrentSessionEvidence },
      effect: 'not_observed',
      evidence_ref: 'inline:catalog.unrelated_current_session_refs',
    };
  } else if (matchingProviderCwd.length === 0) {
    status = 'catalog_not_observed';
  } else if (providerSessionId && providerSessionId !== NOT_OBSERVED) {
    const exactMatches = matchingProviderCwd.filter((session) => normalizeSessionId(session) === providerSessionId);
    if (exactMatches.length === 1) {
      status = 'catalog_matched';
      [matched] = exactMatches;
    } else if (exactMatches.length > 1) {
      status = 'multiple_catalog_candidates';
      mismatch = {
        code: 'multiple_catalog_matches',
        severity: 'warn',
        source: 'catalog',
        expected: { provider_session_id: providerSessionId },
        observed: { match_count: exactMatches.length },
        effect: 'ambiguous',
        evidence_ref: 'inline:catalog.catalog_record_refs',
      };
    } else {
      status = 'catalog_current_launch_not_observed';
      mismatch = {
        code: 'catalog_match_not_observed',
        severity: 'info',
        source: 'catalog',
        expected: { provider_session_id: providerSessionId },
        observed: { catalog_record_refs: catalogRecordRefs },
        effect: 'not_observed',
        evidence_ref: 'inline:catalog.catalog_record_refs',
      };
    }
  } else if (currentCandidates.length === 0) {
    status = 'catalog_current_launch_not_observed';
    mismatch = {
      code: 'catalog_current_launch_not_observed',
      severity: 'info',
      source: 'catalog',
      expected: { updated_at_or_after: launchObservedAt },
      observed: { catalog_record_refs: catalogRecordRefs },
      effect: 'not_observed',
      evidence_ref: 'inline:catalog.catalog_record_refs',
    };
  } else if (currentCandidates.length === 1) {
    status = 'catalog_candidate_current_launch_observed';
    [matched] = currentCandidates;
  } else {
    status = 'multiple_catalog_candidates';
    mismatch = {
      code: 'multiple_catalog_candidates',
      severity: 'warn',
      source: 'catalog',
      expected: { current_candidate_count: 1 },
      observed: { current_candidate_count: currentCandidates.length },
      effect: 'ambiguous',
      evidence_ref: 'inline:catalog.catalog_record_refs',
    };
  }

  const telemetryStatus = matched
    ? (sessionTelemetryObserved(matched) ? 'telemetry_observed' : 'telemetry_not_observed')
    : (
      status === 'catalog_provider_session_wrong_cwd'
        ? 'telemetry_not_attempted_wrong_cwd'
        : (status === 'catalog_not_observed' ? 'telemetry_not_attempted_no_catalog_match' : 'telemetry_current_launch_not_observed')
    );
  const telemetryEventRefs = matched && sessionTelemetryObserved(matched)
    ? (matched.telemetry_event_refs ?? matched.telemetryEventRefs ?? [`inline:catalog:${sessionRef(matched)}:telemetry`])
    : NOT_OBSERVED;

  return {
    provider_acceptance: providerAcceptance,
    catalog: {
      status,
      catalog_record_refs: reviewableCatalogRecordRefs.length > 0 ? reviewableCatalogRecordRefs : NOT_OBSERVED,
      match_count: matched ? 1 : currentCandidates.length,
      matched_session_id: matched ? normalizeSessionId(matched) : NOT_OBSERVED,
      source_file: matched?.source_file ?? matched?.sourceFile ?? NOT_OBSERVED,
      resume_command: matched?.resume_command ?? matched?.resumeCommand ?? NOT_OBSERVED,
      launch_observed_at: launchObservedAt ?? NOT_OBSERVED,
      unrelated_current_session_refs: unrelatedCurrentSessionEvidence.length > 0
        ? unrelatedCurrentSessionEvidence
        : NOT_OBSERVED,
      provider_session_mismatch: observedProviderSessionWrongCwd
        ? {
          code: 'provider_session_wrong_cwd',
          expected_cwd: cwd,
          observed_cwd: observedProviderSessionCwd,
          provider_session_id: providerSessionId,
          catalog_record_ref: sessionRef(observedProviderSession),
          lifecycle_state: 'failed',
        }
        : NOT_OBSERVED,
    },
    telemetry: {
      status: telemetryStatus,
      telemetry_event_refs: telemetryEventRefs,
      lifecycle_event_refs: matched?.lifecycle_event_refs ?? matched?.lifecycleEventRefs ?? NOT_OBSERVED,
      capability_event_refs: matched?.capability_event_refs ?? matched?.capabilityEventRefs ?? NOT_OBSERVED,
      mismatch_refs: [],
    },
    mismatches: mismatch ? [mismatch] : [],
  };
}

function normalizeWorktree(packet, repoRoot) {
  return repoPath(repoRoot, packet.worktree ?? packet.cwd ?? repoRoot);
}

function resolveRef(repoRoot, ref) {
  if (!ref) {
    return {
      status: 'missing_with_reason',
      reason: 'packet did not include required_start_ref',
      ref: null,
      sha: null,
    };
  }
  const result = runGit(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`]);
  return {
    status: result.exitCode === 0 ? 'resolved' : 'missing_with_reason',
    reason: result.exitCode === 0 ? null : result.stderr || 'git rev-parse failed',
    ref,
    sha: result.exitCode === 0 ? result.stdout : null,
    command: result.command,
  };
}

function resolveGitFacts(repoRoot) {
  const branch = runGit(repoRoot, ['branch', '--show-current']);
  const head = runGit(repoRoot, ['rev-parse', 'HEAD']);
  return {
    branch: branch.exitCode === 0 && branch.stdout ? branch.stdout : NOT_OBSERVED,
    head: head.exitCode === 0 && head.stdout ? head.stdout : NOT_OBSERVED,
  };
}

async function resolveDockProfile(repoRoot, dockName) {
  const dockJson = resolve(repoRoot, '.docks', dockName, 'dock.json');
  if (!existsSync(dockJson)) {
    return {
      status: 'missing_with_reason',
      reason: `dock profile not found at .docks/${dockName}/dock.json`,
      dock: dockName,
      role: NOT_OBSERVED,
      launch_root: relative(repoRoot, resolve(repoRoot, '.docks', dockName)),
      profile_path: relative(repoRoot, dockJson),
    };
  }
  const profile = await readJsonFile(dockJson, 'dock profile');
  return {
    status: 'resolved',
    dock: profile.name ?? dockName,
    role: profile.role ?? dockName,
    launch_root: relative(repoRoot, resolve(repoRoot, '.docks', dockName)),
    profile_path: relative(repoRoot, dockJson),
  };
}

function checkSourceArtifact(repoRoot, sourceArtifact) {
  if (!sourceArtifact) {
    return {
      status: 'missing_with_reason',
      reason: 'packet did not include source_artifact',
      path: null,
    };
  }
  const sourcePath = repoPath(repoRoot, sourceArtifact);
  return {
    status: existsSync(sourcePath) ? 'present' : 'missing_with_reason',
    reason: existsSync(sourcePath) ? null : 'source artifact path does not exist in current worktree',
    path: isWithinRepo(repoRoot, sourcePath) ? relative(repoRoot, sourcePath) : sourcePath,
  };
}

function validationRecord(name, ok, details = {}) {
  return { name, ...details, status: ok ? 'passed' : 'failed' };
}

function validatePathExists(name, path) {
  return validationRecord(name, Boolean(path && existsSync(path)), {
    path,
    reason: path && existsSync(path) ? null : `${name} path does not exist: ${path}`,
  });
}

function selectedProvider({ explicitProvider, packetProviderHint, commandProvider }) {
  const selected = explicitProvider ?? packetProviderHint ?? commandProvider ?? null;
  if (!selected) {
    return {
      selected_provider: 'missing_with_reason',
      provider_selection_source: 'missing_with_reason',
      status: 'missing_with_reason',
      mismatch_facts: ['missing_provider_selection'],
    };
  }
  const normalized = String(selected).toLowerCase();
  return {
    selected_provider: normalized,
    provider_selection_source: explicitProvider
      ? 'explicit_option'
      : (packetProviderHint ? 'packet_provider_hint' : 'bridge_command'),
    status: SUPPORTED_PROVIDERS.has(normalized) ? 'selected_no_provider_launch' : 'unsupported',
    mismatch_facts: SUPPORTED_PROVIDERS.has(normalized) ? [] : [`unsupported_provider:${normalized}`],
  };
}

function harmlessCommand(session, cwd) {
  const payload = JSON.stringify({ marker: 'afk-launch-attempt-marker', session, cwd });
  const encoded = Buffer.from(payload, 'utf8').toString('base64');
  return `node -e ${JSON.stringify(`console.log(Buffer.from(${JSON.stringify(encoded)}, 'base64').toString('utf8'));`)}`;
}

function providerCommand(provider) {
  if (provider === 'codex') return 'codex --no-alt-screen';
  throw new Error(`Provider launch command is not defined for ${provider}`);
}

function launchModeFor(options) {
  return options.launchMode ?? (options.supervisedProviderLaunch ? 'supervised-provider' : 'no-provider');
}

function assertNoProviderCommand(command) {
  if (PROVIDER_BINARY_PATTERN.test(command)) {
    throw new Error('Refusing command path that would execute a provider binary');
  }
}

async function freePort() {
  const server = http.createServer();
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const address = server.address();
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return address.port;
}

async function waitForHealth(port, readOutput) {
  const url = `http://127.0.0.1:${port}/health`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
  }
  throw new Error(`bridge did not become healthy:\n${readOutput()}`);
}

async function waitForSnapshot(port, session, marker) {
  const url = `http://127.0.0.1:${port}/snapshot?session=${encodeURIComponent(session)}&lines=80`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(url);
    if (response.ok) {
      const snapshot = await response.json();
      if (snapshot.text.includes(marker)) return snapshot;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`snapshot did not include ${marker}`);
}

async function waitForSessionReadySnapshot(port, session) {
  let last = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/snapshot?session=${encodeURIComponent(session)}&lines=80`);
    if (response.ok) {
      const snapshot = await response.json();
      last = snapshot;
      if (snapshot.command_child_pid || snapshot.text || snapshot.command) return snapshot;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  return last;
}

async function waitForProviderObservationSnapshot(port, session, fallback) {
  let last = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/snapshot?session=${encodeURIComponent(session)}&lines=80`);
    if (response.ok) {
      const snapshot = await response.json();
      const observation = providerObservationFromBridgeSnapshot(snapshot, fallback);
      last = { snapshot, observation };
      if (
        snapshot.command_child_pid
        && observation.provider_acceptance.status === 'provider_session_observed'
      ) {
        return last;
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  return last;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function typeCharacters({
  port,
  session,
  text,
  fetchImpl = fetch,
  charDelayMs = LIVE_INPUT_TIMING_PROFILE.charDelayMs,
  sleepImpl = sleep,
}) {
  let lastResult = null;
  let accepted = true;
  for (const char of text) {
    const inputResponse = await fetchImpl(`http://127.0.0.1:${port}/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session,
        text: char,
        enter: false,
      }),
    });
    lastResult = inputResponse.ok ? await inputResponse.json() : { ok: false, status: inputResponse.status };
    accepted = accepted && (lastResult.ok === true || lastResult.text_accepted === true || lastResult.textAccepted === true);
    if (charDelayMs > 0) {
      await sleepImpl(charDelayMs);
    }
  }
  return {
    ok: accepted,
    text_accepted: accepted,
    typed_character_count: [...text].length,
    text_bytes: Buffer.byteLength(text),
    last_result: lastResult,
  };
}

async function submitLiveProviderPrompt({
  port,
  session,
  prompt,
  promptSource = {},
  fetchImpl = fetch,
  timing = LIVE_INPUT_TIMING_PROFILE,
  sleepImpl = sleep,
}) {
  await sleepImpl(timing.startupSettleMs);
  const inputResult = await typeCharacters({
    port,
    session,
    text: prompt,
    fetchImpl,
    charDelayMs: timing.charDelayMs,
    sleepImpl,
  });
  await sleepImpl(timing.preSubmitDelayMs);
  const keyResponse = await fetchImpl(`http://127.0.0.1:${port}/key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      session,
      key: 'Enter',
    }),
  });
  const keyResult = keyResponse.ok ? await keyResponse.json() : { ok: false, status: keyResponse.status };
  return inputSubmissionRecord({
    prompt,
    promptSource,
    inputResult,
    keyResult,
    timing,
    typedCharacterCount: inputResult.typed_character_count,
  });
}

function promptSubmissionMismatch(inputSubmission) {
  if (inputSubmission?.status === 'submitted') return null;
  return {
    code: 'provider_prompt_submission_unobserved',
    severity: 'error',
    source: 'terminal_substrate',
    expected: { input_submission: 'prompt text accepted by bridge /input and isolated /key Enter accepted' },
    observed: { input_submission: inputSubmission?.status ?? NOT_OBSERVED },
    effect: 'not_observed',
    evidence_ref: 'inline:terminal_substrate.input_submission',
  };
}

async function waitForBridgeUnreachable(port) {
  const url = `http://127.0.0.1:${port}/health`;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await fetch(url);
    } catch {
      return true;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  return false;
}

async function waitForPidGone(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  return false;
}

async function waitForProcessGroupGone(pgid) {
  if (!Number.isInteger(pgid) || pgid <= 0) return false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = spawnSync('ps', ['-axo', 'pid=,pgid='], { encoding: 'utf8' });
    if (result.status === 0) {
      const groupMembers = result.stdout.trim().split('\n').filter((line) => {
        const [, observedPgid] = line.trim().split(/\s+/).map(Number);
        return observedPgid === pgid;
      });
      if (groupMembers.length === 0) return true;
    }
    if (result.status !== 0) {
      try {
        process.kill(-pgid, 0);
      } catch {
        return true;
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  return false;
}

function cleanupProofFromStatus({
  owner = 'afk-launch-attempt-prototype',
  status,
  proof = [],
  reason = null,
  session = NOT_OBSERVED,
  command = NOT_OBSERVED,
  port = NOT_OBSERVED,
}) {
  const verified = status === 'verified' || status === 'complete' || status === 'completed';
  return {
    owner,
    status: verified ? 'verified' : 'cleanup_unverified',
    proof,
    reason: verified ? null : (reason ?? 'helper-owned bridge/provider cleanup was not verified'),
    scope: {
      owned_bridge_session: session,
      owned_command: command,
      owned_bridge_port: port,
      unrelated_provider_processes: 'not_classified',
    },
  };
}

function proofItemText(item) {
  return typeof item === 'string' ? item : `${item?.kind ?? ''} ${JSON.stringify(item ?? {})}`;
}

function cleanupProofCoversBridgeAndChild(proof) {
  if (!Array.isArray(proof)) return false;
  if (proof.some((item) => item && typeof item === 'object' && item.exit_observed === false)) return false;
  if (proof.some((item) => item && typeof item === 'object' && item.unreachable === false)) return false;
  const texts = proof.map(proofItemText);
  if (texts.some((text) => text.includes('provider_launch_dry_run_no_helper_process_started'))) return true;
  const bridgeExit = texts.some((text) => text.includes('owned_bridge_process_exit') || text.includes('bridge server process') || text.includes('bridge process'));
  const bridgeUnreachable = texts.some((text) => text.includes('owned_bridge_health_unreachable_after_teardown') || text.includes('bridge health endpoint unreachable'));
  const childExit = texts.some((text) => (
    text.includes('owned_process_driver_child_exit')
    || text.includes('owned_provider_command_child_exit')
    || text.includes('pty-proxy.py process')
    || text.includes('codex --no-alt-screen process')
  ));
  return bridgeExit && bridgeUnreachable && childExit;
}

async function helperOwnedCleanupProof({ bridge, port, session, command, processChildPid = null, commandChildPid = null }) {
  const bridgeUnreachable = await waitForBridgeUnreachable(port);
  const childGone = processChildPid ? await waitForPidGone(processChildPid) : false;
  const commandGone = commandChildPid ? await waitForProcessGroupGone(commandChildPid) : false;
  const verified = bridge.exitCode !== null && bridgeUnreachable && childGone && commandGone;
  const reason = verified
    ? null
    : (bridge.exitCode === null
      ? 'bridge process exit was not observed'
      : (!bridgeUnreachable
        ? 'owned bridge health endpoint still responded'
        : (!childGone
          ? 'owned process-driver child still observable after bridge teardown'
          : 'owned provider command child still observable after bridge teardown')));
  return cleanupProofFromStatus({
    status: verified ? 'verified' : 'cleanup_unverified',
    proof: [
      {
        kind: 'owned_bridge_process_exit',
        session,
        command,
        exit_observed: bridge.exitCode !== null,
        signal: bridge.signalCode ?? NOT_OBSERVED,
      },
      {
        kind: 'owned_bridge_health_unreachable_after_teardown',
        port,
        unreachable: bridgeUnreachable,
      },
      {
        kind: 'owned_process_driver_child_exit',
        session,
        command,
        pid: processChildPid ?? NOT_OBSERVED,
        exit_observed: childGone,
      },
      {
        kind: 'owned_provider_command_child_exit',
        session,
        command,
        process_group_id: commandChildPid ?? NOT_OBSERVED,
        exit_observed: commandGone,
      },
    ],
    reason,
    session,
    command,
    port,
  });
}

function normalizeCleanupProofFixture(cleanup, fallback = {}) {
  if (!cleanup) return null;
  const status = cleanup.status ?? cleanup.cleanup_status ?? cleanup.cleanupStatus ?? NOT_OBSERVED;
  const proof = cleanup.proof ?? cleanup.cleanup_proof ?? cleanup.cleanupProof ?? [];
  const verified = (status === 'verified' || status === 'complete' || status === 'completed')
    && cleanupProofCoversBridgeAndChild(proof);
  return cleanupProofFromStatus({
    owner: cleanup.owner ?? 'afk-launch-attempt-prototype',
    status: verified ? 'verified' : 'cleanup_unverified',
    proof,
    reason: cleanup.reason ?? (verified ? null : 'cleanup proof must include helper-owned bridge and child/session teardown'),
    session: cleanup.session ?? fallback.session,
    command: cleanup.command ?? fallback.command,
    port: cleanup.port ?? fallback.port,
  });
}

async function observeTerminalSubstrate({ repoRoot, idempotenceKey, launchCwd, command }) {
  assertNoProviderCommand(command);
  const tempRoot = mkdtempSync(join(tmpdir(), 'afk-launch-attempt-'));
  const homeDir = join(tempRoot, 'home');
  const codexRoot = join(tempRoot, 'codex-empty');
  const claudeRoot = join(tempRoot, 'claude-empty');
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(codexRoot, { recursive: true });
  mkdirSync(claudeRoot, { recursive: true });
  const port = await freePort();
  const defaultSession = `afk-launch-${idempotenceKey.slice(0, 12)}`;
  let output = '';
  let observed = null;
  const bridge = spawn(process.execPath, ['apps/sigil/codex-terminal/server.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SIGIL_AGENT_TERMINAL_PORT: String(port),
      SIGIL_AGENT_TERMINAL_DRIVER: 'process',
      SIGIL_AGENT_TMUX_SESSION: defaultSession,
      SIGIL_AGENT_CWD: launchCwd,
      SIGIL_AGENT_COMMAND: command,
      SIGIL_AGENT_CATALOG_HOME: homeDir,
      SIGIL_AGENT_CODEX_ROOT: codexRoot,
      SIGIL_AGENT_CLAUDE_ROOT: claudeRoot,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bridge.stdout.on('data', (chunk) => { output += chunk.toString('utf8'); });
  bridge.stderr.on('data', (chunk) => { output += chunk.toString('utf8'); });

  try {
    const health = await waitForHealth(port, () => output);
    const ensureResponse = await fetch(`http://127.0.0.1:${port}/ensure`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session: defaultSession,
        cwd: launchCwd,
        command,
        force: true,
      }),
    });
    if (!ensureResponse.ok) {
      throw new Error(`bridge /ensure failed: ${await ensureResponse.text()}`);
    }
    const ensured = await ensureResponse.json();
    const snapshot = await waitForSnapshot(port, defaultSession, 'afk-launch-attempt-marker');
    const sessionsResponse = await fetch(
      `http://127.0.0.1:${port}/sessions?cwd=${encodeURIComponent(launchCwd)}`,
    );
    const catalog = sessionsResponse.ok ? await sessionsResponse.json() : { sessions: [] };
    const inspectorResponse = await fetch(
      `http://127.0.0.1:${port}/session-inspector?cwd=${encodeURIComponent(launchCwd)}&provider=codex&session_id=${defaultSession}`,
    );
    observed = {
      bridge_session_started: true,
      terminal_substrate: {
        status: 'observed',
        driver: ensured.driver,
        session_handle: ensured.session,
        process_child_pid: ensured.child_pid ?? NOT_OBSERVED,
        command_child_pid: snapshot.command_child_pid ?? NOT_OBSERVED,
        cwd: launchCwd,
        command,
        snapshot_ref: 'inline:terminal_substrate.snapshot_summary',
        snapshot_summary: {
          session: snapshot.session,
          driver: snapshot.driver,
          command: snapshot.command,
          includes_marker: snapshot.text.includes('afk-launch-attempt-marker'),
          text_excerpt: snapshot.text.split('\n').slice(0, 4).join('\n'),
        },
        bridge_health: {
          ok: health.ok,
          default_session: health.defaultSession,
          default_cwd: health.defaultCwd,
          driver: health.driver,
        },
      },
      catalog_status: catalog.sessions.length === 0 ? NOT_OBSERVED : 'fixture_only_unexpected',
      telemetry_status: inspectorResponse.status === 404 ? NOT_OBSERVED : 'fixture_only_unexpected',
    };
    return observed;
  } finally {
    if (bridge.exitCode == null) {
      bridge.kill('SIGTERM');
      await new Promise((resolvePromise) => bridge.once('exit', resolvePromise));
    }
    if (observed) {
      observed.cleanup = await helperOwnedCleanupProof({
        bridge,
        port,
        session: defaultSession,
        command,
        processChildPid: observed.terminal_substrate.process_child_pid,
        commandChildPid: observed.terminal_substrate.command_child_pid,
      });
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function dryRunProviderTerminalSubstrate({ session, launchCwd, command }) {
  return {
    bridge_session_started: true,
    command,
    provider_launch_performed: true,
    terminal_substrate: {
      status: 'observed',
      driver: 'process',
      session_handle: session,
      cwd: launchCwd,
      command,
      snapshot_ref: 'inline:terminal_substrate.provider_launch_dry_run',
      geometry: {
        cols: NOT_OBSERVED,
        rows: NOT_OBSERVED,
      },
      resize: NOT_OBSERVED,
      input_submission: NOT_OBSERVED,
      snapshot_summary: {
        session,
        driver: 'process',
        command,
        includes_marker: false,
        text_excerpt: 'provider launch dry-run: command not executed',
      },
      bridge_health: {
        ok: NOT_OBSERVED,
        default_session: session,
        default_cwd: launchCwd,
        driver: 'process',
      },
    },
    provider_acceptance: {
      status: 'provider_acceptance_unobserved',
      provider_session_id: NOT_OBSERVED,
      provider_reported_cwd: NOT_OBSERVED,
      provider_reported_branch: NOT_OBSERVED,
      provider_reported_head: NOT_OBSERVED,
      provider_version: NOT_OBSERVED,
      model: NOT_OBSERVED,
    },
    catalog_status: NOT_OBSERVED,
    telemetry_status: NOT_OBSERVED,
    cleanup: cleanupProofFromStatus({
      status: 'verified',
      proof: [
        {
          kind: 'provider_launch_dry_run_no_helper_process_started',
          session,
          command,
        },
      ],
      session,
      command,
    }),
    mismatch: {
      code: 'provider_session_id_not_observed',
      severity: 'info',
      source: 'provider_acceptance',
      expected: { provider_session_id: 'parseable from bridge snapshot/title' },
      observed: { terminal_substrate: 'provider_launch_dry_run' },
      effect: 'not_observed',
      evidence_ref: 'inline:terminal_substrate.provider_launch_dry_run',
    },
  };
}

async function observeProviderTerminalSubstrate({ repoRoot, idempotenceKey, launchCwd, command, prompt, promptSource }) {
  const port = await freePort();
  const defaultSession = `afk-launch-${idempotenceKey.slice(0, 12)}`;
  let output = '';
  let observed = null;
  const bridge = spawn(process.execPath, ['apps/sigil/codex-terminal/server.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SIGIL_AGENT_TERMINAL_PORT: String(port),
      SIGIL_AGENT_TERMINAL_DRIVER: 'process',
      SIGIL_AGENT_TMUX_SESSION: defaultSession,
      SIGIL_AGENT_CWD: launchCwd,
      SIGIL_AGENT_COMMAND: command,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bridge.stdout.on('data', (chunk) => { output += chunk.toString('utf8'); });
  bridge.stderr.on('data', (chunk) => { output += chunk.toString('utf8'); });

  try {
    const health = await waitForHealth(port, () => output);
    const ensureResponse = await fetch(`http://127.0.0.1:${port}/ensure`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session: defaultSession,
        cwd: launchCwd,
        command,
        force: true,
      }),
    });
    if (!ensureResponse.ok) {
      throw new Error(`bridge /ensure failed: ${await ensureResponse.text()}`);
    }
    const ensured = await ensureResponse.json();
    const readySnapshot = await waitForSessionReadySnapshot(port, defaultSession);
    const inputSubmission = await submitLiveProviderPrompt({
      port,
      session: defaultSession,
      prompt,
      promptSource,
    });
    const providerObservationSnapshot = await waitForProviderObservationSnapshot(port, defaultSession, {
      session: ensured.session,
      driver: ensured.driver,
      command,
      observedTerminalSubstrate: 'observed',
    });
    const processSnapshot = providerObservationSnapshot?.snapshot ?? null;
    const providerObservation = providerObservationSnapshot?.observation
      ?? providerObservationFromBridgeSnapshot(null, {
        session: ensured.session,
        driver: ensured.driver,
        command,
        observedTerminalSubstrate: 'observed',
      });
    inputSubmission.provider_execution_observed =
      providerObservation.provider_acceptance.status === 'provider_session_observed';
    observed = {
      bridge_session_started: true,
      command,
      provider_launch_performed: true,
      terminal_substrate: {
        status: 'observed',
        driver: ensured.driver,
        session_handle: ensured.session,
        process_child_pid: ensured.child_pid ?? NOT_OBSERVED,
        command_child_pid: processSnapshot?.command_child_pid ?? NOT_OBSERVED,
        cwd: launchCwd,
        command,
        snapshot_ref: providerObservation.snapshot_ref,
        input_submission: inputSubmission,
        snapshot_summary: providerObservation.snapshot_summary,
        bridge_health: {
          ok: health.ok,
          default_session: health.defaultSession,
          default_cwd: health.defaultCwd,
          driver: health.driver,
        },
      },
      provider_acceptance: providerObservation.provider_acceptance,
      catalog_status: NOT_OBSERVED,
      telemetry_status: NOT_OBSERVED,
      mismatch: promptSubmissionMismatch(inputSubmission) ?? providerObservation.mismatch,
    };
    if (
      observed.terminal_substrate.command_child_pid === NOT_OBSERVED
      && readySnapshot?.command_child_pid
    ) {
      observed.terminal_substrate.command_child_pid = readySnapshot.command_child_pid;
    }
    return observed;
  } finally {
    if (bridge.exitCode == null) {
      bridge.kill('SIGTERM');
      await new Promise((resolvePromise) => bridge.once('exit', resolvePromise));
    }
    if (observed) {
      observed.cleanup = await helperOwnedCleanupProof({
        bridge,
        port,
        session: defaultSession,
        command,
        processChildPid: observed.terminal_substrate.process_child_pid,
        commandChildPid: observed.terminal_substrate.command_child_pid,
      });
    }
  }
}

async function buildAttemptContext(options) {
  if (!options.packet) throw new Error('Missing required --packet');
  const repoRoot = resolveRepoRoot(options.repo ?? process.cwd());
  let codexHome = normalizeCodexHomeOption(repoRoot, options);
  const packetPath = repoPath(repoRoot, options.packet);
  const packet = await readJsonFile(packetPath, 'packet');
  const rawCatalogFixture = options.catalogFixture
    ? await readJsonFile(repoPath(repoRoot, options.catalogFixture), 'catalog fixture')
    : null;
  const rawBridgeVisibilityFixture = options.bridgeVisibilityFixture
    ? await readJsonFile(repoPath(repoRoot, options.bridgeVisibilityFixture), 'bridge visibility fixture')
    : null;
  const catalogInput = bridgeFixtureCatalogInput(rawBridgeVisibilityFixture ?? rawCatalogFixture);
  const catalogFixture = catalogInput ? normalizeCatalogFixture(catalogInput) : null;
  const allCwdCatalogFixture = catalogInput ? normalizeAllCwdCatalogFixture(catalogInput) : [];
  const packetId = normalizePacketId(packet);
  const sourceArtifact = normalizeSourceArtifact(packet);
  const requiredStartRef = normalizeRef(packet);
  const selectedDock = options.dock ?? normalizeRequestedDock(packet) ?? 'missing_with_reason';
  const worktree = normalizeWorktree(packet, repoRoot);
  const cwdPath = repoPath(repoRoot, packet.cwd ?? repoRoot);
  const bridgeCommand = rawBridgeVisibilityFixture
    ? (bridgeFixtureBridgeInput(rawBridgeVisibilityFixture).command
      ?? bridgeFixtureBridgeInput(rawBridgeVisibilityFixture).snapshot?.command)
    : null;
  const provider = selectedProvider({
    explicitProvider: options.provider,
    packetProviderHint: normalizeProviderHint(packet),
    commandProvider: inferProviderFromCommand(bridgeCommand),
  });
  const source = checkSourceArtifact(repoRoot, sourceArtifact);
  const refResolution = resolveRef(repoRoot, requiredStartRef);
  const dockProfile = await resolveDockProfile(repoRoot, selectedDock);
  const gitFacts = resolveGitFacts(repoRoot);
  const resultRoutes = normalizeResultRoutes(packet);
  const launchRoot = dockProfile.launch_root ?? `.docks/${selectedDock}`;
  const intendedLaunchCwd = resolve(repoRoot, launchRoot);
  const schedulerRunId = options.schedulerRunId ?? `prototype-scheduler-${stableHash({
    packetId,
    sourceArtifact,
    requiredStartRef,
    selectedDock,
    selectedProvider: provider.selected_provider,
  }, 16)}`;
  const dispatchAttemptId = `prototype-dispatch-${stableHash({
    schedulerRunId,
    selectedDock,
    selectedProvider: provider.selected_provider,
  }, 16)}`;
  const action = 'start';
  const launchMode = launchModeFor(options);
  const idempotenceKey = stableHash({
    packet_id_or_ref: packetId,
    scheduler_run_id: schedulerRunId,
    selected_dock: selectedDock,
    selected_provider: provider.selected_provider,
    launch_root: launchRoot,
    intended_worktree: worktree,
    required_start_ref: requiredStartRef,
    result_route_refs: resultRoutes,
    action,
    launch_mode: launchMode,
  });
  const session = `afk-launch-${idempotenceKey.slice(0, 12)}`;
  const command = launchMode === 'supervised-provider'
    ? providerCommand(provider.selected_provider)
    : harmlessCommand(session, intendedLaunchCwd);
  if (launchMode === 'no-provider') {
    assertNoProviderCommand(command);
  }
  const bridgeVisibility = normalizeBridgeVisibilityFixture(rawBridgeVisibilityFixture, intendedLaunchCwd);
  if (
    !codexHome
    && launchMode === 'supervised-provider'
    && provider.selected_provider === 'codex'
    && !options.providerLaunchDryRun
    && !rawBridgeVisibilityFixture
  ) {
    codexHome = join(homedir(), '.codex');
  }
  const promptContext = {
    packet,
    packetId,
    sourceArtifact,
    requiredStartRef,
    worktree,
  };
  const liveProviderPrompt = buildLiveProviderPrompt(promptContext);

  const validations = [
    validationRecord('packet_id_or_ref_present', Boolean(packetId), { packet_id_or_ref: packetId ?? null }),
    validationRecord('source_artifact_exists_when_repo_path', source.status === 'present', source),
    validationRecord('cwd_resolves_to_repo_root', cwdPath === repoRoot, {
      cwd: cwdPath,
      expected_repo_root: repoRoot,
      reason: cwdPath === repoRoot ? null : `cwd resolves to ${cwdPath}, not expected repo root ${repoRoot}`,
    }),
    validatePathExists('worktree_exists', worktree),
    validationRecord('required_start_ref_resolves', refResolution.status === 'resolved', refResolution),
    validationRecord('dock_profile_exists', dockProfile.status === 'resolved', {
      dock: selectedDock,
      profile_path: dockProfile.profile_path ?? null,
      reason: dockProfile.reason ?? null,
    }),
    validationRecord('selected_provider_supported', provider.status === 'selected_no_provider_launch', {
      selected_provider: provider.selected_provider,
      reason: provider.status === 'selected_no_provider_launch' ? null : provider.status,
    }),
    validationRecord(
      launchMode === 'supervised-provider' ? 'provider_binary_in_command_for_supervised_launch' : 'provider_binary_not_in_command',
      launchMode === 'supervised-provider' ? PROVIDER_BINARY_PATTERN.test(command) : !PROVIDER_BINARY_PATTERN.test(command),
      {
        launch_mode: launchMode,
        selected_provider: provider.selected_provider,
        selected_dock: selectedDock,
        command,
      },
    ),
    validationRecord('supervised_provider_launch_limited_to_codex_gdi', launchMode !== 'supervised-provider' || (provider.selected_provider === 'codex' && selectedDock === 'gdi'), {
      launch_mode: launchMode,
      selected_provider: provider.selected_provider,
      selected_dock: selectedDock,
    }),
    validationRecord('provider_launch_dry_run_not_fixture_backed', !options.providerLaunchDryRun || !rawBridgeVisibilityFixture, {
      launch_mode: launchMode,
      provider_launch_dry_run: Boolean(options.providerLaunchDryRun),
      bridge_visibility_fixture: rawBridgeVisibilityFixture ? 'present' : NOT_OBSERVED,
    }),
    validationRecord('provider_launch_dry_run_requires_supervised_mode', !options.providerLaunchDryRun || launchMode === 'supervised-provider', {
      launch_mode: launchMode,
      provider_launch_dry_run: Boolean(options.providerLaunchDryRun),
    }),
    validationRecord('bridge_visibility_fixture_provider_command_not_executed', true, {
      selected_command: command,
      fixture_command: bridgeVisibility?.command ?? NOT_APPLICABLE_NO_PROVIDER,
      fixture: rawBridgeVisibilityFixture ? 'synthetic_bridge_visibility' : NOT_APPLICABLE_NO_PROVIDER,
    }),
  ];

  return {
    repoRoot,
    codexHome,
    packetPath,
    packet,
    packetId,
    sourceArtifact,
    requiredStartRef,
    source,
    refResolution,
    selectedDock,
    dockProfile,
    worktree,
    cwdPath,
    provider,
    gitFacts,
    resultRoutes,
    launchRoot,
    intendedLaunchCwd,
    schedulerRunId,
    dispatchAttemptId,
    action,
    launchMode,
    idempotenceKey,
    command,
    liveProviderPrompt,
    liveProviderPromptSource: {
      packetId,
      sourceArtifact,
      requiredStartRef,
      worktree,
      goal: packet.goal ?? packet.objective ?? packet.single_next_goal ?? NOT_OBSERVED,
    },
    bridgeVisibility,
    providerLaunchPerformed: bridgeVisibility?.provider_launch_performed ?? false,
    providerLaunchDryRun: Boolean(options.providerLaunchDryRun),
    catalogFixture,
    allCwdCatalogFixture,
    providerSessionId: options.providerSessionId ?? bridgeVisibility?.providerSessionId ?? NOT_OBSERVED,
    launchObservedAt: options.launchObservedAt ?? catalogInput?.launch_observed_at ?? catalogInput?.launchObservedAt ?? options.timestamp ?? NOT_OBSERVED,
    launchObservedAtForCorrelation: options.launchObservedAt
      ?? catalogInput?.launch_observed_at
      ?? catalogInput?.launchObservedAt
      ?? (launchMode === 'supervised-provider' && !options.providerLaunchDryRun && !rawBridgeVisibilityFixture
        ? options.timestamp
        : NOT_OBSERVED),
    validations,
  };
}

function initialRecord(context, timestamp) {
  const validationFailed = context.validations.some((validation) => validation.status !== 'passed');
  return {
    record_type: 'aos.afk_launch_attempt',
    schema_status: 'not_a_schema',
    launch_attempt_id: `launch-attempt-${context.idempotenceKey.slice(0, 16)}`,
    scheduler_run_id: context.schedulerRunId,
    dispatch_attempt_id: context.dispatchAttemptId,
    idempotence_key: context.idempotenceKey,
    created_at: timestamp,
    updated_at: timestamp,
    lifecycle_state: validationFailed ? 'rejected' : 'requested',
    duplicate_handling: {
      duplicate: false,
      bridge_session_started: false,
      reused_launch_attempt_id: NOT_APPLICABLE_NO_PROVIDER,
    },
    validations: context.validations,
    transfer: {
      packet_id_or_ref: context.packetId ?? 'missing_with_reason: packet id/ref is required',
      source_event_or_artifact: context.sourceArtifact ?? 'missing_with_reason: source_artifact not supplied',
      result_route_refs: context.resultRoutes.length > 0 ? context.resultRoutes : NOT_OBSERVED,
      required_start_ref: context.requiredStartRef ?? 'missing_with_reason: required_start_ref not supplied',
      start_ref_sha: context.refResolution.sha ?? 'missing_with_reason: required_start_ref did not resolve',
      external_publication_policy: context.packet.external_publication_policy
        ?? context.packet.externalPublicationPolicy
        ?? 'local-only',
    },
    selection: {
      selected_provider: context.provider.selected_provider,
      provider_selection_source: context.provider.provider_selection_source,
      selected_dock: context.selectedDock,
      dock_role_kind: context.dockProfile.role ?? context.selectedDock,
      dock_profile_ref: context.dockProfile.profile_path ?? `.docks/${context.selectedDock}/dock.json`,
      launch_root: context.launchRoot,
    },
    launch_intent: {
      action: context.action,
      launch_mode: context.launchMode,
      intended_worktree: context.worktree,
      intended_launch_cwd: context.intendedLaunchCwd,
      intended_branch: context.gitFacts.branch,
      intended_head: context.gitFacts.head,
      command_argv: context.launchMode === 'supervised-provider'
        ? ['codex', '--no-alt-screen']
        : ['node', '-e', '<harmless marker command>'],
      command: context.command,
      command_env_refs: context.launchMode === 'supervised-provider'
        ? [
            'SIGIL_AGENT_TERMINAL_DRIVER=process',
            'SIGIL_AGENT_COMMAND=codex --no-alt-screen',
          ]
        : [
            'SIGIL_AGENT_TERMINAL_DRIVER=process',
            'SIGIL_AGENT_COMMAND=<harmless-node-command>',
          ],
      deadline_or_lease: context.packet.timeout_or_lease ?? context.packet.timeoutOrLease ?? NOT_OBSERVED,
      launch_requested: true,
      launch_performed: false,
      provider_launch_performed: false,
    },
    terminal_substrate: {
      status: NOT_OBSERVED,
      driver: NOT_OBSERVED,
      session_handle: NOT_OBSERVED,
      cwd: NOT_OBSERVED,
      command: NOT_OBSERVED,
      snapshot_ref: NOT_OBSERVED,
    },
    provider_acceptance: {
      status: NOT_APPLICABLE_NO_PROVIDER,
      provider_session_id: NOT_APPLICABLE_NO_PROVIDER,
      provider_reported_cwd: NOT_APPLICABLE_NO_PROVIDER,
      provider_reported_branch: NOT_APPLICABLE_NO_PROVIDER,
      provider_reported_head: NOT_APPLICABLE_NO_PROVIDER,
      provider_version: NOT_APPLICABLE_NO_PROVIDER,
      model: NOT_APPLICABLE_NO_PROVIDER,
    },
    catalog: {
      status: NOT_OBSERVED,
      catalog_record_refs: NOT_OBSERVED,
      match_count: NOT_OBSERVED,
      matched_session_id: NOT_OBSERVED,
      source_file: NOT_OBSERVED,
      resume_command: NOT_OBSERVED,
    },
    codex_adapter: {
      status: NOT_ATTEMPTED,
      codex_home_ref: NOT_OBSERVED,
      correlation_status: NOT_OBSERVED,
      confidence: 'none',
      matched_thread_id: NOT_OBSERVED,
      matched_thread_ref: NOT_OBSERVED,
      matched_deeplink: NOT_OBSERVED,
      matched_cwd_basis: NOT_OBSERVED,
      candidate_thread_ids: [],
      time_window: NOT_OBSERVED,
      evidence_refs: [],
      diagnostics: [],
      mismatches: [],
    },
    telemetry: {
      status: NOT_OBSERVED,
      telemetry_event_refs: NOT_OBSERVED,
      lifecycle_event_refs: NOT_OBSERVED,
      capability_event_refs: NOT_OBSERVED,
      mismatch_refs: [],
    },
    result_route: {
      status: NOT_ATTEMPTED,
      attempt_refs: [],
      delivered_refs: [],
      failure: NOT_OBSERVED,
    },
    cleanup: {
      owner: NOT_OBSERVED,
      status: NOT_OBSERVED,
      proof: NOT_OBSERVED,
      reason: NOT_OBSERVED,
      scope: NOT_OBSERVED,
    },
    mismatches: context.provider.mismatch_facts.map((fact) => ({
      code: fact.split(':')[0],
      severity: 'error',
      observed_at: timestamp,
      source: 'dispatch',
      expected: { supported_providers: [...SUPPORTED_PROVIDERS] },
      observed: { selected_provider: context.provider.selected_provider },
      effect: 'rejected',
      evidence_ref: 'inline:validations',
    })),
    evidence: {
      required_before_completed: [],
      observed_refs: [],
    },
  };
}

async function createLaunchAttempt(options) {
  const context = await buildAttemptContext(options);
  const timestamp = options.timestamp ?? new Date().toISOString();
  const existing = attemptRegistry.get(context.idempotenceKey);
  if (existing) {
    const duplicate = structuredClone(existing);
    duplicate.updated_at = timestamp;
    duplicate.duplicate_handling = {
      duplicate: true,
      bridge_session_started: false,
      reused_launch_attempt_id: existing.launch_attempt_id,
    };
    duplicate.lifecycle_state = existing.lifecycle_state;
    return duplicate;
  }

  const record = initialRecord(context, timestamp);
  attemptRegistry.set(context.idempotenceKey, structuredClone(record));

  const validationFailed = context.validations.some((validation) => validation.status !== 'passed');
  if (validationFailed) {
    record.result_route.status = NOT_ATTEMPTED;
    attemptRegistry.set(context.idempotenceKey, structuredClone(record));
    return record;
  }

  const observed = context.bridgeVisibility ?? (
    context.launchMode === 'supervised-provider'
      ? (
          context.providerLaunchDryRun
            ? dryRunProviderTerminalSubstrate({
                session: `afk-launch-${context.idempotenceKey.slice(0, 12)}`,
                launchCwd: context.intendedLaunchCwd,
                command: context.command,
              })
            : await observeProviderTerminalSubstrate({
                repoRoot: context.repoRoot,
                idempotenceKey: context.idempotenceKey,
                launchCwd: context.intendedLaunchCwd,
                command: context.command,
                prompt: context.liveProviderPrompt,
                promptSource: context.liveProviderPromptSource,
              })
        )
      : await observeTerminalSubstrate({
          repoRoot: context.repoRoot,
          idempotenceKey: context.idempotenceKey,
          launchCwd: context.intendedLaunchCwd,
          command: context.command,
        })
  );
  const catalogTelemetry = classifyCatalogAndTelemetry({
    sessions: context.catalogFixture,
    allCwdSessions: context.allCwdCatalogFixture,
    provider: context.provider.selected_provider,
    cwd: context.intendedLaunchCwd,
    launchObservedAt: context.launchObservedAt,
    providerSessionId: observed.provider_acceptance?.provider_session_id === NOT_OBSERVED
      ? context.providerSessionId
      : (observed.provider_acceptance?.provider_session_id ?? context.providerSessionId),
  });
  record.terminal_substrate = observed.terminal_substrate;
  if (observed.cleanup) {
    record.cleanup = observed.cleanup;
  }
  record.launch_intent.provider_launch_performed = Boolean(observed.provider_launch_performed);
  if (observed.provider_acceptance) {
    record.provider_acceptance = observed.provider_acceptance;
  }
  if (catalogTelemetry.provider_acceptance) {
    record.provider_acceptance = mergeProviderAcceptance(
      record.provider_acceptance,
      catalogTelemetry.provider_acceptance,
    );
  }
  record.catalog = context.catalogFixture ? catalogTelemetry.catalog : {
    ...record.catalog,
    status: observed.catalog_status,
  };
  record.telemetry = context.catalogFixture ? catalogTelemetry.telemetry : {
    ...record.telemetry,
    status: observed.telemetry_status,
  };
  record.mismatches.push(...catalogTelemetry.mismatches.map((mismatch) => ({
    observed_at: timestamp,
    ...mismatch,
  })));
  if (observed.mismatch) {
    record.mismatches.push({
      observed_at: timestamp,
      ...observed.mismatch,
    });
  }
  if (context.provider.selected_provider === 'codex' && context.codexHome) {
    const timeWindow = deriveAdapterTimeWindow({ ...context, timestamp });
    const correlation = runCodexAdapterCommand(context.repoRoot, {
      command: 'correlateLaunch',
      input: {
        codexHome: context.codexHome,
        providerSessionId: record.provider_acceptance.provider_session_id === NOT_APPLICABLE_NO_PROVIDER
          ? context.providerSessionId
          : record.provider_acceptance.provider_session_id,
        intendedCwd: context.intendedLaunchCwd,
        workspaceRoot: context.worktree,
        timeWindow,
        bridgeVisibility: bridgeVisibilityForAdapter(record),
      },
    });
    const reference = (
      correlation.status === 'matched_by_provider_session_id'
      || correlation.status === 'matched_by_cwd_time_window'
    )
      ? runCodexAdapterCommand(context.repoRoot, {
          command: 'emitThreadReference',
          input: {
            codexHome: context.codexHome,
            threadIdOrPrefix: correlation.thread.thread_id,
            format: 'json',
          },
        })
      : null;
    record.codex_adapter = buildCodexAdapterRecord({
      status: 'observed',
      correlation,
      reference,
      codexHome: context.codexHome,
      timeWindow,
    });
    record.evidence.observed_refs.push(...adapterEvidenceRefStrings(correlation, reference));
    record.mismatches.push(...adapterMismatchObjects(correlation, timestamp));
    if (shouldPromoteCodexMetadataProviderAcceptance(record, correlation)) {
      promoteCodexMetadataProviderAcceptance(record, correlation, reference, timestamp);
    }
  } else {
    record.codex_adapter = buildCodexAdapterRecord({
      status: context.provider.selected_provider === 'codex' ? 'not_attempted_no_codex_home_fixture' : 'not_applicable_non_codex_provider',
    });
  }
  const executionMismatch = providerExecutionUnobservedMismatch(record, timestamp);
  if (executionMismatch) {
    record.mismatches.push(executionMismatch);
  }
  record.launch_intent.launch_performed = true;
  record.duplicate_handling.bridge_session_started = observed.bridge_session_started;
  record.evidence.observed_refs = [...new Set([
    'inline:terminal_substrate.snapshot_summary',
    ...record.evidence.observed_refs,
  ])];
  record.lifecycle_state = deriveLifecycleState(record);
  record.updated_at = timestamp;
  attemptRegistry.set(context.idempotenceKey, structuredClone(record));
  return record;
}

function exitCodeFor(record) {
  return record.lifecycle_state === 'rejected' ? 1 : 0;
}

function toMarkdown(record) {
  return `# Experimental AFK Launch Attempt

launch_attempt_id: ${record.launch_attempt_id}
created_at: ${record.created_at}
lifecycle_state: ${record.lifecycle_state}

This record is experimental local prototype output and is not a schema.

\`\`\`json
${JSON.stringify(record, null, 2)}
\`\`\`
`;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }

    const record = await createLaunchAttempt(options);
    const output = options.json ? JSON.stringify(record, null, 2) : toMarkdown(record);
    if (options.out) {
      await writeFile(options.out, `${output}\n`, 'utf8');
    }

    let finalOutput = output;
    let finalExitCode = exitCodeFor(record);
    if (options.duplicateInProcess) {
      const duplicate = await createLaunchAttempt(options);
      const bundle = {
        type: 'aos.afk_launch_attempt.prototype_duplicate_check',
        first: record,
        duplicate,
        bridge_sessions_started: [
          record.duplicate_handling.bridge_session_started,
          duplicate.duplicate_handling.bridge_session_started,
        ].filter(Boolean).length,
      };
      finalOutput = JSON.stringify(bundle, null, 2);
      finalExitCode = Math.max(finalExitCode, exitCodeFor(duplicate));
      if (options.out) {
        await writeFile(options.out, `${finalOutput}\n`, 'utf8');
      }
    }

    process.stdout.write(`${finalOutput}\n`);
    process.exitCode = finalExitCode;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      record_type: 'aos.afk_launch_attempt',
      schema_status: 'not_a_schema',
      lifecycle_state: 'failed',
      error: error.message,
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export {
  buildLiveProviderPrompt,
  createLaunchAttempt,
  LIVE_INPUT_TIMING_PROFILE,
  parseArgs,
  providerObservationFromBridgeSnapshot,
  submitLiveProviderPrompt,
  typeCharacters,
};
