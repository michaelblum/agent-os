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

function externalRouteMatches(command, args) {
  if (args.length < command.path.length) return false;
  if (!command.path.every((part, index) => args[index] === part)) return false;
  if (!command.when) return true;
  const childArgs = args.slice(command.path.length);
  const childArgIndex = command.when.child_arg_index;
  if (childArgIndex === undefined) return true;
  const childArg = childArgs[childArgIndex];
  if (childArg === undefined) return command.when.child_arg_missing === true;
  if (command.when.child_arg_missing === true) return false;
  if (command.when.prefix !== undefined && !childArg.startsWith(command.when.prefix)) return false;
  if (command.when.excluded_prefixes?.some((prefix) => childArg.startsWith(prefix))) return false;
  if (command.when.excluded_values?.includes(childArg)) return false;
  return true;
}

function routeConditionSamples(routes) {
  const samples = new Set(['__missing__', 'example']);
  for (const route of routes) {
    if (!route.when) continue;
    if (route.when.prefix) samples.add(`${route.when.prefix}sample`);
    for (const prefix of route.when.excluded_prefixes ?? []) samples.add(`${prefix}sample`);
    for (const value of route.when.excluded_values ?? []) samples.add(value);
  }
  return [...samples];
}

test('canonical external command manifest matches the schema', () => {
  const result = validate(manifestPath);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test('external command manifest executable targets exist', async () => {
  const manifest = await loadJson(manifestPath);
  for (const command of manifest.commands) {
    const [first] = command.argv_prefix;
    const repoTargets = command.executable === '/usr/bin/env'
      ? command.argv_prefix.slice(1).filter((arg) => arg.startsWith('scripts/') || arg.startsWith('packages/'))
      : command.argv_prefix.filter((arg) => arg.startsWith('scripts/') || arg.startsWith('packages/'));

    for (const target of repoTargets) {
      assert.equal(existsSync(path.join(repoRoot, target)), true, `${command.path.join(' ')} script missing: ${target}`);
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

test('duplicate external command route conditions include dispatch predicates', async () => {
  const manifest = await loadJson(manifestPath);
  const byPath = new Map();
  for (const command of manifest.commands) {
    const key = command.path.join('\0');
    byPath.set(key, [...(byPath.get(key) ?? []), command]);
  }
  const predicateKeys = ['child_arg_missing', 'prefix', 'excluded_prefixes', 'excluded_values'];

  for (const [key, routes] of byPath) {
    if (routes.length <= 1) continue;
    for (const route of routes) {
      const predicates = predicateKeys.filter((predicateKey) => route.when[predicateKey] !== undefined);
      assert.notEqual(predicates.length, 0, `${key.replaceAll('\0', ' ')} duplicate condition only names an arg index`);
    }
  }
});

test('broad child-index-only conditions are limited to unknown family routers', async () => {
  const manifest = await loadJson(manifestPath);
  const paths = new Set(manifest.commands.map((command) => command.path.join('\0')));

  for (const command of manifest.commands) {
    if (!command.when) continue;
    const conditionKeys = Object.keys(command.when);
    const broadIndexOnly = conditionKeys.length === 1 && conditionKeys[0] === 'child_arg_index';
    if (!broadIndexOnly) continue;

    assert.equal(
      command.argv_prefix[1],
      'scripts/aos-family-router.mjs',
      `${command.path.join(' ')} broad condition must be a generic unknown-command router`,
    );
    assert.ok(
      command.argv_prefix.some((arg) => arg.startsWith('UNKNOWN_')),
      `${command.path.join(' ')} broad family router must emit an UNKNOWN_* code`,
    );
    assert.ok(
      [...paths].some((key) => key.startsWith(`${command.path.join('\0')}\0`)),
      `${command.path.join(' ')} broad family router must have explicit child routes`,
    );
  }
});

test('duplicate external command routes do not overlap for representative child args', async () => {
  const manifest = await loadJson(manifestPath);
  const byPath = new Map();
  for (const command of manifest.commands) {
    const key = command.path.join('\0');
    byPath.set(key, [...(byPath.get(key) ?? []), command]);
  }

  for (const [key, routes] of byPath) {
    if (routes.length <= 1) continue;
    const pathArgs = key.split('\0');
    for (const sample of routeConditionSamples(routes)) {
      const args = sample === '__missing__' ? pathArgs : [...pathArgs, sample];
      const matches = routes.filter((route) => externalRouteMatches(route, args));
      assert.ok(
        matches.length <= 1,
        `${pathArgs.join(' ')} duplicate routes overlap for child ${sample}: ${matches.map((route) => route.argv_prefix.join(' ')).join(' | ')}`,
      );
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
