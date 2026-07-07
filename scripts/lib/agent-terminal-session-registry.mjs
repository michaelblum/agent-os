import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const AGENT_TERMINAL_SESSION_TYPE = 'aos.agent_terminal_session';
const AGENT_TERMINAL_OBSERVATION_TYPE = 'aos.agent_terminal_observation';
const DEFAULT_GEOMETRY = Object.freeze({ cols: 80, rows: 24 });
const DEFAULT_PROVIDER = 'codex';
const DEFAULT_PROVIDER_COMMAND = Object.freeze(['codex', '--no-alt-screen']);

function stableHash(value, length = 16) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, length);
}

function normalizeArgv(value) {
  if (Array.isArray(value)) {
    const parts = value.map((part) => String(part)).filter(Boolean);
    return parts.length ? parts : [...DEFAULT_PROVIDER_COMMAND];
  }
  if (typeof value === 'string' && value.trim()) {
    const parts = [];
    let current = '';
    let quote = null;
    for (const char of value.trim()) {
      if ((char === '"' || char === "'") && quote === null) {
        quote = char;
        continue;
      }
      if (char === quote) {
        quote = null;
        continue;
      }
      if (/\s/.test(char) && quote === null) {
        if (current) {
          parts.push(current);
          current = '';
        }
        continue;
      }
      current += char;
    }
    if (current) parts.push(current);
    return parts.length ? parts : [...DEFAULT_PROVIDER_COMMAND];
  }
  return [...DEFAULT_PROVIDER_COMMAND];
}

function normalizeGeometry(value = {}) {
  const cols = Number(value.cols ?? value.columns ?? DEFAULT_GEOMETRY.cols);
  const rows = Number(value.rows ?? DEFAULT_GEOMETRY.rows);
  return {
    cols: Number.isFinite(cols) ? Math.max(20, Math.min(300, Math.trunc(cols))) : DEFAULT_GEOMETRY.cols,
    rows: Number.isFinite(rows) ? Math.max(8, Math.min(120, Math.trunc(rows))) : DEFAULT_GEOMETRY.rows,
  };
}

function normalizeLifecycle(value = {}) {
  return {
    state: value.state ?? 'running',
    started_at: value.started_at ?? value.startedAt ?? null,
    last_attached_at: value.last_attached_at ?? value.lastAttachedAt ?? null,
    last_detached_at: value.last_detached_at ?? value.lastDetachedAt ?? null,
    retired_at: value.retired_at ?? value.retiredAt ?? null,
  };
}

function normalizeLease(value = {}) {
  return {
    holder: value.holder ?? 'agent_terminal',
    purpose: value.purpose ?? 'observation',
    disposition: value.disposition ?? value.cleanup_disposition ?? value.cleanupDisposition ?? 'returned_to_idle',
  };
}

function createAgentTerminalSessionReceipt(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const provider = options.provider ?? DEFAULT_PROVIDER;
  const providerCommand = normalizeArgv(options.providerCommand ?? options.provider_command ?? options.command);
  const geometry = normalizeGeometry(options.geometry ?? options.pty);
  const cwd = resolve(options.cwd ?? repoRoot);
  const lifecycle = normalizeLifecycle(options.lifecycle);
  const lease = normalizeLease(options.lease);
  const ptyHandle = options.ptyHandle
    ?? options.pty_handle
    ?? options.sessionHandle
    ?? options.session_handle
    ?? 'agent-terminal:fixture-pty';
  const agentTerminalSessionId = options.agentTerminalSessionId
    ?? options.agent_terminal_session_id
    ?? `agent-terminal:${stableHash({
      repoRoot,
      cwd,
      provider,
      providerCommand,
      ptyHandle,
    })}`;

  return {
    record_type: AGENT_TERMINAL_SESSION_TYPE,
    agent_terminal_session_id: agentTerminalSessionId,
    session_id: agentTerminalSessionId,
    cwd,
    provider,
    provider_command: providerCommand,
    pty: {
      driver: options.ptyDriver ?? options.pty_driver ?? options.driver ?? 'aos_pty',
      handle: ptyHandle,
      cols: geometry.cols,
      rows: geometry.rows,
    },
    lifecycle,
    lease,
  };
}

function createAgentTerminalObservation(receipt, options = {}) {
  if (!receipt || receipt.record_type !== AGENT_TERMINAL_SESSION_TYPE) {
    throw new Error('Agent Terminal observation requires an aos.agent_terminal_session receipt');
  }
  return {
    record_type: AGENT_TERMINAL_OBSERVATION_TYPE,
    agent_terminal_session_id: receipt.agent_terminal_session_id,
    rendered_by: 'agent_terminal',
    attach_state: options.attachState ?? options.attach_state ?? 'attached',
    cwd: receipt.cwd,
    command: receipt.provider_command,
    geometry: {
      cols: receipt.pty.cols,
      rows: receipt.pty.rows,
    },
    lifecycle: receipt.lifecycle,
    lease: receipt.lease,
    rail: {
      provider_sessions_visible: Boolean(options.providerSessionsVisible ?? options.provider_sessions_visible ?? true),
      selected_provider_session_id: options.selectedProviderSessionId ?? options.selected_provider_session_id ?? null,
    },
    acceptance_role: 'human_observability_only',
    provider_acceptance: {
      status: 'not_evidence',
      reason: 'Agent Terminal visual state is not provider acceptance evidence',
    },
  };
}

export {
  AGENT_TERMINAL_OBSERVATION_TYPE,
  AGENT_TERMINAL_SESSION_TYPE,
  createAgentTerminalObservation,
  createAgentTerminalSessionReceipt,
};
