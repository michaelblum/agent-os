import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createOperatorAnnotationSurface,
  OPERATOR_ANNOTATION_SURFACE_STATES,
} from '../../packages/toolkit/runtime/operator-annotation-surface.js'
import * as runtime from '../../packages/toolkit/runtime/index.js'

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

test('operator annotation surface commits explicit fallback, saved-ref, and source-capture evidence', async () => {
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
  assert.deepEqual(writes[2].evidence.sourceCapture, {
    kind: 'region',
    summary: 'Capture target',
  })
})
