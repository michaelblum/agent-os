import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { externalRouteConditionSamples, externalRouteMatches } from '../../scripts/lib/external-command-routes.mjs';
import {
  EXTERNAL_SPAWN_REVIEWED_BUNDLE_MAX_BYTES,
  EXTERNAL_SPAWN_REVIEWED_SOURCE_MAX_BYTES,
  assertReviewedExternalSpawnModuleClosure,
  composeReviewedExternalSpawnBundle,
  readCanonicalRegularFile,
  reviewedDependencySetDigest,
  validateExternalCommandManifestV1,
} from '../../scripts/lib/external-command-manifest-v1.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-external-command-manifest-v1.schema.json');
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

async function listModuleFiles(root) {
  const files = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listModuleFiles(absolute));
    if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(absolute);
  }
  return files;
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

test('v1 schema rejects stale wire headers and incomplete or unsafe spawn registrations', async () => {
  const canonical = await loadJson(manifestPath);
  const registeredIndex = canonical.commands.findIndex((command) => command.spawn_registration !== undefined);
  assert.ok(registeredIndex >= 0);
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-external-manifest-v1-schema-'));
  try {
    const mutate = (callback) => {
      const value = structuredClone(canonical);
      callback(value.commands[registeredIndex], value);
      return value;
    };
    const invalidInstances = [
      { ...canonical, schema_version: 1 },
      mutate((command) => { command.spawn_registration.extra = true; }),
      mutate((command) => { command.spawn_registration.expected_script_identity = '../escape.mjs'; }),
      mutate((command) => { command.env.AOS_EXTERNAL_DISPATCH_BINDING_TOKEN = 'caller-authored'; }),
      mutate((command) => { command.executable = '$AOS_PATH'; }),
      mutate((command) => { command.argv_prefix = ['node', 'arbitrary.mjs']; }),
      mutate((command) => { command.help_passthrough = true; }),
      mutate((command) => { delete command.cwd; }),
      mutate((command) => { delete command.stdio; }),
      mutate((command) => { delete command.env; }),
      mutate((command) => { command.env.OPENSSL_CONF = '/tmp/inject.cnf'; }),
      mutate((command) => { command.spawn_registration.activation_predicate.grammar = 'all_listen'; }),
      mutate((command) => { delete command.spawn_registration.executable_resolution_policy.designated_requirement; }),
      mutate((command) => { command.spawn_registration.executable_resolution_policy.signing_team_identifier = 'WRONGTEAM'; }),
      mutate((command) => { command.spawn_registration.executable_resolution_policy.requires_hardened_runtime = false; }),
      mutate((command) => { command.spawn_registration.reviewed_dependencies.pop(); }),
      mutate((command, value) => {
        const target = value.commands.find((candidate, index) => index !== registeredIndex && candidate.path[0] !== 'listen');
        target.spawn_registration = structuredClone(command.spawn_registration);
      }),
      mutate((_command, value) => {
        const target = value.commands.find((candidate, index) => index !== registeredIndex);
        target.stdio = 'registered_bundle';
      }),
    ];
    for (const [index, instance] of invalidInstances.entries()) {
      const file = path.join(temporaryRoot, `invalid-${index}.json`);
      await fs.writeFile(file, `${JSON.stringify(instance)}\n`);
      const result = validate(file);
      assert.notEqual(result.status, 0, `invalid v1 instance ${index} unexpectedly passed`);
    }
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('strict v1 reader rejects cryptographically inconsistent reviewed dependency evidence', async () => {
  const canonical = await loadJson(manifestPath);
  validateExternalCommandManifestV1(canonical, { canonicalAggregate: true });
  const digestDrift = structuredClone(canonical);
  digestDrift.commands.find((command) => command.spawn_registration)
    .spawn_registration.reviewed_dependencies[0].digest = '0'.repeat(64);
  assert.throws(
    () => validateExternalCommandManifestV1(digestDrift, { canonicalAggregate: true }),
    /reviewed_dependency_set_digest/u,
  );
  const setDrift = structuredClone(canonical);
  setDrift.commands.find((command) => command.spawn_registration)
    .spawn_registration.reviewed_dependency_set_digest = '0'.repeat(64);
  assert.throws(
    () => validateExternalCommandManifestV1(setDrift, { canonicalAggregate: true }),
    /reviewed_dependency_set_digest/u,
  );
});

test('canonical registered sources reject symlink substitution', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-external-canonical-file-'));
  try {
    const target = path.join(temporaryRoot, 'target.mjs');
    const link = path.join(temporaryRoot, 'link.mjs');
    await fs.writeFile(target, 'export const value = true;\n');
    await fs.symlink(target, link);
    await assert.rejects(() => readCanonicalRegularFile(link), /canonical non-symlink regular file/u);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('reviewed listen sources compose into a tokenless in-memory ESM bundle', async () => {
  const manifest = await loadJson(manifestPath);
  const registration = manifest.commands.find((command) => command.spawn_registration).spawn_registration;
  const readReviewed = async (identity, expectedDigest) => {
    const bytes = await fs.readFile(path.join(repoRoot, identity));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expectedDigest);
    return bytes;
  };
  const entry = await readReviewed(registration.expected_script_identity, registration.expected_script_digest);
  const dependencies = new Map();
  for (const dependency of registration.reviewed_dependencies) {
    dependencies.set(dependency.identity, await readReviewed(dependency.identity, dependency.digest));
  }
  const bundle = composeReviewedExternalSpawnBundle({
    entryBytes: entry,
    dependencyBytes: dependencies,
    reviewedSetDigest: registration.reviewed_dependency_set_digest,
    lifecycleParentPID: process.pid,
  });
  assert.doesNotMatch(bundle.toString('utf8'), /AOS_EXTERNAL_DISPATCH_BINDING_TOKEN/u);
  assert.doesNotMatch(bundle.toString('utf8'), /one_time_binding_token/u);
  const result = spawnSync(process.execPath, ['--input-type=module', '-', 'listen'], {
    cwd: repoRoot,
    input: bundle,
    encoding: 'utf8',
    env: {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      AOS_PATH: path.join(repoRoot, 'aos'),
      AOS_RUNTIME_MODE: 'repo',
      AOS_STATE_ROOT: path.join(os.tmpdir(), 'aos-tokenless-bundle-proof'),
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /listen requires a channel/u);
  assert.doesNotMatch(result.stderr, /data:text\/javascript/u);
});

test('reviewed Node closure rejects extra module edges and bounded launch-material growth', async () => {
  const manifest = await loadJson(manifestPath);
  const registration = manifest.commands.find((command) => command.spawn_registration).spawn_registration;
  const entryBytes = await fs.readFile(path.join(repoRoot, registration.expected_script_identity));
  const dependencyBytes = new Map(await Promise.all(registration.reviewed_dependencies.map(async (dependency) => [
    dependency.identity,
    await fs.readFile(path.join(repoRoot, dependency.identity)),
  ])));
  const withDependency = (identity, source) => new Map(dependencyBytes).set(identity, Buffer.from(source));

  assert.throws(
    () => assertReviewedExternalSpawnModuleClosure({
      entryBytes: Buffer.concat([entryBytes, Buffer.from("\nimport('./late-microphone.mjs');\n")]),
      dependencyBytes,
    }),
    /unsupported dynamic/u,
  );
  assert.throws(
    () => assertReviewedExternalSpawnModuleClosure({
      entryBytes: Buffer.concat([entryBytes, Buffer.from("\nconst late = true; import './late-microphone.mjs';\n")]),
      dependencyBytes,
    }),
    /outside the reviewed static grammar/u,
  );
  assert.throws(
    () => assertReviewedExternalSpawnModuleClosure({
      entryBytes,
      dependencyBytes: withDependency(
        'scripts/lib/aos-voice-follow.mjs',
        `${dependencyBytes.get('scripts/lib/aos-voice-follow.mjs')}\nimport './extra-local.mjs';\n`,
      ),
    }),
    /reviewed local module edge set/u,
  );
  assert.throws(
    () => assertReviewedExternalSpawnModuleClosure({
      entryBytes,
      dependencyBytes: withDependency(
        'scripts/lib/aos-daemon-client.mjs',
        `${dependencyBytes.get('scripts/lib/aos-daemon-client.mjs')}\nrequire('./extra.cjs');\n`,
      ),
    }),
    /CommonJS/u,
  );
  assert.throws(
    () => assertReviewedExternalSpawnModuleClosure({
      entryBytes: Buffer.alloc(EXTERNAL_SPAWN_REVIEWED_SOURCE_MAX_BYTES + 1, 0x20),
      dependencyBytes,
    }),
    /at most 131072 raw bytes/u,
  );

  const padToLimit = (source) => Buffer.from(`${source}\n/*${'x'.repeat(
    EXTERNAL_SPAWN_REVIEWED_SOURCE_MAX_BYTES - Buffer.byteLength(source) - 6,
  )}*/\n`);
  const maximalDependencies = new Map([
    ['scripts/lib/aos-daemon-client.mjs', padToLimit("import 'node:fs';")],
    ['scripts/lib/aos-voice-follow.mjs', padToLimit("import {} from './aos-daemon-client.mjs';")],
  ]);
  assert.throws(
    () => composeReviewedExternalSpawnBundle({
      entryBytes: padToLimit("import {} from './lib/aos-voice-follow.mjs';"),
      dependencyBytes: maximalDependencies,
      reviewedSetDigest: 'a'.repeat(64),
      lifecycleParentPID: 2_147_483_647,
    }),
    new RegExp(`at most ${EXTERNAL_SPAWN_REVIEWED_BUNDLE_MAX_BYTES} raw bytes`, 'u'),
  );
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

test('target-handle help has no bare saved-ref shorthand or coordinate state validation', async () => {
  const registry = await loadJson(registryPath);
  const doCommand = registry.commands.find(({ path: commandPath }) => commandPath.join(' ') === 'do');
  assert.ok(doCommand, 'do command is missing');
  assert.doesNotMatch(JSON.stringify(doCommand.forms), /ref:<id>/u);

  for (const action of ['click', 'hover', 'scroll']) {
    const form = doCommand.forms.find(({ id }) => id === `do-${action}`);
    assert.ok(form, `do-${action} form is missing`);
    const coordinateBranches = form.usage.split(/\s+\|\s+/u).filter((branch) => branch.includes('<x,y'));
    assert.ok(coordinateBranches.length > 0, `do-${action} coordinate usage is missing`);
    for (const branch of coordinateBranches) {
      assert.doesNotMatch(branch, /--state-id/u, `do-${action} coordinate usage must not advertise state validation`);
    }
  }
});

test('scene effect dry run describes binding validation without claiming admission', async () => {
  const registry = await loadJson(registryPath);
  const command = registry.commands.find(
    ({ path: commandPath }) => commandPath.join(' ') === 'scene effect trigger',
  );
  const dryRun = command?.forms?.[0]?.args?.find(({ id }) => id === 'dry_run');
  assert.match(dryRun?.summary ?? '', /effect binding/u);
  assert.doesNotMatch(dryRun?.summary ?? '', /admission/u);
});

test('external command manifest executable targets exist', async () => {
  const manifest = await loadJson(manifestPath);
  for (const command of manifest.commands) {
    const [first] = command.argv_prefix;
    const repoTargets = command.executable === '/usr/bin/env'
      ? command.argv_prefix.slice(1)
      : command.argv_prefix;

    for (const target of repoTargets
      .map((arg) => arg.startsWith('$AOS_REPO_ROOT/') ? arg.slice('$AOS_REPO_ROOT/'.length) : arg)
      .filter((arg) => arg.startsWith('scripts/') || arg.startsWith('packages/'))) {
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

  for (const command of passthroughRoutes) {
    assert.notEqual(command.executable, '$AOS_PATH', `${command.path.join(' ')} help passthrough must not route to Swift`);
    assert.ok(
      (command.argv_prefix || []).some((arg) => (
        arg.startsWith('scripts/')
        || arg.startsWith('packages/')
        || arg.startsWith('$AOS_REPO_ROOT/scripts/')
        || arg.startsWith('$AOS_REPO_ROOT/packages/')
      )),
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

test('Swift external dispatcher admits a tokenless exact-byte bundle and preserves forwarded signals', async () => {
  const source = await fs.readFile(path.join(repoRoot, 'src/shared/external-command-dispatch.swift'), 'utf8');
  assert.match(source, /action": "external_spawn_intent"/);
  assert.match(source, /action": "external_spawn_child_admit"/);
  assert.match(source, /action": "external_spawn_abandon"/);
  assert.match(source, /AOS_EXTERNAL_DISPATCH_BINDING_TOKEN/);
  assert.match(source, /--input-type=module/);
  assert.match(source, /let sourcePipe = Pipe\(\)/);
  assert.match(source, /makeRegisteredExternalLaunchBundle/);
  assert.match(source, /replacingExactlyOnce/);
  assert.doesNotMatch(source, /registeredEnvironment\[externalDispatchBindingTokenEnvironmentKey\]/);
  assert.doesNotMatch(source, /registeredArguments\[0\] = scriptURL\.path/);
  assert.match(source, /merged\.removeValue\(forKey: legacyExternalDispatchParentPIDEnvironmentKey\)/);
  assert.doesNotMatch(source, /merged\["AOS_EXTERNAL_DISPATCH_PARENT_PID"\]/);
  assert.match(source, /externalDispatchLifecycleParentPIDEnvironmentKey/);
  assert.match(source, /Darwin\.kill\(process\.processIdentifier, SIGTERM\)/);
  assert.match(source, /Darwin\.kill\(process\.processIdentifier, SIGINT\)/);
});

test('wire v2 registers exactly the microphone listen spawn with generator-bound evidence', async () => {
  const manifest = await loadJson(manifestPath);
  const source = await loadJson(path.join(repoRoot, 'manifests/commands/source/external/15-listen.json'));
  assert.equal(manifest.schema_version, 2);
  assert.equal(source.schema_version, 1);
  const registered = manifest.commands.filter((command) => command.spawn_registration !== undefined);
  assert.equal(registered.length, 1);
  assert.deepEqual(registered[0].path, ['listen']);
  assert.deepEqual(registered[0], source.commands[0]);

  const registration = registered[0].spawn_registration;
  assert.deepEqual(Object.keys(registration), [
    'route_source_id',
    'route_source_revision',
    'adapter_registration_id',
    'adapter_registration_revision',
    'activation_predicate',
    'executable_resolution_policy',
    'expected_script_identity',
    'expected_script_digest',
    'reviewed_dependencies',
    'reviewed_dependency_set_digest',
    'canonical_argv_shape_digest',
  ]);
  assert.equal(registration.route_source_id, source.id);
  assert.equal(registration.adapter_registration_id, 'microphone-capture-adapter');
  assert.equal(registration.adapter_registration_revision, 1);
  assert.deepEqual(registration.activation_predicate, { grammar: 'listen_microphone_v1' });
  assert.deepEqual(registration.executable_resolution_policy, {
    launcher_shape: 'usr_bin_env_node',
    resolution_owner: 'native_external_dispatch',
    resolution_phase: 'immediately_before_spawn',
    search_source: 'sanitized_path',
    command_name: 'node',
    designated_requirement: 'anchor apple generic and identifier "node" and certificate leaf[subject.OU] = "HX7739G8FX"',
    signing_identifier: 'node',
    signing_team_identifier: 'HX7739G8FX',
    requires_hardened_runtime: true,
    platform_code_directory_hash_algorithm: 'sha256_truncated_cdhash_20_bytes',
    reviewed_source_max_bytes: EXTERNAL_SPAWN_REVIEWED_SOURCE_MAX_BYTES,
    reviewed_bundle_max_bytes: EXTERNAL_SPAWN_REVIEWED_BUNDLE_MAX_BYTES,
  });
  assert.equal(registration.expected_script_identity, 'scripts/aos-tell-listen.mjs');
  assert.deepEqual(registered[0].argv_prefix, ['node', '--input-type=module', '-', 'listen']);
  assert.equal(registered[0].cwd, 'repo');
  assert.equal(registered[0].stdio, 'registered_bundle');

  const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
  const sortedJSON = (value) => {
    if (Array.isArray(value)) return `[${value.map(sortedJSON).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${sortedJSON(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  };
  assert.equal(
    registration.expected_script_digest,
    sha256(await fs.readFile(path.join(repoRoot, registration.expected_script_identity))),
  );
  assert.deepEqual(
    registration.reviewed_dependencies.map(({ identity }) => identity),
    ['scripts/lib/aos-daemon-client.mjs', 'scripts/lib/aos-voice-follow.mjs'],
  );
  for (const dependency of registration.reviewed_dependencies) {
    assert.equal(dependency.digest, sha256(await fs.readFile(path.join(repoRoot, dependency.identity))));
  }
  assert.equal(
    registration.reviewed_dependency_set_digest,
    reviewedDependencySetDigest(registration.reviewed_dependencies),
  );
  assert.equal(registration.canonical_argv_shape_digest, sha256(Buffer.from(sortedJSON({
    argv_prefix: registered[0].argv_prefix,
    forwarded_suffix: 'path_suffix_after_route',
  }), 'utf8')));
  const semanticSource = structuredClone(source);
  delete semanticSource.commands[0].spawn_registration.route_source_revision;
  assert.equal(
    registration.route_source_revision,
    sha256(Buffer.from(sortedJSON(semanticSource), 'utf8')),
  );
  for (const command of manifest.commands) {
    if (command !== registered[0]) assert.equal(command.spawn_registration, undefined);
  }
});

test('listen uses the registered bundle stream while inheriting output and signal control', async () => {
  const manifest = await loadJson(manifestPath);
  const listen = manifest.commands.find((command) => command.path.join(' ') === 'listen');
  assert.ok(listen, 'listen external route is missing');
  assert.equal(listen.stdio, 'registered_bundle');
});

test('status item registration inherits stdio for its connection-scoped follow lease', async () => {
  const manifest = await loadJson(manifestPath);
  const register = manifest.commands.find((command) => command.path.join(' ') === 'status-item register');
  assert.ok(register, 'status-item register external route is missing');
  assert.equal(register.stdio, 'inherit');
});

test('desktop pixel native baseline inherits stdio for supervised cancellation', async () => {
  const manifest = await loadJson(manifestPath);
  const baseline = manifest.commands.find((command) => command.path.join(' ') === 'runtime probe desktop-pixels');
  assert.ok(baseline, 'desktop pixel native baseline route is missing');
  assert.equal(baseline.stdio, 'inherit');
});

test('external command manifest only routes approved bootstrap and stateless primitives to Swift', async () => {
  const manifest = await loadJson(manifestPath);
  const allowedSwiftRoutes = new Map([
    ['serve', { executable: '$AOS_PATH', argvPrefix: ['__serve'] }],
    ['operation', { executable: '$AOS_PATH', argvPrefix: ['__operation'] }],
    ['see compare', { executable: '/usr/bin/env', argvPrefix: ['$AOS_PATH', '__see', 'compare'] }],
  ]);

  for (const command of manifest.commands) {
    const directlyInvokesSwift = command.executable === '$AOS_PATH'
      || (command.executable === '/usr/bin/env' && command.argv_prefix[0] === '$AOS_PATH');
    if (!directlyInvokesSwift) continue;
    const publicPath = command.path.join(' ');
    const allowed = allowedSwiftRoutes.get(publicPath);
    assert.ok(allowed, `${publicPath} must route through an external script, not the current AOS executable`);
    assert.equal(command.executable, allowed.executable, `${publicPath} direct executable strategy drifted`);
    assert.deepEqual(command.argv_prefix, allowed.argvPrefix, `${publicPath} must use its approved direct primitive only`);
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
    '__desktop-pixel-native-baseline',
    '__see',
    '__say',
    '__do',
    '__operation',
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
  const fillRoute = manifest.commands.find((command) => command.argv_prefix.join(' ') === 'node $AOS_REPO_ROOT/scripts/aos-do-browser.mjs fill');
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
    const browserRoute = routes.find((command) => command.argv_prefix.join(' ') === `node $AOS_REPO_ROOT/scripts/aos-do-browser.mjs ${action}`);
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
  assert.ok(
    classifier[0].includes('isForegroundAOSServeOwner'),
    'ready must accept a direct aos serve foreground wrapper plus aos __serve socket owner as foreground_dev',
  );
});

test('service readiness consumes native runtime ownership facts instead of duplicating foreground serve policy', async () => {
  const source = await fs.readFile(path.join(repoRoot, 'scripts/aos-service.mjs'), 'utf8');
  assert.ok(
    source.includes("'__runtime', 'status-facts', '--json'"),
    'service readiness must read structured native runtime ownership facts',
  );
  assert.equal(
    source.includes('isForegroundAOSServeOwner'),
    false,
    'service readiness must not keep a second foreground aos serve classifier in JS',
  );
  assert.equal(
    source.includes('commandLineHasAOSCommand'),
    false,
    'service readiness must not duplicate process command-line prefix policy in JS',
  );
});

test('private Swift primitives are reachable only through expected direct routes and external wrappers', async () => {
  const manifest = await loadJson(manifestPath);
  const expectedDirectRoutes = new Map([
    ['__serve', new Set(['serve'])],
    ['__see', new Set(['see compare'])],
  ]);
  const expectedWrapperFiles = new Map([
    ['__daemon', ['scripts/aos-ready.mjs', 'scripts/aos-doctor.mjs', 'scripts/aos-permissions.mjs']],
    ['__runtime', ['scripts/aos-ready.mjs', 'scripts/aos-status.mjs', 'scripts/aos-doctor.mjs', 'scripts/aos-service.mjs', 'scripts/aos-clean.mjs']],
    ['__permissions', ['scripts/aos-ready.mjs', 'scripts/aos-status.mjs', 'scripts/aos-doctor.mjs', 'scripts/aos-permissions.mjs']],
    ['__render', ['scripts/aos-show-render.mjs']],
    ['__see', ['scripts/lib/aos-see-child-runner.mjs']],
    ['__say', ['scripts/aos-say.mjs']],
    ['__do', ['scripts/aos-do-native.mjs', 'scripts/aos-do-canvas.mjs']],
  ]);
  const privatePrimitives = new Set([...expectedDirectRoutes.keys(), ...expectedWrapperFiles.keys()]);

  for (const command of manifest.commands) {
    for (const arg of command.argv_prefix) {
      if (!privatePrimitives.has(arg)) continue;
      const directlyInvokesSwift = command.executable === '$AOS_PATH'
        || (command.executable === '/usr/bin/env' && command.argv_prefix[0] === '$AOS_PATH');
      assert.equal(directlyInvokesSwift, true, `${command.path.join(' ')} must directly self-route ${arg}`);
      assert.ok(
        expectedDirectRoutes.get(arg)?.has(command.path.join(' ')),
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
        `${relativePath} must invoke ${primitive} through its approved private owner`,
      );
    }
  }

  const directSeeWrapper = await fs.readFile(path.join(repoRoot, 'scripts/aos-see-native.mjs'), 'utf8');
  const savedCaptureOwner = await fs.readFile(path.join(repoRoot, 'scripts/lib/agent-workspace/capture.mjs'), 'utf8');
  const savedActionOwner = await fs.readFile(path.join(repoRoot, 'scripts/lib/agent-workspace/actions.mjs'), 'utf8');
  const targetHandleOwner = await fs.readFile(path.join(repoRoot, 'scripts/lib/target-handle-runtime.mjs'), 'utf8');
  assert.ok(
    directSeeWrapper.includes('aosSeeChildRunnerPath'),
    'direct native perception must route through the shared child guardian',
  );
  assert.ok(
    savedCaptureOwner.includes('runNativeSeeSync'),
    'saved native perception must route through the shared child guardian',
  );
  assert.equal(
    `${savedActionOwner}\n${targetHandleOwner}`.includes('runNativeSeeSync'),
    false,
    'saved browser Observation Ref validation must never recapture through native perception',
  );

  const nestedSeeCallers = [];
  for (const absolutePath of await listModuleFiles(path.join(repoRoot, 'scripts'))) {
    const source = await fs.readFile(absolutePath, 'utf8');
    if (/\[\s*['"]__see['"]/u.test(source)) {
      nestedSeeCallers.push(path.relative(repoRoot, absolutePath));
    }
  }
  assert.deepEqual(
    nestedSeeCallers.sort(),
    ['scripts/lib/aos-see-child-runner.mjs'],
    'only the shared child guardian may invoke private __see',
  );

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

test('annotation geometry and semantic target forms share one reviewed adapter route', async () => {
  const [registry, external] = await Promise.all([
    loadJson(registryPath),
    loadJson(manifestPath),
  ]);
  const annotation = registry.commands.find((command) => command.path.join(' ') === 'see annotation');
  assert.ok(annotation, 'see annotation command must exist in registry');

  const geometry = annotation.forms.find((form) => form.id === 'annotation-select-follow');
  const target = annotation.forms.find((form) => form.id === 'annotation-target-select-follow');
  assert.ok(geometry, 'geometric annotation selection form must remain available');
  assert.ok(target, 'semantic target selection form must be explicit');

  const geometryModes = geometry.args.find((arg) => arg.id === 'mode')?.value_type?.enum
    ?.map((item) => item.value);
  const targetModes = target.args.find((arg) => arg.id === 'mode')?.value_type?.enum
    ?.map((item) => item.value);
  assert.deepEqual(geometryModes, ['point', 'rectangle', 'freehand', 'text']);
  assert.deepEqual(targetModes, ['target']);

  const route = external.commands.find((command) => command.path.join(' ') === 'see annotation select');
  assert.ok(route, 'annotation selection external route must exist');
  assert.equal(route.executable, '/usr/bin/env');
  assert.deepEqual(route.argv_prefix, ['node', 'scripts/aos-annotation-select.mjs']);
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

test('permissions execution metadata matches daemon startup behavior', async () => {
  const registry = await loadJson(registryPath);
  const forms = new Map(
    registry.commands.flatMap((command) => command.forms.map((form) => [form.id, form])),
  );

  assert.equal(forms.get('permissions-check')?.execution.auto_starts_daemon, false);
  assert.equal(forms.get('permissions-check')?.execution.read_only, true);
  assert.equal(forms.get('permissions-prime-screen-capture')?.execution.auto_starts_daemon, false);
  assert.equal(forms.get('permissions-prime-screen-capture')?.execution.interactive, true);
  assert.equal(forms.get('permissions-prime-screen-capture')?.execution.mutates_state, true);
  assert.equal(forms.get('permissions-setup')?.execution.auto_starts_daemon, true);
  assert.equal(forms.get('permissions-setup')?.execution.mutates_state, true);
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

test('registry conditional execution metadata references declared form flags', async () => {
  const registry = await loadJson(registryPath);
  const conditionalFields = ['mutates_when_flags', 'auto_starts_daemon_when_flags'];

  for (const command of registry.commands) {
    for (const form of command.forms) {
      const declaredFlags = new Set(
        form.args
          .filter((arg) => arg.kind === 'flag')
          .map((arg) => arg.token),
      );
      for (const field of conditionalFields) {
        const flags = form.execution?.[field] ?? [];
        assert.ok(Array.isArray(flags), `${form.id} execution.${field} must be an array`);
        for (const flag of flags) {
          assert.ok(declaredFlags.has(flag), `${form.id} execution.${field} references undeclared flag ${flag}`);
        }
      }
      if (form.execution?.auto_starts_daemon_when_flags?.length) {
        assert.equal(
          form.execution.auto_starts_daemon,
          false,
          `${form.id} conditional daemon startup must not also claim unconditional startup`,
        );
      }
    }
  }
});

test('command surface docs describe registry visibility and conditional output metadata', async () => {
  const docs = await fs.readFile(path.join(repoRoot, 'docs/dev/command-surface.md'), 'utf8');

  assert.match(docs, /consumer_discovery: false/, 'command-surface docs must describe consumer discovery filtering');
  assert.match(docs, /`aos dev` is retired/, 'command-surface docs must document dev removal');
  assert.match(docs, /`aos ops` is retired/, 'command-surface docs must document ops removal');
  assert.match(docs, /Do not add `dev` command source fragments/, 'command-surface docs must forbid dev reintroduction');
  assert.match(docs, /Do not add `ops` command source fragments/, 'command-surface docs must forbid ops reintroduction');
  assert.match(docs, /retained local skills backed\s+by deterministic repo scripts/, 'command-surface docs must name skill-backed maintainer workflows');
  assert.match(docs, /output\.conditional_modes/, 'command-surface docs must describe conditional output metadata');
  assert.match(docs, /when_flags/, 'command-surface docs must require conditional output flags');
  assert.match(docs, /execution\.mutates_when_flags/, 'command-surface docs must describe conditional mutation metadata');
  assert.match(docs, /execution\.auto_starts_daemon_when_flags/, 'command-surface docs must describe conditional daemon-start metadata');
});

test('command surface does not expose retired dev or ops command forms', async () => {
  const registry = await loadJson(registryPath);
  const manifest = await loadJson(manifestPath);

  assert.equal(registry.commands.some((command) => command.path[0] === 'dev'), false, 'registry must not contain retired dev commands');
  assert.equal(registry.commands.some((command) => command.path[0] === 'ops'), false, 'registry must not contain retired ops commands');
  assert.equal(manifest.commands.some((command) => command.path[0] === 'dev'), false, 'external manifest must not contain retired dev routes');
  assert.equal(manifest.commands.some((command) => command.path[0] === 'ops'), false, 'external manifest must not contain retired ops routes');
  for (const command of registry.commands) {
    for (const form of command.forms || []) {
      assert.notEqual(concreteUsagePath(form)?.[0], 'dev', `${form.id} must not expose a dev concrete usage path`);
      assert.notEqual(concreteUsagePath(form)?.[0], 'ops', `${form.id} must not expose an ops concrete usage path`);
    }
  }
});

test('registry concrete usage forms have external routes', async () => {
  const manifest = await loadJson(manifestPath);
  const registry = await loadJson(registryPath);
  const externalPaths = new Set(manifest.commands.map((command) => command.path.join('\0')));
  const bootstrapFamilies = new Set(['serve', 'ready', 'permissions', 'operation']);

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
