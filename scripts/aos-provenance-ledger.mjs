#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCHEMA_VERSION = '2026-05-dock-provenance-v0';
const EVENT_MAX_BYTES = intEnv('AOS_PROVENANCE_EVENT_BYTES', 8192);
const COMMAND_MAX_CHARS = intEnv('AOS_PROVENANCE_COMMAND_CHARS', 240);
const MAX_WALK_NODES = intEnv('AOS_PROVENANCE_MAX_WALK_NODES', 500);
const RAW_RETENTION_DAYS = intEnv('AOS_PROVENANCE_RAW_RETENTION_DAYS', 14);
const RAW_CAP_BYTES = intEnv('AOS_PROVENANCE_RAW_CAP_BYTES', 32 * 1024 * 1024);
const SUMMARY_RETENTION_DAYS = intEnv('AOS_PROVENANCE_SUMMARY_RETENTION_DAYS', 90);
const SUMMARY_CAP_BYTES = intEnv('AOS_PROVENANCE_SUMMARY_CAP_BYTES', 16 * 1024 * 1024);

const ALLOWLIST_PREFIXES = [
  './aos dev recommend',
  './aos dev classify',
  './aos dev audit',
  './aos dev provenance',
  './aos ready',
  './aos dev build',
  'node --test ',
  'bash tests/',
  'git diff --check',
  'cd packages/host && npm test',
  'cd packages/gateway && npm test',
];

const BYPASS_PATTERNS = [
  { id: 'direct-daemon-curl', pattern: /\bcurl\b.*(?:localhost|127\.0\.0\.1).*(?:daemon|sock|api|ipc)/i },
  { id: 'direct-tmux-control', pattern: /\btmux\b/i },
  { id: 'raw-launchd-control', pattern: /\blaunchctl\b/i },
];

function intEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function printJSON(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function error(message, code) {
  process.stderr.write(JSON.stringify({ code, error: message }, null, 2) + '\n');
  process.exit(1);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseArgs(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length;) {
    const arg = args[i];
    if (arg === '--json' || arg === '--apply' || arg === '--dry-run') {
      out[arg.slice(2).replaceAll('-', '_')] = true;
      i += 1;
    } else if (arg === '--files') {
      out.files = [];
      i += 1;
      while (i < args.length && !args[i].startsWith('--')) {
        out.files.push(args[i]);
        i += 1;
      }
      if (!out.files.length) error('--files requires at least one path', 'MISSING_ARG');
    } else if (arg.startsWith('--')) {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) error(`${arg} requires a value`, 'MISSING_ARG');
      out[arg.slice(2).replaceAll('-', '_')] = args[i + 1];
      i += 2;
    } else {
      out._.push(arg);
      i += 1;
    }
  }
  return out;
}

function stateRoot(options = {}) {
  return path.resolve(options.state_root || process.env.AOS_STATE_ROOT || path.join(os.homedir(), '.config', 'aos'));
}

function runtimeMode(options = {}) {
  return options.runtime_mode || process.env.AOS_RUNTIME_MODE || 'repo';
}

function repoKey(repoRoot) {
  return sha256(path.resolve(repoRoot || process.cwd())).slice(0, 16);
}

function baseDir(options = {}) {
  const repoRoot = path.resolve(options.repo || process.cwd());
  return path.join(stateRoot(options), runtimeMode(options), 'provenance', 'repos', repoKey(repoRoot));
}

function dockDir(options = {}) {
  const dock = sanitizeName(options.dock || 'unknown');
  return path.join(baseDir(options), 'docks', dock);
}

function sanitizeName(value) {
  const out = String(value || 'unknown').replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '');
  return out || 'unknown';
}

function isoNow(options = {}) {
  return options.now || process.env.AOS_PROVENANCE_NOW || new Date().toISOString();
}

function dateKey(iso) {
  return String(iso).slice(0, 10);
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function readPayload(options) {
  if (options.payload_file) {
    try {
      return fs.readFileSync(options.payload_file, 'utf8');
    } catch {
      return '';
    }
  }
  return readStdin();
}

function parseJSON(raw) {
  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return null;
  }
}

function walk(value, visit) {
  const stack = [value];
  let count = 0;
  while (stack.length && count < MAX_WALK_NODES) {
    const item = stack.pop();
    count += 1;
    visit(item);
    if (Array.isArray(item)) {
      for (let i = item.length - 1; i >= 0; i -= 1) stack.push(item[i]);
    } else if (item && typeof item === 'object') {
      for (const child of Object.values(item)) stack.push(child);
    }
  }
  return { truncated: stack.length > 0, visited: count };
}

function firstString(payload, keys) {
  let found;
  walk(payload, (item) => {
    if (found || !item || typeof item !== 'object' || Array.isArray(item)) return;
    for (const key of keys) {
      if (typeof item[key] === 'string' && item[key].trim()) {
        found = item[key].trim();
        return;
      }
    }
  });
  return found;
}

function firstNumber(payload, keys) {
  let found;
  walk(payload, (item) => {
    if (found != null || !item || typeof item !== 'object' || Array.isArray(item)) return;
    for (const key of keys) {
      const value = item[key];
      if (Number.isFinite(value)) {
        found = value;
        return;
      }
      if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
        found = Number(value);
        return;
      }
    }
  });
  return found;
}

function commandCandidates(payload) {
  const candidates = [];
  walk(payload, (item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    for (const key of ['cmd', 'command', 'shell_command']) {
      if (typeof item[key] === 'string' && item[key].trim()) candidates.push(item[key].trim());
    }
    const args = item.args;
    if (Array.isArray(args) && args.length && args.every((part) => typeof part === 'string')) {
      candidates.push(args.map(shellQuote).join(' '));
    }
  });
  return [...new Set(candidates)];
}

function shellQuote(value) {
  return /^[A-Za-z0-9_./:=@%+-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

function normalizeCommand(command, repoRoot) {
  let out = String(command || '').replace(/\s+/g, ' ').trim();
  const root = path.resolve(repoRoot || process.cwd());
  out = out.replaceAll(`${root}/aos`, './aos');
  out = out.replaceAll(`cd ${root} && `, '');
  out = out.replace(/^env\s+[^ ]+\s+/, '');
  return out;
}

function commandKind(normalized) {
  if (/^(?:\.\/)?aos dev gh\b/.test(normalized) || /^gh\b/.test(normalized)) return 'github';
  if (/^(?:\.\/)?aos\b/.test(normalized)) return 'aos';
  if (/^git\b/.test(normalized)) return 'git';
  if (/\bslack\b/i.test(normalized)) return 'slack';
  if (normalized) return 'shell';
  return 'unknown';
}

function allowedSummary(normalized) {
  if (normalized.length > COMMAND_MAX_CHARS) return null;
  for (const prefix of ALLOWLIST_PREFIXES) {
    if (normalized === prefix.trim() || normalized.startsWith(prefix)) return normalized;
  }
  return null;
}

function commandRecord(command, repoRoot) {
  const normalized = normalizeCommand(command, repoRoot);
  const summary = allowedSummary(normalized);
  const bypass = BYPASS_PATTERNS.filter((entry) => entry.pattern.test(normalized)).map((entry) => entry.id);
  const out = {
    kind: commandKind(normalized),
    hash: `sha256:${sha256(normalized)}`,
    redacted: summary == null,
  };
  if (summary) out.summary = summary;
  if (bypass.length) out.bypass_signals = bypass;
  return out;
}

function outputMetadata(payload) {
  let bytes = 0;
  const hash = crypto.createHash('sha256');
  walk(payload, (item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    for (const key of ['output', 'stdout', 'stderr', 'result']) {
      if (typeof item[key] === 'string' && item[key]) {
        bytes += Buffer.byteLength(item[key], 'utf8');
        hash.update(item[key]);
      }
    }
  });
  return bytes > 0 ? { bytes, hash: `sha256:${hash.digest('hex')}` } : undefined;
}

function successFromPayload(payload) {
  let failed = false;
  let success;
  walk(payload, (item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    for (const key of ['exit_code', 'returncode', 'return_code', 'status_code']) {
      const value = item[key];
      if (Number.isInteger(value)) {
        success = value === 0;
        if (value !== 0) failed = true;
      }
    }
    for (const key of ['success', 'ok']) {
      if (typeof item[key] === 'boolean') {
        success = item[key];
        if (!item[key]) failed = true;
      }
    }
    if (typeof item.status === 'string' && /failed|error|timeout|cancel/i.test(item.status)) failed = true;
  });
  return failed ? false : success;
}

function tokenTelemetryFromPayload(payload) {
  let snapshot;
  walk(payload, (item) => {
    if (snapshot || !item || typeof item !== 'object' || Array.isArray(item)) return;
    if (item.type === 'agent.session.telemetry' && item.context) snapshot = item;
    if (item.session_telemetry?.type === 'agent.session.telemetry') snapshot = item.session_telemetry;
  });
  if (snapshot) {
    return {
      status: 'available',
      precision: snapshot.context?.used_tokens?.source?.precision || snapshot.context?.window_tokens?.source?.precision || 'unknown',
      latest: compactContext(snapshot.context),
      source: snapshot.session?.source_file ? { file: snapshot.session.source_file } : undefined,
    };
  }
  return { status: 'unknown', reason: 'no_hook_session_telemetry' };
}

function compactContext(context) {
  if (!context || typeof context !== 'object') return undefined;
  const out = {};
  for (const key of ['window_tokens', 'used_tokens', 'remaining_tokens', 'used_ratio', 'remaining_ratio']) {
    if (context[key]?.value != null) {
      out[key] = {
        value: context[key].value,
        unit: context[key].unit,
        precision: context[key].source?.precision || 'unknown',
      };
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function buildEvent(raw, options) {
  const observedAt = isoNow(options);
  const repoRoot = path.resolve(options.repo || process.cwd());
  const bytes = Buffer.byteLength(raw, 'utf8');
  const base = {
    type: 'aos.dock.provenance.event',
    schema_version: SCHEMA_VERSION,
    observed_at: observedAt,
    repo_key: repoKey(repoRoot),
    dock: sanitizeName(options.dock || 'unknown'),
    phase: options.phase || 'unknown',
    session_id: process.env.AOS_SESSION_ID || process.env.CODEX_THREAD_ID || undefined,
  };
  if (bytes > EVENT_MAX_BYTES) {
    return {
      ...base,
      event: 'diagnostic',
      diagnostic: {
        code: 'payload_over_limit',
        payload_bytes: bytes,
        payload_hash: `sha256:${sha256(raw)}`,
        limit_bytes: EVENT_MAX_BYTES,
      },
    };
  }

  const payload = parseJSON(raw);
  if (payload == null) {
    return {
      ...base,
      event: 'diagnostic',
      diagnostic: {
        code: 'malformed_hook_payload',
        payload_bytes: bytes,
        payload_hash: `sha256:${sha256(raw)}`,
      },
    };
  }

  const walkStats = walk(payload, () => {});
  const commands = commandCandidates(payload).slice(0, 8).map((command) => commandRecord(command, repoRoot));
  const output = outputMetadata(payload);
  const event = {
    ...base,
    event: commands.length ? 'command' : (options.phase === 'stop' ? 'session' : 'tool'),
    provider: firstString(payload, ['provider', 'provider_name', 'harness']) || undefined,
    tool_name: firstString(payload, ['tool_name', 'tool', 'recipient_name', 'function_name']) || undefined,
    session_id: firstString(payload, ['session_id', 'sessionId', 'thread_id']) || base.session_id,
    command: commands[0],
    commands: commands.length > 1 ? commands : undefined,
    success: successFromPayload(payload),
    duration_ms: firstNumber(payload, ['duration_ms', 'elapsed_ms']),
    output,
    token_telemetry: tokenTelemetryFromPayload(payload),
  };
  if (walkStats.truncated) {
    event.diagnostic = {
      code: 'payload_walk_truncated',
      visited_nodes: walkStats.visited,
      limit_nodes: MAX_WALK_NODES,
    };
  }
  return stripUndefined(event);
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, stripUndefined(item)]),
  );
}

function eventPath(event, options) {
  return path.join(dockDir(options), 'events', `${dateKey(event.observed_at)}.jsonl`);
}

function summaryPath(event, options) {
  return path.join(dockDir(options), 'summaries', `${dateKey(event.observed_at)}.json`);
}

function appendEvent(event, options) {
  const file = eventPath(event, options);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`);
  updateDailySummary(event, summaryPath(event, options));
}

function updateDailySummary(event, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let summary = {
    type: 'aos.dock.provenance.daily_summary',
    schema_version: SCHEMA_VERSION,
    date: dateKey(event.observed_at),
    dock: event.dock,
    events: 0,
    command_counts: {},
    command_kind_counts: {},
    failed_commands: 0,
    diagnostics: {},
    bypass_signals: {},
    token_telemetry: { available: 0, unknown: 0 },
    updated_at: event.observed_at,
  };
  try {
    summary = { ...summary, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {}
  summary.events += 1;
  summary.updated_at = event.observed_at;
  if (event.command) {
    const key = event.command.summary || event.command.hash;
    summary.command_counts[key] = (summary.command_counts[key] || 0) + 1;
    summary.command_kind_counts[event.command.kind] = (summary.command_kind_counts[event.command.kind] || 0) + 1;
    if (event.success === false) summary.failed_commands += 1;
    for (const signal of event.command.bypass_signals || []) {
      summary.bypass_signals[signal] = (summary.bypass_signals[signal] || 0) + 1;
    }
  }
  if (event.diagnostic?.code) {
    summary.diagnostics[event.diagnostic.code] = (summary.diagnostics[event.diagnostic.code] || 0) + 1;
  }
  if (event.token_telemetry?.status === 'available') summary.token_telemetry.available += 1;
  else summary.token_telemetry.unknown += 1;
  fs.writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);
}

function retentionSettings() {
  return {
    event_max_bytes: EVENT_MAX_BYTES,
    command_max_chars: COMMAND_MAX_CHARS,
    max_walk_nodes: MAX_WALK_NODES,
    raw_retention_days: RAW_RETENTION_DAYS,
    raw_cap_bytes: RAW_CAP_BYTES,
    summary_retention_days: SUMMARY_RETENTION_DAYS,
    summary_cap_bytes: SUMMARY_CAP_BYTES,
    env_overrides: [
      'AOS_STATE_ROOT',
      'AOS_RUNTIME_MODE',
      'AOS_PROVENANCE_EVENT_BYTES',
      'AOS_PROVENANCE_RAW_RETENTION_DAYS',
      'AOS_PROVENANCE_RAW_CAP_BYTES',
      'AOS_PROVENANCE_SUMMARY_RETENTION_DAYS',
      'AOS_PROVENANCE_SUMMARY_CAP_BYTES',
    ],
  };
}

function readEvents(options) {
  const root = path.join(dockDir(options), 'events');
  const events = [];
  if (!fs.existsSync(root)) return events;
  for (const file of listFiles(root).filter((item) => item.endsWith('.jsonl')).sort()) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        events.push(JSON.parse(line));
      } catch {}
    }
  }
  return events;
}

function listFiles(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function summarizeEvents(events, options) {
  const commands = new Map();
  const failed = [];
  const bypass = {};
  const diagnostics = {};
  for (const event of events) {
    if (event.command) {
      const key = event.command.summary || event.command.hash;
      if (!commands.has(key)) {
        commands.set(key, {
          summary: event.command.summary,
          hash: event.command.hash,
          kind: event.command.kind,
          redacted: event.command.redacted,
          count: 0,
          successes: 0,
          failures: 0,
        });
      }
      const item = commands.get(key);
      item.count += 1;
      if (event.success === false) item.failures += 1;
      else if (event.success === true) item.successes += 1;
      if (event.success === false) failed.push({ observed_at: event.observed_at, command: item.summary || item.hash, kind: item.kind });
      for (const signal of event.command.bypass_signals || []) bypass[signal] = (bypass[signal] || 0) + 1;
    }
    if (event.diagnostic?.code) diagnostics[event.diagnostic.code] = (diagnostics[event.diagnostic.code] || 0) + 1;
  }
  return {
    status: 'success',
    subject: 'dock-provenance-summary',
    repo: path.resolve(options.repo || process.cwd()),
    state_root: stateRoot(options),
    runtime_mode: runtimeMode(options),
    dock: sanitizeName(options.dock || 'unknown'),
    retention: retentionSettings(),
    event_count: events.length,
    command_count: [...commands.values()].reduce((sum, item) => sum + item.count, 0),
    commands: [...commands.values()].sort((a, b) => (a.summary || a.hash).localeCompare(b.summary || b.hash)),
    failed_commands: failed,
    bypass_signals: bypass,
    diagnostics,
    omitted: {
      possible_due_to_retention: true,
      reason: 'summary reads retained ledger partitions only',
    },
  };
}

function telemetryFromFile(file, provider, options) {
  if (!file) return { status: 'unknown', reason: 'no_provider_telemetry_source' };
  let lines;
  try {
    lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  } catch {
    return { status: 'unknown', reason: 'telemetry_file_unreadable' };
  }
  const host = hostTelemetryFromFile(file, provider, options);
  if (provider === 'codex') return mergeTelemetry(codexTelemetry(lines, file, options), host);
  if (provider === 'claude-code') return mergeTelemetry(claudeTelemetry(lines, file, options), host);
  return { status: 'unknown', reason: 'unknown_provider' };
}

function hostTelemetryFromFile(file, provider, options) {
  const repoRoot = path.resolve(options.repo || process.cwd());
  const script = `
import fs from 'node:fs';
import {
  extractCodexTelemetryFromJsonlLines,
  extractClaudeTranscriptTelemetryFromJsonlLines,
} from './packages/host/src/session-telemetry.ts';

const [file, provider, sessionId] = process.argv.slice(1);
const lines = fs.readFileSync(file, 'utf8').split(/\\r?\\n/).filter(Boolean);
const extractor = provider === 'claude-code'
  ? extractClaudeTranscriptTelemetryFromJsonlLines
  : extractCodexTelemetryFromJsonlLines;
const result = extractor(lines, { sourceFile: file, sessionId: sessionId || undefined });
const context = result.snapshot?.context || {};
const compact = {};
for (const key of ['window_tokens', 'used_tokens', 'remaining_tokens', 'used_ratio', 'remaining_ratio']) {
  if (context[key]?.value != null) {
    compact[key] = {
      value: context[key].value,
      unit: context[key].unit,
      precision: context[key].source?.precision || 'unknown',
    };
  }
}
console.log(JSON.stringify({
  status: Object.keys(compact).length ? 'available' : 'unknown',
  session_id: result.snapshot?.session?.session_id,
  latest: Object.keys(compact).length ? compact : undefined,
  diagnostics: result.diagnostics?.map((item) => item.code).filter(Boolean) || [],
}));
`;
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script, file, provider, options.session_id || ''], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) return { status: 'unknown', reason: 'host_session_telemetry_unavailable' };
  return parseJSON(result.stdout) || { status: 'unknown', reason: 'host_session_telemetry_invalid_json' };
}

function mergeTelemetry(local, host) {
  if (host?.status !== 'available') {
    return {
      ...local,
      source_adapter: 'local-v0-fallback',
      adapter_diagnostic: host?.reason || 'host_session_telemetry_unavailable',
    };
  }
  return stripUndefined({
    ...local,
    status: local.status === 'available' ? 'available' : host.status,
    session_id: local.session_id || host.session_id,
    latest: local.latest || host.latest,
    source_adapter: 'packages/host/src/session-telemetry.ts',
    adapter_diagnostics: host.diagnostics?.length ? host.diagnostics : undefined,
  });
}

function metric(value, unit, precision) {
  return { value, unit, precision };
}

function codexTelemetry(lines, file, options) {
  let sessionId = options.session_id;
  let start;
  let latest;
  let model;
  for (const line of lines) {
    const record = parseJSON(line);
    if (!record) continue;
    if (record.type === 'session_meta') sessionId = record.payload?.id || sessionId;
    const payload = record.payload || {};
    if (payload.model) model = payload.model;
    if (payload.type === 'token_count' && payload.info) {
      const total = payload.info.total_token_usage?.total_tokens;
      const window = payload.info.model_context_window;
      const snapshot = {
        used_tokens: Number.isFinite(total) ? metric(total, 'tokens', 'exact') : undefined,
        window_tokens: Number.isFinite(window) ? metric(window, 'tokens', 'exact') : undefined,
      };
      if (!start) start = snapshot;
      latest = snapshot;
    }
  }
  if (!sessionId && !latest) return { status: 'unknown', reason: 'codex_context_usage_unavailable' };
  return compactTelemetryResult('codex', sessionId, model, file, start, latest);
}

function claudeTelemetry(lines, file, options) {
  let sessionId = options.session_id;
  let start;
  let latest;
  let model;
  for (const line of lines) {
    const record = parseJSON(line);
    if (!record) continue;
    sessionId = record.sessionId || record.session_id || sessionId;
    const message = record.message || {};
    if (message.model) model = message.model;
    const usage = message.usage;
    if (usage) {
      const used = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']
        .map((key) => Number.isFinite(usage[key]) ? usage[key] : 0)
        .reduce((sum, value) => sum + value, 0);
      const snapshot = { used_tokens: metric(used, 'tokens', 'derived') };
      if (!start) start = snapshot;
      latest = snapshot;
    }
  }
  if (!sessionId && !latest) return { status: 'unknown', reason: 'claude_context_usage_unavailable' };
  return compactTelemetryResult('claude-code', sessionId, model, file, start, latest);
}

function compactTelemetryResult(provider, sessionId, model, file, start, latest) {
  const delta = {};
  if (start?.used_tokens && latest?.used_tokens) {
    delta.used_tokens = metric(latest.used_tokens.value - start.used_tokens.value, 'tokens', latest.used_tokens.precision);
  }
  return stripUndefined({
    status: latest ? 'available' : 'unknown',
    provider,
    session_id: sessionId,
    model,
    source: { file },
    start,
    latest,
    delta: Object.keys(delta).length ? delta : undefined,
    reason: latest ? undefined : 'context_usage_unavailable',
  });
}

function buildRecommendation(options) {
  const args = ['scripts/aos-dev-workflow.mjs', 'recommend', '--json', '--repo', path.resolve(options.repo || process.cwd())];
  if (options.manifest) args.push('--manifest', options.manifest);
  if (options.base) args.push('--base', options.base);
  if (options.files?.length) args.push('--files', ...options.files);
  const result = spawnSync(process.execPath, args, { cwd: path.resolve(options.repo || process.cwd()), encoding: 'utf8' });
  if (result.status !== 0) {
    return {
      status: 'failed',
      error: 'recommendation_failed',
      stderr: result.stderr.trim(),
      stdout: result.stdout.trim(),
    };
  }
  return parseJSON(result.stdout) || { status: 'failed', error: 'recommendation_invalid_json' };
}

function audit(options) {
  const events = readEvents(options);
  const summary = summarizeEvents(events, options);
  const recommendation = buildRecommendation(options);
  const recommended = [
    ...(recommendation.next_commands || []),
    ...(recommendation.verification || []),
  ];
  const observed = summary.commands.filter((item) => item.summary).map((item) => item.summary);
  const observedSet = new Set(observed);
  const recommendedCommands = recommended.map((item) => item.command).filter(Boolean);
  const missing = recommendedCommands.filter((command) => !observedSet.has(command));
  const observedMatching = observed.filter((command) => recommendedCommands.includes(command));
  const extras = observed.filter((command) => !recommendedCommands.includes(command));
  return {
    status: recommendation.status === 'success' ? 'success' : 'failed',
    subject: 'dock-provenance-audit',
    repo: path.resolve(options.repo || process.cwd()),
    dock: sanitizeName(options.dock || 'unknown'),
    changed_files: recommendation.changed_files || options.files || [],
    diff_base: recommendation.diff_base ?? options.base ?? null,
    recommended_commands: recommended,
    observed_matching_commands: observedMatching,
    missing_recommended_commands: missing,
    extra_notable_commands: extras,
    failed_commands: summary.failed_commands,
    bypass_signals: summary.bypass_signals,
    retention: retentionSettings(),
    token_telemetry: telemetryFromFile(options.telemetry_file, options.telemetry_provider || 'codex', options),
    recommendation_status: recommendation.status,
  };
}

function cutoffDate(days, now) {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function prunePlan(options) {
  const root = baseDir(options);
  const now = isoNow(options);
  const files = listFiles(root).map((file) => {
    const stat = fs.statSync(file);
    return { path: file, bytes: stat.size, date: (path.basename(file).match(/\d{4}-\d{2}-\d{2}/) || ['0000-00-00'])[0] };
  });
  const eventCutoff = cutoffDate(RAW_RETENTION_DAYS, now);
  const summaryCutoff = cutoffDate(SUMMARY_RETENTION_DAYS, now);
  const candidates = [];
  for (const file of files) {
    if (file.path.includes(`${path.sep}events${path.sep}`) && file.date < eventCutoff) candidates.push({ ...file, reason: 'raw_retention_days' });
    if (file.path.includes(`${path.sep}summaries${path.sep}`) && file.date < summaryCutoff) candidates.push({ ...file, reason: 'summary_retention_days' });
  }
  for (const [segment, cap] of [['events', RAW_CAP_BYTES], ['summaries', SUMMARY_CAP_BYTES]]) {
    const segmentFiles = files
      .filter((file) => file.path.includes(`${path.sep}${segment}${path.sep}`))
      .sort((a, b) => a.date.localeCompare(b.date));
    let total = segmentFiles.reduce((sum, file) => sum + file.bytes, 0);
    for (const file of segmentFiles) {
      if (total <= cap) break;
      if (!candidates.some((item) => item.path === file.path)) candidates.push({ ...file, reason: `${segment}_cap_bytes` });
      total -= file.bytes;
    }
  }
  return {
    status: 'success',
    subject: 'dock-provenance-prune',
    mode: options.apply ? 'apply' : 'dry-run',
    repo: path.resolve(options.repo || process.cwd()),
    state_root: stateRoot(options),
    runtime_mode: runtimeMode(options),
    retention: retentionSettings(),
    delete_count: candidates.length,
    delete_bytes: candidates.reduce((sum, item) => sum + item.bytes, 0),
    candidates: candidates.map((item) => ({ ...item, path: path.relative(stateRoot(options), item.path) })),
  };
}

function applyPrune(plan, options) {
  const root = stateRoot(options);
  for (const candidate of plan.candidates) {
    const file = path.resolve(root, candidate.path);
    if (!file.startsWith(root + path.sep)) continue;
    try {
      fs.unlinkSync(file);
    } catch {}
  }
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const options = parseArgs(rest);
  if (command === 'record') {
    try {
      const raw = readPayload(options);
      const event = buildEvent(raw, options);
      appendEvent(event, options);
      if (options.json) printJSON({ status: 'success', event });
    } catch (err) {
      if (options.json) printJSON({ status: 'skipped', diagnostic: String(err?.message || err) });
    }
    return;
  }
  if (command === 'summary') {
    const payload = summarizeEvents(readEvents(options), options);
    payload.token_telemetry = telemetryFromFile(options.telemetry_file, options.telemetry_provider || 'codex', options);
    options.json ? printJSON(payload) : process.stdout.write(`provenance summary: ${payload.event_count} events\n`);
    return;
  }
  if (command === 'audit') {
    const payload = audit(options);
    options.json ? printJSON(payload) : process.stdout.write(`provenance audit: ${payload.missing_recommended_commands.length} missing recommended commands\n`);
    process.exit(payload.status === 'success' ? 0 : 1);
  }
  if (command === 'prune') {
    if (options.apply && options.dry_run) error('Use either --dry-run or --apply, not both.', 'INVALID_FLAGS');
    if (!options.apply && !options.dry_run) error('provenance prune requires --dry-run or --apply', 'MISSING_MODE');
    const plan = prunePlan(options);
    if (options.apply) applyPrune(plan, options);
    options.json ? printJSON(plan) : process.stdout.write(`provenance prune ${plan.mode}: ${plan.delete_count} files\n`);
    return;
  }
  error(`Unknown provenance command: ${command || ''}`, 'UNKNOWN_SUBCOMMAND');
}

main();
