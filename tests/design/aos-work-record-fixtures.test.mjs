import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(repoRoot, 'docs/design/fixtures/aos-work-records');

const requiredDoStepKeys = [
  'type',
  'schema_version',
  'id',
  'surface',
  'intent',
  'precondition',
  'action',
  'postcondition',
  'execution_map',
  'evidence',
  'health'
];

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, fileName), 'utf8'));
}

test('design work-record fixtures are valid JSON', () => {
  const files = fs.readdirSync(fixtureRoot).filter((file) => file.endsWith('.json'));
  assert.deepEqual(files.sort(), [
    'browser-artifact-collection-step.json',
    'canvas-toolkit-control-step.json',
    'desktop-workflow-demo-step.json',
    'recipe-health-retirement.json'
  ]);

  for (const file of files) {
    assert.doesNotThrow(() => readJson(file), file);
  }
});

test('do_step examples preserve the four-layer work-record shape', () => {
  for (const file of [
    'browser-artifact-collection-step.json',
    'canvas-toolkit-control-step.json',
    'desktop-workflow-demo-step.json'
  ]) {
    const fixture = readJson(file);
    for (const key of requiredDoStepKeys) {
      assert.ok(Object.hasOwn(fixture, key), `${file} missing ${key}`);
    }
    assert.equal(fixture.type, 'aos.do_step');
    assert.equal(typeof fixture.intent.nl, 'string');
    assert.ok(fixture.intent.nl.length > 20);
    assert.equal(typeof fixture.action.verb, 'string');
    assert.equal(typeof fixture.action.target, 'string');
    assert.equal(typeof fixture.health.state, 'string');
  }
});

test('health fixture keeps retirement separate from historical evidence', () => {
  const fixture = readJson('recipe-health-retirement.json');
  assert.equal(fixture.type, 'aos.recipe_health_event');
  assert.equal(fixture.next_health.state, 'impossible');
  assert.equal(fixture.retirement.automatic_replay_allowed, false);
  assert.ok(fixture.evidence.last_trace.includes('trace'));
});
