import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createWorkRecordSubject,
  createWorkRecordSubjects,
} from '../../packages/toolkit/workbench/work-record-subject.js';
import {
  subjectCapabilities,
  subjectContracts,
  subjectFacets,
  subjectHosts,
  subjectLegacyControls,
  subjectLegacyViews,
} from '../../packages/toolkit/workbench/subject.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(repoRoot, 'docs/design/fixtures/aos-work-records');
const v0FixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0/valid');

function fixture(name, root = fixtureRoot) {
  return JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
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
  assert.ok(subjectCapabilities(subject).includes('editable'));
  assert.ok(subjectContracts(subject).includes('work_record.execution_map.edit'));
  const facets = subjectFacets(subject);
  assert.ok(facets.find((facet) => facet.key === 'work_record.execution_map.json').contracts.includes('work_record.execution_map.view'));
  assert.ok(facets.find((facet) => facet.key === 'work_record.controls').contracts.includes('work_record.execution_map.edit'));
  assert.ok(subjectHosts(subject).every((host) => host.kind === 'canvas' && host.target_dialect === 'canvas'));
  assert.ok(subject.capabilities.includes('work_record.execution_map.edit'));
  assert.ok(subjectLegacyViews(subject).includes('work_record.step.timeline'));
  assert.ok(subjectLegacyControls(subject).includes('execution_map.json.editor'));
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
  assert.ok(subjectLegacyViews(subject).includes('work_record.retirement'));
  assert.ok(subjectFacets(subject).find((facet) => facet.key === 'work_record.retirement').contracts.includes('work_record.retirement.inspect'));
  assert.ok(subject.capabilities.includes('work_record.retirement.inspect'));
});

test('createWorkRecordSubject projects a v0 Work Record read-only', () => {
  const subject = createWorkRecordSubject(fixture('playbook-origin.json', v0FixtureRoot));

  assert.equal(subject.id, 'work-record:playbook-open-wiki-sigil-2026-05-05');
  assert.equal(subject.subject_type, 'aos.work_record');
  assert.equal(subject.source.kind, 'work_record');
  assert.equal(subject.source.format, 'v0');
  assert.equal(subject.source.origin.kind, 'playbook');
  assert.equal(subject.state.health.state, 'valid');
  assert.equal(subject.state.read_only, true);
  assert.equal(subject.persistence, null);
  assert.equal(subject.artifacts.length, 3);
  assert.ok(subject.capabilities.includes('inspectable'));
  assert.ok(subject.capabilities.includes('verifier-target'));
  assert.ok(subject.capabilities.includes('work_record.verifier_report.view'));
  assert.ok(subjectContracts(subject).includes('work_record.verifier_report.view'));
  assert.ok(subjectFacets(subject).find((facet) => facet.key === 'work_record.verifier_report').contracts.includes('work_record.verifier_report.view'));
  assert.ok(!subject.capabilities.includes('work_record.execution_map.edit'));
  assert.ok(subjectLegacyViews(subject).includes('work_record.execution_map.postconditions'));
  assert.ok(subjectLegacyViews(subject).includes('work_record.claims'));
  assert.ok(subjectLegacyViews(subject).includes('work_record.claim_results'));
  assert.ok(subjectLegacyViews(subject).includes('work_record.verifier_report'));
  assert.ok(!subjectLegacyControls(subject).includes('execution_map.json.editor'));
  assert.deepEqual(subjectLegacyControls(subject), ['health.status']);
  assert.equal(subject.metadata.claim_count, 2);
  assert.equal(subject.metadata.claim_result_count, 2);
});

test('createWorkRecordSubjects maps arrays and rejects records without ids', () => {
  assert.equal(createWorkRecordSubjects([
    fixture('browser-artifact-collection-step.json'),
    fixture('canvas-toolkit-control-step.json'),
  ]).length, 2);
  assert.throws(() => createWorkRecordSubject({ type: 'aos.do_step' }), /requires an id/);
});
