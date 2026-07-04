import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  discoverWorkRecords,
  readWorkRecord,
  verifyWorkRecord,
  explainWorkRecordStatus,
  exportWorkRecordBundle,
  recoveryGuidanceForWorkRecord,
  WORK_RECORD_CONSUMER_VERSION,
} from '../../packages/toolkit/workbench/work-record-consumer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0');
const validRoot = path.join(fixtureRoot, 'valid');

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(validRoot, name), 'utf8'));
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-consumer-'));
}

function writeJSON(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function runAos(args) {
  return spawnSync('./aos', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

test('Work Record consumer discovers canonical fixtures and reads records by id or path', () => {
  const discovery = discoverWorkRecords({ roots: [validRoot], repoRoot });
  assert.equal(discovery.status, 'success');
  assert.equal(discovery.schema_version, WORK_RECORD_CONSUMER_VERSION);
  assert.ok(discovery.records.some((record) => record.id === 'work-record:workflow-open-wiki-sigil-2026-05-05'));
  assert.ok(discovery.records.some((record) => record.id === 'work-record:workflow-browser-live-action-status-aos-browser-click-status-2026-05-06'));

  const byId = readWorkRecord('workflow-open-wiki-sigil-2026-05-05', { roots: [validRoot], repoRoot });
  assert.equal(byId.status, 'success');
  assert.equal(byId.summary.id, 'work-record:workflow-open-wiki-sigil-2026-05-05');
  assert.equal(byId.summary.historical_claim_results_present, true);

  const byPath = readWorkRecord(path.join(validRoot, 'workflow-origin.json'), { repoRoot });
  assert.equal(byPath.status, 'success');
  assert.equal(byPath.source.match, 'path');
  assert.equal(byPath.record.id, byId.record.id);

  const defaultDiscovery = discoverWorkRecords({ repoRoot });
  const duplicateIds = defaultDiscovery.records
    .map((record) => record.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  assert.equal(defaultDiscovery.status, 'success');
  assert.deepEqual(duplicateIds, []);

  const adHoc = readWorkRecord('work-record:aos-browser-click-status-2026-05-06', { repoRoot });
  assert.equal(adHoc.status, 'success');
  assert.equal(adHoc.record.origin.kind, 'ad_hoc');

  const workflow = readWorkRecord('work-record:workflow-browser-live-action-status-aos-browser-click-status-2026-05-06', { repoRoot });
  assert.equal(workflow.status, 'success');
  assert.equal(workflow.record.origin.kind, 'workflow');
});

test('Work Record consumer verify returns report-only diagnostics distinct from historical claim results', () => {
  const result = verifyWorkRecord(path.join(validRoot, 'workflow-origin.json'), { repoRoot });

  assert.equal(result.status, 'passed');
  assert.equal(result.verifier_profile_id, 'aos.verifier.work-record.v0.report-only');
  assert.equal(result.verifier_mode, 'report_only');
  assert.equal(result.mutates_record, false);
  assert.equal(result.health_verdict, 'valid');
  assert.equal(result.embedded_record_health, 'valid');
  assert.equal(result.current_report_status, 'passed');
  assert.deepEqual(result.failure_classes, []);
  assert.deepEqual(result.diagnostics, []);
  assert.ok(result.evidence_refs_used.includes('evidence:after-see'));
  assert.equal(result.historical_claim_results.source, 'record.claim_results');
  assert.equal(result.historical_claim_results.distinct_from_current_report, true);
  assert.equal(result.recovery.action, 'no_repair_needed');
  assert.ok(result.recovery.next_commands.every((command) => !command.includes('replay')));
});

test('Work Record consumer status returns conservative recovery guidance for every health verdict', () => {
  const base = fixture('workflow-origin.json');
  const actions = new Map([
    ['valid', 'no_repair_needed'],
    ['stale', 'reperceive_and_create_new_record'],
    ['repairable', 'workflow_gated_repair_required'],
    ['blocked', 'resolve_blocker_before_reuse'],
    ['impossible', 'do_not_replay'],
    ['superseded', 'use_replacement_record'],
    ['retired', 'historical_only'],
  ]);

  for (const [verdict, action] of actions) {
    const record = structuredClone(base);
    record.health.verdict = verdict;
    if (verdict === 'superseded') {
      record.references.push({
        id: 'replacement',
        relationship: 'superseded_by',
        ref: 'work-record:newer-record',
      });
    }
    const recovery = recoveryGuidanceForWorkRecord(record, { diagnostics: [], failure_classes: [] });
    assert.equal(recovery.verdict, verdict);
    assert.equal(recovery.action, action);
    assert.equal(recovery.mutates_record, false);
    assert.equal(recovery.automatic_replay_allowed, false);
    assert.equal(recovery.next_commands.some((command) => /\breplay\b/.test(command)), false);
  }

  const repairable = explainWorkRecordStatus(path.join(validRoot, 'repairable-stale-saved-ref.json'), { repoRoot });
  assert.equal(repairable.status, 'failed');
  assert.equal(repairable.health_verdict, 'repairable');
  assert.equal(repairable.recovery.action, 'workflow_gated_repair_required');
  assert.ok(repairable.recovery.next_commands.includes('./aos see capture browser:work-record-saved-ref-demo --save --workspace work-record-proof --mode ax'));

  const blocked = explainWorkRecordStatus(path.join(validRoot, 'cleanup-or-postcondition-failed.json'), { repoRoot });
  assert.equal(blocked.status, 'failed');
  assert.equal(blocked.embedded_record_health, 'blocked');
  assert.equal(blocked.health_verdict, 'blocked');
  assert.equal(blocked.current_report_status, 'failed');
  assert.equal(blocked.recovery.action, 'resolve_blocker_before_reuse');
});

test('Work Record consumer fails closed on invalid records and duplicate ids', () => {
  const invalid = discoverWorkRecords({
    roots: [path.join(fixtureRoot, 'invalid')],
    repoRoot,
  });
  assert.equal(invalid.status, 'failed');
  assert.ok(invalid.diagnostics.some((diagnostic) => diagnostic.code === 'AD_HOC_ORIGIN_REF_NOT_NULL'));
  assert.ok(invalid.diagnostics.some((diagnostic) => diagnostic.code === 'TOP_LEVEL_POSTCONDITIONS_UNSUPPORTED'));
  assert.ok(invalid.diagnostics.some((diagnostic) => diagnostic.code === 'REPLAY_GATE_NOT_REQUIRED'));

  const dir = tempDir();
  const record = fixture('workflow-origin.json');
  writeJSON(path.join(dir, 'a.json'), record);
  writeJSON(path.join(dir, 'b.json'), record);
  const duplicate = discoverWorkRecords({ roots: [dir], repoRoot });
  assert.equal(duplicate.status, 'success');
  assert.ok(duplicate.diagnostics.some((diagnostic) => (
    diagnostic.code === 'DUPLICATE_WORK_RECORD_ID' && diagnostic.severity === 'warning'
  )));
  const ambiguous = readWorkRecord(record.id, { roots: [dir], repoRoot });
  assert.equal(ambiguous.status, 'failed');
  assert.equal(ambiguous.code, 'WORK_RECORD_REF_AMBIGUOUS');
});

test('Work Record export returns a compact read-only bundle manifest without inlining heavy payloads', () => {
  const result = exportWorkRecordBundle(path.join(validRoot, 'workflow-origin.json'), { repoRoot });

  assert.equal(result.type, 'work_record.bundle_manifest');
  assert.equal(result.status, 'success');
  assert.equal(result.mode, 'read_only_manifest');
  assert.equal(result.inlines_heavy_payloads, false);
  assert.equal(result.mutates_record, false);
  assert.equal(result.record.id, 'work-record:workflow-open-wiki-sigil-2026-05-05');
  assert.equal(result.evidence.length, 3);
  assert.ok(result.evidence.every((item) => Object.hasOwn(item, 'size_bytes')));
  assert.ok(Array.isArray(result.missing_artifact_diagnostics));
});

test('aos work-record public command routes through help and external dispatch', () => {
  const help = runAos(['help', 'work-record', '--json']);
  assert.equal(help.status, 0, help.stderr);
  const helpJson = JSON.parse(help.stdout);
  assert.deepEqual(helpJson.path, ['work-record']);
  assert.ok(helpJson.forms.some((form) => form.id === 'work-record-status'));

  const list = runAos(['work-record', 'list', '--root', validRoot, '--json']);
  assert.equal(list.status, 0, list.stderr);
  const listJson = JSON.parse(list.stdout);
  assert.equal(listJson.status, 'success');
  assert.ok(listJson.records.some((record) => record.id === 'work-record:workflow-open-wiki-sigil-2026-05-05'));

  const status = runAos(['work-record', 'status', path.join(validRoot, 'workflow-origin.json'), '--json']);
  assert.equal(status.status, 0, status.stderr);
  const statusJson = JSON.parse(status.stdout);
  assert.equal(statusJson.verifier.profile_id, 'aos.verifier.work-record.v0.report-only');
  assert.equal(statusJson.verifier.mutates_record, false);
  assert.equal(statusJson.recovery.action, 'no_repair_needed');

  const readAdHoc = runAos(['work-record', 'read', 'work-record:aos-browser-click-status-2026-05-06', '--json']);
  assert.equal(readAdHoc.status, 0, readAdHoc.stderr);
  const readAdHocJson = JSON.parse(readAdHoc.stdout);
  assert.equal(readAdHocJson.record.origin.kind, 'ad_hoc');

  const readWorkflow = runAos([
    'work-record',
    'read',
    'work-record:workflow-browser-live-action-status-aos-browser-click-status-2026-05-06',
    '--json',
  ]);
  assert.equal(readWorkflow.status, 0, readWorkflow.stderr);
  const readWorkflowJson = JSON.parse(readWorkflow.stdout);
  assert.equal(readWorkflowJson.record.origin.kind, 'workflow');
});
