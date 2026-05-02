import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

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
