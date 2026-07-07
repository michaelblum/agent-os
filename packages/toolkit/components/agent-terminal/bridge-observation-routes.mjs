import {
  createAgentTerminalObservation,
  createAgentTerminalSessionReceipt,
} from '../../../../scripts/lib/agent-terminal-session-registry.mjs';

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

export function agentTerminalSessionResponseForUrl(url, options = {}) {
  const {
    defaultRepoRoot,
    defaultSession,
    env = process.env,
    terminalManager,
  } = options;
  const session = terminalManager.cleanSession(url.searchParams.get('session') || defaultSession);
  const command = terminalManager.terminalCommandForSession(session);
  const explicitSessionCwd = url.searchParams.get('cwd') || envValue(env, 'AGENT_TERMINAL_SESSION_CWD', undefined);
  const receipt = createAgentTerminalSessionReceipt({
    repoRoot: defaultRepoRoot,
    cwd: explicitSessionCwd || terminalManager.terminalCwdForSession(session),
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
  return {
    agent_terminal_session: receipt,
    agent_terminal_observation: createAgentTerminalObservation(receipt, {
      selectedProviderSessionId: url.searchParams.get('provider_session_id') || null,
    }),
  };
}
