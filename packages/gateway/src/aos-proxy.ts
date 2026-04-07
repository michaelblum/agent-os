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
    execFile(AOS_BIN, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`aos ${args.join(' ')} failed: ${err.message}\n${stderr}`));
      else resolve(stdout);
    });
  });
}

export async function getWindows(filter?: { app?: string; title?: string }): Promise<unknown[]> {
  const raw = await runAos(['see', 'cursor']);
  try {
    const data = JSON.parse(raw);
    let windows = data.windows ?? [data];
    if (filter?.app) windows = windows.filter((w: any) => w.app?.includes(filter.app));
    if (filter?.title) windows = windows.filter((w: any) => w.title?.includes(filter.title));
    return windows;
  } catch {
    return [{ raw }];
  }
}

export async function click(target: { x: number; y: number }): Promise<void> {
  await runAos(['do', 'click', `${target.x},${target.y}`]);
}

export async function say(text: string): Promise<void> {
  await runAos(['say', text]);
}
