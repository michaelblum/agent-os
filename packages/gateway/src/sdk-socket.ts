// src/sdk-socket.ts
import { createServer, Socket } from 'node:net';
import { mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import * as aosProxy from './aos-proxy.js';

export interface SDKSocketOptions {
  socketPath: string;
}

export function startSDKSocket(opts: SDKSocketOptions) {
  const { socketPath } = opts;
  mkdirSync(dirname(socketPath), { recursive: true });
  if (existsSync(socketPath)) unlinkSync(socketPath);

  const server = createServer((conn: Socket) => {
    let buffer = '';
    conn.on('data', (chunk) => {
      buffer += chunk.toString();
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        handleRequest(conn, line);
      }
    });
  });

  server.listen(socketPath);
  return server;
}

async function handleRequest(conn: Socket, line: string) {
  let req: { id: string; domain: string; method: string; params: any };
  try { req = JSON.parse(line); } catch { return; }

  let result: unknown;
  try {
    if (req.domain === 'system') {
      result = await handleSystem(req.method, req.params);
    } else {
      result = { error: `Unknown domain: ${req.domain}` };
    }
  } catch (err: any) {
    result = { error: err.message };
  }

  conn.write(JSON.stringify({ id: req.id, result }) + '\n');
}

async function handleSystem(method: string, params: any): Promise<unknown> {
  switch (method) {
    // Perception
    case 'getWindows': return aosProxy.getWindows(params?.filter);
    case 'getCursor': return aosProxy.getCursor();
    case 'capture': return aosProxy.capture(params);
    case 'getDisplays': return aosProxy.getDisplays();
    // Action
    case 'click': return aosProxy.click(params.target);
    case 'type': return aosProxy.type(params.text);
    case 'say': return aosProxy.say(params.text);
    // Display
    case 'createCanvas': return aosProxy.createCanvas(params);
    case 'removeCanvas': return aosProxy.removeCanvas(params.id);
    case 'evalCanvas': return aosProxy.evalCanvas(params.id, params.js);
    case 'updateCanvas': return aosProxy.updateCanvas(params.id, params);
    case 'listCanvases': return aosProxy.listCanvases();
    // Config & Health
    case 'doctor': return aosProxy.doctor();
    case 'getConfig': return aosProxy.getConfig();
    case 'setConfig': return aosProxy.setConfig(params.key, params.value);
    // Layer 2 Smart Operations
    case 'perceive': return aosProxy.perceive();
    case 'findWindow': return aosProxy.findWindow(params);
    case 'clickElement': return aosProxy.clickElement(params.label, params);
    case 'waitFor': return aosProxy.waitFor(params.pattern ?? params, params);
    case 'showOverlay': return aosProxy.showOverlay(params);
    case 'updateOverlay': return aosProxy.updateOverlay(params.id, params);
    default: return { error: `Unknown system method: ${method}` };
  }
}
