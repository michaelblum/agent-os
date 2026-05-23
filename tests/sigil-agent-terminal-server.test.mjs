import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { appendProcessStderr } from '../apps/sigil/codex-terminal/server.mjs';

describe('Sigil Agent Terminal bridge', () => {
  let root;
  let homeDir;
  let repoCwd;
  let port;
  let child;
  let output;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sigil-agent-terminal-'));
    homeDir = path.join(root, 'home');
    repoCwd = path.join(root, 'work', 'agent-os');
    fs.mkdirSync(repoCwd, { recursive: true });
    port = await freePort();
    output = '';

    writeJsonl(
      path.join(homeDir, '.codex', 'sessions', '2026', '05', '01', 'rollout-2026-05-01T09-10-08-codex-session.jsonl'),
      [
        { timestamp: '2026-05-01T13:10:37.580Z', type: 'session_meta', payload: { id: 'codex-session', cwd: repoCwd, git: { branch: 'main' } } },
        {
          timestamp: '2026-05-01T13:11:00.000Z',
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              total_token_usage: {
                input_tokens: 12000,
                cached_input_tokens: 2000,
                output_tokens: 400,
                total_tokens: 12400,
              },
              model_context_window: 258400,
            },
          },
        },
      ],
    );
    writeJsonl(
      path.join(homeDir, '.codex', 'sessions', '2026', '05', '01', 'rollout-2026-05-01T10-00-00-codex-drift.jsonl'),
      [
        { timestamp: '2026-05-01T13:20:00.000Z', type: 'session_meta', payload: { id: 'codex-drift', cwd: repoCwd, git: { branch: 'main' } } },
        { timestamp: '2026-05-01T13:21:00.000Z', type: 'event_msg', payload: { type: 'token_count' } },
      ],
    );
    writeJsonl(
      path.join(homeDir, '.codex', 'sessions', '2026', '05', '01', 'rollout-2026-05-01T11-00-00-codex-other-cwd.jsonl'),
      [
        {
          timestamp: '2026-05-01T15:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: 'codex-other-cwd',
            cwd: path.join(root, 'work', 'other'),
            git: { branch: 'operator' },
          },
        },
      ],
    );
    writeJsonl(
      path.join(homeDir, '.claude', 'projects', '-tmp-work-agent-os', 'claude-session.jsonl'),
      [
        { type: 'user', timestamp: '2026-05-01T14:00:00.000Z', sessionId: 'claude-session', cwd: repoCwd, gitBranch: 'main', message: { role: 'user', content: 'fixture' } },
        {
          type: 'assistant',
          timestamp: '2026-05-01T14:02:00.000Z',
          sessionId: 'claude-session',
          cwd: repoCwd,
          gitBranch: 'main',
          message: {
            role: 'assistant',
            content: 'fixture',
            model: 'claude-opus-4-7',
            usage: {
              input_tokens: 6,
              cache_creation_input_tokens: 11000,
              cache_read_input_tokens: 16256,
              output_tokens: 209,
            },
          },
        },
        {
          timestamp: '2026-05-01T14:03:00.000Z',
          sessionId: 'claude-session',
          cwd: repoCwd,
          compactMetadata: {
            trigger: 'manual',
            preTokens: 165246,
            postTokens: 23229,
            durationMs: 97699,
          },
        },
      ],
    );

    child = spawn('node', ['apps/sigil/codex-terminal/server.mjs'], {
      cwd: path.resolve('.'),
      env: {
        ...process.env,
        SIGIL_AGENT_TERMINAL_PORT: String(port),
        SIGIL_AGENT_TERMINAL_DRIVER: 'process',
        SIGIL_AGENT_TMUX_SESSION: 'sigil-agent-terminal-test',
        SIGIL_AGENT_CWD: repoCwd,
        SIGIL_AGENT_COMMAND: 'node -e "setTimeout(() => {}, 100)"',
        SIGIL_AGENT_CATALOG_HOME: homeDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => { output += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { output += chunk.toString('utf8'); });

    await waitForHealth(port, () => output);
  });

  afterEach(async () => {
    if (child && child.exitCode == null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('lists provider catalog sessions for the rail', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/sessions?cwd=${encodeURIComponent(repoCwd)}`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.scope, 'cwd');
    assert.equal(payload.cwd_filter, repoCwd);
    assert.deepEqual(
      payload.sessions.map((session) => `${session.provider}:${session.session_id}`).sort(),
      ['claude-code:claude-session', 'codex:codex-drift', 'codex:codex-session'],
    );
    const codexSession = payload.sessions.find((session) => session.session_id === 'codex-session');
    assert.equal(codexSession.created_at, '2026-05-01T13:10:37.580Z');
    assert.equal(codexSession.last_message_at, '2026-05-01T13:11:00.000Z');
    const claudeSession = payload.sessions.find((session) => session.provider === 'claude-code');
    assert.equal(claudeSession.created_at, '2026-05-01T14:00:00.000Z');
    assert.equal(claudeSession.last_message_at, '2026-05-01T14:03:00.000Z');

    const codexResponse = await fetch(`http://127.0.0.1:${port}/sessions?cwd=${encodeURIComponent(repoCwd)}&provider=codex`);
    const codexPayload = await codexResponse.json();
    assert.deepEqual(codexPayload.sessions.map((session) => session.provider), ['codex', 'codex']);
  });

  it('keeps omitted cwd catalog queries scoped to the bridge default cwd', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/sessions?provider=codex`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.scope, 'cwd');
    assert.equal(payload.cwd_filter, repoCwd);
    assert.deepEqual(
      payload.sessions.map((session) => session.session_id).sort(),
      ['codex-drift', 'codex-session'],
    );
  });

  it('exposes dock terminal session observation without provider acceptance authority', async () => {
    const response = await fetch(
      `http://127.0.0.1:${port}/dock-terminal-session?dock=gdi&session=sigil-agent-terminal-test&provider_session_id=codex-session`,
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.dock_terminal_session.record_type, 'aos.dock_terminal_session');
    assert.equal(payload.dock_terminal_session.dock, 'gdi');
    assert.match(payload.dock_terminal_session.dock_terminal_session_id, /^dock-terminal:gdi:[a-f0-9]{16}$/);
    assert.equal(payload.dock_terminal_session.cwd, path.join(process.cwd(), '.docks/gdi'));
    assert.deepEqual(payload.dock_terminal_session.provider_command, ['node', '-e', 'setTimeout(() => {}, 100)']);
    assert.deepEqual(payload.agent_terminal_observation.geometry, { cols: 80, rows: 24 });
    assert.equal(payload.agent_terminal_observation.lease.disposition, 'returned_to_idle');
    assert.equal(payload.agent_terminal_observation.acceptance_role, 'human_observability_only');
    assert.equal(payload.agent_terminal_observation.provider_acceptance.status, 'not_evidence');
    assert.equal(payload.agent_terminal_observation.rail.selected_provider_session_id, 'codex-session');
  });

  it('supports explicit all-cwd provider catalog queries', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/sessions?provider=codex&all_cwd=true`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.scope, 'all_cwd');
    assert.equal(payload.cwd_filter, null);
    assert.deepEqual(
      payload.sessions.map((session) => session.session_id).sort(),
      ['codex-drift', 'codex-other-cwd', 'codex-session'],
    );
    assert.equal(new Set(payload.sessions.map((session) => session.cwd)).size, 2);
    assert.deepEqual([...new Set(payload.sessions.map((session) => session.provider))], ['codex']);
  });

  it('filters providers in all-cwd catalog queries', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/sessions?provider=claude-code&all_cwd=true`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.scope, 'all_cwd');
    assert.deepEqual(
      payload.sessions.map((session) => `${session.provider}:${session.session_id}`),
      ['claude-code:claude-session'],
    );
  });

  it('returns sanitized session inspector telemetry for selected sessions', async () => {
    const codexResponse = await fetch(
      `http://127.0.0.1:${port}/session-inspector?cwd=${encodeURIComponent(repoCwd)}&provider=codex&session_id=codex-session`,
    );
    assert.equal(codexResponse.status, 200);
    const codexPayload = await codexResponse.json();
    assert.equal(codexPayload.session.provider, 'codex');
    assert.equal(codexPayload.telemetry.context.window_tokens.value, 258400);
    assert.equal(codexPayload.telemetry.context.used_tokens.value, 12400);
    assert.equal(codexPayload.telemetry.context.remaining_tokens.value, 246000);
    assert.equal(codexPayload.telemetry.context.used_tokens.source.stability, 'provider-local');
    assert.deepEqual(codexPayload.diagnostics, []);

    const claudeResponse = await fetch(
      `http://127.0.0.1:${port}/session-inspector?cwd=${encodeURIComponent(repoCwd)}&provider=claude-code&session_id=claude-session`,
    );
    assert.equal(claudeResponse.status, 200);
    const claudePayload = await claudeResponse.json();
    assert.equal(claudePayload.session.provider, 'claude-code');
    assert.equal(claudePayload.telemetry.model.id, 'claude-opus-4-7');
    assert.equal(claudePayload.telemetry.context.used_tokens.value, 27262);
    assert.equal(claudePayload.telemetry.context.used_tokens.source.precision, 'derived');
    assert.equal(claudePayload.lifecycle_events[0].event, 'context_compacted');
    assert.equal(claudePayload.lifecycle_events[0].pre_tokens.value, 165246);
    assert.equal(JSON.stringify(claudePayload).includes('fixture'), false);
  });

  it('surfaces provider drift diagnostics in the session inspector', async () => {
    const response = await fetch(
      `http://127.0.0.1:${port}/session-inspector?cwd=${encodeURIComponent(repoCwd)}&provider=codex&session_id=codex-drift`,
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.session.session_id, 'codex-drift');
    assert.equal(payload.telemetry.context, undefined);
    assert.equal(payload.diagnostics[0].type, 'agent.session.telemetry_mismatch');
    assert.equal(payload.diagnostics[0].code, 'codex_token_count_missing_info');
    assert.equal(payload.diagnostics[0].fallback, 'context_unavailable');
  });

  it('accepts provider resume commands as argv arrays', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/ensure`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session: 'sigil-agent-terminal-test',
        cwd: repoCwd,
        command: ['node', '-e', 'setTimeout(() => {}, 50)'],
        force: true,
      }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.driver, 'process');
  });

  it('submits process-driver /input text with Enter to the PTY', async () => {
    const session = 'sigil-agent-terminal-input-test';
    await ensureInteractiveEchoSession(port, session, repoCwd);

    const inputResponse = await fetch(`http://127.0.0.1:${port}/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session,
        text: 'input-marker',
      }),
    });
    assert.equal(inputResponse.status, 200);
    const inputPayload = await inputResponse.json();
    assert.equal(inputPayload.ok, true);
    assert.equal(inputPayload.driver, 'process');
    assert.equal(inputPayload.session_exists, true);
    assert.equal(inputPayload.text_bytes, Buffer.byteLength('input-marker'));
    assert.equal(inputPayload.text_accepted, true);
    assert.equal(inputPayload.enter_sent, true);
    assert.equal(inputPayload.enter_bytes, 1);
    assert.equal(inputPayload.enter_accepted, true);

    const snapshot = await waitForSnapshot(port, session, 'got:input-marker');
    assert.equal(snapshot.driver, 'process');
    assert.match(snapshot.text, /got:input-marker/);
  });

  it('submits process-driver text through /input enter=false plus /key Enter', async () => {
    const session = 'sigil-agent-terminal-key-test';
    await ensureInteractiveEchoSession(port, session, repoCwd);

    const inputResponse = await fetch(`http://127.0.0.1:${port}/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session,
        text: 'key-marker',
        enter: false,
      }),
    });
    assert.equal(inputResponse.status, 200);
    const inputPayload = await inputResponse.json();
    assert.equal(inputPayload.ok, true);
    assert.equal(inputPayload.driver, 'process');
    assert.equal(inputPayload.session_exists, true);
    assert.equal(inputPayload.text_bytes, Buffer.byteLength('key-marker'));
    assert.equal(inputPayload.text_accepted, true);
    assert.equal(inputPayload.enter_sent, false);
    assert.equal(inputPayload.enter_bytes, 0);
    assert.equal(inputPayload.enter_accepted, null);

    const keyResponse = await fetch(`http://127.0.0.1:${port}/key`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session,
        key: 'Enter',
      }),
    });
    assert.equal(keyResponse.status, 200);
    const keyPayload = await keyResponse.json();
    assert.equal(keyPayload.ok, true);
    assert.equal(keyPayload.driver, 'process');
    assert.equal(keyPayload.session_exists, true);
    assert.equal(keyPayload.key, 'Enter');
    assert.equal(keyPayload.key_bytes, 1);
    assert.equal(keyPayload.key_accepted, true);

    const snapshot = await waitForSnapshot(port, session, 'got:key-marker');
    assert.equal(snapshot.driver, 'process');
    assert.match(snapshot.text, /got:key-marker/);
  });

  it('submits input and Enter to a raw no-echo full-screen-ish PTY fixture', async () => {
    const session = 'sigil-agent-terminal-raw-test';
    await ensureRawTuiSession(port, session, repoCwd);

    const readySnapshot = await waitForSnapshot(port, session, 'size:');
    assert.equal(readySnapshot.driver, 'process');
    assert.deepEqual(readySnapshot.terminal, { cols: 80, rows: 24 });
    assert.match(readySnapshot.text, /size:80x24/);

    const inputResponse = await fetch(`http://127.0.0.1:${port}/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session,
        text: 'raw-marker',
      }),
    });
    assert.equal(inputResponse.status, 200);
    const inputPayload = await inputResponse.json();
    assert.equal(inputPayload.ok, true);
    assert.equal(inputPayload.text_bytes, Buffer.byteLength('raw-marker'));
    assert.equal(inputPayload.enter_sent, true);
    assert.equal(inputPayload.enter_bytes, 1);

    const snapshot = await waitForSnapshot(port, session, 'raw-submit:raw-marker');
    assert.doesNotMatch(snapshot.text, /raw-markerraw-submit/);
    assert.match(snapshot.text, /raw-submit:raw-marker/);
  });

  it('resizes a process-driver PTY and preserves key delivery after enter=false input', async () => {
    const session = 'sigil-agent-terminal-raw-resize-test';
    await ensureRawTuiSession(port, session, repoCwd);
    await waitForSnapshot(port, session, 'size:');

    const resizeResponse = await fetch(`http://127.0.0.1:${port}/resize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session,
        cols: 100,
        rows: 31,
      }),
    });
    assert.equal(resizeResponse.status, 200);
    const resizePayload = await resizeResponse.json();
    assert.equal(resizePayload.ok, true);
    assert.equal(resizePayload.driver, 'process');
    assert.equal(resizePayload.cols, 100);
    assert.equal(resizePayload.rows, 31);
    assert.equal(resizePayload.resize_accepted, true);

    const inputResponse = await fetch(`http://127.0.0.1:${port}/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session,
        text: 'raw-key-marker',
        enter: false,
      }),
    });
    assert.equal(inputResponse.status, 200);
    const inputPayload = await inputResponse.json();
    assert.equal(inputPayload.enter_sent, false);

    const keyResponse = await fetch(`http://127.0.0.1:${port}/key`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session,
        key: 'Enter',
      }),
    });
    assert.equal(keyResponse.status, 200);
    const keyPayload = await keyResponse.json();
    assert.equal(keyPayload.key_accepted, true);

    const snapshot = await waitForSnapshot(port, session, 'raw-submit:raw-key-marker');
    assert.deepEqual(snapshot.terminal, { cols: 100, rows: 31 });
    assert.match(snapshot.text, /resize:100x31/);
    assert.match(snapshot.text, /raw-submit:raw-key-marker/);
  });

  it('forwards input coalesced after a pty-proxy control frame', async () => {
    const script = [
      'process.stdin.setEncoding("utf8");',
      'if (process.stdin.isTTY) process.stdin.setRawMode(true);',
      'let buffer = "";',
      'process.stdout.write(`size:${process.stdout.columns}x${process.stdout.rows}\\r\\n`);',
      'process.stdin.on("data", (chunk) => {',
      '  for (const char of chunk) {',
      '    if (char === "\\r" || char === "\\n") {',
      '      process.stdout.write(`raw-submit:${buffer}\\r\\n`);',
      '      buffer = "";',
      '    } else {',
      '      buffer += char;',
      '    }',
      '  }',
      '});',
      'setTimeout(() => {}, 10000);',
    ].join(' ');
    const proxy = spawn('python3', [
      'apps/sigil/codex-terminal/pty-proxy.py',
      `${shellQuote(process.execPath)} -e ${shellQuote(script)}`,
    ], {
      cwd: path.resolve('.'),
      env: {
        ...process.env,
        SIGIL_AGENT_TERMINAL_COLS: '80',
        SIGIL_AGENT_TERMINAL_ROWS: '24',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let proxyOutput = '';
    proxy.stdout.on('data', (chunk) => { proxyOutput += chunk.toString('utf8'); });
    proxy.stderr.on('data', (chunk) => { proxyOutput += chunk.toString('utf8'); });

    try {
      await waitForText(() => proxyOutput, 'size:80x24');
      proxy.stdin.write(Buffer.concat([
        Buffer.from('\0{"type":"resize","cols":100,"rows":31}', 'utf8'),
        Buffer.from('coalesced-marker\r', 'utf8'),
      ]));
      await waitForText(() => proxyOutput, 'raw-submit:coalesced-marker');
      assert.doesNotMatch(proxyOutput, /coalesced-markerraw-submit/);

      proxy.stdin.write(Buffer.from('\0{"type":"resize",', 'utf8'));
      proxy.stdin.write(Buffer.from('"cols":90,"rows":30}partial-marker\r', 'utf8'));
      await waitForText(() => proxyOutput, 'raw-submit:partial-marker');
      assert.doesNotMatch(proxyOutput, /partial-markerraw-submit/);
    } finally {
      if (proxy.exitCode == null) {
        proxy.kill('SIGTERM');
        await new Promise((resolve) => proxy.once('exit', resolve));
      }
    }
  });

  it('drops oversized malformed pty-proxy control frames and resumes stdin forwarding', async () => {
    const script = [
      'process.stdin.setEncoding("utf8");',
      'if (process.stdin.isTTY) process.stdin.setRawMode(true);',
      'let buffer = "";',
      'process.stdout.write("raw-ready\\r\\n");',
      'process.stdin.on("data", (chunk) => {',
      '  for (const char of chunk) {',
      '    if (char === "\\r" || char === "\\n") {',
      '      process.stdout.write(`raw-submit:${buffer.slice(-32)}\\r\\n`);',
      '      buffer = "";',
      '    } else {',
      '      buffer += char;',
      '    }',
      '  }',
      '});',
      'setTimeout(() => {}, 10000);',
    ].join(' ');
    const proxy = spawn('python3', [
      'apps/sigil/codex-terminal/pty-proxy.py',
      `${shellQuote(process.execPath)} -e ${shellQuote(script)}`,
    ], {
      cwd: path.resolve('.'),
      env: {
        ...process.env,
        SIGIL_AGENT_TERMINAL_COLS: '80',
        SIGIL_AGENT_TERMINAL_ROWS: '24',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let proxyOutput = '';
    proxy.stdout.on('data', (chunk) => { proxyOutput += chunk.toString('utf8'); });
    proxy.stderr.on('data', (chunk) => { proxyOutput += chunk.toString('utf8'); });

    try {
      await waitForText(() => proxyOutput, 'raw-ready');
      proxy.stdin.write(Buffer.concat([
        Buffer.from('\0{"type":"resize","cols":100,"rows":', 'utf8'),
        Buffer.alloc(4100, 'x'),
      ]));
      proxy.stdin.write(Buffer.alloc(4100, 'x'));
      await new Promise((resolve) => setTimeout(resolve, 100));
      proxy.stdin.write(Buffer.from('oversize-marker\r', 'utf8'));
      await waitForText(() => proxyOutput, 'raw-submit:oversize-marker');
    } finally {
      if (proxy.exitCode == null) {
        proxy.kill('SIGTERM');
        await new Promise((resolve) => proxy.once('exit', resolve));
      }
    }
  });
});

describe('Sigil Agent Terminal PTY child PID marker parsing', () => {
  it('sets commandPid once and surfaces later marker-shaped stderr as output', () => {
    const record = {
      buffer: '',
      clients: new Set(),
      commandPid: null,
    };
    appendProcessStderr(record, Buffer.from('SIGIL_AGENT_PTY_CHILD_PID=111\n', 'utf8'));
    assert.equal(record.commandPid, 111);
    assert.equal(record.buffer, '');

    appendProcessStderr(record, Buffer.from('SIGIL_AGENT_PTY_CHILD_PID=222\nordinary stderr\n', 'utf8'));
    assert.equal(record.commandPid, 111);
    assert.equal(record.buffer, 'SIGIL_AGENT_PTY_CHILD_PID=222\nordinary stderr\n');
  });
});

function writeJsonl(file, records) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
}

async function freePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function waitForHealth(activePort, readOutput) {
  const url = `http://127.0.0.1:${activePort}/health`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`bridge did not become healthy:\n${readOutput()}`);
}

async function ensureInteractiveEchoSession(activePort, session, cwd) {
  const command = [
    'node',
    '-e',
    [
      "const readline = require('node:readline');",
      'const rl = readline.createInterface({ input: process.stdin });',
      "rl.on('line', (line) => console.log(`got:${line}`));",
      'setTimeout(() => {}, 10000);',
    ].join(' '),
  ];
  const response = await fetch(`http://127.0.0.1:${activePort}/ensure`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      session,
      cwd,
      command,
      force: true,
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.driver, 'process');
}

async function ensureRawTuiSession(activePort, session, cwd) {
  const command = [
    'node',
    '-e',
    [
      'process.stdin.setEncoding("utf8");',
      'if (process.stdin.isTTY) process.stdin.setRawMode(true);',
      'const renderSize = (label) => process.stdout.write(`\\x1b[2J\\x1b[H${label}:${process.stdout.columns}x${process.stdout.rows}\\r\\n`);',
      'renderSize("size");',
      'process.stdout.write("raw-ready\\r\\n");',
      'let buffer = "";',
      'process.stdout.on("resize", () => renderSize("resize"));',
      'process.stdin.on("data", (chunk) => {',
      '  for (const char of chunk) {',
      '    if (char === "\\r" || char === "\\n") {',
      '      process.stdout.write(`raw-submit:${buffer}\\r\\n`);',
      '      buffer = "";',
      '    } else {',
      '      buffer += char;',
      '    }',
      '  }',
      '});',
      'setTimeout(() => {}, 10000);',
    ].join(' '),
  ];
  const response = await fetch(`http://127.0.0.1:${activePort}/ensure`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      session,
      cwd,
      command,
      force: true,
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.driver, 'process');
}

async function waitForSnapshot(activePort, session, marker) {
  const url = `http://127.0.0.1:${activePort}/snapshot?session=${encodeURIComponent(session)}&lines=80`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(url);
    if (response.ok) {
      const snapshot = await response.json();
      if (snapshot.text.includes(marker)) return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`snapshot did not include ${marker}`);
}

async function waitForText(readText, marker) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const text = readText();
    if (text.includes(marker)) return text;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`output did not include ${marker}:\n${readText()}`);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
