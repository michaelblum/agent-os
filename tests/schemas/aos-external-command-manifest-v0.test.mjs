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
const operatorSwiftPath = path.join(repoRoot, 'src/commands/operator.swift');

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
  const aosUsage = form.usage?.startsWith('aos ')
    ? form.usage
    : form.usage?.split(/\s+\|\s+/).find((part) => part.startsWith('aos '));
  if (!aosUsage) return null;
  const concrete = [];
  for (const token of aosUsage.split(/\s+/).slice(1)) {
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

function usageFlags(form) {
  const matches = form.usage?.matchAll(/--[a-zA-Z0-9][a-zA-Z0-9_-]*/g) ?? [];
  return [...new Set([...matches].map((match) => match[0]))];
}

function exampleFlags(form) {
  return [
    ...new Set(
      (form.examples ?? [])
        .flatMap((example) => [...example.matchAll(/--[a-zA-Z0-9][a-zA-Z0-9_-]*/g)])
        .map((match) => match[0]),
    ),
  ];
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

function collectManifestPlaceholders(value, out = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectManifestPlaceholders(item, out);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectManifestPlaceholders(item, out);
  } else if (typeof value === 'string' && value.startsWith('$')) {
    out.add(value.split('/')[0]);
  }
  return out;
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

test('external command manifest placeholders are resolved by Swift dispatcher', async () => {
  const manifest = await loadJson(manifestPath);
  const source = await fs.readFile(path.join(repoRoot, 'src/shared/external-command-dispatch.swift'), 'utf8');
  const resolved = new Set([...source.matchAll(/value == "(\$[A-Z0-9_]+)"/g)].map((match) => match[1]));
  resolved.add('$REPO_ROOT');

  for (const placeholder of collectManifestPlaceholders(manifest)) {
    assert.ok(resolved.has(placeholder), `manifest placeholder is not resolved by Swift dispatcher: ${placeholder}`);
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

test('Swift external dispatcher does not consume flags as --repo values', async () => {
  const source = await fs.readFile(path.join(repoRoot, 'src/shared/external-command-dispatch.swift'), 'utf8');
  const rawOptionValue = source.match(/private func rawOptionValue\([\s\S]*?\n\}/);
  assert.ok(rawOptionValue, 'external dispatcher must keep rawOptionValue visible');
  assert.ok(
    rawOptionValue[0].includes('!value.hasPrefix("--")'),
    'external dispatcher must leave flag-shaped values for external parsers to classify as MISSING_ARG',
  );
});

test('ready ownership classifier accepts managed parent child daemon shape', async () => {
  const source = await fs.readFile(operatorSwiftPath, 'utf8');
  const classifier = source.match(/private func currentOwnershipState\([\s\S]*?\n\}/);
  assert.ok(classifier, 'ready ownership classifier must stay visible');
  assert.ok(
    classifier[0].includes('parentProcessID(of: ownerPID) == servicePID'),
    'ready must treat launchd-managed aos serve parent plus aos __serve socket owner as consistent',
  );
});

test('private Swift primitives are reachable only through expected external wrappers', async () => {
  const manifest = await loadJson(manifestPath);
  const expectedBootstrapRoutes = new Map([
    ['__serve', 'serve'],
    ['__status', 'status'],
    ['__ready', 'ready'],
    ['__doctor', 'doctor'],
    ['__permissions', 'permissions'],
  ]);
  const expectedWrapperFiles = new Map([
    ['__render', ['scripts/aos-show-render.mjs']],
    ['__see', ['scripts/aos-see-native.mjs']],
    ['__say', ['scripts/aos-say.mjs']],
    ['__do', ['scripts/aos-do-native.mjs']],
  ]);
  const privatePrimitives = new Set([...expectedBootstrapRoutes.keys(), ...expectedWrapperFiles.keys()]);

  for (const command of manifest.commands) {
    for (const arg of command.argv_prefix) {
      if (!privatePrimitives.has(arg)) continue;
      assert.equal(
        command.executable,
        '$AOS_PATH',
        `${command.path.join(' ')} must not pass ${arg} through a non-Swift executable`,
      );
      assert.equal(
        expectedBootstrapRoutes.get(arg),
        command.path.join(' '),
        `${command.path.join(' ')} must not expose private primitive ${arg} directly`,
      );
    }
  }

  for (const [primitive, files] of expectedWrapperFiles) {
    for (const relativePath of files) {
      const source = await fs.readFile(path.join(repoRoot, relativePath), 'utf8');
      assert.ok(source.includes(primitive), `${relativePath} must invoke ${primitive}`);
    }
  }

  const scriptFiles = (await fs.readdir(path.join(repoRoot, 'scripts')))
    .filter((file) => file.endsWith('.mjs'))
    .map((file) => `scripts/${file}`);
  for (const relativePath of scriptFiles) {
    const source = await fs.readFile(path.join(repoRoot, relativePath), 'utf8');
    for (const primitive of privatePrimitives) {
      const invokesPrimitive = new RegExp(`\\[\\s*['"]${primitive}['"]`).test(source);
      if (!invokesPrimitive) continue;
      const allowed = expectedWrapperFiles.get(primitive) ?? [];
      assert.ok(
        allowed.includes(relativePath),
        `${relativePath} must not invoke private Swift primitive ${primitive}`,
      );
    }
  }
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
  const registryPaths = new Map();

  for (const command of registry.commands) {
    const key = command.path.join('\0');
    registryPaths.set(key, (registryPaths.get(key) ?? 0) + 1);
    assert.equal(externalPaths.has(key), true, `${command.path.join(' ')} missing external route`);
  }

  for (const [key, count] of registryPaths) {
    assert.equal(count, 1, `${key.replaceAll('\0', ' ')} registry command path is duplicated`);
  }
});

test('registry form ids are unique and usage paths stay under their command', async () => {
  const registry = await loadJson(registryPath);
  const formIds = new Map();

  for (const command of registry.commands) {
    const commandPath = command.path.join(' ');
    for (const form of command.forms) {
      formIds.set(form.id, [...(formIds.get(form.id) ?? []), commandPath]);

      const concrete = concreteUsagePath(form);
      if (!concrete?.length) continue;
      assert.deepEqual(
        concrete.slice(0, command.path.length),
        command.path,
        `${form.id} usage path ${concrete.join(' ')} must stay under registry command ${commandPath}`,
      );
    }
  }

  for (const [id, owners] of formIds) {
    assert.equal(owners.length, 1, `${id} registry form id is duplicated under: ${owners.join(', ')}`);
  }
});

test('registry usage flags are declared as form arguments', async () => {
  const registry = await loadJson(registryPath);

  for (const command of registry.commands) {
    for (const form of command.forms) {
      const declaredFlags = new Set(
        form.args
          .filter((arg) => arg.kind === 'flag')
          .map((arg) => arg.token),
      );

      for (const flag of usageFlags(form)) {
        assert.ok(
          declaredFlags.has(flag),
          `${form.id} usage mentions ${flag} but does not declare it as a flag argument`,
        );
      }
    }
  }
});

test('registry example flags are declared as form arguments', async () => {
  const registry = await loadJson(registryPath);

  for (const command of registry.commands) {
    for (const form of command.forms) {
      const declaredFlags = new Set(
        form.args
          .filter((arg) => arg.kind === 'flag')
          .map((arg) => arg.token),
      );

      for (const flag of exampleFlags(form)) {
        assert.ok(
          declaredFlags.has(flag),
          `${form.id} examples mention ${flag} but do not declare it as a flag argument`,
        );
      }
    }
  }
});

test('tell session mode flags are boolean selectors', async () => {
  const registry = await loadJson(registryPath);
  const tell = registry.commands.find((command) => command.path.join(' ') === 'tell');
  assert.ok(tell, 'tell command must exist in registry');

  for (const [formID, token] of [
    ['tell-register', '--register'],
    ['tell-unregister', '--unregister'],
  ]) {
    const form = tell.forms.find((candidate) => candidate.id === formID);
    assert.ok(form, `${formID} registry form must exist`);
    const arg = form.args.find((candidate) => candidate.kind === 'flag' && candidate.token === token);
    assert.ok(arg, `${formID} must expose ${token}`);
    assert.equal(arg.value_type, 'bool', `${formID} ${token} is a mode selector, not a value-taking flag`);
  }
});

test('help registry forms expose their json flag metadata', async () => {
  const registry = await loadJson(registryPath);
  const help = registry.commands.find((command) => command.path.join(' ') === 'help');
  assert.ok(help, 'help command must exist in registry');

  for (const form of help.forms) {
    assert.equal(form.output?.supports_json_flag, true, `${form.id} must advertise JSON output support`);
    assert.ok(
      form.args.some((arg) => arg.kind === 'flag' && arg.token === '--json' && arg.value_type === 'bool'),
      `${form.id} must expose --json as a boolean flag argument`,
    );
  }
});

test('operational registry forms expose json flag metadata', async () => {
  const registry = await loadJson(registryPath);
  const requiredForms = new Set([
    'content-status',
    'doctor',
    'status',
    'reset',
    'clean',
    'permissions-check',
    'permissions-preflight',
    'permissions-setup',
    'permissions-reset-runtime',
    'service-install',
    'service-start',
    'service-stop',
    'service-restart',
    'service-status',
    'runtime-install',
    'runtime-status',
    'runtime-path',
    'introspect-review',
  ]);
  const forms = new Map();

  for (const command of registry.commands) {
    for (const form of command.forms) {
      forms.set(form.id, form);
    }
  }

  for (const id of requiredForms) {
    const form = forms.get(id);
    assert.ok(form, `${id} registry form must exist`);
    assert.equal(form.output?.supports_json_flag, true, `${id} must advertise JSON output support`);
    assert.ok(
      form.args.some((arg) => arg.kind === 'flag' && arg.token === '--json' && arg.value_type === 'bool'),
      `${id} must expose --json as a boolean flag argument`,
    );
  }
});

test('json-capable registry forms expose json flag metadata', async () => {
  const registry = await loadJson(registryPath);

  for (const command of registry.commands) {
    for (const form of command.forms) {
      if (form.output?.supports_json_flag !== true) continue;
      assert.ok(
        form.args.some((arg) => arg.kind === 'flag' && arg.token === '--json' && arg.value_type === 'bool'),
        `${form.id} must expose --json as a boolean flag argument`,
      );
      assert.match(form.usage, /--json/, `${form.id} usage must mention --json`);
    }
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

test('external-only routes are explicitly private helper paths', async () => {
  const manifest = await loadJson(manifestPath);
  const registry = await loadJson(registryPath);
  const registryPaths = new Set(registry.commands.map((command) => command.path.join('\0')));
  const formPaths = new Set();

  for (const command of registry.commands) {
    for (const form of command.forms) {
      const concrete = concreteUsagePath(form);
      if (concrete?.length) formPaths.add(concrete.join('\0'));
    }
  }

  for (const command of manifest.commands) {
    const key = command.path.join('\0');
    if (registryPaths.has(key) || formPaths.has(key)) continue;

    assert.ok(
      command.path.some((part) => part.startsWith('_')),
      `${command.path.join(' ')} is externally routed but not discoverable in the registry`,
    );
  }
});

test('piped registry usage forms resolve to their aos command path', async () => {
  const registry = await loadJson(registryPath);
  const logCommand = registry.commands.find((command) => command.path.join(' ') === 'log');
  const logStream = logCommand?.forms.find((form) => form.id === 'log-stream');

  assert.ok(logStream, 'log-stream registry form must exist');
  assert.equal(logStream.usage.includes('| aos log'), true, 'log-stream must preserve its piped usage example');
  assert.deepEqual(concreteUsagePath(logStream), ['log']);
});
