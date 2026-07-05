import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createOperatorAnnotationSurface,
  OPERATOR_ANNOTATION_SURFACE_STATES,
} from '../../packages/toolkit/runtime/operator-annotation-surface.js'

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

test('operator annotation surface starts from menu message and commits pending annotation input', async () => {
  const writes = []
  const surface = createOperatorAnnotationSurface({
    now: () => '2026-07-05T12:00:00Z',
    async createPendingAnnotation(input) {
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
    target_kind: 'region',
    target_summary: 'Header save button',
    fallback_evidence: [{
      kind: 'region',
      reason: 'saved_ref_unavailable',
      summary: 'Header save button',
      artifact_refs: [{ role: 'capture_image', path: '/tmp/capture.png' }],
    }],
    recommended_next: [{
      kind: 'refresh_saved_perception',
      reason: 'Capture before action.',
      argv: ['aos', 'see', 'capture', 'main', '--save', '--workspace', 'default', '--mode', 'som'],
    }],
  })
  assert.equal(started.status, 'selecting')

  surface.updateComment('Use this control')
  const committed = await surface.commit()
  assert.equal(committed.status, 'committed')
  assert.equal(committed.result.id, 'ann-surface')
  assert.equal(committed.result.path, '/tmp/aos-pending-annotations/ann-surface.json')
  assert.deepEqual(writes, [{
    source: 'operator_annotation_surface',
    comment: 'Use this control',
    target_kind: 'region',
    target_summary: 'Header save button',
    saved_ref: null,
    capability: undefined,
    fallback_evidence: [{
      kind: 'region',
      reason: 'saved_ref_unavailable',
      summary: 'Header save button',
      artifact_refs: [{ role: 'capture_image', path: '/tmp/capture.png' }],
    }],
    artifact_refs: [],
    recommended_next: [{
      kind: 'refresh_saved_perception',
      reason: 'Capture before action.',
      argv: ['aos', 'see', 'capture', 'main', '--save', '--workspace', 'default', '--mode', 'som'],
    }],
    source_capture: null,
  }])
})

test('operator annotation surface cancel and missing adapter fail closed', async () => {
  const cancelled = createOperatorAnnotationSurface({ now: () => '2026-07-05T12:00:00Z' })
  cancelled.start({ target_summary: 'Cancel target' })
  assert.equal(cancelled.cancel('changed_target').status, 'cancelled')
  assert.equal(cancelled.snapshot().result.reason, 'changed_target')

  const missing = createOperatorAnnotationSurface({ now: () => '2026-07-05T12:00:00Z' })
  missing.start({ target_summary: 'Missing adapter target' })
  const failed = await missing.commit()
  assert.equal(failed.status, 'failed')
  assert.equal(failed.error.code, 'OPERATOR_ANNOTATION_CREATE_MISSING')
})
