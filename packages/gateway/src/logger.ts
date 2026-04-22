import { closeSync, existsSync, openSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';

export interface Logger {
  info(msg: string, meta?: object): void;
  warn(msg: string, meta?: object): void;
  error(msg: string, meta?: object): void;
  close(): void;
}

export interface LoggerOptions {
  logPath: string;
  maxBytes?: number;
  keep?: number;
  alsoStderr?: boolean;
}

export function createLogger(opts: LoggerOptions): Logger {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const keep = opts.keep ?? 3;
  const alsoStderr = opts.alsoStderr ?? true;
  let fd: number | undefined;

  function open() {
    if (fd === undefined) fd = openSync(opts.logPath, 'a');
  }

  function rotate() {
    if (fd !== undefined) {
      closeSync(fd);
      fd = undefined;
    }
    const rotated = (n: number) => `${opts.logPath}.${n}`;
    if (existsSync(rotated(keep))) unlinkSync(rotated(keep));
    for (let i = keep - 1; i >= 1; i--) {
      if (existsSync(rotated(i))) renameSync(rotated(i), rotated(i + 1));
    }
    if (existsSync(opts.logPath)) renameSync(opts.logPath, rotated(1));
  }

  function write(level: 'info' | 'warn' | 'error', msg: string, meta?: object) {
    const entry: Record<string, unknown> = { ts: new Date().toISOString(), level, msg };
    if (meta !== undefined) entry.meta = meta;
    const line = JSON.stringify(entry) + '\n';

    if (existsSync(opts.logPath)) {
      const size = statSync(opts.logPath).size;
      if (size + Buffer.byteLength(line, 'utf8') > maxBytes) rotate();
    }
    open();
    writeSync(fd!, line);
    if (alsoStderr) process.stderr.write(line);
  }

  return {
    info(msg, meta) { write('info', msg, meta); },
    warn(msg, meta) { write('warn', msg, meta); },
    error(msg, meta) { write('error', msg, meta); },
    close() {
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch {}
        fd = undefined;
      }
    },
  };
}
