import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  annotationCapabilityFromSavedRef,
} from '../../scripts/lib/agent-workspace/refs.mjs';
import {
  pendingAnnotationInputFromOperatorSelection,
} from '../../scripts/lib/pending-annotations-surface-adapter.mjs';
import {
  parseError,
  parseJSON,
  repoRoot,
  run,
  savedRefFixture,
  sourceCaptureRecordFixture,
  validateAllPendingRecordFiles,
  validateJSONFile,
  writeJSON,
} from '../lib/pending-annotation-fixtures.mjs';

test('agent workspace owns annotation capability projection for saved refs', () => {
  for (const [backend, resolutionClass, targetKind] of [
    ['browser', 'snapshot_scoped', 'browser'],
    ['aos_canvas', 'reacquirable', 'canvas'],
    ['native_ax', 'stable', 'native_ax'],
  ]) {
    assert.deepEqual(annotationCapabilityFromSavedRef(savedRefFixture({
      backend,
      resolutionClass,
    })), {
      status: 'saved_ref',
      target_kind: targetKind,
      reasons: [],
      saved_ref_available: true,
    });
  }

  for (const [backend, resolutionClass, targetKind] of [
    ['native_ax', 'snapshot_scoped', 'native_ax'],
    ['browser', 'stable', 'browser'],
    ['aos_canvas', 'stable', 'canvas'],
    ['browser', 'reacquirable', 'browser'],
    ['browser', 'volatile', 'browser'],
  ]) {
    assert.deepEqual(annotationCapabilityFromSavedRef(savedRefFixture({
      backend,
      resolutionClass,
    })), {
      status: 'fallback_only',
      target_kind: targetKind,
      reasons: [`saved_ref_not_actionable:${backend}:${resolutionClass}`],
      saved_ref_available: false,
    });
  }

  for (const resolutionClass of ['stable', 'snapshot_scoped', 'reacquirable']) {
    assert.deepEqual(annotationCapabilityFromSavedRef(savedRefFixture({
      backend: 'unknown',
      resolutionClass,
    })), {
      status: 'unsupported',
      target_kind: null,
      reasons: [`unsupported_saved_ref:unknown:${resolutionClass}`],
      saved_ref_available: false,
    });
  }
});

test('pending annotation adapter owns conversion from operator selection evidence', () => {
  assert.deepEqual(pendingAnnotationInputFromOperatorSelection({
    origin: 'operator_annotation_surface',
    comment: 'Use this',
    target: {
      kind: 'browser',
      summary: 'Save button',
      savedRef: {
        workspace_id: 'default',
        snapshot_id: 'snap1',
        ref: 'r1',
      },
    },
    readiness: { status: 'saved_ref', reasons: [] },
    evidence: {
      fallback: [],
      artifacts: [{ role: 'capture_summary', path: '/tmp/capture.json' }],
      next: [{ kind: 'inspect_saved_refs', argv: ['aos', 'see', 'refs'] }],
      sourceCapture: { kind: 'saved_capture', selected_ref: 'r1' },
    },
  }), {
    source: 'operator_annotation_surface',
    comment: 'Use this',
    target_kind: 'browser',
    target_summary: 'Save button',
    saved_ref: {
      workspace_id: 'default',
      snapshot_id: 'snap1',
      ref: 'r1',
    },
    capability: { status: 'saved_ref', reasons: [] },
    fallback_evidence: [],
    artifact_refs: [{ role: 'capture_summary', path: '/tmp/capture.json' }],
    recommended_next: [{ kind: 'inspect_saved_refs', argv: ['aos', 'see', 'refs'] }],
    source_capture: { kind: 'saved_capture', selected_ref: 'r1' },
  });
});

test('pending annotation projection does not own saved-ref actionability policy constants', async () => {
  // This protects an import-graph boundary: the saved-ref policy owner is the
  // agent workspace refs module, and projection intentionally only consumes it.
  const source = await fs.readFile(path.join(repoRoot, 'scripts/lib/pending-annotations-projection.mjs'), 'utf8');
  assert(!source.includes('SAVED_REF_BACKEND_TARGETS'));
  assert(!source.includes('ACTIONABLE_REF_CLASSES'));
  assert(!source.includes("aos.agent-workspace.v0';"));
});

test('pending annotation create rejects saved-ref capability without saved ref', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-capability-'));
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-capability-fixtures-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };

  const savedRefStatusPath = await writeJSON(fixtureRoot, 'saved-ref-status.json', {
    id: 'ann-claimed-saved-ref',
    target_kind: 'region',
    target_summary: 'Claimed saved ref target',
    capability: { status: 'saved_ref' },
  });
  const savedRefStatus = parseError(run(['create', '--from-json', savedRefStatusPath, '--json'], env));
  assert.equal(savedRefStatus.code, 'INVALID_ARG');

  const savedRefAvailablePath = await writeJSON(fixtureRoot, 'saved-ref-available.json', {
    id: 'ann-claimed-available',
    target_kind: 'region',
    target_summary: 'Claimed availability target',
    capability: { saved_ref_available: true },
  });
  const savedRefAvailable = parseError(run(['create', '--from-json', savedRefAvailablePath, '--json'], env));
  assert.equal(savedRefAvailable.code, 'INVALID_ARG');

  await validateAllPendingRecordFiles(env);
});

test('pending annotation source_capture is normalized to the public saved-capture shape', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-source-capture-'));
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-source-capture-fixtures-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };

  const invalidPath = await writeJSON(fixtureRoot, 'invalid-source-capture.json', {
    id: 'ann-invalid-source-capture',
    target_kind: 'region',
    target_summary: 'Invalid source capture target',
    source_capture: { kind: 'region' },
  });
  const invalid = parseError(run(['create', '--from-json', invalidPath, '--json'], env));
  assert.equal(invalid.code, 'INVALID_ARG');

  const acceptedPath = await writeJSON(fixtureRoot, 'accepted-source-capture.json', {
    id: 'ann-source-capture',
    target_kind: 'region',
    target_summary: 'Accepted source capture target',
    source_capture: {
      ...sourceCaptureRecordFixture(),
      ignored_private_field: 'drop me',
    },
  });
  const created = parseJSON(run(['create', '--from-json', acceptedPath, '--json'], env));
  const record = JSON.parse(await fs.readFile(created.annotation.path, 'utf8'));
  assert.deepEqual(record.source_capture, sourceCaptureRecordFixture());
  validateJSONFile(created.annotation.path);
  await validateAllPendingRecordFiles(env);
});

test('pending annotation selected target does not manufacture fallback evidence', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-no-fake-fallback-'));
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
  };

  const created = parseJSON(run([
    'create',
    '--id',
    'ann-selected-target',
    '--target-kind',
    'region',
    '--target-summary',
    'Explicit selected target',
    '--json',
  ], env));
  const read = parseJSON(run(['read', 'ann-selected-target', '--json'], env));
  assert.equal(created.annotation.fallback_count, 0);
  assert.deepEqual(read.annotation.fallback_evidence, []);
  assert.equal(read.annotation.capability.fallback_used, false);
  validateJSONFile(created.annotation.path);
});
