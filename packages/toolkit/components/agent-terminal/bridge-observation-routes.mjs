import {
  createAgentTerminalObservation,
  createDockTerminalSessionReceipt,
} from '../../../../scripts/lib/dock-terminal-session-registry.mjs';
import { appendAgentTerminalProvenanceEvent } from '../../../../scripts/aos-provenance-ledger.mjs';

function envValue(env, name, fallback) {
  const value = env[name];
  if (value !== undefined && value !== '') return value;
  return fallback;
}

export function healthResponse(options = {}) {
  const {
    defaultSession,
    defaultCwd,
    defaultTerminalSize,
    terminalManager,
  } = options;
  const driver = terminalManager.activeDriver();
  return {
    ok: true,
    defaultSession,
    defaultCwd,
    driver,
    tmuxAvailable: terminalManager.tmuxAvailable,
    scriptAvailable: terminalManager.scriptAvailable,
    pythonAvailable: terminalManager.pythonAvailable,
    terminal: driver === 'process' ? { ...defaultTerminalSize } : null,
  };
}

export function dockTerminalSessionResponseForUrl(url, options = {}) {
  const {
    defaultRepoRoot,
    defaultSession,
    env = process.env,
    terminalManager,
  } = options;
  const dock = url.searchParams.get('dock') || envValue(env, 'AGENT_TERMINAL_DOCK', 'gdi');
  const session = terminalManager.cleanSession(url.searchParams.get('session') || defaultSession);
  const command = terminalManager.terminalCommandForSession(session);
  const explicitDockCwd = url.searchParams.get('cwd') || envValue(env, 'AGENT_TERMINAL_DOCK_CWD', undefined);
  const receipt = createDockTerminalSessionReceipt({
    repoRoot: defaultRepoRoot,
    dock,
    cwd: explicitDockCwd || terminalManager.terminalCwdForSession(session),
    provider: url.searchParams.get('provider') || 'codex',
    providerCommand: command,
    ptyHandle: session,
    ptyDriver: terminalManager.activeDriver() === 'process'
      ? 'aos_pty_process_fixture'
      : 'aos_pty_tmux_fixture',
    geometry: terminalManager.terminalGeometryForSession(session),
    lease: {
      holder: url.searchParams.get('lease_holder') || 'agent_terminal',
      purpose: url.searchParams.get('lease_purpose') || 'observation',
      disposition: url.searchParams.get('lease_disposition') || 'returned_to_idle',
    },
  });
  appendAgentTerminalProvenanceEvent({
    kind: 'session',
    session_event: 'observed',
    dock,
    dock_terminal_session_id: receipt.dock_terminal_session_id,
    pty_handle: receipt.pty.handle,
    pty_driver: receipt.pty.driver,
    provider: receipt.provider,
    provider_command: receipt.provider_command,
    cwd: receipt.cwd,
  }, {
    dock,
    repo: defaultRepoRoot,
    state_root: env.AOS_STATE_ROOT,
    runtime_mode: env.AOS_RUNTIME_MODE,
  });
  return {
    dock_terminal_session: receipt,
    agent_terminal_observation: createAgentTerminalObservation(receipt, {
      selectedProviderSessionId: url.searchParams.get('provider_session_id') || null,
    }),
  };
}
