import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { HostClient } from '../src/sdk-client.ts';

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('HostClient', () => {
  const sockets: net.Server[] = [];
  const connections: net.Socket[] = [];
  const paths: string[] = [];

  afterEach(async () => {
    for (const socket of connections.splice(0)) {
      socket.destroy();
    }
    await Promise.all(sockets.splice(0).map((server) => new Promise<void>((resolve) => {
      server.close(() => resolve());
    })));
    for (const socketPath of paths.splice(0)) {
      try { fs.unlinkSync(socketPath); } catch {}
    }
  });

  it('rejects pending calls when the socket closes without a response', async () => {
    const socketPath = path.join(os.tmpdir(), `aos-host-client-${process.pid}-${Date.now()}.sock`);
    paths.push(socketPath);

    const server = net.createServer((socket) => {
      connections.push(socket);
      socket.once('data', () => socket.destroy());
    });
    sockets.push(server);
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const client = new HostClient(socketPath);
    await client.connect();
    const pending = client.listTools();
    await nextTick();

    await assert.rejects(
      () => pending,
      /Host socket closed/,
    );
  });

  it('rejects pending calls on explicit disconnect', async () => {
    const socketPath = path.join(os.tmpdir(), `aos-host-client-disconnect-${process.pid}-${Date.now()}.sock`);
    paths.push(socketPath);

    const server = net.createServer((socket) => {
      connections.push(socket);
    });
    sockets.push(server);
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const client = new HostClient(socketPath);
    await client.connect();
    const pending = client.listSessions();
    client.disconnect();

    await assert.rejects(
      () => pending,
      /Host socket disconnected/,
    );
  });

  it('rejects calls made before connect instead of throwing from socket access', async () => {
    const socketPath = path.join(os.tmpdir(), `aos-host-client-unconnected-${process.pid}-${Date.now()}.sock`);
    const client = new HostClient(socketPath);

    await assert.rejects(
      () => client.listTools(),
      /Host socket is not connected/,
    );
  });

  it('rejects a pending call when socket write reports an error', async () => {
    const client = new HostClient('unused');
    const writeError = new Error('write failed');
    const fakeSocket = {
      destroyed: false,
      write(_data: string, callback: (error?: Error) => void): boolean {
        callback(writeError);
        return false;
      },
    };

    (client as unknown as { socket: typeof fakeSocket }).socket = fakeSocket;

    await assert.rejects(
      () => client.listSessions(),
      /write failed/,
    );
  });
});
