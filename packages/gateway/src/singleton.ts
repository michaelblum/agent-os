// src/singleton.ts
// Advisory pidfile lock so dev-mode and MCP-mode gateways don't collide on
// ~/.config/aos-gateway/{gateway.db,sdk.sock}. See issue #102.

import { openSync, writeSync, closeSync, readFileSync, unlinkSync } from 'node:fs';

export interface PidLock {
  release(): void;
}

export interface PidHolder {
  pid: number;
  since: string;
}

export class PeerAliveError extends Error {
  code = 'EPEERLIVE';
  constructor(public holder: PidHolder, public pidfile: string) {
    super(`aos-gateway peer already running: pid=${holder.pid} since=${holder.since} pidfile=${pidfile}`);
  }
}

export function acquirePidLock(path: string): PidLock {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx');
      writeSync(fd, `${process.pid}\n${Date.now()}\n`);
      closeSync(fd);
      let released = false;
      return {
        release: () => {
          if (released) return;
          released = true;
          try { unlinkSync(path); } catch {}
        },
      };
    } catch (err: any) {
      if (err.code !== 'EEXIST') throw err;
      const holder = readHolder(path);
      if (holder && holder.pid !== process.pid && isAlive(holder.pid)) {
        throw new PeerAliveError(holder, path);
      }
      try { unlinkSync(path); } catch {}
    }
  }
  throw new Error(`aos-gateway: failed to acquire ${path}`);
}

function readHolder(path: string): PidHolder | null {
  try {
    const parts = readFileSync(path, 'utf8').split('\n');
    const pid = parseInt(parts[0], 10);
    const ts = parseInt(parts[1] ?? '', 10);
    if (!Number.isFinite(pid)) return null;
    const since = Number.isFinite(ts) ? new Date(ts).toISOString() : '?';
    return { pid, since };
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err.code === 'EPERM';
  }
}
