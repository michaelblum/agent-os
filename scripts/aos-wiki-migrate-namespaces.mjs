#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function error(message, code) {
  process.stderr.write(`${JSON.stringify({ code, error: message }, null, 2)}\n`);
  process.exit(1);
}

function unknownArg(arg) {
  error(`Unknown ${arg.startsWith('--') ? 'flag' : 'argument'}: ${arg}`, arg.startsWith('--') ? 'UNKNOWN_FLAG' : 'UNKNOWN_ARG');
}

function runtimeMode() {
  return process.env.AOS_RUNTIME_MODE === 'installed' ? 'installed' : 'repo';
}

function stateRoot() {
  return path.resolve(process.env.AOS_STATE_ROOT || path.join(os.homedir(), '.config/aos'));
}

function defaultWikiRoot() {
  return path.join(stateRoot(), runtimeMode(), 'wiki');
}

function expandHome(value) {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function valueAfter(args, key) {
  const idx = args.indexOf(key);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function migrateIfNeeded(wikiRoot) {
  const aosDir = path.join(wikiRoot, 'aos');
  const legacy = ['entities', 'concepts', 'plugins'];
  const presentLegacy = legacy.filter((name) => fs.existsSync(path.join(wikiRoot, name)));

  if (presentLegacy.length === 0) return false;

  const backup = path.join(path.dirname(wikiRoot), `${path.basename(wikiRoot)}.pre-namespace-bak`);
  if (!fs.existsSync(backup)) {
    fs.cpSync(wikiRoot, backup, { recursive: true, force: false, errorOnExist: true });
  }

  fs.mkdirSync(aosDir, { recursive: true });

  for (const name of presentLegacy) {
    const src = path.join(wikiRoot, name);
    const dst = path.join(aosDir, name);
    if (fs.existsSync(dst)) continue;
    fs.renameSync(src, dst);
  }
  return true;
}

const args = process.argv.slice(2);
const asJSON = args.includes('--json');
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--json') continue;
  if (arg === '--wiki-root') {
    i += 1;
    if (i >= args.length || args[i].startsWith('--')) error('--wiki-root requires a value', 'MISSING_ARG');
    continue;
  }
  unknownArg(arg);
}

const wikiRoot = path.resolve(expandHome(valueAfter(args, '--wiki-root') || defaultWikiRoot()));

try {
  const migrated = migrateIfNeeded(wikiRoot);
  if (asJSON) {
    process.stdout.write(`${JSON.stringify({ status: 'ok', migrated, wiki_root: wikiRoot }, null, 2)}\n`);
  } else if (migrated) {
    process.stdout.write(`Migrated wiki at ${wikiRoot} -> ${wikiRoot}/aos/\n`);
  } else {
    process.stdout.write('Already migrated (aos/ namespace present or no legacy dirs found). No-op.\n');
  }
} catch (err) {
  error(`Migration failed: ${err.message}`, 'WIKI_MIGRATE_FAILED');
}
