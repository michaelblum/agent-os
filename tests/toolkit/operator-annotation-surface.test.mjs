import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  createOperatorAnnotationSurface,
  OPERATOR_ANNOTATION_SURFACE_STATES,
} from '../../packages/toolkit/runtime/operator-annotation-surface.js'
import * as runtime from '../../packages/toolkit/runtime/index.js'
import {
  createPendingAnnotation,
  pendingAnnotationInputFromOperatorSelection,
} from '../../scripts/lib/pending-annotations.mjs'

test('operator annotation surface exposes the expected V0 states', () => {
  assert.deepEqual(OPERATOR_ANNOTATION_SURFACE_STATES, [
    'idle',
    'selecting',
    'committing',
    'committed',
    'cancelled',
    'failed',
  ])
})

test('toolkit runtime facade does not export pending annotation DTO helpers', () => {
  assert.equal(Object.hasOwn(runtime, 'pendingAnnotationInputFromOperatorSelection'), false)
})

test('operator annotation surface starts from menu message and commits generic selection evidence', async () => {
  const writes = []
  const surface = createOperatorAnnotationSurface({
    now: () => '2026-07-05T12:00:00Z',
    async createAnnotation(input) {
      writes.push(input)
      return {
        annotation: {
          id: 'ann-surface',
          path: '/tmp/aos-pending-annotations/ann-surface.json',
        },
      }
    },
  })

  const started = surface.handleMessage({
    type: 'aos.operator_annotation.start',
    targetKind: 'region',
    targetSummary: 'Header save button',
    evidence: {
      fallback: [{
        kind: 'region',
        reason: 'saved_ref_unavailable',
        summary: 'Header save button',
        artifact_refs: [{ role: 'capture_image', path: '/tmp/capture.png' }],
      }],
      next: [{
        kind: 'refresh_saved_perception',
        reason: 'Capture before action.',
        argv: ['aos', 'see', 'capture', 'main', '--save', '--workspace', 'default', '--mode', 'som'],
      }],
    },
  })
  assert.equal(started.status, 'selecting')

  surface.updateComment('Use this control')
  const committed = await surface.commit()
  assert.equal(committed.status, 'committed')
  assert.equal(committed.result.id, 'ann-surface')
  assert.equal(committed.result.path, '/tmp/aos-pending-annotations/ann-surface.json')
  assert.deepEqual(writes, [{
    origin: 'operator_annotation_surface',
    comment: 'Use this control',
    target: {
      kind: 'region',
      summary: 'Header save button',
      savedRef: null,
    },
    readiness: null,
    evidence: {
      fallback: [{
        kind: 'region',
        reason: 'saved_ref_unavailable',
        summary: 'Header save button',
        artifact_refs: [{ role: 'capture_image', path: '/tmp/capture.png' }],
      }],
      artifacts: [],
      next: [{
        kind: 'refresh_saved_perception',
        reason: 'Capture before action.',
        argv: ['aos', 'see', 'capture', 'main', '--save', '--workspace', 'default', '--mode', 'som'],
      }],
      sourceCapture: null,
    },
  }])
})

test('operator annotation surface cancel and missing adapter fail closed', async () => {
  const cancelled = createOperatorAnnotationSurface({ now: () => '2026-07-05T12:00:00Z' })
  cancelled.start({ targetSummary: 'Cancel target' })
  assert.equal(cancelled.cancel('changed_target').status, 'cancelled')
  assert.equal(cancelled.snapshot().result.reason, 'changed_target')

  const missing = createOperatorAnnotationSurface({ now: () => '2026-07-05T12:00:00Z' })
  missing.start({ targetSummary: 'Missing adapter target' })
  const failed = await missing.commit()
  assert.equal(failed.status, 'failed')
  assert.equal(failed.error.code, 'OPERATOR_ANNOTATION_CREATE_MISSING')
})

test('operator annotation surface can select without target but commit requires evidence', async () => {
  const writes = []
  const surface = createOperatorAnnotationSurface({
    now: () => '2026-07-05T12:00:00Z',
    async createAnnotation(input) {
      writes.push(input)
      return { id: 'should-not-write' }
    },
  })
  const started = surface.start()
  assert.equal(started.status, 'selecting')
  assert.equal(started.target, null)

  const failed = await surface.commit()
  assert.equal(failed.status, 'failed')
  assert.equal(failed.error.code, 'OPERATOR_ANNOTATION_TARGET_REQUIRED')
  assert.deepEqual(writes, [])
})

test('operator annotation surface commits explicit fallback, saved-ref, and preserves source-capture evidence', async () => {
  const writes = []
  const surface = createOperatorAnnotationSurface({
    now: () => '2026-07-05T12:00:00Z',
    async createAnnotation(input) {
      writes.push(input)
      return { id: `ann-${writes.length}` }
    },
  })

  surface.start()
  assert.equal((await surface.commit({
    evidence: {
      fallback: [{
        kind: 'region',
        reason: 'operator_explicit_fallback',
        summary: 'Fallback target',
        artifact_refs: [],
      }],
    },
  })).status, 'committed')

  surface.start()
  assert.equal((await surface.commit({
    targetKind: 'browser',
    targetSummary: 'Saved ref target',
    savedRef: {
      workspace_id: 'default',
      snapshot_id: 'snap1',
      ref: 'r1',
    },
  })).status, 'committed')

  surface.start()
  assert.equal((await surface.commit({
    targetKind: 'region',
    targetSummary: 'Capture target',
    evidence: {
      sourceCapture: {
        kind: 'region',
        summary: 'Capture target',
      },
    },
  })).status, 'committed')

  assert.equal(writes.length, 3)
  assert.equal(writes[0].target.kind, 'region')
  assert.equal(writes[0].target.summary, 'Fallback target')
  assert.deepEqual(writes[0].evidence.fallback, [{
    kind: 'region',
    reason: 'operator_explicit_fallback',
    summary: 'Fallback target',
    artifact_refs: [],
  }])
  assert.equal(writes[1].target.kind, 'browser')
  assert.deepEqual(writes[1].target.savedRef, {
    workspace_id: 'default',
    snapshot_id: 'snap1',
    ref: 'r1',
  })
  assert.equal(writes[2].target.kind, 'region')
  assert.equal(writes[2].target.summary, 'Capture target')
  assert.deepEqual(writes[2].evidence.sourceCapture, {
    kind: 'region',
    summary: 'Capture target',
  })
})

test('operator annotation commit reaches pending annotation adapter without source-capture target promotion', async () => {
  const sourceCapture = {
    kind: 'saved_capture',
    schema_version: 'aos.agent-workspace.v0',
    status: 'success',
    workspace_id: 'workspace',
    snapshot_id: 'snapshot',
    selected_ref: 'r1',
    capture_target: 'main',
    capture_mode: 'ax',
    ref_count: 1,
  }
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-operator-annotation-surface-'))
  const env = {
    AOS_STATE_ROOT: stateRoot,
    AOS_RUNTIME_MODE: 'repo',
    AOS_SESSION_ID: 'operator-annotation-surface-test',
  }
  const adapterCalls = []
  const createAnnotation = async (selection) => {
    const input = pendingAnnotationInputFromOperatorSelection(selection)
    adapterCalls.push(input)
    return createPendingAnnotation(input, env)
  }

  const sourceOnly = createOperatorAnnotationSurface({ createAnnotation })
  sourceOnly.start({
    evidence: {
      sourceCapture,
    },
  })
  const sourceOnlyResult = await sourceOnly.commit()
  assert.equal(sourceOnlyResult.status, 'failed')
  assert.equal(sourceOnlyResult.error.code, 'OPERATOR_ANNOTATION_TARGET_REQUIRED')
  assert.equal(adapterCalls.length, 0)

  const explicitTarget = createOperatorAnnotationSurface({ createAnnotation })
  explicitTarget.start({
    targetKind: 'browser',
    targetSummary: 'Main capture target',
    evidence: {
      sourceCapture,
    },
  })
  const explicitResult = await explicitTarget.commit({ comment: 'Use explicit target' })
  assert.equal(explicitResult.status, 'committed')
  const explicitRecord = JSON.parse(await fs.readFile(explicitResult.result.raw.annotation.path, 'utf8'))
  assert.equal(adapterCalls[0].target_kind, 'browser')
  assert.deepEqual(adapterCalls[0].source_capture, sourceCapture)
  assert.deepEqual(explicitRecord.source_capture, sourceCapture)

  const fallbackEvidence = {
    kind: 'region',
    reason: 'operator_explicit_fallback',
    summary: 'Fallback capture target',
    artifact_refs: [{ role: 'capture_summary', path: '/tmp/fallback-capture.json' }],
  }
  const explicitFallback = createOperatorAnnotationSurface({ createAnnotation })
  explicitFallback.start({
    evidence: {
      fallback: [fallbackEvidence],
      sourceCapture,
    },
  })
  const fallbackResult = await explicitFallback.commit({ comment: 'Use fallback target' })
  assert.equal(fallbackResult.status, 'committed')
  const fallbackRecord = JSON.parse(await fs.readFile(fallbackResult.result.raw.annotation.path, 'utf8'))
  assert.equal(adapterCalls[1].target_kind, 'region')
  assert.deepEqual(adapterCalls[1].fallback_evidence, [fallbackEvidence])
  assert.deepEqual(adapterCalls[1].source_capture, sourceCapture)
  assert.deepEqual(fallbackRecord.fallback_evidence, [fallbackEvidence])
  assert.deepEqual(fallbackRecord.source_capture, sourceCapture)
})
