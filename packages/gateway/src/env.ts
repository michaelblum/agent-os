import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function parseEnvValue(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    const quote = trimmed[0];
    const inner = trimmed.slice(1, -1);
    return quote === '"'
      ? inner
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
      : inner;
  }
  return trimmed;
}

function loadEnvFileIfPresent(filePath: string) {
  if (!existsSync(filePath)) return;

  const raw = readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const exportMatch = trimmed.match(/^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    const plainMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    const match = exportMatch ?? plainMatch;
    if (!match) continue;

    const [, key, value] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = parseEnvValue(value);
  }
}

export function loadGatewayEnv(packageRoot: string) {
  const explicit = process.env.AOS_GATEWAY_ENV_FILE;
  if (explicit) loadEnvFileIfPresent(resolve(packageRoot, explicit));
  loadEnvFileIfPresent(resolve(packageRoot, '.env'));
  loadEnvFileIfPresent(resolve(packageRoot, '.env.local'));
}
