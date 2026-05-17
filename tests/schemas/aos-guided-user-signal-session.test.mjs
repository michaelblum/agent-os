import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createGuidedUserSignalSession } from '../../packages/toolkit/workbench/guided-user-signal-session.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos.guided-user-signal.session.v1.json');

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
        print('/'.join(str(p) for p in error.path), error.message)
    sys.exit(1)
`,
      schemaPath,
      instancePath,
    ],
    { encoding: 'utf8' },
  );
}

test('guided user signal session record matches public schema', async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), 'aos-guided-user-signal-schema-'));
  const record = createGuidedUserSignalSession({
    session_id: 'guided-signal-11111111-2222-3333-4444-555555555555',
    source_operation: { operation_id: 'op-1', operation_kind: 'repair', session_id: 's-1', harness: 'codex', agent: 'gdi' },
    subject: { reference: 'subject:button', kind: 'browser_element', surface_id: 'canvas-1', surface_kind: 'browser_page' },
    guidance: [{ kind: 'label', text: 'This control', rect: { x: 1, y: 2, width: 3, height: 4 } }],
    capture_request: { kind: 'annotation' },
    capture_result: {
      kind: 'annotation',
      captured_at: '2026-05-17T02:40:00.000Z',
      annotation: { address: 'subject:button', comment_text: 'This one' },
      free_text: 'This one',
    },
    linked_artifacts: { gate_record_id: 'gate-1', continuation_id: 'gate-cont-11111111-2222-3333-4444-555555555555' },
    lifecycle: { state: 'captured', terminal_outcome: 'captured' },
  }, { now: '2026-05-17T02:39:00.000Z', env: { AOS_STATE_ROOT: stateRoot, AOS_RUNTIME_MODE: 'repo' } });
  const instancePath = path.join(stateRoot, 'guided-session.json');
  await writeFile(instancePath, JSON.stringify(record), 'utf8');

  const result = validate(instancePath);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test('guided user signal session schema accepts redacted and explicitly stored text records', async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), 'aos-guided-user-signal-schema-redaction-'));
  const base = {
    source_operation: { operation_id: 'op-1', operation_kind: 'repair', session_id: 's-1', harness: 'codex', agent: 'gdi' },
    subject: { reference: 'subject:button', kind: 'browser_element', surface_id: 'canvas-1', surface_kind: 'browser_page' },
    guidance: [{ kind: 'label', text: 'This control', rect: { x: 1, y: 2, width: 3, height: 4 } }],
    capture_request: { kind: 'annotation', prompt: 'Private prompt body' },
    capture_result: {
      kind: 'annotation',
      captured_at: '2026-05-17T02:40:00.000Z',
      annotation: { address: 'subject:button', comment_text: 'This one' },
      free_text: 'Private answer text',
    },
    lifecycle: { state: 'captured', terminal_outcome: 'captured' },
  };
  const records = [
    createGuidedUserSignalSession({
      ...base,
      session_id: 'guided-signal-11111111-2222-3333-4444-555555555555',
    }, { now: '2026-05-17T02:39:00.000Z', env: { AOS_STATE_ROOT: stateRoot, AOS_RUNTIME_MODE: 'repo' } }),
    createGuidedUserSignalSession({
      ...base,
      session_id: 'guided-signal-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      redaction: { prompt_bodies: 'store', free_text_answers: 'store' },
    }, { now: '2026-05-17T02:39:00.000Z', env: { AOS_STATE_ROOT: stateRoot, AOS_RUNTIME_MODE: 'repo' } }),
  ];

  assert.equal(records[0].capture_request.prompt, '');
  assert.equal(records[0].capture_result.free_text, '');
  assert.equal(records[0].capture_result.annotation.comment_text, '');
  assert.equal(records[1].capture_request.prompt, 'Private prompt body');
  assert.equal(records[1].capture_result.free_text, 'Private answer text');
  assert.equal(records[1].capture_result.annotation.comment_text, 'This one');

  for (const [index, record] of records.entries()) {
    const instancePath = path.join(stateRoot, `guided-session-${index}.json`);
    await writeFile(instancePath, JSON.stringify(record), 'utf8');
    const result = validate(instancePath);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  }
});
