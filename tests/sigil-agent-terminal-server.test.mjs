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
        { timestamp: '2026-05-01T13:11:00.000Z', type: 'response_item', payload: { type: 'message' } },
      ],
    );
    writeJsonl(
      path.join(homeDir, '.claude', 'projects', '-tmp-work-agent-os', 'claude-session.jsonl'),
      [
        { type: 'user', timestamp: '2026-05-01T14:00:00.000Z', sessionId: 'claude-session', cwd: repoCwd, gitBranch: 'main', message: { role: 'user', content: 'fixture' } },
        { type: 'assistant', timestamp: '2026-05-01T14:02:00.000Z', sessionId: 'claude-session', cwd: repoCwd, gitBranch: 'main', message: { role: 'assistant', content: 'fixture' } },
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
      ['claude-code:claude-session', 'codex:codex-session'],
    );
    const codexSession = payload.sessions.find((session) => session.provider === 'codex');
    assert.equal(codexSession.created_at, '2026-05-01T13:10:37.580Z');
    assert.equal(codexSession.last_message_at, '2026-05-01T13:11:00.000Z');
    const claudeSession = payload.sessions.find((session) => session.provider === 'claude-code');
    assert.equal(claudeSession.created_at, '2026-05-01T14:00:00.000Z');
    assert.equal(claudeSession.last_message_at, '2026-05-01T14:02:00.000Z');

    const codexResponse = await fetch(`http://127.0.0.1:${port}/sessions?cwd=${encodeURIComponent(repoCwd)}&provider=codex`);
    const codexPayload = await codexResponse.json();
    assert.deepEqual(codexPayload.sessions.map((session) => session.provider), ['codex']);
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
