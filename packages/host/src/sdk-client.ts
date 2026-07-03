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

  private rejectPending(error: Error): void {
    for (const handler of this.pending.values()) {
      handler.reject(error);
    }
    this.pending.clear();
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      this.socket = socket;
      let buffer = '';

      const onConnectError = (error: Error) => {
        if (this.socket === socket) this.socket = null;
        reject(error);
      };

      socket.once('error', onConnectError);
      socket.once('connect', () => {
        socket.off('error', onConnectError);
        resolve();
      });

      socket.on('error', (error) => {
        this.rejectPending(error);
      });

      socket.on('close', () => {
        this.rejectPending(new Error('Host socket closed'));
        if (this.socket === socket) this.socket = null;
      });

      socket.on('data', (data) => {
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
    this.rejectPending(new Error('Host socket disconnected'));
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
      const socket = this.activeSocket();
      if (!socket) {
        reject(new Error('Host socket is not connected'));
        return;
      }
      const id = ulid();
      this.pending.set(id, { resolve, reject });
      const req: SocketRequest = { id, method, params };
      socket.write(JSON.stringify(req) + '\n', (error) => {
        if (!error) return;
        const handler = this.pending.get(id);
        if (!handler) return;
        this.pending.delete(id);
        handler.reject(error);
      });
    });
  }

  private callWithStream(
    method: string,
    params: Record<string, unknown>,
    onStream: (event: StreamEvent) => void,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const socket = this.activeSocket();
      if (!socket) {
        reject(new Error('Host socket is not connected'));
        return;
      }
      const id = ulid();
      this.pending.set(id, { resolve, reject, onStream });
      const req: SocketRequest = { id, method, params };
      socket.write(JSON.stringify(req) + '\n', (error) => {
        if (!error) return;
        const handler = this.pending.get(id);
        if (!handler) return;
        this.pending.delete(id);
        handler.reject(error);
      });
    });
  }

  private activeSocket(): net.Socket | null {
    return this.socket && !this.socket.destroyed ? this.socket : null;
  }
}
