import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const RECORD_TYPE = 'aos.dock_terminal_session';
const AGENT_TERMINAL_OBSERVATION_TYPE = 'aos.agent_terminal_observation';
const KNOWN_DOCKS = new Set(['foreman', 'gdi', 'operator']);
const DEFAULT_GEOMETRY = Object.freeze({ cols: 80, rows: 24 });
const DEFAULT_PROVIDER = 'codex';
const DEFAULT_PROVIDER_COMMAND = Object.freeze(['codex', '--no-alt-screen']);

function stableHash(value, length = 16) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, length);
}

function assertDock(dock) {
  const normalized = String(dock || '').trim().toLowerCase();
  if (!KNOWN_DOCKS.has(normalized)) {
    throw new Error(`Unsupported dock terminal session dock: ${dock}`);
  }
  return normalized;
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
    holder: value.holder ?? 'idle',
    purpose: value.purpose ?? 'warm_dock_tui_reuse',
    disposition: value.disposition ?? value.cleanup_disposition ?? value.cleanupDisposition ?? 'returned_to_idle',
  };
}

function dockCwd(repoRoot, dock, cwd) {
  return resolve(cwd ?? join(repoRoot, '.docks', dock));
}

function createDockTerminalSessionReceipt(options = {}) {
  const dock = assertDock(options.dock);
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const provider = options.provider ?? DEFAULT_PROVIDER;
  const providerCommand = normalizeArgv(options.providerCommand ?? options.provider_command ?? options.command);
  const geometry = normalizeGeometry(options.geometry ?? options.pty);
  const cwd = dockCwd(repoRoot, dock, options.cwd);
  const lifecycle = normalizeLifecycle(options.lifecycle);
  const lease = normalizeLease(options.lease);
  const ptyHandle = options.ptyHandle ?? options.pty_handle ?? options.sessionHandle ?? options.session_handle ?? `${dock}:fixture-pty`;
  const dockTerminalSessionId = options.dockTerminalSessionId
    ?? options.dock_terminal_session_id
    ?? `dock-terminal:${dock}:${stableHash({
      repoRoot,
      dock,
      cwd,
      provider,
      providerCommand,
      ptyHandle,
    })}`;

  return {
    record_type: RECORD_TYPE,
    dock,
    dock_terminal_session_id: dockTerminalSessionId,
    session_id: dockTerminalSessionId,
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

function createFixtureDockTerminalSessions(options = {}) {
  const docks = options.docks ?? [...KNOWN_DOCKS];
  return Object.fromEntries(docks.map((dock) => [
    dock,
    createDockTerminalSessionReceipt({
      ...options,
      dock,
      ptyHandle: options.ptyHandle ?? options.pty_handle ?? `${dock}:fixture-pty`,
    }),
  ]));
}

function createAgentTerminalObservation(receipt, options = {}) {
  if (!receipt || receipt.record_type !== RECORD_TYPE) {
    throw new Error('Agent Terminal observation requires an aos.dock_terminal_session receipt');
  }
  return {
    record_type: AGENT_TERMINAL_OBSERVATION_TYPE,
    dock_terminal_session_id: receipt.dock_terminal_session_id,
    dock: receipt.dock,
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
  RECORD_TYPE,
  createAgentTerminalObservation,
  createDockTerminalSessionReceipt,
  createFixtureDockTerminalSessions,
};
