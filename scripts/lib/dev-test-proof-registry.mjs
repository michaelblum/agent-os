import fs from 'node:fs';
import path from 'node:path';

export const defaultProofRegistryPath = 'docs/dev/test-proof-registry.json';
export const proofWorthFailureCode = 'MISSING_PROOF_WORTH';

export class ProofRegistryError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ProofRegistryError';
    this.code = code;
  }
}

function unique(input) {
  const seen = new Set();
  return input.filter((item) => item && !seen.has(item) && seen.add(item));
}

function toPosixPath(value) {
  return value.replaceAll(path.sep, '/').replaceAll('\\', '/');
}

export function normalizeProofPath(value, repoRoot = process.cwd()) {
  if (!value) return '';
  const expanded = value.startsWith('~') ? path.join(process.env.HOME || '', value.slice(1)) : value;
  const absolute = path.isAbsolute(expanded);
  const normalized = absolute ? path.relative(repoRoot, expanded) : expanded;
  return toPosixPath(normalized).replace(/^\.\//, '');
}

export function globToRegex(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length;) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 3;
        } else {
          out += '.*';
          i += 2;
        }
      } else {
        out += '[^/]*';
        i += 1;
      }
    } else if (ch === '?') {
      out += '[^/]';
      i += 1;
    } else {
      out += ch.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
      i += 1;
    }
  }
  return out;
}

export function globMatches(pattern, itemPath) {
  if (pattern === '**') return true;
  return new RegExp(`^${globToRegex(pattern)}$`).test(itemPath);
}

export function loadProofRegistry({ repoRoot = process.cwd(), registryPath = defaultProofRegistryPath } = {}) {
  const resolved = path.resolve(path.isAbsolute(registryPath) ? registryPath : path.join(repoRoot, registryPath));
  let raw;
  try {
    raw = fs.readFileSync(resolved, 'utf8');
  } catch (err) {
    throw new ProofRegistryError(`Missing dev test proof registry: ${resolved}`, 'MISSING_PROOF_REGISTRY', { cause: err });
  }

  let registry;
  try {
    registry = JSON.parse(raw);
  } catch (err) {
    throw new ProofRegistryError(`Invalid dev test proof registry ${resolved}: ${err.message}`, 'INVALID_PROOF_REGISTRY');
  }

  if (!registry || Array.isArray(registry) || typeof registry !== 'object' || !Array.isArray(registry.entries)) {
    throw new ProofRegistryError(`Invalid dev test proof registry ${resolved}: expected object with entries[]`, 'INVALID_PROOF_REGISTRY');
  }

  return {
    path: resolved,
    relativePath: normalizeProofPath(resolved, repoRoot),
    registry,
  };
}

export function classifyProofAsset(itemPath) {
  const normalized = normalizeProofPath(itemPath);
  if (!normalized || normalized === '.') return null;

  if (normalized === defaultProofRegistryPath) {
    return { kind: 'proof_registry', patternField: 'path_patterns' };
  }

  if (normalized.startsWith('shared/schemas/fixtures/')) {
    return { kind: 'fixture', patternField: 'fixture_patterns' };
  }

  if (normalized.startsWith('tests/fixtures/') || normalized.includes('/fixtures/')) {
    return { kind: 'fixture', patternField: 'fixture_patterns' };
  }

  if (normalized.startsWith('tests/lib/')) {
    return { kind: 'helper', patternField: 'path_patterns' };
  }

  if (normalized.startsWith('tests/')) {
    const basename = path.posix.basename(normalized);
    if (/\.(?:sh|bash|mjs|js|cjs|py)$/.test(basename)) {
      return { kind: normalized.startsWith('tests/manual/') ? 'manual_test' : 'test', patternField: 'path_patterns' };
    }
  }

  if (/^docs\/dev\/reports\/.+(?:proof|test-housecleaning|harness).+\.md$/.test(normalized)) {
    return { kind: 'proof_report', patternField: 'path_patterns' };
  }

  return null;
}

function entryPatterns(entry, field) {
  return Array.isArray(entry?.[field]) ? entry[field] : [];
}

function matchingEntries(entries, itemPath, field) {
  return entries.filter((entry) => entryPatterns(entry, field).some((pattern) => globMatches(pattern, itemPath)));
}

function commandIsRunnable(command) {
  return typeof command === 'string' && command.trim().length > 0 && !command.includes('<changed-test>');
}

function commandReason(entry) {
  return `${entry.id}: ${entry.worth}`;
}

function mergeCommand(out, entry) {
  if (!commandIsRunnable(entry.command)) return;
  const existing = out.find((item) => item.command === entry.command);
  if (existing) {
    if (!existing.source_entries.includes(entry.id)) existing.source_entries.push(entry.id);
    return;
  }
  out.push({
    command: entry.command,
    reason: commandReason(entry),
    source_entries: [entry.id],
  });
}

function coveredStatus(entries) {
  const statuses = unique(entries.map((entry) => entry.status || 'unknown'));
  if (statuses.includes('active')) return 'active';
  if (statuses.includes('manual_only') || statuses.includes('quarantined')) return 'guarded';
  if (statuses.includes('retired')) return 'retired';
  return 'unknown';
}

export function evaluateProofWorth({ changedFiles, repoRoot = process.cwd(), registry, registryPath = defaultProofRegistryPath } = {}) {
  const entries = Array.isArray(registry?.entries) ? registry.entries : [];
  const assets = [];
  const commands = [];
  const guarded = [];
  const failures = [];

  for (const itemPath of unique((changedFiles || []).map((file) => normalizeProofPath(file, repoRoot))).filter(Boolean)) {
    const asset = classifyProofAsset(itemPath);
    if (!asset) continue;

    const exists = fs.existsSync(path.join(repoRoot, itemPath));
    const matches = matchingEntries(entries, itemPath, asset.patternField);
    const retired = matches.filter((entry) => entry.status === 'retired');
    const active = matches.filter((entry) => entry.status === 'active');
    const guardedEntries = matches.filter((entry) => entry.status === 'manual_only' || entry.status === 'quarantined');
    const assetOut = {
      path: itemPath,
      kind: asset.kind,
      deleted: !exists,
      pattern_field: asset.patternField,
      entries: matches.map((entry) => entry.id),
      coverage: matches.length ? coveredStatus(matches) : 'missing',
      status: 'passed',
    };

    if (!exists) {
      assetOut.coverage = matches.length ? 'deleted_registered_cleanup' : 'deleted_unregistered_cleanup';
      assets.push(assetOut);
      continue;
    }

    if (retired.length) {
      assetOut.status = 'failed';
      assetOut.failure = 'retired_proof_touched';
      failures.push({
        path: itemPath,
        kind: asset.kind,
        reason: 'retired_proof_touched',
        entries: retired.map((entry) => entry.id),
        message: 'Touched proof asset matches a retired registry entry.',
      });
    } else if (!matches.length) {
      assetOut.status = 'failed';
      assetOut.failure = 'missing_registry_entry';
      failures.push({
        path: itemPath,
        kind: asset.kind,
        reason: 'missing_registry_entry',
        entries: [],
        message: 'Touched executable test, helper, fixture, or proof asset has no proof-worth registry entry.',
      });
    }

    for (const entry of active) {
      if (!commandIsRunnable(entry.command)) {
        assetOut.status = 'failed';
        assetOut.failure = 'missing_default_command';
        failures.push({
          path: itemPath,
          kind: asset.kind,
          reason: 'missing_default_command',
          entries: [entry.id],
          message: 'Active proof registry entry lacks an exact default command.',
        });
        continue;
      }
      mergeCommand(commands, entry);
    }

    for (const entry of guardedEntries) {
      guarded.push({
        path: itemPath,
        entry: entry.id,
        status: entry.status,
        guard: entry.guard,
        command: entry.command,
      });
    }

    assets.push(assetOut);
  }

  const failed = failures.length > 0;
  const payload = {
    status: failed ? 'failed' : 'passed',
    passed: !failed,
    failed,
    registry: registryPath,
    changed_asset_count: assets.length,
    assets,
    commands,
    guarded,
    failures,
  };
  if (failed) payload.code = proofWorthFailureCode;
  return payload;
}
