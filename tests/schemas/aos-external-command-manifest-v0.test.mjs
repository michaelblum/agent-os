import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { externalRouteConditionSamples, externalRouteMatches } from '../../scripts/lib/external-command-routes.mjs';

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

function parseCurrentMigrationMatrixForms(markdown) {
  const lines = markdown.split(/\r?\n/);
  const anchor = lines.findIndex((line) => line.startsWith('Current migration matrix'));
  assert.notEqual(anchor, -1, 'command-surface docs must contain the current migration matrix');

  const header = '| Form | Current disposition | Move-out criterion | Public promotion criterion |';
  const tableStart = lines.findIndex((line, index) => index > anchor && line.trim() === header);
  assert.notEqual(tableStart, -1, 'current migration matrix must keep the expected table header');

  const rows = [];
  for (const line of lines.slice(tableStart + 2)) {
    if (!line.startsWith('|')) break;
    const columns = line.split('|').slice(1, -1).map((column) => column.trim());
    if (columns.length < 1 || columns[0] === '') continue;
    const form = columns[0].match(/^`([^`]+)`$/)?.[1];
    assert.ok(form, `current migration matrix form cell must be a single code span: ${columns[0]}`);
    rows.push(form);
  }

  assert.ok(rows.length > 0, 'current migration matrix must contain form rows');
  return rows;
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

test('generated command manifests advertise source provenance', async () => {
  const registry = await loadJson(registryPath);
  const external = await loadJson(manifestPath);

  assert.deepEqual(registry.generated, {
    artifact: true,
    description: 'Generated command manifest. Edit source fragments, not this file.',
    source_owner: 'manifests/AGENTS.md',
    source_path: 'manifests/commands/source/aos/',
    regeneration_command: 'node scripts/generate-command-manifests.mjs',
  });
  assert.deepEqual(external.generated, {
    artifact: true,
    description: 'Generated command manifest. Edit source fragments, not this file.',
    source_owner: 'manifests/AGENTS.md',
    source_path: 'manifests/commands/source/external/',
    regeneration_command: 'node scripts/generate-command-manifests.mjs',
  });
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

test('external help passthrough routes stay script-owned', async () => {
  const manifest = await loadJson(manifestPath);
  const passthroughRoutes = manifest.commands.filter((command) => command.help_passthrough === true);

  assert.ok(
    passthroughRoutes.some((command) => command.path.join(' ') === 'dev gh'),
    'dev gh must declare script-owned help passthrough',
  );

  for (const command of passthroughRoutes) {
    assert.notEqual(command.executable, '$AOS_PATH', `${command.path.join(' ')} help passthrough must not route to Swift`);
    assert.ok(
      (command.argv_prefix || []).some((arg) => arg.startsWith('scripts/') || arg.startsWith('packages/')),
      `${command.path.join(' ')} help passthrough must name an external script target`,
    );
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
    '__permissions',
    '__daemon',
    '__runtime',
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

test('ready public route is externally composed', async () => {
  const manifest = await loadJson(manifestPath);
  const ready = manifest.commands.find((command) => command.path.join(' ') === 'ready');
  assert.ok(ready, 'ready route missing');
  assert.equal(ready.executable, '/usr/bin/env');
  assert.deepEqual(ready.argv_prefix, ['node', 'scripts/aos-ready.mjs']);
  assert.equal(ready.env.AOS_PATH, '$AOS_PATH');
});

test('status public route is externally composed', async () => {
  const manifest = await loadJson(manifestPath);
  const status = manifest.commands.find((command) => command.path.join(' ') === 'status');
  assert.ok(status, 'status route missing');
  assert.equal(status.executable, '/usr/bin/env');
  assert.deepEqual(status.argv_prefix, ['node', 'scripts/aos-status.mjs']);
  assert.equal(status.env.AOS_PATH, '$AOS_PATH');
});

test('doctor public route is externally composed', async () => {
  const manifest = await loadJson(manifestPath);
  const doctor = manifest.commands.find((command) => command.path.join(' ') === 'doctor');
  assert.ok(doctor, 'doctor route missing');
  assert.equal(doctor.executable, '/usr/bin/env');
  assert.deepEqual(doctor.argv_prefix, ['node', 'scripts/aos-doctor.mjs']);
  assert.equal(doctor.env.AOS_PATH, '$AOS_PATH');
});

test('skills public routes are externally composed', async () => {
  const manifest = await loadJson(manifestPath);
  for (const subcommand of ['list', 'check', 'install']) {
    const command = manifest.commands.find((item) => item.path.join(' ') === `skills ${subcommand}`);
    assert.ok(command, `skills ${subcommand} route missing`);
    assert.equal(command.executable, '/usr/bin/env');
    assert.deepEqual(command.argv_prefix, ['node', 'scripts/aos-skills.mjs', subcommand]);
  }

  const root = manifest.commands.find((item) => item.path.join(' ') === 'skills');
  assert.ok(root, 'skills root route missing');
  assert.equal(root.executable, '/usr/bin/env');
  assert.deepEqual(root.argv_prefix, ['node', 'scripts/aos-skills.mjs']);

  for (const pathSuffix of ['companion', 'companion check', 'companion install']) {
    const route = manifest.commands.find((item) => item.path.join(' ') === `skills ${pathSuffix}`);
    assert.ok(route, `skills ${pathSuffix} route missing`);
    assert.equal(route.executable, '/usr/bin/env');
    assert.deepEqual(route.argv_prefix, ['node', 'scripts/aos-skills.mjs', ...pathSuffix.split(' ')]);
  }
});

test('permissions public workflow routes are externally composed', async () => {
  const manifest = await loadJson(manifestPath);
  for (const subcommand of ['check', 'preflight', 'setup', 'reset-runtime']) {
    const command = manifest.commands.find((item) => item.path.join(' ') === `permissions ${subcommand}`);
    assert.ok(command, `permissions ${subcommand} route missing`);
    assert.equal(command.executable, '/usr/bin/env');
    assert.deepEqual(command.argv_prefix, ['node', 'scripts/aos-permissions.mjs', subcommand]);
    assert.equal(command.env.AOS_PATH, '$AOS_PATH');
    assert.equal(command.env.AOS_INVOCATION_DISPLAY_NAME, '$AOS_INVOCATION_DISPLAY_NAME');
    assert.equal(command.env.AOS_RUNTIME_MODE, '$AOS_RUNTIME_MODE');
    assert.equal(command.env.AOS_STATE_ROOT, '$AOS_STATE_ROOT');
  }

  const fallback = manifest.commands.find((item) => item.path.join(' ') === 'permissions');
  assert.ok(fallback, 'permissions catch-all route missing');
  assert.equal(fallback.executable, '/usr/bin/env');
  assert.deepEqual(fallback.argv_prefix, ['node', 'scripts/aos-permissions.mjs']);
  assert.equal(fallback.env.AOS_PATH, '$AOS_PATH');
  assert.equal(fallback.env.AOS_INVOCATION_DISPLAY_NAME, '$AOS_INVOCATION_DISPLAY_NAME');
  assert.equal(fallback.env.AOS_RUNTIME_MODE, '$AOS_RUNTIME_MODE');
  assert.equal(fallback.env.AOS_STATE_ROOT, '$AOS_STATE_ROOT');
});

test('saved-ref do targets are routed before backend wrappers', async () => {
  const manifest = await loadJson(manifestPath);
  const refActions = ['click', 'hover', 'drag', 'scroll', 'type', 'key', 'fill', 'press', 'set-value', 'focus'];
  for (const action of refActions) {
    const routes = manifest.commands.filter((command) => command.path.join(' ') === `do ${action}`);
    const refRoute = routes.find((command) => command.argv_prefix.join(' ') === `node scripts/aos-do-ref.mjs ${action}`);
    assert.ok(refRoute, `do ${action} missing first-class saved-ref route`);
    assert.equal(refRoute.when?.child_arg_index, 0, `do ${action} ref route must inspect first target`);
    assert.equal(refRoute.when?.prefix, 'ref:', `do ${action} ref route must own ref: targets`);
    assert.equal(refRoute.env?.AOS_PATH, '$AOS_PATH', `do ${action} ref route must dispatch through configured AOS_PATH`);
  }

  for (const action of ['hover', 'scroll', 'type', 'key']) {
    const nativeRoute = manifest.commands.find((command) => command.argv_prefix.join(' ') === `node scripts/aos-do-native.mjs ${action}`);
    assert.deepEqual(nativeRoute?.when?.excluded_prefixes, ['browser:', 'ref:'], `do ${action} native route must not catch ref targets`);
  }
  const nativeClickRoute = manifest.commands.find((command) => command.argv_prefix.join(' ') === 'node scripts/aos-do-native.mjs click');
  assert.deepEqual(nativeClickRoute?.when?.excluded_prefixes, ['browser:', 'ref:', 'canvas:'], 'do click native route must not catch browser, ref, or canvas targets');
  for (const action of ['click', 'drag', 'set-value']) {
    const canvasRoute = manifest.commands.find((command) => command.argv_prefix.join(' ') === `node scripts/aos-do-canvas.mjs ${action}`);
    assert.equal(canvasRoute?.when?.child_arg_index, 0, `do ${action} canvas route must inspect first target`);
    assert.equal(canvasRoute?.when?.prefix, 'canvas:', `do ${action} canvas route must own canvas targets`);
  }
  const nativeDragRoute = manifest.commands.find((command) => command.argv_prefix.join(' ') === 'node scripts/aos-do-native.mjs drag');
  assert.deepEqual(nativeDragRoute?.when?.excluded_prefixes, ['browser:', 'ref:', 'canvas:'], 'do drag native route must not catch browser, ref, or canvas targets');
  const nativeSetValueRoute = manifest.commands.find((command) => command.argv_prefix.join(' ') === 'node scripts/aos-do-native.mjs set-value');
  assert.deepEqual(nativeSetValueRoute?.when?.excluded_prefixes, ['ref:', 'canvas:'], 'do set-value native route must not catch ref or canvas targets');
  for (const action of ['press', 'focus']) {
    const nativeRoute = manifest.commands.find((command) => command.argv_prefix.join(' ') === `node scripts/aos-do-native.mjs ${action}`);
    assert.deepEqual(nativeRoute?.when?.excluded_prefixes, ['ref:'], `do ${action} native route must not catch ref targets`);
  }
  const fillRoute = manifest.commands.find((command) => command.argv_prefix.join(' ') === 'node scripts/aos-do-browser.mjs fill');
  assert.deepEqual(fillRoute?.when?.excluded_prefixes, ['ref:'], 'do fill browser route must not catch ref targets');

  for (const relativePath of ['scripts/aos-do-browser.mjs', 'scripts/aos-do-native.mjs', 'scripts/aos-do-canvas.mjs']) {
    const source = await fs.readFile(path.join(repoRoot, relativePath), 'utf8');
    assert.equal(source.includes('maybeRunRefAction'), false, `${relativePath} must not own saved-ref dispatch`);
    assert.equal(source.includes('runRefAction'), false, `${relativePath} must not own saved-ref dispatch`);
  }
});

test('direct browser do targets route to browser wrappers instead of native fallbacks', async () => {
  const manifest = await loadJson(manifestPath);
  const directBrowserActions = ['click', 'hover', 'drag', 'scroll', 'type', 'key'];

  for (const action of directBrowserActions) {
    const routes = manifest.commands.filter((command) => command.path.join(' ') === `do ${action}`);
    const browserRoute = routes.find((command) => command.argv_prefix.join(' ') === `node scripts/aos-do-browser.mjs ${action}`);
    const nativeRoute = routes.find((command) => command.argv_prefix.join(' ') === `node scripts/aos-do-native.mjs ${action}`);
    const refRoute = routes.find((command) => command.argv_prefix.join(' ') === `node scripts/aos-do-ref.mjs ${action}`);
    const args = ['do', action, 'browser:work/ref-save'];

    assert.ok(browserRoute, `do ${action} missing direct browser route`);
    assert.equal(browserRoute.when?.child_arg_index, 0, `do ${action} browser route must inspect first target`);
    assert.equal(browserRoute.when?.prefix, 'browser:', `do ${action} browser route must own browser: targets`);
    assert.equal(externalRouteMatches(browserRoute, args), true, `do ${action} browser: target must match browser wrapper`);
    assert.equal(externalRouteMatches(nativeRoute, args), false, `do ${action} browser: target must not match native wrapper`);
    assert.equal(externalRouteMatches(refRoute, args), false, `do ${action} browser: target must not match saved-ref wrapper`);
  }
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
  const classifier = source.match(/private func currentOwnershipClassification\([\s\S]*?\n\}/);
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
  ]);
  const expectedWrapperFiles = new Map([
    ['__daemon', ['scripts/aos-ready.mjs', 'scripts/aos-doctor.mjs', 'scripts/aos-permissions.mjs']],
    ['__runtime', ['scripts/aos-ready.mjs', 'scripts/aos-status.mjs', 'scripts/aos-doctor.mjs']],
    ['__permissions', ['scripts/aos-ready.mjs', 'scripts/aos-status.mjs', 'scripts/aos-doctor.mjs', 'scripts/aos-permissions.mjs']],
    ['__render', ['scripts/aos-show-render.mjs']],
    ['__see', ['scripts/aos-see-native.mjs']],
    ['__say', ['scripts/aos-say.mjs']],
    ['__do', ['scripts/aos-do-native.mjs', 'scripts/aos-do-canvas.mjs']],
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
    const sharedCompositionSource = await fs.readFile(path.join(repoRoot, 'scripts/lib/aos-facts.mjs'), 'utf8');
    for (const relativePath of files) {
      const source = await fs.readFile(path.join(repoRoot, relativePath), 'utf8');
      assert.ok(
        `${source}\n${sharedCompositionSource}`.includes(primitive),
        `${relativePath} must invoke ${primitive} directly or through scripts/lib/aos-facts.mjs`,
      );
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
    for (const sample of externalRouteConditionSamples(routes)) {
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

test('registry conditional output modes reference declared form flags', async () => {
  const registry = await loadJson(registryPath);
  const validDefaultModes = new Set(['none', 'text', 'json', 'ndjson']);

  for (const command of registry.commands) {
    for (const form of command.forms) {
      const conditionalModes = form.output?.conditional_modes ?? [];
      if (!conditionalModes.length) continue;
      assert.ok(Array.isArray(conditionalModes), `${form.id} output.conditional_modes must be an array`);

      const declaredFlags = new Set(
        form.args
          .filter((arg) => arg.kind === 'flag')
          .map((arg) => arg.token),
      );

      for (const mode of conditionalModes) {
        assert.ok(validDefaultModes.has(mode.default_mode), `${form.id} conditional output default_mode is invalid`);
        assert.ok(typeof mode.summary === 'string' && mode.summary.length > 0, `${form.id} conditional output summary is required`);
        assert.ok(Array.isArray(mode.when_flags) && mode.when_flags.length > 0, `${form.id} conditional output must declare when_flags`);
        assert.notEqual(mode.default_mode, form.output.default_mode, `${form.id} conditional output must differ from the default output mode`);
        for (const flag of mode.when_flags) {
          assert.ok(declaredFlags.has(flag), `${form.id} conditional output references undeclared flag ${flag}`);
        }
      }
    }
  }
});

test('command surface docs describe registry visibility and conditional output metadata', async () => {
  const docs = await fs.readFile(path.join(repoRoot, 'docs/dev/command-surface.md'), 'utf8');

  assert.match(docs, /consumer_discovery: false/, 'command-surface docs must describe consumer discovery filtering');
  assert.match(docs, /direct help paths/, 'command-surface docs must keep direct maintainer help reachable');
  assert.match(docs, /output\.conditional_modes/, 'command-surface docs must describe conditional output metadata');
  assert.match(docs, /when_flags/, 'command-surface docs must require conditional output flags');
  assert.match(docs, /execution\.mutates_when_flags/, 'command-surface docs must describe conditional mutation metadata');
});

test('command surface dev migration matrix covers generated dev forms exactly once', async () => {
  const registry = await loadJson(registryPath);
  const docs = await fs.readFile(path.join(repoRoot, 'docs/dev/command-surface.md'), 'utf8');
  const dev = registry.commands.find((command) => command.path.join(' ') === 'dev');
  assert.ok(dev, 'generated command registry must include the dev command');

  const expectedForms = dev.forms.map((form) => concreteUsagePath(form)?.join(' '));
  assert.ok(expectedForms.every(Boolean), 'dev registry forms must expose concrete usage paths');

  const documentedForms = parseCurrentMigrationMatrixForms(docs);
  assert.equal(new Set(documentedForms).size, documentedForms.length, 'current migration matrix must not duplicate form rows');
  assert.equal(new Set(expectedForms).size, expectedForms.length, 'generated dev forms must not duplicate concrete usage paths');
  assert.deepEqual(
    documentedForms.slice().sort(),
    expectedForms.slice().sort(),
    'current migration matrix rows must match generated dev command forms',
  );
});

test('registry concrete usage forms have external routes', async () => {
  const manifest = await loadJson(manifestPath);
  const registry = await loadJson(registryPath);
  const externalPaths = new Set(manifest.commands.map((command) => command.path.join('\0')));
  const bootstrapFamilies = new Set(['serve', 'ready', 'permissions']);

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
