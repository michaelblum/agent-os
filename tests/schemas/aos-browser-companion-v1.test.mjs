import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateDescriptor } from '../../scripts/lib/browser-companion/descriptor.mjs';
import { CompanionError, publicError } from '../../scripts/lib/browser-companion/errors.mjs';
import { companionStatus } from '../../scripts/lib/browser-companion/lifecycle.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const descriptorPath = path.join(repoRoot, 'manifests/companions/playwright-cli-v1.json');
const descriptorSchema = path.join(repoRoot, 'shared/schemas/aos-browser-companion-descriptor-v1.schema.json');
const resultSchema = path.join(repoRoot, 'shared/schemas/aos-browser-companion-result-v1.schema.json');
const temporaryRoots = new Set();
const SUBPROCESS_TIMEOUT_MS = 5_000;

function temporaryRoot(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.add(directory);
  return directory;
}

after(() => {
  for (const directory of temporaryRoots) fs.rmSync(directory, { recursive: true, force: true });
});

function validate(schema, instance) {
  const directory = temporaryRoot('aos-browser-companion-schema-');
  const instancePath = path.join(directory, 'instance.json');
  fs.writeFileSync(instancePath, `${JSON.stringify(instance)}\n`);
  return spawnSync('python3', ['-c', `
import json, sys
from jsonschema import Draft202012Validator
schema = json.load(open(sys.argv[1], encoding='utf-8'))
instance = json.load(open(sys.argv[2], encoding='utf-8'))
Draft202012Validator.check_schema(schema)
errors = sorted(Draft202012Validator(schema).iter_errors(instance), key=lambda error: list(error.path))
for error in errors[:8]: print(error.message)
sys.exit(1 if errors else 0)
`, schema, instancePath], { encoding: 'utf8', timeout: SUBPROCESS_TIMEOUT_MS });
}

function assertValid(schema, instance) {
  const result = validate(schema, instance);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
}

test('source Playwright companion descriptor is exact, closed, and schema-valid', () => {
  const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
  assertValid(descriptorSchema, descriptor);
  const validated = validateDescriptor(descriptor);
  assert.equal(validated.descriptor.packages.length, 3);
  assert.deepEqual(validated.descriptor.packages.map(({ name, version }) => ({ name, version })), [
    { name: '@playwright/cli', version: '0.1.15' },
    { name: 'playwright', version: '1.62.0-alpha-2026-06-29' },
    { name: 'playwright-core', version: '1.62.0-alpha-2026-06-29' },
  ]);
  const widened = structuredClone(descriptor);
  widened.latest = true;
  assert.notEqual(validate(descriptorSchema, widened).status, 0);
  const changedIntegrity = structuredClone(descriptor);
  changedIntegrity.packages[0].integrity = `sha512-${Buffer.alloc(64).toString('base64')}`;
  assert.notEqual(validate(descriptorSchema, changedIntegrity).status, 0);
});

test('status, mutation, and typed error projections satisfy one closed content-free schema', () => {
  const root = temporaryRoot('aos-browser-companion-result-');
  const current = validateDescriptor(JSON.parse(fs.readFileSync(descriptorPath, 'utf8')));
  const status = companionStatus({ env: { ...process.env, AOS_STATE_ROOT: root }, current });
  assertValid(resultSchema, status);
  assert.equal(status.state, 'missing');

  const mutation = {
    schema_version: 'aos.browser.companion.mutation.v1',
    operation: 'install',
    status: 'installed',
    previous_version: null,
    active_version: '0.1.15',
    descriptor_sha256: current.digest,
    closure_sha256: 'a'.repeat(64),
    before_state: 'missing',
    after_state: 'current',
    session_cleanup_count: 0,
    recovery_pending: false,
    duration_ms: 12,
    completed_at: '2026-08-14T08:00:00.000Z',
  };
  assertValid(resultSchema, mutation);
  assertValid(resultSchema, { ...mutation, duration_ms: 300_001 });
  assertValid(resultSchema, { ...mutation, duration_ms: Number.MAX_SAFE_INTEGER });
  assert.notEqual(validate(resultSchema, { ...mutation, duration_ms: Number.MAX_SAFE_INTEGER + 1 }).status, 0);
  assertValid(resultSchema, { ...mutation, after_state: 'partial', recovery_pending: true });
  assertValid(resultSchema, { ...mutation, status: 'unchanged', after_state: 'partial', recovery_pending: true });
  assertValid(resultSchema, {
    ...mutation,
    operation: 'uninstall',
    status: 'uninstalled',
    active_version: null,
    before_state: 'update_available',
    after_state: 'missing',
  });
  assertValid(resultSchema, {
    ...mutation,
    operation: 'uninstall',
    status: 'uninstalled',
    active_version: null,
    before_state: 'partial',
    after_state: 'partial',
    recovery_pending: true,
  });
  assertValid(resultSchema, {
    ...mutation,
    operation: 'uninstall',
    status: 'already_absent',
    previous_version: null,
    active_version: null,
    closure_sha256: null,
    before_state: 'missing',
    after_state: 'missing',
  });

  const error = publicError(new CompanionError(
    'COMPANION_DOWNLOAD_FAILED',
    `raw path ${root} https://registry.npmjs.org/private.tgz`,
  ), 'install');
  assertValid(resultSchema, error);
  assert.equal(JSON.stringify(error).includes(root), false);
  assert.doesNotMatch(JSON.stringify(error), /https?:|\.tgz/u);

  assert.notEqual(validate(resultSchema, { ...status, path: root }).status, 0);
  assert.notEqual(validate(resultSchema, { ...mutation, operation: 'uninstall', status: 'installed' }).status, 0);
  assert.notEqual(validate(resultSchema, { ...error, detail: 'raw npm output' }).status, 0);
});
