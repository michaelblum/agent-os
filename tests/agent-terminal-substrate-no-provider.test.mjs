import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);

describe('Agent Terminal substrate validation without provider launch', () => {
  let root;
  let homeDir;
  let codexRoot;
  let claudeRoot;
  let worktree;
  let port;
  let bridge;
  let output;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-terminal-substrate-'));
    homeDir = path.join(root, 'home');
    codexRoot = path.join(root, 'codex-empty');
    claudeRoot = path.join(root, 'claude-empty');
    worktree = path.join(root, 'worktree');
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(codexRoot, { recursive: true });
    fs.mkdirSync(claudeRoot, { recursive: true });
    fs.mkdirSync(worktree, { recursive: true });
    port = await freePort();
    output = '';

    bridge = spawn(process.execPath, ['packages/toolkit/components/agent-terminal/bridge-server.mjs'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        AGENT_TERMINAL_PORT: String(port),
        AGENT_TERMINAL_DRIVER: 'process',
        AGENT_TERMINAL_TMUX_SESSION: 'agent-terminal-substrate',
        AGENT_TERMINAL_CWD: worktree,
        AGENT_TERMINAL_COMMAND: harmlessCommand('default-agent-terminal-session', worktree),
        AGENT_TERMINAL_CATALOG_HOME: homeDir,
        AGENT_TERMINAL_CODEX_ROOT: codexRoot,
        AGENT_TERMINAL_CLAUDE_ROOT: claudeRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    bridge.stdout.on('data', (chunk) => { output += chunk.toString('utf8'); });
    bridge.stderr.on('data', (chunk) => { output += chunk.toString('utf8'); });

    await waitForHealth(port, () => output);
  });

  afterEach(async () => {
    if (bridge && bridge.exitCode == null) {
      bridge.kill('SIGTERM');
      await new Promise((resolve) => bridge.once('exit', resolve));
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('observes process-driver session facts without provider catalog or telemetry claims', async () => {
    const session = 'agent-terminal-no-provider-session';
    const command = harmlessCommand(session, worktree);

    const healthResponse = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json();
    assert.equal(health.ok, true);
    assert.equal(health.driver, 'process');
    assert.equal(health.defaultSession, 'agent-terminal-substrate');
    assert.equal(health.defaultCwd, worktree);
    assert.equal(typeof health.pythonAvailable, 'boolean');

    const ensureResponse = await fetch(`http://127.0.0.1:${port}/ensure`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session,
        cwd: worktree,
        command,
        force: true,
      }),
    });
    assert.equal(ensureResponse.status, 200);
    const ensured = await ensureResponse.json();
    assert.equal(ensured.ok, true);
    assert.equal(ensured.session, session);
    assert.equal(ensured.created, true);
    assert.equal(ensured.driver, 'process');
    assert.equal(typeof ensured.child_pid, 'number');

    const snapshot = await waitForSnapshot(port, session, 'agent-terminal-substrate-marker');
    assert.equal(snapshot.session, session);
    assert.equal(snapshot.driver, 'process');
    assert.match(snapshot.text, /^\$ node -e /);
    assert.match(snapshot.text, /agent-terminal-substrate-marker/);
    assert.match(snapshot.text, new RegExp(escapeRegExp(`"session":"${session}"`)));
    assert.match(snapshot.text, new RegExp(escapeRegExp(`"cwd":"${worktree}"`)));
    assert.doesNotMatch(snapshot.text, /\b(codex|claude|gemini)\b/i);

    const sessionsResponse = await fetch(
      `http://127.0.0.1:${port}/sessions?cwd=${encodeURIComponent(worktree)}`,
    );
    assert.equal(sessionsResponse.status, 200);
    const catalog = await sessionsResponse.json();
    assert.deepEqual(catalog.sessions, []);

    const inspectorResponse = await fetch(
      `http://127.0.0.1:${port}/session-inspector?cwd=${encodeURIComponent(worktree)}&provider=codex&session_id=${session}`,
    );
    assert.equal(inspectorResponse.status, 404);
    assert.equal(await inspectorResponse.text(), `session not found: codex:${session}`);
  });
});

function harmlessCommand(session, cwd) {
  const payload = JSON.stringify({ marker: 'agent-terminal-substrate-marker', session, cwd });
  const encoded = Buffer.from(payload, 'utf8').toString('base64');
  return `node -e ${JSON.stringify(`console.log(Buffer.from(${JSON.stringify(encoded)}, 'base64').toString('utf8'));`)}`;
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

async function waitForSnapshot(activePort, session, marker) {
  const url = `http://127.0.0.1:${activePort}/snapshot?session=${encodeURIComponent(session)}&lines=80`;
  let lastText = '';
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(url);
    if (response.ok) {
      const snapshot = await response.json();
      lastText = snapshot.text;
      if (snapshot.text.includes(marker)) return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`snapshot did not include ${marker}:\n${lastText}`);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
