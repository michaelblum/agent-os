import fs from 'node:fs';
import {
  extractClaudeTranscriptTelemetryFromJsonlLines,
  extractCodexTelemetryFromJsonlLines,
} from '../../../packages/host/src/session-telemetry.ts';

const DEFAULT_TAIL_BYTES = 2 * 1024 * 1024;
const DEFAULT_TAIL_LINES = 1200;
const SCHEMA_VERSION = '2026-05-02';

export function buildSessionInspector(record, options = {}) {
  const observedAt = options.observedAt || new Date().toISOString();
  const session = sessionSummary(record);
  const diagnostics = [];
  const lifecycleEvents = [];
  let snapshot;

  if (!record || typeof record !== 'object') {
    diagnostics.push(adapterDiagnostic({
      observedAt,
      provider: 'codex',
      code: 'invalid_session_record',
      expected: ['provider session catalog record'],
      fallback: 'telemetry_unknown',
      severity: 'warn',
    }));
    return { session: null, telemetry: null, lifecycle_events: lifecycleEvents, diagnostics };
  }

  if (!record.source_file) {
    diagnostics.push(adapterDiagnostic({
      observedAt,
      provider: record.provider,
      sessionId: record.session_id,
      code: 'missing_source_file',
      expected: ['provider-session-catalog.source_file'],
      fallback: 'telemetry_unknown',
      severity: 'warn',
    }));
    return { session, telemetry: null, lifecycle_events: lifecycleEvents, diagnostics };
  }

  const lines = readJsonlTailLines(record.source_file, {
    maxBytes: options.maxBytes ?? DEFAULT_TAIL_BYTES,
    maxLines: options.maxLines ?? DEFAULT_TAIL_LINES,
  });
  if (!lines) {
    diagnostics.push(adapterDiagnostic({
      observedAt,
      provider: record.provider,
      sessionId: record.session_id,
      code: 'source_file_unreadable',
      expected: ['readable provider-session-catalog.source_file'],
      fallback: 'telemetry_unknown',
      severity: 'warn',
    }));
    return { session, telemetry: null, lifecycle_events: lifecycleEvents, diagnostics };
  }

  const extractionOptions = {
    observedAt,
    sessionId: record.session_id,
    cwd: record.cwd,
    sourceFile: record.source_file,
    providerVersion: options.providerVersion,
  };

  if (record.provider === 'codex') {
    const result = extractCodexTelemetryFromJsonlLines(lines, extractionOptions);
    snapshot = result.snapshot;
    diagnostics.push(...result.diagnostics);
    lifecycleEvents.push(...result.lifecycle_events);
  } else if (record.provider === 'claude-code') {
    const result = extractClaudeTranscriptTelemetryFromJsonlLines(lines, extractionOptions);
    snapshot = result.snapshot;
    diagnostics.push(...result.diagnostics);
    lifecycleEvents.push(...result.lifecycle_events);
  } else {
    diagnostics.push(adapterDiagnostic({
      observedAt,
      provider: record.provider,
      sessionId: record.session_id,
      code: 'unsupported_provider',
      expected: ['codex', 'claude-code'],
      fallback: 'telemetry_unknown',
      severity: 'warn',
    }));
  }

  return {
    session,
    telemetry: snapshot || null,
    lifecycle_events: lifecycleEvents,
    diagnostics,
  };
}

function sessionSummary(record) {
  if (!record || typeof record !== 'object') return null;
  const summary = {
    provider: String(record.provider || ''),
    session_id: String(record.session_id || ''),
    cwd: String(record.cwd || ''),
    updated_at: String(record.updated_at || ''),
  };
  for (const key of ['branch', 'created_at', 'last_message_at', 'source_file']) {
    if (typeof record[key] === 'string' && record[key]) summary[key] = record[key];
  }
  if (Array.isArray(record.resume_command)) {
    summary.resume_command = record.resume_command.map((part) => String(part));
  }
  return summary;
}

function readJsonlTailLines(file, options) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const bytesToRead = Math.min(options.maxBytes, size);
    const start = Math.max(0, size - bytesToRead);
    const buffer = Buffer.alloc(bytesToRead);
    const bytesRead = bytesToRead > 0 ? fs.readSync(fd, buffer, 0, bytesToRead, start) : 0;
    let text = buffer.subarray(0, bytesRead).toString('utf8');
    if (start > 0) {
      const firstNewline = text.indexOf('\n');
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : '';
    }
    return text.split(/\r?\n/).filter((line) => line.trim()).slice(-options.maxLines);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // Best-effort read-only inspector.
      }
    }
  }
}

function adapterDiagnostic({
  observedAt,
  provider,
  sessionId,
  code,
  expected,
  fallback,
  severity,
}) {
  const diagnostic = {
    type: 'agent.session.telemetry_mismatch',
    schema_version: SCHEMA_VERSION,
    observed_at: observedAt,
    provider: provider === 'claude-code' ? 'claude-code' : 'codex',
    source: 'aos_adapter',
    provider_surface: 'agent-terminal.session-inspector',
    code,
    expected,
    fallback,
    severity,
  };
  if (sessionId) diagnostic.session_id = String(sessionId);
  return diagnostic;
}
