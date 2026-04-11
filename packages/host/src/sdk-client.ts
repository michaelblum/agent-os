// packages/host/src/sdk-client.ts
import net from 'node:net';
import { ulid } from 'ulid';
import type { SocketRequest, StreamEvent, Session, SessionConfig, ToolDefinition } from './types.ts';

export class HostClient {
  private socket: net.Socket | null = null;
  private pending = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
    onStream?: (event: StreamEvent) => void;
  }>();

  private socketPath: string;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.socketPath);
      let buffer = '';

      this.socket.on('connect', resolve);
      this.socket.once('error', reject);

      this.socket.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            const handler = this.pending.get(msg.id);
            if (!handler) continue;

            if ('stream' in msg) {
              handler.onStream?.(msg.stream as StreamEvent);
            } else if ('error' in msg) {
              this.pending.delete(msg.id);
              handler.reject(new Error(msg.error.message));
            } else {
              this.pending.delete(msg.id);
              handler.resolve(msg.result);
            }
          } catch {}
        }
      });
    });
  }

  disconnect(): void {
    this.socket?.destroy();
    this.socket = null;
  }

  async createSession(config: SessionConfig = {}): Promise<Session> {
    return this.call('chat.create', config as Record<string, unknown>) as Promise<Session>;
  }

  async sendMessage(
    sessionId: string,
    text: string,
    onStream: (event: StreamEvent) => void,
  ): Promise<void> {
    await this.callWithStream('chat.send', { sessionId, text }, onStream);
  }

  async stop(sessionId: string): Promise<void> {
    await this.call('chat.stop', { sessionId });
  }

  async listSessions(): Promise<Session[]> {
    return this.call('chat.list', {}) as Promise<Session[]>;
  }

  async listTools(): Promise<ToolDefinition[]> {
    return this.call('tools.list', {}) as Promise<ToolDefinition[]>;
  }

  private call(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ulid();
      this.pending.set(id, { resolve, reject });
      const req: SocketRequest = { id, method, params };
      this.socket!.write(JSON.stringify(req) + '\n');
    });
  }

  private callWithStream(
    method: string,
    params: Record<string, unknown>,
    onStream: (event: StreamEvent) => void,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ulid();
      this.pending.set(id, { resolve, reject, onStream });
      const req: SocketRequest = { id, method, params };
      this.socket!.write(JSON.stringify(req) + '\n');
    });
  }
}
