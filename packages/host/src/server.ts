// packages/host/src/server.ts
import net from 'node:net';
import fs from 'node:fs';
import type { SocketRequest, SocketResponse, StreamEvent } from './types.ts';

type RequestHandler = (
  method: string,
  params: Record<string, unknown>,
  streamCallback: (event: StreamEvent) => void,
) => Promise<unknown>;

export class HostServer {
  private handler: RequestHandler;
  private server: net.Server;
  private connections = new Set<net.Socket>();

  constructor(handler: RequestHandler) {
    this.handler = handler;
    this.server = net.createServer(socket => this.handleConnection(socket));
  }

  listen(socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try { fs.unlinkSync(socketPath); } catch {}
      this.server.listen(socketPath, () => resolve());
      this.server.once('error', reject);
    });
  }

  close(): Promise<void> {
    for (const conn of this.connections) {
      conn.destroy();
    }
    return new Promise(resolve => this.server.close(() => resolve()));
  }

  private handleConnection(socket: net.Socket): void {
    this.connections.add(socket);
    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        this.handleLine(socket, line.trim());
      }
    });

    socket.on('close', () => {
      this.connections.delete(socket);
    });

    socket.on('error', () => {
      this.connections.delete(socket);
    });
  }

  private async handleLine(socket: net.Socket, line: string): Promise<void> {
    let req: SocketRequest;
    try {
      req = JSON.parse(line);
    } catch {
      return;
    }

    const streamCallback = (event: StreamEvent) => {
      if (!socket.destroyed) {
        const streamMsg = JSON.stringify({ id: req.id, stream: event });
        socket.write(streamMsg + '\n');
      }
    };

    try {
      const result = await this.handler(req.method, req.params, streamCallback);
      const response: SocketResponse = { id: req.id, result };
      socket.write(JSON.stringify(response) + '\n');
    } catch (err: any) {
      const response: SocketResponse = {
        id: req.id,
        error: { message: err.message, code: err.code },
      };
      socket.write(JSON.stringify(response) + '\n');
    }
  }
}
