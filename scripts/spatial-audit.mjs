#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const allowlistPath = path.join(repoRoot, 'tests/fixtures/spatial-governance-allowlist.json');

const FUNCTION_PATTERNS = {
  '.js': [
    /\b(?:export\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g,
    /\b(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(/g,
  ],
  '.mjs': [
    /\b(?:export\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g,
    /\b(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(/g,
  ],
  '.swift': [
    /\b(?:private\s+|fileprivate\s+|internal\s+|public\s+|open\s+)?func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g,
  ],
};

function trackedNames(manifest) {
  return new Set(Object.keys(manifest.trackedHelpers || {}));
}

function listTrackedFiles(root) {
  const stdout = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  });
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((rel) => ['.js', '.mjs', '.swift'].includes(path.extname(rel)));
}

function collectMatches(source, ext, wanted) {
  const hits = [];
  for (const pattern of FUNCTION_PATTERNS[ext] || []) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const name = match[1];
      if (wanted.has(name)) hits.push(name);
    }
  }
  return hits;
}

export async function runSpatialAudit(root = repoRoot) {
  const manifest = JSON.parse(await fs.readFile(allowlistPath, 'utf8'));
  const wanted = trackedNames(manifest);
  const files = listTrackedFiles(root);
  const definitions = new Map();

  for (const relPath of files) {
    const ext = path.extname(relPath);
    if (!FUNCTION_PATTERNS[ext]) continue;
    const absPath = path.join(root, relPath);
    let source;
    try {
      source = await fs.readFile(absPath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    const found = collectMatches(source, ext, wanted);
    for (const helper of found) {
      if (!definitions.has(helper)) definitions.set(helper, []);
      definitions.get(helper).push(relPath);
    }
  }

  const violations = [];
  const missing = [];
  for (const [helper, spec] of Object.entries(manifest.trackedHelpers || {})) {
    const found = definitions.get(helper) || [];
    if (found.length === 0) {
      missing.push(helper);
      violations.push({
        type: 'missing',
        helper,
        message: `tracked helper '${helper}' not found in the repo scan`,
      });
      continue;
    }
    const allowed = new Set(spec.allowedFiles || []);
    const unauthorized = found.filter((file) => !allowed.has(file));
    if (unauthorized.length > 0) {
      violations.push({
        type: 'unauthorized-definition',
        helper,
        allowedFiles: [...allowed],
        foundFiles: found,
        unauthorizedFiles: unauthorized,
        message: `helper '${helper}' is defined outside the allowlist`,
      });
    }
  }

  return {
    allowlistPath: path.relative(root, allowlistPath),
    trackedHelperCount: wanted.size,
    definitions: Object.fromEntries(
      [...definitions.entries()].sort(([a], [b]) => a.localeCompare(b)),
    ),
    missing,
    violations,
  };
}

function formatSummary(result) {
  const lines = [];
  lines.push(`Spatial audit allowlist: ${result.allowlistPath}`);
  lines.push(`Tracked helpers: ${result.trackedHelperCount}`);
  for (const [helper, files] of Object.entries(result.definitions)) {
    lines.push(`- ${helper}: ${files.join(', ')}`);
  }
  if (result.violations.length === 0) {
    lines.push('Status: OK');
  } else {
    lines.push('Status: VIOLATIONS');
    for (const violation of result.violations) {
      lines.push(`  - ${violation.message}`);
      if (violation.unauthorizedFiles?.length) {
        lines.push(`    unauthorized: ${violation.unauthorizedFiles.join(', ')}`);
      }
    }
  }
  return lines.join('\n');
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const result = await runSpatialAudit();
  if (args.has('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatSummary(result));
  }
  if (args.has('--check') && result.violations.length > 0) {
    process.exitCode = 1;
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
