import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { GateContinuationStore } from '../../packages/daemon/gate/continuations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const continuationSchema = path.join(repoRoot, 'shared/schemas/aos.gate.continuation.v1.json');
const resumeEventSchema = path.join(repoRoot, 'shared/schemas/aos.gate.resume-event.v1.json');

function validate(schemaPath, instancePath) {
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
        print('/'.join(str(p) for p in error.path), error.message)
    sys.exit(1)
`,
      schemaPath,
      instancePath,
    ],
    { encoding: 'utf8' },
  );
}

function request() {
  return {
    schema_version: 'aos.gate.request.v1',
    id: 'gate-schema',
    prompt: { title: 'Schema gate' },
    fields: [{ id: 'decision', kind: 'boolean' }],
    timeout_ms: 20000,
    source: { surface: 'test' },
  };
}

test('deferred gate continuation and resume event records match public schemas', async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), 'aos-gate-schema-'));
  const store = new GateContinuationStore({ root: stateRoot, env: { AOS_RUNTIME_MODE: 'repo' } });
  const continuation = await store.create({
    request: request(),
    sessionId: 'codex-schema-session',
    harness: 'codex',
    role: 'worker',
  });
  assert.equal(continuation.session.role, 'worker');
  assert.equal('dock' in continuation.session, false);

  const submitted = await store.submit({ continuationId: continuation.continuation_id, response: { decision: true } });
  const continuationPath = path.join(stateRoot, 'continuation.json');
  const eventPath = path.join(stateRoot, 'event.json');
  await writeFile(continuationPath, JSON.stringify(submitted.record), 'utf8');
  await writeFile(eventPath, JSON.stringify(submitted.event), 'utf8');

  const continuationResult = validate(continuationSchema, continuationPath);
  assert.equal(continuationResult.status, 0, `${continuationResult.stdout}${continuationResult.stderr}`);
  const eventResult = validate(resumeEventSchema, eventPath);
  assert.equal(eventResult.status, 0, `${eventResult.stdout}${eventResult.stderr}`);
});

test('legacy v1 continuation records with session.dock validate for compatibility', async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), 'aos-gate-legacy-schema-'));
  const store = new GateContinuationStore({ root: stateRoot, env: { AOS_RUNTIME_MODE: 'repo' } });
  const continuation = await store.create({
    request: request(),
    sessionId: 'codex-legacy-schema-session',
    harness: 'codex',
    role: 'worker',
  });
  const legacySession = { ...continuation.session, dock: 'gdi' };
  delete legacySession.role;
  const legacy = { ...continuation, session: legacySession };
  const legacyPath = path.join(stateRoot, 'legacy-continuation.json');
  await writeFile(legacyPath, JSON.stringify(legacy), 'utf8');

  const legacyResult = validate(continuationSchema, legacyPath);
  assert.equal(legacyResult.status, 0, `${legacyResult.stdout}${legacyResult.stderr}`);
});

test('mixed v1 continuation records with session.role and session.dock are not canonical schema', async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), 'aos-gate-mixed-schema-'));
  const store = new GateContinuationStore({ root: stateRoot, env: { AOS_RUNTIME_MODE: 'repo' } });
  const continuation = await store.create({
    request: request(),
    sessionId: 'codex-mixed-schema-session',
    harness: 'codex',
    role: 'worker',
  });
  const mixed = { ...continuation, session: { ...continuation.session, dock: 'gdi' } };
  const mixedPath = path.join(stateRoot, 'mixed-continuation.json');
  await writeFile(mixedPath, JSON.stringify(mixed), 'utf8');

  const mixedResult = validate(continuationSchema, mixedPath);
  assert.notEqual(mixedResult.status, 0, 'mixed role+dock records must stay read-boundary tolerance only');
});
