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

// --- Normalization helpers ---

export type NormalizedWindow = {
  id: string; app: string; title: string;
  frame: { x: number; y: number; width: number; height: number };
  focused: boolean;
};

/** Normalize raw CLI window data to match the SDK type contract. */
export function normalizeWindow(raw: any, isFocused = false): NormalizedWindow {
  const win = raw.window ?? raw;
  const bounds = win.bounds ?? win.frame ?? {};
  return {
    id: String(win.window_id ?? win.id ?? ''),
    app: win.app_name ?? win.app ?? '',
    title: win.title ?? '',
    frame: {
      x: bounds.x ?? 0, y: bounds.y ?? 0,
      width: bounds.width ?? 0, height: bounds.height ?? 0,
    },
    focused: isFocused || !!raw.focused,
  };
}

/** Single CLI call that powers getWindows, getCursor, getDisplays, and perceive. */
async function getCursorSnapshot(): Promise<any> {
  const raw = await runAos(['see', 'cursor']);
  return parseJSON(raw) as any;
}

// --- Layer 1 Primitives: Perception ---

export async function getWindows(filter?: { app?: string; title?: string }): Promise<NormalizedWindow[]> {
  const data = await getCursorSnapshot();
  const rawWindows = data.windows ?? [data];
  let windows: NormalizedWindow[] = rawWindows.map((w: any, i: number) => normalizeWindow(w, i === 0 && rawWindows.length === 1));
  if (filter?.app) {
    const q = filter.app.toLowerCase();
    windows = windows.filter((w: NormalizedWindow) => w.app.toLowerCase().includes(q));
  }
  if (filter?.title) {
    const q = filter.title.toLowerCase();
    windows = windows.filter((w: NormalizedWindow) => w.title.toLowerCase().includes(q));
  }
  return windows;
}

export async function getCursor(): Promise<{ x: number; y: number; app?: string; title?: string }> {
  const data = await getCursorSnapshot();
  return {
    x: data.cursor?.x ?? data.x ?? 0,
    y: data.cursor?.y ?? data.y ?? 0,
    app: data.focused?.window?.app_name ?? data.app,
    title: data.focused?.window?.title ?? data.title,
  };
}

export async function capture(opts?: {
  display?: string;
  canvas?: string;
  window?: boolean;
  xray?: boolean;
  base64?: boolean;
  format?: 'png' | 'jpg';
  out?: string;
}): Promise<{ status: string; base64?: string; elements?: unknown[]; semantic_targets?: unknown[]; path?: string }> {
  const args = ['see', 'capture', opts?.display ?? 'user_active'];
  if (opts?.canvas) args.push('--canvas', opts.canvas);
  if (opts?.window) args.push('--window');
  if (opts?.xray) args.push('--xray');
  if (opts?.base64) args.push('--base64');
  if (opts?.format) args.push('--format', opts.format);
  if (opts?.out) args.push('--out', opts.out);
  const raw = await runAos(args, 30000);
  return parseJSON(raw) as any;
}

export async function getDisplays(): Promise<Array<{ id: string; width: number; height: number; primary?: boolean }>> {
  const data = await getCursorSnapshot();
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

// --- Layer 2 Smart Operations ---

/** Combined situational awareness — windows, cursor, displays in one call. */
export async function perceive(): Promise<{
  focused: NormalizedWindow | null;
  windows: NormalizedWindow[];
  cursor: { x: number; y: number };
  displays: Array<{ id: string; width: number; height: number; primary?: boolean }>;
}> {
  // Single CLI call extracts everything
  const data = await getCursorSnapshot();

  const rawWindows = data.windows ?? [data];
  const windows = rawWindows.map((w: any) => normalizeWindow(w));

  // Mark the focused window — use data.focused or first window
  const focusedApp = data.focused?.window?.app_name;
  const focusedTitle = data.focused?.window?.title;
  let focused: NormalizedWindow | null = null;
  if (focusedApp || focusedTitle) {
    focused = normalizeWindow(data.focused, true);
    // Also mark it in the windows array
    const match = windows.find((w: NormalizedWindow) => w.app === focused!.app && w.title === focused!.title);
    if (match) match.focused = true;
  } else if (windows.length > 0) {
    windows[0].focused = true;
    focused = windows[0];
  }

  const cursor = {
    x: data.cursor?.x ?? data.x ?? 0,
    y: data.cursor?.y ?? data.y ?? 0,
  };

  const displays = data.displays ?? [{ id: 'main', width: 1512, height: 982, primary: true }];

  return { focused, windows, cursor, displays };
}

/** Find a window by app name, title substring, or both. Returns the best match. */
export async function findWindow(query: { app?: string; title?: string }): Promise<{
  found: boolean;
  window: NormalizedWindow | null;
  candidates: string[];
}> {
  const windows = await getWindows();
  let matches = windows;

  if (query.app) {
    const q = query.app.toLowerCase();
    matches = matches.filter(w => w.app.toLowerCase().includes(q));
  }
  if (query.title) {
    const q = query.title.toLowerCase();
    matches = matches.filter(w => w.title.toLowerCase().includes(q));
  }

  return {
    found: matches.length > 0,
    window: matches[0] ?? null,
    candidates: windows.map(w => `${w.app}: ${w.title}`).slice(0, 10),
  };
}

/** Capture the screen, find an element by label, and click it. One call. */
export async function clickElement(label: string, opts?: {
  app?: string;
  role?: string;
}): Promise<{
  clicked: boolean;
  element?: { label: string; role: string; frame: unknown };
  error?: string;
  candidates?: string[];
}> {
  // Capture with accessibility tree
  const captureResult = await capture({ xray: true });
  const elements = (captureResult as any).elements ?? [];

  if (elements.length === 0) {
    return { clicked: false, error: 'No accessibility elements found. Is the target app focused?' };
  }

  // Find matching element
  const labelLower = label.toLowerCase();
  let matches = elements.filter((el: any) => {
    const elLabel = (el.label ?? el.title ?? el.value ?? '').toLowerCase();
    return elLabel.includes(labelLower);
  });

  // Filter by app if specified (check window title)
  if (opts?.role) {
    matches = matches.filter((el: any) => el.role === opts.role);
  }

  if (matches.length === 0) {
    const available = elements
      .filter((el: any) => el.label || el.title)
      .map((el: any) => `${el.role}: "${el.label ?? el.title}"`)
      .slice(0, 15);
    return {
      clicked: false,
      error: `No element matching "${label}" found.`,
      candidates: available,
    };
  }

  const target = matches[0];
  const frame = target.frame ?? target.bounds;
  if (!frame) {
    return { clicked: false, error: `Element "${label}" found but has no frame/bounds.` };
  }

  // Click the center of the element
  const cx = frame.x + (frame.width ?? frame.w ?? 0) / 2;
  const cy = frame.y + (frame.height ?? frame.h ?? 0) / 2;
  await click({ x: Math.round(cx), y: Math.round(cy) });

  return {
    clicked: true,
    element: { label: target.label ?? target.title, role: target.role, frame },
  };
}

/** Poll until a condition is met, then return the match. */
export async function waitFor(pattern: {
  window?: string;
  canvas?: string;
}, opts?: {
  timeout?: number;
  interval?: number;
}): Promise<{
  found: boolean;
  match?: unknown;
  elapsed: number;
}> {
  const timeout = opts?.timeout ?? 10000;
  const interval = opts?.interval ?? 500;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (pattern.window) {
      const windows = await getWindows();
      const regex = new RegExp(pattern.window, 'i');
      const match = (windows as any[]).find((w: any) =>
        regex.test(w.title ?? '') || regex.test(w.app ?? '')
      );
      if (match) return { found: true, match, elapsed: Date.now() - start };
    }

    if (pattern.canvas) {
      const canvases = await listCanvases();
      const match = canvases.find(c => c.id === pattern.canvas);
      if (match) return { found: true, match, elapsed: Date.now() - start };
    }

    await new Promise(r => setTimeout(r, interval));
  }

  return { found: false, elapsed: Date.now() - start };
}

/** Show a positioned overlay near a target window. Auto-generates HTML from content string. */
export async function showOverlay(opts: {
  content: string;
  near?: { app?: string; title?: string };
  at?: [number, number, number, number];
  style?: 'status' | 'success' | 'error' | 'warning' | 'info';
  ttl?: number;
  id?: string;
}): Promise<{ id: string; at: number[] }> {
  const colors: Record<string, { bg: string; border: string; text: string }> = {
    status:  { bg: 'rgba(22,22,26,0.92)', border: 'rgba(188,19,254,0.4)', text: '#d187ff' },
    success: { bg: 'rgba(22,26,22,0.92)', border: 'rgba(48,209,88,0.4)',  text: '#30d158' },
    error:   { bg: 'rgba(26,22,22,0.92)', border: 'rgba(255,69,58,0.4)',  text: '#ff453a' },
    warning: { bg: 'rgba(26,24,22,0.92)', border: 'rgba(255,214,10,0.4)', text: '#ffd60a' },
    info:    { bg: 'rgba(22,22,26,0.92)', border: 'rgba(100,210,255,0.4)', text: '#64d2ff' },
  };
  const s = colors[opts.style ?? 'status'] ?? colors.status;
  const html = `<div style="
    font: 13px -apple-system, BlinkMacSystemFont, sans-serif;
    color: ${s.text}; background: ${s.bg};
    border: 1px solid ${s.border}; border-radius: 8px;
    padding: 8px 14px; backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  ">${opts.content}</div>`;

  // Determine position
  let at = opts.at;
  if (!at && opts.near) {
    const found = await findWindow(opts.near);
    if (found.found && found.window) {
      const { frame } = found.window;
      // Position above the target window, centered
      const w = 280;
      const h = 44;
      const x = frame.x + (frame.width - w) / 2;
      const y = frame.y - h - 8;
      at = [Math.round(x), Math.max(0, Math.round(y)), w, h];
    }
  }
  at = at ?? [200, 40, 280, 44];

  const id = opts.id ?? `overlay-${Date.now().toString(36)}`;
  try {
    await createCanvas({ id, html, at, interactive: false, ttl: opts.ttl });
  } catch (err: any) {
    // If canvas already exists, remove and retry (makes showOverlay idempotent)
    if (err.message?.includes('DUPLICATE_ID')) {
      await removeCanvas(id);
      await createCanvas({ id, html, at, interactive: false, ttl: opts.ttl });
    } else {
      throw err;
    }
  }

  return { id, at };
}

/** Update an existing overlay's content and/or style. Uses updateCanvas (fast) instead of recreating. */
export async function updateOverlay(id: string, opts: {
  content?: string;
  style?: 'status' | 'success' | 'error' | 'warning' | 'info';
  ttl?: number;
}): Promise<{ id: string }> {
  const colors: Record<string, { bg: string; border: string; text: string }> = {
    status:  { bg: 'rgba(22,22,26,0.92)', border: 'rgba(188,19,254,0.4)', text: '#d187ff' },
    success: { bg: 'rgba(22,26,22,0.92)', border: 'rgba(48,209,88,0.4)',  text: '#30d158' },
    error:   { bg: 'rgba(26,22,22,0.92)', border: 'rgba(255,69,58,0.4)',  text: '#ff453a' },
    warning: { bg: 'rgba(26,24,22,0.92)', border: 'rgba(255,214,10,0.4)', text: '#ffd60a' },
    info:    { bg: 'rgba(22,22,26,0.92)', border: 'rgba(100,210,255,0.4)', text: '#64d2ff' },
  };
  const s = colors[opts.style ?? 'status'] ?? colors.status;
  const html = `<div style="
    font: 13px -apple-system, BlinkMacSystemFont, sans-serif;
    color: ${s.text}; background: ${s.bg};
    border: 1px solid ${s.border}; border-radius: 8px;
    padding: 8px 14px; backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  ">${opts.content ?? ''}</div>`;

  await updateCanvas(id, { html });

  // TTL: schedule removal if requested
  if (opts.ttl) {
    setTimeout(async () => { try { await removeCanvas(id); } catch {} }, opts.ttl);
  }

  return { id };
}
