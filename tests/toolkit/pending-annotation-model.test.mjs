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
  normalizeDesktopSelection,
} from '../../scripts/lib/pending-annotations-model.mjs';
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

test('pending annotation model does not import capture projection', async () => {
  const source = await fs.readFile(path.join(repoRoot, 'scripts/lib/pending-annotations-model.mjs'), 'utf8');
  assert(!source.includes('pending-annotations-projection.mjs'));
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

test('pending annotation records normalize bounded desktop selection evidence', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-desktop-selection-'));
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-desktop-selection-fixtures-'));
  const env = { AOS_STATE_ROOT: stateRoot, AOS_RUNTIME_MODE: 'repo' };
  const inputPath = await writeJSON(fixtureRoot, 'desktop-selection.json', {
    id: 'ann-desktop-selection',
    target_kind: 'region',
    target_summary: 'Selected desktop region',
    desktop_selection: {
      kind: 'desktop_annotation_selection',
      selection_id: 'sel-123e4567-e89b-12d3-a456-426614174000',
      mode: 'rectangle',
      geometry: {
        kind: 'rectangle',
        coordinate_space: 'desktop_points_top_left',
        x: 12,
        y: 34,
        width: 56,
        height: 78,
        ignored: true,
      },
      application: { pid: 42, name: 'Fixture', bundle_id: null, ignored: true },
      window: {
        window_id: 17,
        title: 'Window',
        bounds: { x: 0, y: 0, width: 800, height: 600, ignored: true },
        ignored: true,
      },
      ignored: true,
    },
  });
  const created = parseJSON(run(['create', '--from-json', inputPath, '--json'], env));
  const record = JSON.parse(await fs.readFile(created.annotation.path, 'utf8'));

  assert.deepEqual(record.desktop_selection, {
    kind: 'desktop_annotation_selection',
    selection_id: 'sel-123e4567-e89b-12d3-a456-426614174000',
    mode: 'rectangle',
    geometry: {
      kind: 'rectangle',
      coordinate_space: 'desktop_points_top_left',
      x: 12,
      y: 34,
      width: 56,
      height: 78,
    },
    application: { pid: 42, name: 'Fixture', bundle_id: null },
    window: {
      window_id: 17,
      title: 'Window',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    },
  });
  validateJSONFile(created.annotation.path);
  await validateAllPendingRecordFiles(env);
});

test('pending annotation records reject mismatched and oversized desktop selection evidence', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-invalid-desktop-selection-'));
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-pending-annotation-invalid-desktop-selection-fixtures-'));
  const env = { AOS_STATE_ROOT: stateRoot, AOS_RUNTIME_MODE: 'repo' };
  const base = {
    target_kind: 'region',
    target_summary: 'Invalid desktop selection',
    desktop_selection: {
      selection_id: 'sel-123e4567-e89b-12d3-a456-426614174000',
      mode: 'freehand',
      geometry: {
        kind: 'point',
        coordinate_space: 'desktop_points_top_left',
        x: 1,
        y: 2,
      },
      application: { pid: 42, name: null, bundle_id: null },
      window: null,
    },
  };
  const mismatchPath = await writeJSON(fixtureRoot, 'mismatch.json', base);
  assert.equal(parseError(run(['create', '--from-json', mismatchPath, '--json'], env)).code, 'INVALID_ARG');

  const oversizedPath = await writeJSON(fixtureRoot, 'oversized.json', {
    ...base,
    desktop_selection: {
      ...base.desktop_selection,
      geometry: {
        kind: 'freehand',
        coordinate_space: 'desktop_points_top_left',
        points: Array.from({ length: 257 }, (_, index) => ({ x: index, y: index })),
        bounds: { x: 0, y: 0, width: 256, height: 256 },
      },
    },
  });
  assert.equal(parseError(run(['create', '--from-json', oversizedPath, '--json'], env)).code, 'INVALID_ARG');
  await validateAllPendingRecordFiles(env);
});

test('pending annotation model normalizes bounded semantic target evidence', () => {
  const selection = normalizeDesktopSelection({
    kind: 'desktop_annotation_selection',
    selection_id: 'sel-123e4567-e89b-12d3-a456-426614174000',
    mode: 'target',
    geometry: {
      kind: 'element',
      coordinate_space: 'desktop_points_top_left',
      x: 12,
      y: 34,
      width: 56,
      height: 78,
      role: 'AXButton',
      title: 'Save',
      label: 'Save changes',
      ancestor_roles: ['AXApplication', 'AXWindow', 'AXGroup'],
    },
    application: { pid: 42, name: 'Fixture', bundle_id: null, ignored: true },
    window: null,
    ignored: true,
  });

  assert.deepEqual(selection, {
    kind: 'desktop_annotation_selection',
    selection_id: 'sel-123e4567-e89b-12d3-a456-426614174000',
    mode: 'target',
    geometry: {
      kind: 'element',
      coordinate_space: 'desktop_points_top_left',
      x: 12,
      y: 34,
      width: 56,
      height: 78,
      role: 'AXButton',
      title: 'Save',
      label: 'Save changes',
      ancestor_roles: ['AXApplication', 'AXWindow', 'AXGroup'],
    },
    application: { pid: 42, name: 'Fixture', bundle_id: null },
    window: null,
  });
});

test('pending annotation model rejects unsafe semantic target evidence', () => {
  const base = {
    selection_id: 'sel-123e4567-e89b-12d3-a456-426614174000',
    mode: 'target',
    geometry: {
      kind: 'element',
      coordinate_space: 'desktop_points_top_left',
      x: 12,
      y: 34,
      width: 56,
      height: 78,
      role: 'AXButton',
      title: null,
      label: null,
      ancestor_roles: ['AXApplication', 'AXWindow'],
    },
    application: { pid: 42, name: null, bundle_id: null },
    window: null,
  };

  for (const selection of [
    { ...base, geometry: { ...base.geometry, kind: 'rectangle' } },
    { ...base, geometry: { ...base.geometry, width: 0 } },
    { ...base, geometry: { ...base.geometry, x: Number.NaN } },
    {
      ...base,
      geometry: {
        ...base.geometry,
        ancestor_roles: Array.from({ length: 13 }, (_, index) => `AX${index}`),
      },
    },
    {
      ...base,
      geometry: {
        ...base.geometry,
        label: 'é'.repeat(257),
      },
    },
    {
      ...base,
      geometry: {
        ...base.geometry,
        undeclared: true,
      },
    },
  ]) {
    assert.throws(
      () => normalizeDesktopSelection(selection),
      (error) => error?.code === 'INVALID_ARG',
    );
  }
});
