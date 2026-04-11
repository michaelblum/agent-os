// packages/host/src/sigil-bridge.ts
import { HostClient } from './sdk-client.ts';
import type { StreamEvent } from './types.ts';
import path from 'node:path';

const mode = process.env.AOS_MODE ?? 'repo';
const stateDir = path.join(process.env.HOME ?? '/tmp', '.config', 'aos', mode);
const socketPath = path.join(stateDir, 'host.sock');

const client = new HostClient(socketPath);
let sessionId: string | null = null;

function sendToCanvas(msg: { type: string; content?: unknown[]; text?: string }): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function streamEventToCanvasContent(event: StreamEvent): void {
  switch (event.type) {
    case 'text-delta':
      sendToCanvas({ type: 'assistant', content: [{ type: 'text', text: event.text }] });
      break;
    case 'tool-call':
      sendToCanvas({
        type: 'status',
        text: `Using ${event.toolName}...`,
      });
      break;
    case 'tool-result':
      if (event.result.isError) {
        sendToCanvas({
          type: 'status',
          text: `Tool error: ${typeof event.result.content === 'string' ? event.result.content : JSON.stringify(event.result.content)}`,
        });
      }
      break;
    case 'finish':
      sendToCanvas({ type: 'status', text: '' });
      break;
    case 'error':
      sendToCanvas({ type: 'status', text: `Error: ${event.error}` });
      break;
  }
}

async function handleMessage(text: string): Promise<void> {
  if (!sessionId) {
    const session = await client.createSession({
      system: 'You are a helpful assistant with access to file system tools. Be concise.',
    });
    sessionId = session.id;
  }

  sendToCanvas({ type: 'user', content: [{ type: 'text', text }] });

  await client.sendMessage(sessionId, text, (event) => {
    streamEventToCanvasContent(event);
  });
}

async function main() {
  await client.connect();

  let buffer = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'user_message') {
          handleMessage(msg.payload.text).catch(err => {
            sendToCanvas({ type: 'status', text: `Error: ${err.message}` });
          });
        } else if (msg.type === 'stop') {
          if (sessionId) client.stop(sessionId);
        }
      } catch {}
    }
  });
}

main().catch(err => {
  console.error('Bridge error:', err);
  process.exit(1);
});
