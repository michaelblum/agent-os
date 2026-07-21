import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DESKTOP_WORLD_SCENE_RESULT_ERROR_CODES } from '../../packages/toolkit/scene/scene-result-codes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/daemon-event.schema.json');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/daemon-event');
const descriptorSchemaPath = path.join(repoRoot, 'shared/schemas/aos-status-item-descriptor-v1.schema.json');
const statusEventSchemaPath = path.join(repoRoot, 'shared/schemas/aos-status-item-event-v1.schema.json');
const anchorSchemaPath = path.join(repoRoot, 'shared/schemas/aos-status-item-anchor-v1.schema.json');

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
from referencing import Registry, Resource

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(Path(sys.argv[2]).read_text())
Draft202012Validator.check_schema(schema)
registry = Registry()
for candidate in Path(sys.argv[1]).parent.glob("*.json"):
    document = json.loads(candidate.read_text())
    if document.get("$id"):
        registry = registry.with_resource(document["$id"], Resource.from_contents(document))
validator = Draft202012Validator(schema, registry=registry)
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

function runValueJsonschema(targetSchemaPath, value) {
  return spawnSync('python3', ['-c', `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

schema_path = Path(sys.argv[1])
schema = json.loads(schema_path.read_text())
instance = json.loads(sys.argv[2])
registry = Registry()
for candidate in schema_path.parent.glob("*.json"):
    document = json.loads(candidate.read_text())
    if document.get("$id"):
        registry = registry.with_resource(document["$id"], Resource.from_contents(document))
validator = Draft202012Validator(schema, registry=registry)
errors = sorted(validator.iter_errors(instance), key=lambda error: list(error.path))
if errors:
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`, targetSchemaPath, JSON.stringify(value)], { encoding: 'utf8' });
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
    'playback_started',
    'playback_finished',
    'playback_canceled',
    'playback_failed',
    'speech_started',
    'speech_finished',
    'speech_canceled',
    'speech_failed',
  ]);
});

test('annotation event vocabulary is strict across desktop selection lifecycle', async () => {
  const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  const rule = schema.allOf.find((item) => item.if?.properties?.service?.const === 'annotation' && !item.if?.properties?.event);
  assert.deepEqual(rule.then.properties.event.enum, [
    'selection_started',
    'selection_completed',
    'selection_canceled',
    'selection_failed',
  ]);
});

test('status-item event envelope has a strict vocabulary and typed event payload', async () => {
  const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  const rule = schema.allOf.find((item) => item.if?.properties?.service?.const === 'status_item' && !item.if?.properties?.event);
  assert.deepEqual(rule.then.properties.event.enum, [
    'ready',
    'bounds_changed',
    'topology_changed',
    'primary_activation',
    'secondary_activation',
    'menu_selection',
  ]);
  assert.equal(
    rule.then.properties.data.$ref,
    'https://agent-os.local/schemas/aos-status-item-event-v1.schema.json',
  );

  const fixture = JSON.parse(await fs.readFile(path.join(fixtureRoot, 'valid/status-item-ready.json'), 'utf8'));
  const leaked = structuredClone(fixture);
  leaked.data.path = '/private/status-item-state';
  const result = runValueJsonschema(schemaPath, leaked);
  assert.notEqual(result.status, 0, 'status-item event data must remain closed to undeclared fields');
});

test('descriptor, event, and anchor identifier schemas reject dot-dot sequences', async () => {
  const envelope = JSON.parse(await fs.readFile(path.join(fixtureRoot, 'valid/status-item-ready.json'), 'utf8'));
  const descriptor = {
    schema_version: 'aos.status_item.descriptor.v1',
    owner: 'io..example',
    item_id: 'companion',
    revision: 1,
    label: 'Companion',
    primary_action_id: 'summon',
  };
  const event = structuredClone(envelope.data);
  event.item_id = 'companion..menu';
  const anchor = structuredClone(envelope.data.anchor);
  anchor.anchor_id = 'native-status-item/io..example/companion';

  for (const [targetSchemaPath, value] of [
    [descriptorSchemaPath, descriptor],
    [statusEventSchemaPath, event],
    [anchorSchemaPath, anchor],
  ]) {
    const result = runValueJsonschema(targetSchemaPath, value);
    assert.notEqual(result.status, 0, `${path.basename(targetSchemaPath)} should reject '..'`);
  }
});

test('scene event vocabulary is strict across results and subscribed gestures', async () => {
  const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  const rule = schema.allOf.find((item) => item.if?.properties?.service?.const === 'scene' && !item.if?.properties?.event);
  assert.deepEqual(rule.then.properties.event.enum, ['result', 'gesture', 'monitor']);
});

test('scene result errors are derived from the runtime emitter contract', async () => {
  const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  assert.deepEqual(
    schema.$defs.SceneResultData.properties.code.enum,
    DESKTOP_WORLD_SCENE_RESULT_ERROR_CODES,
  );

  const stage = await fs.readFile(path.join(
    repoRoot,
    'packages/toolkit/components/desktop-world-stage/index.js',
  ), 'utf8');
  assert.match(stage, /normalizeDesktopWorldSceneResultErrorCode\(fault\.code/u);
  assert.match(stage, /normalizeDesktopWorldSceneResultErrorCode\(\s*error\?\.code/u);

  const coordinator = await fs.readFile(path.join(
    repoRoot,
    'src/daemon/desktop-world-scene-result-coordinator.swift',
  ), 'utf8');
  const nativeBlock = coordinator.match(
    /let aosDesktopWorldSceneResultErrorCodes: Set<String> = \[([\s\S]*?)\n\]/u,
  );
  assert.ok(nativeBlock, 'expected native scene-result error allowlist');
  const nativeCodes = [...nativeBlock[1].matchAll(/"(SCENE_[A-Z0-9_]+)"/gu)]
    .map((match) => match[1]);
  assert.deepEqual(nativeCodes, DESKTOP_WORLD_SCENE_RESULT_ERROR_CODES);
});
