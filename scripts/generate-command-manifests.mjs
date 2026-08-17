#!/usr/bin/env node

import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { externalRouteConditionSamples, externalRouteMatches } from './lib/external-command-routes.mjs';
import {
  EXTERNAL_SPAWN_REVIEWED_DEPENDENCY_IDENTITIES,
  composeReviewedExternalSpawnBundle,
  readCanonicalRegularFile,
  reviewedDependencySetDigest,
} from './lib/external-command-manifest-v1.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sourceRoot = path.join(repoRoot, 'manifests/commands/source');
const aosSourceDir = path.join(sourceRoot, 'aos');
const externalSourceDir = path.join(sourceRoot, 'external');
const aosOutputPath = path.join(repoRoot, 'manifests/commands/aos-commands.json');
const externalOutputPath = path.join(repoRoot, 'manifests/commands/aos-external-commands.json');

const SOURCE_SCHEMA_VERSION = 1;
const EXTERNAL_AGGREGATE_SCHEMA_VERSION = 2;
const SOURCE_FILE_RE = /^\d{2}-[a-z0-9_.-]+\.json$/;
const AOS_REGISTRY_NAME = 'aos';
const AOS_REGISTRY_VERSION = '0.1.0';
const REGENERATION_COMMAND = 'node scripts/generate-command-manifests.mjs';
const EXTERNAL_EXECUTABLES = new Set(['$AOS_PATH', '/usr/bin/env', '/bin/bash']);
const EXTERNAL_STDIO = new Set(['capture', 'inherit', 'registered_bundle']);
const EXTERNAL_CWD = new Set(['repo', '$AOS_REPO_ROOT']);
const EXTERNAL_WHEN_KEYS = new Set([
  'child_arg_index',
  'child_arg_missing',
  'prefix',
  'excluded_prefixes',
  'excluded_values',
]);
const SPAWN_REGISTRATION_KEYS = [
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
];
const REVIEWED_DEPENDENCY_KEYS = ['identity', 'digest'];
const NODE_RESOLUTION_POLICY = {
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
  reviewed_source_max_bytes: 131_072,
  reviewed_bundle_max_bytes: 524_288,
};
const REGISTERED_LISTEN_ENVIRONMENT = {
  AOS_PATH: '$AOS_PATH',
  AOS_RUNTIME_MODE: '$AOS_RUNTIME_MODE',
  AOS_STATE_ROOT: '$AOS_STATE_ROOT',
};
const SHA256_RE = /^[0-9a-f]{64}$/;
const RESERVED_EXTERNAL_DISPATCH_ENV = new Set([
  'AOS_EXTERNAL_DISPATCH_BINDING_TOKEN',
  'AOS_EXTERNAL_DISPATCH_PARENT_PID',
  'AOS_EXTERNAL_DISPATCH_LIFECYCLE_PARENT_PID',
  'AOS_EXTERNAL_DISPATCH_REVIEWED_DEPENDENCY_SET_DIGEST',
]);
const REGISTERED_SPAWN_UNSAFE_ENVIRONMENT = /^(?:NODE(?:_|$)|DYLD_|LD_|BASH_ENV$|ENV$)/;

function usage() {
  return `Usage: node scripts/generate-command-manifests.mjs [--check]\n`;
}

function fail(message) {
  process.stderr.write(`generate-command-manifests: ${message}\n`);
  process.exit(1);
}

function assertCondition(condition, message) {
  if (!condition) fail(message);
}

function assertObject(value, label) {
  assertCondition(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
}

function assertString(value, label) {
  assertCondition(typeof value === 'string' && value.length > 0, `${label} must be a non-empty string`);
}

function assertStringArray(value, label) {
  assertCondition(Array.isArray(value) && value.length > 0, `${label} must be a non-empty array`);
  for (const [index, item] of value.entries()) {
    assertString(item, `${label}[${index}]`);
  }
}

function stableJSONString(value) {
  return JSON.stringify(value);
}

function sortedJSONString(value) {
  if (Array.isArray(value)) return `[${value.map(sortedJSONString).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${sortedJSONString(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function semanticSourceRevision(doc, commandIndex) {
  const semantic = structuredClone(doc);
  delete semantic.commands[commandIndex].spawn_registration.route_source_revision;
  return sha256(Buffer.from(sortedJSONString(semantic), 'utf8'));
}

function canonicalArgvShapeDigest(command) {
  return sha256(Buffer.from(sortedJSONString({
    argv_prefix: command.argv_prefix,
    forwarded_suffix: 'path_suffix_after_route',
  }), 'utf8'));
}

function normalizedRepoRelativeIdentity(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || path.posix.isAbsolute(value)) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    && path.posix.normalize(value) === value;
}

async function validateSpawnRegistration(command, { doc, commandIndex, sourceFile, label }) {
  const registration = command.spawn_registration;
  if (registration === undefined) return;
  assertObject(registration, `${label}.spawn_registration`);
  assertCondition(
    sortedJSONString(Object.keys(registration).sort()) === sortedJSONString([...SPAWN_REGISTRATION_KEYS].sort()),
    `${label}.spawn_registration must contain exactly the closed v1 registration fields`,
  );
  assertCondition(registration.route_source_id === doc.id, `${label}.spawn_registration.route_source_id must match source id ${doc.id}`);
  assertCondition(SHA256_RE.test(registration.route_source_revision), `${label}.spawn_registration.route_source_revision must be lowercase SHA-256`);
  assertString(registration.adapter_registration_id, `${label}.spawn_registration.adapter_registration_id`);
  assertCondition(
    Number.isInteger(registration.adapter_registration_revision) && registration.adapter_registration_revision > 0,
    `${label}.spawn_registration.adapter_registration_revision must be a positive integer`,
  );
  assertCondition(
    sortedJSONString(registration.activation_predicate) === sortedJSONString({ grammar: 'listen_microphone_v1' }),
    `${label}.spawn_registration.activation_predicate must bind the exact listen microphone grammar`,
  );
  assertCondition(
    sortedJSONString(registration.executable_resolution_policy) === sortedJSONString(NODE_RESOLUTION_POLICY),
    `${label}.spawn_registration.executable_resolution_policy must be the native trusted-Node policy`,
  );
  assertCondition(
    command.executable === '/usr/bin/env'
      && sortedJSONString(command.argv_prefix) === sortedJSONString(['node', '--input-type=module', '-', 'listen'])
      && command.cwd === 'repo'
      && command.stdio === 'registered_bundle',
    `${label} registered route must use the exact reviewed listen launcher`,
  );
  assertCondition(command.help_passthrough !== true, `${label} registered route must not enable help passthrough`);
  assertCondition(
    sortedJSONString(command.env) === sortedJSONString(REGISTERED_LISTEN_ENVIRONMENT)
      && !Object.keys(command.env).some((key) => REGISTERED_SPAWN_UNSAFE_ENVIRONMENT.test(key)),
    `${label} registered route must author exactly the reviewed listen environment`,
  );
  assertCondition(normalizedRepoRelativeIdentity(registration.expected_script_identity), `${label}.spawn_registration.expected_script_identity must be normalized repo-relative`);
  assertCondition(
    registration.expected_script_identity === 'scripts/aos-tell-listen.mjs',
    `${label}.spawn_registration.expected_script_identity must bind the reviewed listen source`,
  );
  const scriptPath = path.join(repoRoot, registration.expected_script_identity);
  const scriptBytes = await readCanonicalRegularFile(scriptPath)
    .catch((err) => fail(`${label} cannot read canonical registered script ${registration.expected_script_identity}: ${err.message}`));
  assertCondition(registration.expected_script_digest === sha256(scriptBytes), `${label}.spawn_registration.expected_script_digest does not match raw script bytes`);
  assertCondition(
    Array.isArray(registration.reviewed_dependencies)
      && registration.reviewed_dependencies.length === EXTERNAL_SPAWN_REVIEWED_DEPENDENCY_IDENTITIES.length,
    `${label}.spawn_registration.reviewed_dependencies must be the exact reviewed dependency set`,
  );
  const dependencyBytesByIdentity = new Map();
  for (const [index, identity] of EXTERNAL_SPAWN_REVIEWED_DEPENDENCY_IDENTITIES.entries()) {
    const dependency = registration.reviewed_dependencies[index];
    assertObject(dependency, `${label}.spawn_registration.reviewed_dependencies[${index}]`);
    assertCondition(
      sortedJSONString(Object.keys(dependency).sort()) === sortedJSONString([...REVIEWED_DEPENDENCY_KEYS].sort()),
      `${label}.spawn_registration.reviewed_dependencies[${index}] must contain exactly identity and digest`,
    );
    assertCondition(
      dependency.identity === identity,
      `${label}.spawn_registration.reviewed_dependencies[${index}].identity must be ${identity}`,
    );
    const dependencyBytes = await readCanonicalRegularFile(path.join(repoRoot, identity))
      .catch((err) => fail(`${label} cannot read canonical reviewed dependency ${identity}: ${err.message}`));
    dependencyBytesByIdentity.set(identity, dependencyBytes);
    assertCondition(
      dependency.digest === sha256(dependencyBytes),
      `${label}.spawn_registration.reviewed_dependencies[${index}].digest does not match raw dependency bytes`,
    );
  }
  assertCondition(
    registration.reviewed_dependency_set_digest === reviewedDependencySetDigest(registration.reviewed_dependencies),
    `${label}.spawn_registration.reviewed_dependency_set_digest does not match the canonical reviewed dependency set`,
  );
  try {
    composeReviewedExternalSpawnBundle({
      entryBytes: scriptBytes,
      dependencyBytes: dependencyBytesByIdentity,
      reviewedSetDigest: registration.reviewed_dependency_set_digest,
      lifecycleParentPID: 2_147_483_647,
    });
  } catch (error) {
    fail(`${label}.spawn_registration reviewed module closure is invalid: ${error.message}`);
  }
  assertCondition(
    registration.canonical_argv_shape_digest === canonicalArgvShapeDigest(command),
    `${label}.spawn_registration.canonical_argv_shape_digest does not match argv_prefix plus forwarded suffix`,
  );
  assertCondition(
    registration.route_source_revision === semanticSourceRevision(doc, commandIndex),
    `${label}.spawn_registration.route_source_revision does not match semantic source bytes`,
  );
  assertCondition(path.resolve(sourceFile).startsWith(`${externalSourceDir}${path.sep}`), `${label} registered route must come from external source`);
}

function sourceIDFromFile(file) {
  return file.replace(/^\d{2}-/, '').replace(/\.json$/, '');
}

function generatedMetadata(sourcePath) {
  return {
    artifact: true,
    description: 'Generated command manifest. Edit source fragments, not this file.',
    source_owner: 'manifests/AGENTS.md',
    source_path: sourcePath,
    regeneration_command: REGENERATION_COMMAND,
  };
}

async function readJSON(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    fail(`invalid JSON in ${path.relative(repoRoot, file)}: ${err.message}`);
  }
}

async function sourceFiles(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    fail(`cannot read source directory ${path.relative(repoRoot, dir)}: ${err.message}`);
  }
  const files = entries.filter((entry) => entry.endsWith('.json')).sort();
  assertCondition(files.length > 0, `${path.relative(repoRoot, dir)} must contain source JSON files`);
  for (const file of files) {
    assertCondition(SOURCE_FILE_RE.test(file), `${path.relative(repoRoot, path.join(dir, file))} must use NN-family.json naming`);
  }
  return files.map((file) => path.join(dir, file));
}

async function loadSourceCommands(kind, dir) {
  const files = await sourceFiles(dir);
  const seenSourceIDs = new Set();
  const commands = [];

  for (const file of files) {
    const doc = await readJSON(file);
    const label = path.relative(repoRoot, file);
    assertObject(doc, label);
    assertCondition(doc.schema_version === SOURCE_SCHEMA_VERSION, `${label} schema_version must be ${SOURCE_SCHEMA_VERSION}`);
    assertString(doc.id, `${label}.id`);
    assertCondition(doc.id === sourceIDFromFile(path.basename(file)), `${label}.id must match its filename`);
    assertCondition(!seenSourceIDs.has(doc.id), `${kind} source id is duplicated: ${doc.id}`);
    seenSourceIDs.add(doc.id);
    if (kind === 'registry') assertStringArray(doc.path_prefix, `${label}.path_prefix`);
    assertCondition(Array.isArray(doc.commands), `${label}.commands must be an array`);
    for (const [index, command] of doc.commands.entries()) {
      validateCommandShell(command, `${label}.commands[${index}]`);
      if (kind === 'external') {
        await validateSpawnRegistration(command, {
          doc,
          commandIndex: index,
          sourceFile: file,
          label: `${label}.commands[${index}]`,
        });
      }
      if (kind === 'registry') {
        assertCondition(
          stableJSONString(command.path.slice(0, doc.path_prefix.length)) === stableJSONString(doc.path_prefix),
          `${label}.commands[${index}].path must stay under registry prefix ${doc.path_prefix.join(' ')}`,
        );
      }
      commands.push(command);
    }
  }

  return commands;
}

function commandWithoutForms(command) {
  return Object.fromEntries(Object.entries(command).filter(([key]) => key !== 'forms'));
}

function mergeAosRegistryFragments(fragments) {
  const order = [];
  const byPath = new Map();

  for (const command of fragments) {
    const key = command.path.join('\0');
    const signature = sortedJSONString(commandWithoutForms(command));
    if (!byPath.has(key)) {
      order.push(key);
      byPath.set(key, {
        command: { ...command, forms: [...(command.forms ?? [])] },
        signatures: new Set([signature]),
      });
      continue;
    }
    const existing = byPath.get(key);
    assertCondition(
      existing.signatures.has(signature),
      `registry command path ${command.path.join(' ')} has conflicting non-form metadata across source fragments`,
    );
    existing.command.forms.push(...(command.forms ?? []));
  }

  return order.map((key) => byPath.get(key).command);
}

function validateCommandShell(command, label) {
  assertObject(command, label);
  assertStringArray(command.path, `${label}.path`);
  assertString(command.summary, `${label}.summary`);
}

function concreteUsagePath(form) {
  const usage = form.usage;
  if (typeof usage !== 'string') return null;
  const aosUsage = usage.startsWith('aos ')
    ? usage
    : usage.split(/\s+\|\s+/).find((part) => part.startsWith('aos '));
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

function validateAosRegistry(commands) {
  const commandPaths = new Map();
  const formIDs = new Map();

  for (const [commandIndex, command] of commands.entries()) {
    validateCommandShell(command, `aos command ${commandIndex}`);
    const commandPath = command.path.join(' ');
    commandPaths.set(commandPath, [...(commandPaths.get(commandPath) ?? []), commandIndex]);
    assertCondition(Array.isArray(command.forms), `${commandPath}.forms must be an array`);

    for (const [formIndex, form] of command.forms.entries()) {
      const label = `${commandPath}.forms[${formIndex}]`;
      assertObject(form, label);
      assertString(form.id, `${label}.id`);
      formIDs.set(form.id, [...(formIDs.get(form.id) ?? []), commandPath]);
      assertCondition(Array.isArray(form.args), `${form.id}.args must be an array`);
      for (const [argIndex, arg] of form.args.entries()) {
        assertObject(arg, `${form.id}.args[${argIndex}]`);
        assertString(arg.id, `${form.id}.args[${argIndex}].id`);
        assertString(arg.kind, `${form.id}.args[${argIndex}].kind`);
      }

      const concrete = concreteUsagePath(form);
      if (concrete?.length) {
        assertCondition(
          stableJSONString(concrete.slice(0, command.path.length)) === stableJSONString(command.path),
          `${form.id} usage path ${concrete.join(' ')} must stay under ${commandPath}`,
        );
      }
    }
  }

  for (const [commandPath, owners] of commandPaths) {
    assertCondition(owners.length === 1, `registry command path is duplicated: ${commandPath}`);
  }
  for (const [formID, owners] of formIDs) {
    assertCondition(owners.length === 1, `registry form id is duplicated: ${formID} under ${owners.join(', ')}`);
  }
}

function validateExternalWhen(when, label) {
  assertObject(when, label);
  for (const key of Object.keys(when)) {
    assertCondition(EXTERNAL_WHEN_KEYS.has(key), `${label}.${key} is not a supported route predicate`);
  }
  assertCondition(Number.isInteger(when.child_arg_index) && when.child_arg_index >= 0, `${label}.child_arg_index must be a non-negative integer`);
  if (when.child_arg_missing !== undefined) {
    assertCondition(typeof when.child_arg_missing === 'boolean', `${label}.child_arg_missing must be boolean`);
  }
  if (when.prefix !== undefined) assertString(when.prefix, `${label}.prefix`);
  for (const key of ['excluded_prefixes', 'excluded_values']) {
    if (when[key] === undefined) continue;
    assertStringArray(when[key], `${label}.${key}`);
    assertCondition(new Set(when[key]).size === when[key].length, `${label}.${key} must not contain duplicates`);
  }
}

function validateExternalManifest(commands, registryCommands) {
  const exactRoutes = new Set();
  const byPath = new Map();
  const allPaths = new Set(commands.map((command) => command.path.join('\0')));

  for (const [index, command] of commands.entries()) {
    const label = `external command ${index} (${command.path?.join?.(' ') ?? 'unknown'})`;
    validateCommandShell(command, label);
    assertCondition(EXTERNAL_EXECUTABLES.has(command.executable), `${label}.executable is invalid`);
    assertStringArray(command.argv_prefix, `${label}.argv_prefix`);
    if (command.cwd !== undefined) assertCondition(EXTERNAL_CWD.has(command.cwd), `${label}.cwd is invalid`);
    if (command.stdio !== undefined) assertCondition(EXTERNAL_STDIO.has(command.stdio), `${label}.stdio is invalid`);
    if (command.spawn_registration === undefined) {
      assertCondition(command.stdio !== 'registered_bundle', `${label}.stdio registered_bundle requires spawn_registration`);
    }
    if (command.help_passthrough !== undefined) assertCondition(typeof command.help_passthrough === 'boolean', `${label}.help_passthrough must be boolean`);
    if (command.env !== undefined) {
      assertObject(command.env, `${label}.env`);
      for (const [key, value] of Object.entries(command.env)) {
        assertCondition(/^[A-Z_][A-Z0-9_]*$/.test(key), `${label}.env key is invalid: ${key}`);
        assertCondition(!RESERVED_EXTERNAL_DISPATCH_ENV.has(key), `${label}.env cannot author reserved external-dispatch authority: ${key}`);
        assertString(value, `${label}.env.${key}`);
      }
    }
    if (command.when !== undefined) validateExternalWhen(command.when, `${label}.when`);
    if (command.when !== undefined) {
      const conditionKeys = Object.keys(command.when);
      const broadIndexOnly = conditionKeys.length === 1 && conditionKeys[0] === 'child_arg_index';
      if (broadIndexOnly) {
        assertCondition(
          command.argv_prefix[1] === 'scripts/aos-family-router.mjs',
          `${label}.when can use child_arg_index alone only for the generic family router`,
        );
        assertCondition(
          command.argv_prefix.some((arg) => arg.startsWith('UNKNOWN_')),
          `${label}.when broad family router must emit an UNKNOWN_* code`,
        );
        assertCondition(
          [...allPaths].some((key) => key.startsWith(`${command.path.join('\0')}\0`)),
          `${label}.when broad family router must have explicit child routes`,
        );
      }
    }

    const exactID = stableJSONString([command.path, command.argv_prefix, command.when ?? null]);
    assertCondition(!exactRoutes.has(exactID), `${label} duplicates an exact external route`);
    exactRoutes.add(exactID);
    const pathKey = command.path.join('\0');
    byPath.set(pathKey, [...(byPath.get(pathKey) ?? []), command]);
  }

  const registered = commands.filter((command) => command.spawn_registration !== undefined);
  assertCondition(registered.length === 1, 'external manifest must contain exactly one spawn registration');
  assertCondition(
    stableJSONString(registered[0].path) === stableJSONString(['listen'])
      && registered[0].spawn_registration.adapter_registration_id === 'microphone-capture-adapter',
    'only listen may register the microphone-capture-adapter spawn binding',
  );

  for (const [pathKey, routes] of byPath) {
    if (routes.length <= 1) continue;
    const pathText = pathKey.replaceAll('\0', ' ');
    for (const route of routes) {
      assertCondition(route.when, `${pathText} duplicate route is missing a when condition`);
    }
    for (const sample of externalRouteConditionSamples(routes)) {
      const pathArgs = pathKey.split('\0');
      const args = sample === '__missing__' ? pathArgs : [...pathArgs, sample];
      const matches = routes.filter((route) => externalRouteMatches(route, args));
      assertCondition(
        matches.length <= 1,
        `${pathText} duplicate routes overlap for child ${sample}: ${matches.map((route) => route.argv_prefix.join(' ')).join(' | ')}`,
      );
    }
  }

  const externalPaths = new Set(commands.map((command) => command.path.join('\0')));
  for (const command of registryCommands) {
    const key = command.path.join('\0');
    assertCondition(externalPaths.has(key), `${command.path.join(' ')} is missing an external route`);
  }
}

function quote(value) {
  return JSON.stringify(value);
}

function isPrimitive(value) {
  return value === null || typeof value !== 'object';
}

function formatRegistryJSON(value, indent = '', key = null) {
  if (Array.isArray(value)) {
    if (value.length === 0) return key === 'args' ? `[\n\n${indent}]` : `[\n${indent}]`;
    return `[\n${value.map((item) => `${indent}  ${formatRegistryJSON(item, `${indent}  `)}`).join(',\n')}\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    return `{\n${entries.map(([entryKey, item]) => `${indent}  ${quote(entryKey)} : ${formatRegistryJSON(item, `${indent}  `, entryKey)}`).join(',\n')}\n${indent}}`;
  }
  return quote(value);
}

function formatExternalJSON(value, indent = '', key = null) {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const inline = `[${value.map((item) => formatExternalJSON(item, indent)).join(', ')}]`;
    if (value.every(isPrimitive) && (key !== 'argv_prefix' || `${indent}${inline}`.length <= 140)) return inline;
    return `[\n${value.map((item) => `${indent}  ${formatExternalJSON(item, `${indent}  `)}`).join(',\n')}\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    return `{\n${entries.map(([entryKey, item]) => `${indent}  ${quote(entryKey)}: ${formatExternalJSON(item, `${indent}  `, entryKey)}`).join(',\n')}\n${indent}}`;
  }
  return quote(value);
}

function firstDiff(left, right) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return index;
  }
  return left.length === right.length ? -1 : length;
}

async function writeOrCheck(file, content, check) {
  if (!check) {
    await fs.writeFile(file, content);
    return;
  }
  let current;
  try {
    current = await fs.readFile(file, 'utf8');
  } catch (err) {
    fail(`cannot read ${path.relative(repoRoot, file)} for drift check: ${err.message}`);
  }
  if (current === content) return;
  const index = firstDiff(current, content);
  fail(`${path.relative(repoRoot, file)} is out of date; first byte diff at ${index}. Run node scripts/generate-command-manifests.mjs`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(usage());
    return;
  }
  const check = args.includes('--check');
  const unknown = args.filter((arg) => arg !== '--check');
  assertCondition(unknown.length === 0, `unknown arguments: ${unknown.join(' ')}`);

  const registryFragments = await loadSourceCommands('registry', aosSourceDir);
  const registryCommands = mergeAosRegistryFragments(registryFragments);
  const externalCommands = await loadSourceCommands('external', externalSourceDir);
  validateAosRegistry(registryCommands);
  validateExternalManifest(externalCommands, registryCommands);

  const registry = {
    generated: generatedMetadata('manifests/commands/source/aos/'),
    commands: registryCommands,
    name: AOS_REGISTRY_NAME,
    version: AOS_REGISTRY_VERSION,
  };
  const external = {
    generated: generatedMetadata('manifests/commands/source/external/'),
    schema_version: EXTERNAL_AGGREGATE_SCHEMA_VERSION,
    commands: externalCommands,
  };

  await writeOrCheck(aosOutputPath, `${formatRegistryJSON(registry)}\n`, check);
  await writeOrCheck(externalOutputPath, `${formatExternalJSON(external)}\n`, check);

  if (check) {
    process.stdout.write('command manifests are generated and up to date\n');
  } else {
    process.stdout.write('generated manifests/commands/aos-commands.json and manifests/commands/aos-external-commands.json\n');
  }
}

main().catch((err) => fail(err.stack || err.message));
