import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/daemon-event.schema.json');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/daemon-event');

async function jsonFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

function runJsonschema(fixturePath) {
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
      fixturePath,
    ],
    { encoding: 'utf8' },
  );
}

test('valid daemon event fixtures match the canonical schema', async () => {
  const fixtures = await jsonFiles(path.join(fixtureRoot, 'valid'));
  assert.ok(fixtures.length >= 1, 'expected valid fixtures');
  for (const fixture of fixtures) {
    const result = runJsonschema(fixture);
    assert.equal(
      result.status,
      0,
      `${path.relative(repoRoot, fixture)} should validate\n${result.stdout}${result.stderr}`,
    );
  }
});

test('invalid daemon event fixtures are rejected by the canonical schema', async () => {
  const fixtures = await jsonFiles(path.join(fixtureRoot, 'invalid'));
  assert.ok(fixtures.length >= 1, 'expected invalid fixtures');
  for (const fixture of fixtures) {
    const result = runJsonschema(fixture);
    assert.notEqual(result.status, 0, `${path.relative(repoRoot, fixture)} should fail validation`);
  }
});

test('voice event vocabulary is strict across dictation, capture, and speech', async () => {
  const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  const voiceServiceRule = schema.allOf.find((rule) => rule.if?.properties?.service?.const === 'voice');
  assert.deepEqual(voiceServiceRule.then.properties.event.enum, [
    'wake_detected',
    'dictation_opened',
    'dictation_closed_send',
    'dictation_closed_cancel',
    'capture_started',
    'capture_completed',
    'capture_canceled',
    'capture_failed',
    'capture_segmented_started',
    'capture_segment_ready',
    'capture_segmented_completed',
    'capture_segmented_canceled',
    'capture_segmented_failed',
    'audio_frame',
    'speech_started',
    'speech_finished',
    'speech_canceled',
    'speech_failed',
  ]);
});
