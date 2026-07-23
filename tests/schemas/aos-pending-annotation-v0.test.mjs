import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parseJSON,
  rejectJSONFile,
  run,
  validateJSONFile,
} from '../lib/pending-annotation-fixtures.mjs';

test('pending annotation schema accepts persisted records with required nullable source_capture', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-schema-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const created = parseJSON(run([
    'create',
    '--id',
    'ann-schema-null-source-capture',
    '--target-kind',
    'region',
    '--target-summary',
    'Schema fixture target',
    '--json',
  ], env));
  const record = JSON.parse(await fs.readFile(created.annotation.path, 'utf8'));
  assert(Object.hasOwn(record, 'source_capture'));
  assert.equal(record.source_capture, null);
  validateJSONFile(created.annotation.path);
  delete record.source_capture;
  const invalidRecordPath = path.join(stateRoot, 'missing-source-capture.json');
  await fs.writeFile(invalidRecordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  rejectJSONFile(invalidRecordPath);
});

test('pending annotation schema rejects terminal lifecycle records without transition evidence', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-terminal-schema-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };
  const created = parseJSON(run([
    'create',
    '--id',
    'ann-schema-terminal',
    '--target-kind',
    'region',
    '--target-summary',
    'Terminal schema fixture',
    '--json',
  ], env));
  const record = JSON.parse(await fs.readFile(created.annotation.path, 'utf8'));

  const consumedWithoutEvidence = {
    ...record,
    lifecycle: {
      ...record.lifecycle,
      state: 'consumed',
      consumed_at: null,
      consumed_by: null,
    },
  };
  const consumedPath = path.join(stateRoot, 'consumed-without-evidence.json');
  await fs.writeFile(consumedPath, `${JSON.stringify(consumedWithoutEvidence, null, 2)}\n`, 'utf8');
  rejectJSONFile(consumedPath);

  const deletedWithoutEvidence = {
    ...record,
    lifecycle: {
      ...record.lifecycle,
      state: 'deleted',
      deleted_at: null,
    },
  };
  const deletedPath = path.join(stateRoot, 'deleted-without-evidence.json');
  await fs.writeFile(deletedPath, `${JSON.stringify(deletedWithoutEvidence, null, 2)}\n`, 'utf8');
  rejectJSONFile(deletedPath);
});

test('pending annotation schema enforces desktop selection identity and mode geometry', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-desktop-schema-'));
  const env = { AOS_STATE_ROOT: stateRoot, AOS_RUNTIME_MODE: 'repo' };
  const inputPath = path.join(stateRoot, 'input.json');
  await fs.writeFile(inputPath, `${JSON.stringify({
    id: 'ann-desktop-schema',
    target_kind: 'region',
    target_summary: 'Desktop schema fixture',
    desktop_selection: {
      selection_id: 'sel-123e4567-e89b-12d3-a456-426614174000',
      mode: 'rectangle',
      geometry: {
        kind: 'rectangle',
        coordinate_space: 'desktop_points_top_left',
        x: 1,
        y: 2,
        width: 3,
        height: 4,
      },
      application: { pid: 42, name: null, bundle_id: null },
      window: null,
    },
  }, null, 2)}\n`, 'utf8');
  const created = parseJSON(run(['create', '--from-json', inputPath, '--json'], env));
  const record = JSON.parse(await fs.readFile(created.annotation.path, 'utf8'));
  validateJSONFile(created.annotation.path);

  record.desktop_selection.mode = 'freehand';
  const mismatchPath = path.join(stateRoot, 'mismatched-desktop-selection.json');
  await fs.writeFile(mismatchPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  rejectJSONFile(mismatchPath);

  record.desktop_selection.mode = 'rectangle';
  record.desktop_selection.selection_id = 'sel-not-a-uuid';
  const invalidIDPath = path.join(stateRoot, 'invalid-desktop-selection-id.json');
  await fs.writeFile(invalidIDPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  rejectJSONFile(invalidIDPath);
});

test('pending annotation schema accepts strict semantic target evidence', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-target-schema-'));
  const env = { AOS_STATE_ROOT: stateRoot, AOS_RUNTIME_MODE: 'repo' };
  const inputPath = path.join(stateRoot, 'target-input.json');
  await fs.writeFile(inputPath, `${JSON.stringify({
    id: 'ann-target-schema',
    target_kind: 'native_ax',
    target_summary: 'Save changes',
    capability: {
      status: 'fallback_only',
      reasons: ['native_ax_selection_without_saved_ref'],
    },
    fallback_evidence: [{
      kind: 'native_ax',
      reason: 'saved_ref_unavailable',
      summary: 'Save changes',
    }],
    desktop_selection: {
      selection_id: 'sel-123e4567-e89b-12d3-a456-426614174000',
      mode: 'target',
      geometry: {
        kind: 'element',
        coordinate_space: 'desktop_points_top_left',
        x: 10,
        y: 20,
        width: 120,
        height: 36,
        role: 'AXButton',
        title: null,
        label: 'Save changes',
        ancestor_roles: ['AXApplication', 'AXWindow'],
      },
      application: { pid: 42, name: 'Fixture App', bundle_id: 'io.example.fixture' },
      window: null,
    },
  }, null, 2)}\n`, 'utf8');
  const created = parseJSON(run(['create', '--from-json', inputPath, '--json'], env));
  const record = JSON.parse(await fs.readFile(created.annotation.path, 'utf8'));
  validateJSONFile(created.annotation.path);
  assert.equal(record.target.kind, 'native_ax');
  assert.equal(record.comment.text, null);
  assert.equal(record.desktop_selection.geometry.label, 'Save changes');

  const leaked = structuredClone(record);
  leaked.desktop_selection.geometry.path = '/private/target';
  const leakedPath = path.join(stateRoot, 'target-extra-field.json');
  await fs.writeFile(leakedPath, `${JSON.stringify(leaked, null, 2)}\n`, 'utf8');
  rejectJSONFile(leakedPath);

  const mismatched = structuredClone(record);
  mismatched.desktop_selection.mode = 'rectangle';
  const mismatchPath = path.join(stateRoot, 'target-mode-mismatch.json');
  await fs.writeFile(mismatchPath, `${JSON.stringify(mismatched, null, 2)}\n`, 'utf8');
  rejectJSONFile(mismatchPath);

  const excessiveAncestors = structuredClone(record);
  excessiveAncestors.desktop_selection.geometry.ancestor_roles = Array.from(
    { length: 12 },
    (_, index) => `AX${index}`,
  );
  const excessiveAncestorsPath = path.join(stateRoot, 'target-excessive-ancestors.json');
  await fs.writeFile(excessiveAncestorsPath, `${JSON.stringify(excessiveAncestors, null, 2)}\n`, 'utf8');
  rejectJSONFile(excessiveAncestorsPath);
});
