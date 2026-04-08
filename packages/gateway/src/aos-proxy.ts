import { execFile } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findAosBinary(): string {
  // packages/gateway/src/ → ../../.. → repo root
  const repoAos = resolve(__dirname, '..', '..', '..', 'aos');
  if (existsSync(repoAos)) return repoAos;
  return 'aos'; // fall back to PATH
}

const AOS_BIN = findAosBinary();

function runAos(args: string[], timeoutMs = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(AOS_BIN, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 5 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`aos ${args.join(' ')} failed: ${err.message}\n${stderr}`));
      else resolve(stdout);
    });
  });
}

function parseJSON(raw: string): unknown {
  try { return JSON.parse(raw); }
  catch { return { raw }; }
}

// --- Layer 1 Primitives: Perception ---

export async function getWindows(filter?: { app?: string; title?: string }): Promise<unknown[]> {
  const raw = await runAos(['see', 'cursor']);
  const data = parseJSON(raw) as any;
  let windows = data.windows ?? [data];
  if (filter?.app) windows = windows.filter((w: any) => w.app?.includes(filter.app));
  if (filter?.title) windows = windows.filter((w: any) => w.title?.includes(filter.title));
  return windows;
}

export async function getCursor(): Promise<{ x: number; y: number; app?: string; title?: string }> {
  const raw = await runAos(['see', 'cursor']);
  const data = parseJSON(raw) as any;
  return {
    x: data.cursor?.x ?? data.x ?? 0,
    y: data.cursor?.y ?? data.y ?? 0,
    app: data.app,
    title: data.title,
  };
}

export async function capture(opts?: {
  display?: string;
  window?: boolean;
  xray?: boolean;
  base64?: boolean;
  format?: 'png' | 'jpg';
  out?: string;
}): Promise<{ status: string; base64?: string; elements?: unknown[]; path?: string }> {
  const args = ['see', 'capture', opts?.display ?? 'user_active'];
  if (opts?.window) args.push('--window');
  if (opts?.xray) args.push('--xray');
  if (opts?.base64) args.push('--base64');
  if (opts?.format) args.push('--format', opts.format);
  if (opts?.out) args.push('--out', opts.out);
  const raw = await runAos(args, 30000);
  return parseJSON(raw) as any;
}

export async function getDisplays(): Promise<Array<{ id: string; width: number; height: number; primary?: boolean }>> {
  // aos see cursor returns display info; we can also use the daemon's canvas list
  // to infer display topology. For now, use a simple approach.
  const raw = await runAos(['see', 'cursor']);
  const data = parseJSON(raw) as any;
  // If the daemon returns display info, use it; otherwise provide main display
  if (data.displays) return data.displays;
  return [{ id: 'main', width: 1512, height: 982, primary: true }];
}

// --- Layer 1 Primitives: Action ---

export async function click(target: { x: number; y: number }): Promise<void> {
  await runAos(['do', 'click', `${target.x},${target.y}`]);
}

export async function type(text: string): Promise<void> {
  await runAos(['do', 'type', text]);
}

export async function say(text: string): Promise<void> {
  await runAos(['say', text]);
}

// --- Layer 1 Primitives: Display ---

export async function createCanvas(opts: {
  id: string;
  html?: string;
  url?: string;
  at: [number, number, number, number];
  interactive?: boolean;
  ttl?: number;
}): Promise<{ status: string; id: string }> {
  const args = ['show', 'create', '--id', opts.id];
  if (opts.html) args.push('--html', opts.html);
  if (opts.url) args.push('--url', opts.url);
  args.push('--at', opts.at.join(','));
  if (opts.interactive) args.push('--interactive');
  if (opts.ttl) args.push('--ttl', String(opts.ttl));
  const raw = await runAos(args);
  return { ...(parseJSON(raw) as any), id: opts.id };
}

export async function removeCanvas(id: string): Promise<{ status: string }> {
  const raw = await runAos(['show', 'remove', '--id', id]);
  return parseJSON(raw) as any;
}

export async function evalCanvas(id: string, js: string): Promise<{ result: unknown }> {
  const raw = await runAos(['show', 'eval', '--id', id, '--js', js]);
  return parseJSON(raw) as any;
}

export async function updateCanvas(id: string, opts: {
  html?: string;
  at?: [number, number, number, number];
}): Promise<{ status: string }> {
  const args = ['show', 'update', '--id', id];
  if (opts.html) args.push('--html', opts.html);
  if (opts.at) args.push('--at', opts.at.join(','));
  const raw = await runAos(args);
  return parseJSON(raw) as any;
}

export async function listCanvases(): Promise<Array<{
  id: string; at: number[]; interactive: boolean; scope: string;
}>> {
  const raw = await runAos(['show', 'list']);
  const data = parseJSON(raw) as any;
  return data.canvases ?? [];
}

// --- Layer 1 Primitives: Config & Health ---

export async function doctor(): Promise<unknown> {
  const raw = await runAos(['doctor', '--json'], 15000);
  return parseJSON(raw);
}

export async function getConfig(): Promise<unknown> {
  // `aos set` with no args prints current config
  const raw = await runAos(['set']);
  return parseJSON(raw);
}

export async function setConfig(key: string, value: string): Promise<{ status: string }> {
  const raw = await runAos(['set', key, value]);
  return parseJSON(raw) as any;
}
