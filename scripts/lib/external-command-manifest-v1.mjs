import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const IDENTIFIER = /^[a-z0-9][a-z0-9_.-]*$/;
const PATH_SEGMENT = /^[A-Za-z0-9_.-]+$/;
const ENVIRONMENT_KEY = /^[A-Z_][A-Z0-9_]*$/;
const SHA256 = /^[0-9a-f]{64}$/;
const RESERVED_DISPATCH_ENVIRONMENT = new Set([
  'AOS_EXTERNAL_DISPATCH_BINDING_TOKEN',
  'AOS_EXTERNAL_DISPATCH_PARENT_PID',
  'AOS_EXTERNAL_DISPATCH_LIFECYCLE_PARENT_PID',
  'AOS_EXTERNAL_DISPATCH_REVIEWED_DEPENDENCY_SET_DIGEST',
]);
const REGISTERED_SPAWN_UNSAFE_ENVIRONMENT = /^(?:NODE(?:_|$)|DYLD_|LD_|BASH_ENV$|ENV$)/;
const TOP_LEVEL_KEYS = new Set(['$schema', 'generated', 'schema_version', 'commands']);
const GENERATED_KEYS = new Set([
  'artifact',
  'description',
  'source_owner',
  'source_path',
  'regeneration_command',
]);
const COMMAND_KEYS = new Set([
  'path',
  'summary',
  'executable',
  'argv_prefix',
  'help_passthrough',
  'cwd',
  'env',
  'stdio',
  'when',
  'spawn_registration',
]);
const CONDITION_KEYS = new Set([
  'child_arg_index',
  'child_arg_missing',
  'prefix',
  'excluded_prefixes',
  'excluded_values',
]);
const REGISTRATION_KEYS = new Set([
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
const REVIEWED_DEPENDENCY_KEYS = new Set(['identity', 'digest']);
export const EXTERNAL_SPAWN_REVIEWED_DEPENDENCY_IDENTITIES = Object.freeze([
  'scripts/lib/aos-daemon-client.mjs',
  'scripts/lib/aos-voice-follow.mjs',
]);
export const EXTERNAL_SPAWN_REVIEWED_SOURCE_MAX_BYTES = 128 * 1024;
export const EXTERNAL_SPAWN_REVIEWED_BUNDLE_MAX_BYTES = 512 * 1024;
export const EXTERNAL_SPAWN_LIFECYCLE_PARENT_PID_ENV = 'AOS_EXTERNAL_DISPATCH_LIFECYCLE_PARENT_PID';
export const EXTERNAL_SPAWN_REVIEWED_DEPENDENCY_SET_DIGEST_ENV = 'AOS_EXTERNAL_DISPATCH_REVIEWED_DEPENDENCY_SET_DIGEST';
const RESOLUTION_POLICY_KEYS = new Set([
  'launcher_shape',
  'resolution_owner',
  'resolution_phase',
  'search_source',
  'command_name',
  'designated_requirement',
  'signing_identifier',
  'signing_team_identifier',
  'requires_hardened_runtime',
  'platform_code_directory_hash_algorithm',
  'reviewed_source_max_bytes',
  'reviewed_bundle_max_bytes',
]);
const EXACT_GENERATED_PROVENANCE = {
  artifact: true,
  description: 'Generated command manifest. Edit source fragments, not this file.',
  source_owner: 'manifests/AGENTS.md',
  source_path: 'manifests/commands/source/external/',
  regeneration_command: 'node scripts/generate-command-manifests.mjs',
};
const EXACT_NODE_RESOLUTION_POLICY = {
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
};
const EXACT_REGISTERED_LISTEN_ENVIRONMENT = {
  AOS_PATH: '$AOS_PATH',
  AOS_RUNTIME_MODE: '$AOS_RUNTIME_MODE',
  AOS_STATE_ROOT: '$AOS_STATE_ROOT',
};

function invalid(detail) {
  throw new Error(`external command manifest wire v2 is invalid: ${detail}`);
}

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object`);
}

function closed(value, allowed, label) {
  object(value, label);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) invalid(`${label} contains unsupported field ${key}`);
  }
}

function exactKeys(value, expected, label) {
  closed(value, expected, label);
  if (Object.keys(value).length !== expected.size) invalid(`${label} is missing a required field`);
}

function nonemptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) invalid(`${label} must be a non-empty string`);
}

function nonemptyStringArray(value, label, { pattern = null, unique = false } = {}) {
  if (!Array.isArray(value) || value.length === 0) invalid(`${label} must be a non-empty array`);
  for (const [index, item] of value.entries()) {
    nonemptyString(item, `${label}[${index}]`);
    if (pattern && !pattern.test(item)) invalid(`${label}[${index}] has an invalid value`);
  }
  if (unique && new Set(value).size !== value.length) invalid(`${label} must not contain duplicates`);
}

function normalizedScriptIdentity(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.includes('\\')
    && value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..' && PATH_SEGMENT.test(segment));
}

function sortedJSONString(value) {
  if (Array.isArray(value)) return `[${value.map(sortedJSONString).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${sortedJSONString(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function reviewedDependencySetDigest(reviewedDependencies) {
  return crypto.createHash('sha256')
    .update(Buffer.from(sortedJSONString(reviewedDependencies), 'utf8'))
    .digest('hex');
}

function reviewedSourceText(bytes, label) {
  if (!Buffer.isBuffer(bytes) || bytes.length > EXTERNAL_SPAWN_REVIEWED_SOURCE_MAX_BYTES) {
    throw new Error(`${label} must be at most ${EXTERNAL_SPAWN_REVIEWED_SOURCE_MAX_BYTES} raw bytes`);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} must be valid UTF-8`);
  }
}

function staticModuleSpecifiers(source, label) {
  if (/\bimport\s*(?:(?:\/\*[\s\S]*?\*\/|\/\/[^\r\n]*)\s*)?(?:\(|\.)/u.test(source)
      || /\brequire\s*(?:(?:\/\*[\s\S]*?\*\/|\/\/[^\r\n]*)\s*)?\(/u.test(source)
      || /\bcreateRequire\b/u.test(source)
      || /["']file:/u.test(source)) {
    throw new Error(`${label} contains an unsupported dynamic, CommonJS, import.meta, or file URL edge`);
  }
  const edgePattern = /^\s*(?:import\s+(?:[^'";]*?\s+from\s+)?|export\s+(?:\*|\{)[^'";]*?\s+from\s+)(['"])([^'"\r\n]+)\1\s*;?\s*$/gmu;
  const specifiers = [...source.matchAll(edgePattern)].map((match) => match[2]);
  // Count every raw import token conservatively. Comments or strings that add
  // ambiguity fail closed instead of being treated as reviewed module syntax.
  const declarationCount = (source.match(/\bimport\b/gu) ?? []).length
    + (source.match(/\bexport\s+(?:\*|\{)[^;]*?\s+from\b/gu) ?? []).length;
  if (specifiers.length !== declarationCount) {
    throw new Error(`${label} contains an import or re-export outside the reviewed static grammar`);
  }
  return specifiers;
}

function assertReviewedModuleEdges(source, label, expectedLocalSpecifier) {
  const specifiers = staticModuleSpecifiers(source, label);
  const local = specifiers.filter((specifier) => !specifier.startsWith('node:'));
  const expected = expectedLocalSpecifier === null ? [] : [expectedLocalSpecifier];
  if (JSON.stringify(local) !== JSON.stringify(expected)) {
    throw new Error(`${label} must contain exactly the reviewed local module edge set`);
  }
  if (specifiers.some((specifier) => !specifier.startsWith('node:') && specifier !== expectedLocalSpecifier)) {
    throw new Error(`${label} contains a module outside the reviewed closure`);
  }
}

export function assertReviewedExternalSpawnModuleClosure({ entryBytes, dependencyBytes }) {
  const entrySource = reviewedSourceText(entryBytes, 'registered listen entry source');
  const daemonClientSource = reviewedSourceText(
    dependencyBytes.get('scripts/lib/aos-daemon-client.mjs'),
    'reviewed daemon client source',
  );
  const voiceSource = reviewedSourceText(
    dependencyBytes.get('scripts/lib/aos-voice-follow.mjs'),
    'reviewed voice source',
  );
  assertReviewedModuleEdges(entrySource, 'registered listen entry source', './lib/aos-voice-follow.mjs');
  assertReviewedModuleEdges(voiceSource, 'reviewed voice source', './aos-daemon-client.mjs');
  assertReviewedModuleEdges(daemonClientSource, 'reviewed daemon client source', null);
  return { entrySource, daemonClientSource, voiceSource };
}

function replaceExactlyOnce(source, target, replacement, label) {
  const pieces = source.split(target);
  if (pieces.length !== 2) throw new Error(`${label} must occur exactly once`);
  return `${pieces[0]}${replacement}${pieces[1]}`;
}

export function composeReviewedExternalSpawnBundle({
  entryBytes,
  dependencyBytes,
  reviewedSetDigest,
  lifecycleParentPID,
}) {
  if (!SHA256.test(reviewedSetDigest ?? '')) throw new Error('reviewed dependency set digest is invalid');
  if (!Number.isSafeInteger(lifecycleParentPID) || lifecycleParentPID < 1 || lifecycleParentPID > 2_147_483_647) {
    throw new Error('lifecycle-only parent PID is invalid');
  }
  const { entrySource, daemonClientSource, voiceSource } = assertReviewedExternalSpawnModuleClosure({
    entryBytes,
    dependencyBytes,
  });
  const daemonClientURL = `data:text/javascript;base64,${Buffer.from(daemonClientSource, 'utf8').toString('base64')}`;
  const rewrittenVoice = replaceExactlyOnce(
    voiceSource,
    "'./aos-daemon-client.mjs'",
    JSON.stringify(daemonClientURL),
    'reviewed daemon client import',
  );
  const prelude = [
    `process.env[${JSON.stringify(EXTERNAL_SPAWN_REVIEWED_DEPENDENCY_SET_DIGEST_ENV)}] = ${JSON.stringify(reviewedSetDigest)};`,
    `process.env[${JSON.stringify(EXTERNAL_SPAWN_LIFECYCLE_PARENT_PID_ENV)}] = ${JSON.stringify(String(lifecycleParentPID))};`,
  ].join('\n');
  const voiceURL = `data:text/javascript;base64,${Buffer.from(`${prelude}\n${rewrittenVoice}`, 'utf8').toString('base64')}`;
  const bundle = Buffer.from(replaceExactlyOnce(
    entrySource,
    "'./lib/aos-voice-follow.mjs'",
    JSON.stringify(voiceURL),
    'reviewed voice import',
  ), 'utf8');
  if (bundle.length > EXTERNAL_SPAWN_REVIEWED_BUNDLE_MAX_BYTES) {
    throw new Error(`registered listen bundle must be at most ${EXTERNAL_SPAWN_REVIEWED_BUNDLE_MAX_BYTES} raw bytes`);
  }
  return bundle;
}

function validateGenerated(generated) {
  exactKeys(generated, GENERATED_KEYS, 'generated');
  for (const [key, expected] of Object.entries(EXACT_GENERATED_PROVENANCE)) {
    if (generated[key] !== expected) invalid(`generated.${key} does not match canonical provenance`);
  }
}

function validateCondition(condition, label) {
  closed(condition, CONDITION_KEYS, label);
  if (!Number.isInteger(condition.child_arg_index) || condition.child_arg_index < 0) {
    invalid(`${label}.child_arg_index must be a non-negative integer`);
  }
  if (condition.child_arg_missing !== undefined && typeof condition.child_arg_missing !== 'boolean') {
    invalid(`${label}.child_arg_missing must be boolean`);
  }
  if (condition.prefix !== undefined) nonemptyString(condition.prefix, `${label}.prefix`);
  for (const key of ['excluded_prefixes', 'excluded_values']) {
    if (condition[key] !== undefined) nonemptyStringArray(condition[key], `${label}.${key}`, { unique: true });
  }
}

function validateRegistration(registration, command, label) {
  exactKeys(registration, REGISTRATION_KEYS, label);
  if (!IDENTIFIER.test(registration.route_source_id ?? '')) invalid(`${label}.route_source_id is invalid`);
  if (!SHA256.test(registration.route_source_revision ?? '')) invalid(`${label}.route_source_revision is invalid`);
  if (!IDENTIFIER.test(registration.adapter_registration_id ?? '')) invalid(`${label}.adapter_registration_id is invalid`);
  if (!Number.isInteger(registration.adapter_registration_revision) || registration.adapter_registration_revision < 1) {
    invalid(`${label}.adapter_registration_revision must be a positive integer`);
  }
  exactKeys(registration.activation_predicate, new Set(['grammar']), `${label}.activation_predicate`);
  if (registration.activation_predicate.grammar !== 'listen_microphone_v1') {
    invalid(`${label}.activation_predicate is invalid`);
  }
  exactKeys(registration.executable_resolution_policy, RESOLUTION_POLICY_KEYS, `${label}.executable_resolution_policy`);
  for (const [key, expected] of Object.entries(EXACT_NODE_RESOLUTION_POLICY)) {
    if (registration.executable_resolution_policy[key] !== expected) {
      invalid(`${label}.executable_resolution_policy.${key} is invalid`);
    }
  }
  if (!normalizedScriptIdentity(registration.expected_script_identity)) invalid(`${label}.expected_script_identity is invalid`);
  for (const key of ['expected_script_digest', 'reviewed_dependency_set_digest', 'canonical_argv_shape_digest']) {
    if (!SHA256.test(registration[key] ?? '')) invalid(`${label}.${key} is invalid`);
  }
  if (!Array.isArray(registration.reviewed_dependencies)
      || registration.reviewed_dependencies.length !== EXTERNAL_SPAWN_REVIEWED_DEPENDENCY_IDENTITIES.length) {
    invalid(`${label}.reviewed_dependencies must be the exact reviewed dependency set`);
  }
  registration.reviewed_dependencies.forEach((dependency, index) => {
    const dependencyLabel = `${label}.reviewed_dependencies[${index}]`;
    exactKeys(dependency, REVIEWED_DEPENDENCY_KEYS, dependencyLabel);
    if (dependency.identity !== EXTERNAL_SPAWN_REVIEWED_DEPENDENCY_IDENTITIES[index]) {
      invalid(`${dependencyLabel}.identity is outside the reviewed dependency set`);
    }
    if (!SHA256.test(dependency.digest ?? '')) invalid(`${dependencyLabel}.digest is invalid`);
  });
  if (reviewedDependencySetDigest(registration.reviewed_dependencies) !== registration.reviewed_dependency_set_digest) {
    invalid(`${label}.reviewed_dependency_set_digest does not match the reviewed dependency set`);
  }
  if (
    command.executable !== '/usr/bin/env'
    || JSON.stringify(command.argv_prefix) !== JSON.stringify(['node', '--input-type=module', '-', 'listen'])
    || registration.expected_script_identity !== 'scripts/aos-tell-listen.mjs'
    || command.help_passthrough === true
    || command.cwd !== 'repo'
    || command.stdio !== 'registered_bundle'
    || sortedJSONString(command.env) !== sortedJSONString(EXACT_REGISTERED_LISTEN_ENVIRONMENT)
    || Object.keys(command.env ?? {}).some((key) => REGISTERED_SPAWN_UNSAFE_ENVIRONMENT.test(key))
  ) {
    invalid(`${label} is not bound to its authored Node command`);
  }
}

function validateCommand(command, index) {
  const label = `commands[${index}]`;
  closed(command, COMMAND_KEYS, label);
  for (const required of ['path', 'summary', 'executable', 'argv_prefix']) {
    if (!Object.hasOwn(command, required)) invalid(`${label}.${required} is required`);
  }
  nonemptyStringArray(command.path, `${label}.path`, { pattern: PATH_SEGMENT });
  nonemptyString(command.summary, `${label}.summary`);
  if (!new Set(['$AOS_PATH', '/usr/bin/env', '/bin/bash']).has(command.executable)) {
    invalid(`${label}.executable is invalid`);
  }
  nonemptyStringArray(command.argv_prefix, `${label}.argv_prefix`);
  if (command.help_passthrough !== undefined && typeof command.help_passthrough !== 'boolean') {
    invalid(`${label}.help_passthrough must be boolean`);
  }
  if (command.cwd !== undefined && command.cwd !== 'repo' && command.cwd !== '$AOS_REPO_ROOT') {
    invalid(`${label}.cwd is invalid`);
  }
  if (command.env !== undefined) {
    object(command.env, `${label}.env`);
    for (const [key, value] of Object.entries(command.env)) {
      if (!ENVIRONMENT_KEY.test(key) || RESERVED_DISPATCH_ENVIRONMENT.has(key)) invalid(`${label}.env contains a reserved or invalid key`);
      nonemptyString(value, `${label}.env.${key}`);
    }
  }
  if (command.stdio !== undefined
      && command.stdio !== 'capture'
      && command.stdio !== 'inherit'
      && command.stdio !== 'registered_bundle') {
    invalid(`${label}.stdio is invalid`);
  }
  if (command.when !== undefined) validateCondition(command.when, `${label}.when`);
  if (command.spawn_registration !== undefined) {
    validateRegistration(command.spawn_registration, command, `${label}.spawn_registration`);
  } else if (command.stdio === 'registered_bundle') {
    invalid(`${label}.stdio registered_bundle requires spawn_registration`);
  }
}

export function validateExternalCommandManifestV1(manifest, { canonicalAggregate = false } = {}) {
  closed(manifest, TOP_LEVEL_KEYS, 'manifest');
  for (const required of ['generated', 'schema_version', 'commands']) {
    if (!Object.hasOwn(manifest, required)) invalid(`manifest.${required} is required`);
  }
  if (manifest.$schema !== undefined && typeof manifest.$schema !== 'string') invalid('manifest.$schema must be a string');
  validateGenerated(manifest.generated);
  if (manifest.schema_version !== 2) invalid('manifest.schema_version must be 2');
  if (!Array.isArray(manifest.commands) || manifest.commands.length === 0) invalid('manifest.commands must be a non-empty array');
  manifest.commands.forEach(validateCommand);

  const registered = manifest.commands.filter((command) => command.spawn_registration !== undefined);
  if (registered.length > 1) invalid('manifest may contain at most one spawn registration');
  if (registered.length === 1) {
    const [command] = registered;
    if (
      command.path.length !== 1
      || command.path[0] !== 'listen'
      || command.spawn_registration.route_source_id !== 'listen'
      || command.spawn_registration.adapter_registration_id !== 'microphone-capture-adapter'
    ) {
      invalid('only listen may own the microphone spawn registration');
    }
  }
  if (canonicalAggregate && registered.length !== 1) {
    invalid('canonical aggregate must contain exactly one listen spawn registration');
  }
  return manifest;
}

export async function readCanonicalRegularFile(file) {
  const requested = path.resolve(file);
  const canonical = await fs.realpath(requested);
  const status = await fs.lstat(requested);
  if (canonical !== requested || !status.isFile()) {
    throw new Error('registered script must be a canonical non-symlink regular file');
  }
  return fs.readFile(requested);
}

export function assertExternalCommandManifestGeneratorCurrent(repoRoot) {
  const result = spawnSync(
    process.execPath,
    [path.join(repoRoot, 'scripts/generate-command-manifests.mjs'), '--check'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error('generated external command manifest is not current with its canonical sources');
  }
}
