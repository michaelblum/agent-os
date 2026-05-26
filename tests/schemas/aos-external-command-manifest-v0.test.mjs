import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-external-command-manifest-v0.schema.json');
const manifestPath = path.join(repoRoot, 'manifests/commands/aos-external-commands.json');
const registryPath = path.join(repoRoot, 'manifests/commands/aos-commands.json');
const mainSwiftPath = path.join(repoRoot, 'src/main.swift');

function validate(instancePath) {
  return spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(Path(sys.argv[2]).read_text())
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema)
errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`,
      schemaPath,
      instancePath,
    ],
    { encoding: 'utf8' },
  );
}

async function loadJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function concreteUsagePath(form) {
  if (!form.usage?.startsWith('aos ')) return null;
  const concrete = [];
  for (const token of form.usage.split(/\s+/).slice(1)) {
    if (
      token.startsWith('[')
      || token.startsWith('(')
      || token.startsWith('<')
      || token.startsWith('--')
    ) {
      break;
    }
    concrete.push(token);
  }
  return concrete;
}

test('canonical external command manifest matches the schema', () => {
  const result = validate(manifestPath);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test('external command manifest executable targets exist', async () => {
  const manifest = await loadJson(manifestPath);
  for (const command of manifest.commands) {
    const [first, second] = command.argv_prefix;
    if (command.executable === '/usr/bin/env' && first === 'node' && second?.startsWith('scripts/')) {
      assert.equal(existsSync(path.join(repoRoot, second)), true, `${command.path.join(' ')} script missing: ${second}`);
    }
    if (command.executable === '/bin/bash' && first?.startsWith('scripts/')) {
      assert.equal(existsSync(path.join(repoRoot, first)), true, `${command.path.join(' ')} script missing: ${first}`);
    }
  }
});

test('external command manifest only routes bootstrap families to Swift', async () => {
  const manifest = await loadJson(manifestPath);
  const allowedSwiftRoutes = new Map([
    ['serve', ['__serve']],
    ['status', ['__status']],
    ['ready', ['__ready']],
    ['doctor', ['__doctor']],
    ['permissions', ['__permissions']],
  ]);

  for (const command of manifest.commands) {
    if (command.executable !== '$AOS_PATH') continue;
    const publicPath = command.path.join(' ');
    const allowedPrefix = allowedSwiftRoutes.get(publicPath);
    assert.ok(allowedPrefix, `${publicPath} must route through an external script, not $AOS_PATH`);
    assert.deepEqual(command.argv_prefix, allowedPrefix, `${publicPath} must use the bootstrap primitive only`);
  }
});

test('Swift entry point exposes only private bootstrap and native primitives', async () => {
  const source = await fs.readFile(mainSwiftPath, 'utf8');
  const commandSwitch = source.match(/switch command \{([\s\S]*?)\n\s*default:/);
  assert.ok(commandSwitch, 'src/main.swift must keep a visible top-level command switch');

  const allowedCases = new Set([
    '__serve',
    '__status',
    '__ready',
    '__doctor',
    '__permissions',
    '__render',
    '__see',
    '__say',
    '__do',
  ]);
  const cases = [...commandSwitch[1].matchAll(/case "([^"]+)":/g)].map((match) => match[1]);
  assert.deepEqual(cases.filter((name) => !allowedCases.has(name)), [], 'top-level Swift command cases must stay private');

  for (const required of allowedCases) {
    assert.ok(cases.includes(required), `missing private Swift primitive ${required}`);
  }
  assert.equal(source.includes('case "help"'), false, 'help must stay external');
  assert.equal(source.includes('helpCommand(args:'), false, 'Swift help renderer must not return');
  assert.equal(source.includes('buildCommandRegistry'), false, 'Swift command registry must not return');
});

test('duplicate external command paths are explicitly condition-gated', async () => {
  const manifest = await loadJson(manifestPath);
  const byPath = new Map();
  for (const command of manifest.commands) {
    const key = command.path.join('\0');
    byPath.set(key, [...(byPath.get(key) ?? []), command]);
  }

  for (const [key, routes] of byPath) {
    if (routes.length <= 1) continue;
    for (const route of routes) {
      assert.ok(route.when, `${key.replaceAll('\0', ' ')} duplicate route is missing a when condition`);
    }
  }
});

test('registry command paths have external routes', async () => {
  const manifest = await loadJson(manifestPath);
  const registry = await loadJson(registryPath);
  const externalPaths = new Set(manifest.commands.map((command) => command.path.join('\0')));

  for (const command of registry.commands) {
    assert.equal(externalPaths.has(command.path.join('\0')), true, `${command.path.join(' ')} missing external route`);
  }
});

test('registry concrete usage forms have external routes', async () => {
  const manifest = await loadJson(manifestPath);
  const registry = await loadJson(registryPath);
  const externalPaths = new Set(manifest.commands.map((command) => command.path.join('\0')));
  const bootstrapFamilies = new Set(['serve', 'status', 'ready', 'doctor', 'permissions']);

  for (const command of registry.commands) {
    for (const form of command.forms) {
      const concrete = concreteUsagePath(form);
      if (!concrete?.length) continue;
      if (concrete[0] === 'help') continue;
      if (bootstrapFamilies.has(concrete[0])) continue;
      assert.equal(externalPaths.has(concrete.join('\0')), true, `${form.id} missing external route: ${concrete.join(' ')}`);
    }
  }
});
