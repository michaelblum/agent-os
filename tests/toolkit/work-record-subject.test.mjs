import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createWorkRecordSubject,
  createWorkRecordSubjects,
} from '../../packages/toolkit/workbench/work-record-subject.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(repoRoot, 'docs/design/fixtures/aos-work-records');

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), 'utf8'));
}

test('createWorkRecordSubject projects a browser do_step as a workbench subject', () => {
  const subject = createWorkRecordSubject(fixture('browser-artifact-collection-step.json'));

  assert.equal(subject.type, 'aos.workbench.subject');
  assert.equal(subject.id, 'work-record:collect-company-careers-page');
  assert.equal(subject.subject_type, 'aos.do_step');
  assert.equal(subject.owner, 'aos-work-record');
  assert.equal(subject.source.kind, 'work_record');
  assert.equal(subject.state.health.state, 'stale');
  assert.equal(subject.state.surface, 'browser');
  assert.equal(subject.state.action.verb, 'navigate');
  assert.equal(subject.metadata.has_execution_map, true);
  assert.ok(subject.capabilities.includes('work_record.execution_map.edit'));
  assert.ok(subject.views.includes('work_record.step.timeline'));
  assert.ok(subject.controls.includes('execution_map.json.editor'));
  assert.equal(subject.artifacts.length, 3);
});

test('createWorkRecordSubject projects recipe retirement as evidence and health', () => {
  const subject = createWorkRecordSubject(fixture('recipe-health-retirement.json'));

  assert.equal(subject.id, 'work-record:indeed-benefits-section-retired');
  assert.equal(subject.subject_type, 'aos.recipe_health_event');
  assert.equal(subject.source.kind, 'recipe_health_event');
  assert.equal(subject.source.recipe_id, 'employer-brand/collect-indeed-benefits-section');
  assert.equal(subject.state.health.state, 'impossible');
  assert.equal(subject.state.automatic_replay_allowed, false);
  assert.equal(subject.artifacts[0].kind, 'trace');
  assert.ok(subject.views.includes('work_record.retirement'));
  assert.ok(subject.capabilities.includes('work_record.retirement.inspect'));
});

test('createWorkRecordSubjects maps arrays and rejects records without ids', () => {
  assert.equal(createWorkRecordSubjects([
    fixture('browser-artifact-collection-step.json'),
    fixture('canvas-toolkit-control-step.json'),
  ]).length, 2);
  assert.throws(() => createWorkRecordSubject({ type: 'aos.do_step' }), /requires an id/);
});
