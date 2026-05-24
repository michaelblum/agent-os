#!/usr/bin/env node
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  dockTerminalSessionResponseForUrl,
  healthResponse,
} from './bridge-observation-routes.mjs';
import {
  providerSessionsResponseForUrl,
  sessionInspectorResponseForUrl,
} from './provider-session-routes.mjs';
import {
  appendProcessStderr,
  boundedInt,
  createTerminalSessionManager,
} from './terminal-session-manager.mjs';

function envValue(name, fallback) {
  const value = process.env[name];
  if (value !== undefined && value !== '') return value;
  return fallback;
}

const port = Number(envValue('AGENT_TERMINAL_PORT', process.env.PORT || 17761));
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const ptyProxyPath = path.join(scriptDir, 'pty-proxy.py');
const defaultSession = envValue('AGENT_TERMINAL_TMUX_SESSION', 'aos-agent-terminal-agent-os');
const defaultCwd = envValue('AGENT_TERMINAL_CWD', process.cwd());
const defaultCommand = envValue('AGENT_TERMINAL_COMMAND', 'codex --no-alt-screen');
const defaultRepoRoot = envValue('AGENT_TERMINAL_REPO_ROOT', process.cwd());
const requestedDriver = envValue('AGENT_TERMINAL_DRIVER', 'auto');
const defaultTerminalSize = {
  cols: boundedInt(envValue('AGENT_TERMINAL_COLS', undefined), 80, 20, 300),
  rows: boundedInt(envValue('AGENT_TERMINAL_ROWS', undefined), 24, 8, 120),
};
const allowedKeys = new Set([
  'Enter',
  'C-c',
  'C-d',
  'Up',
  'Down',
  'Left',
  'Right',
  'Tab',
  'Escape',
  'Backspace',
]);
const terminalManager = createTerminalSessionManager({
  defaultSession,
  defaultCwd,
  defaultCommand,
  requestedDriver,
  ptyProxyPath,
  defaultTerminalSize,
});

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(data);
}

function text(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

async function handle(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      json(res, 200, healthResponse({
        defaultSession,
        defaultCwd,
        defaultTerminalSize,
        terminalManager,
      }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/sessions') {
      json(res, 200, providerSessionsResponseForUrl(url, { defaultCwd }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/dock-terminal-session') {
      json(res, 200, dockTerminalSessionResponseForUrl(url, {
        defaultRepoRoot,
        defaultSession,
        terminalManager,
      }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/session-inspector') {
      const result = sessionInspectorResponseForUrl(url, { defaultCwd });
      if (result.contentType === 'text') text(res, result.status, result.body);
      else json(res, result.status, result.body);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/snapshot') {
      const session = terminalManager.cleanSession(url.searchParams.get('session'));
      if (!terminalManager.canCapture(session)) {
        text(res, 404, `tmux session not found: ${session}`);
        return;
      }
      json(res, 200, terminalManager.capture(session, url.searchParams.get('lines')));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/ensure') {
      const body = await readBody(req);
      const session = terminalManager.cleanSession(body.session);
      const result = terminalManager.ensureSession(
        session,
        typeof body.cwd === 'string' ? body.cwd : defaultCwd,
        terminalManager.commandText(body.command),
        body.force === true,
      );
      json(res, 200, { ok: true, session, ...result });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/resize') {
      const body = await readBody(req);
      const session = terminalManager.cleanSession(body.session);
      json(res, 200, terminalManager.resize(session, body.cols, body.rows));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/input') {
      const body = await readBody(req);
      const session = terminalManager.cleanSession(body.session);
      const textValue = String(body.text || '');
      json(res, 200, terminalManager.writeInput(session, textValue, body.enter !== false));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/key') {
      const body = await readBody(req);
      const session = terminalManager.cleanSession(body.session);
      const key = String(body.key || '');
      if (!allowedKeys.has(key)) {
        text(res, 400, `Unsupported key: ${key}`);
        return;
      }
      json(res, 200, terminalManager.writeKey(session, key));
      return;
    }

    text(res, 404, 'Not found');
  } catch (error) {
    text(res, 500, error.message || String(error));
  }
}

function startServer() {
  const server = http.createServer((req, res) => {
    handle(req, res).catch(error => text(res, 500, error.message || String(error)));
  });

  server.on('upgrade', (req, socket) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      if (url.pathname !== '/terminal') {
        socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
        return;
      }
      terminalManager.attachTerminalSocket(socket, req);
    } catch (error) {
      socket.end(`HTTP/1.1 500 Internal Server Error\r\n\r\n${error.message || error}`);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`agent-terminal bridge listening on http://127.0.0.1:${port} (${terminalManager.activeDriver()})`);
  });

  let shuttingDown = false;

  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(() => {});
    terminalManager.terminateOwnedSessions()
      .then(() => {
        process.exit(0);
      })
      .catch((error) => {
        console.error(`agent-terminal shutdown failed: ${error.message || error}`);
        process.exit(1);
      });
    setTimeout(() => process.exit(1), 2500).unref();
  }

  process.on('SIGTERM', () => shutdown());
  process.on('SIGINT', () => shutdown());
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  startServer();
}

export { appendProcessStderr, startServer };
