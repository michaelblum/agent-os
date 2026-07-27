import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  DESKTOP_WORLD_FRAMEBUFFER_PROOF_REQUEST_CONTRACT_ID,
  DESKTOP_WORLD_FRAMEBUFFER_PROOF_RESULT_CONTRACT_ID,
  normalizeDesktopWorldFramebufferProofRequest,
  normalizeDesktopWorldFramebufferProofResult,
} from '../../packages/toolkit/scene/desktop-world-framebuffer-proof.js'
import { proveDesktopWorldSceneFramebuffer } from '../../packages/toolkit/components/desktop-world-stage/scene-framebuffer-proof.js'

const request = Object.freeze({
  contract: DESKTOP_WORLD_FRAMEBUFFER_PROOF_REQUEST_CONTRACT_ID,
  minimum_matches: 1,
  maximum_matches: 1,
  samples: Object.freeze([
    Object.freeze({
      uv: Object.freeze([0.25, 0.75]),
      rgba_min: Object.freeze([0, 220, 0, 220]),
      rgba_max: Object.freeze([80, 255, 80, 255]),
    }),
    Object.freeze({
      uv: Object.freeze([0.75, 0.25]),
      rgba_min: Object.freeze([0, 220, 0, 220]),
      rgba_max: Object.freeze([80, 255, 80, 255]),
    }),
  ]),
})

test('framebuffer proof normalizes bounded assertions and rejects pixel-bearing results', () => {
  assert.deepEqual(normalizeDesktopWorldFramebufferProofRequest(request), request)
  assert.throws(
    () => normalizeDesktopWorldFramebufferProofRequest({ ...request, samples: Array(9).fill(request.samples[0]) }),
    { code: 'SCENE_FRAMEBUFFER_PROOF_LIMIT_EXCEEDED' },
  )
  const result = {
    contract: DESKTOP_WORLD_FRAMEBUFFER_PROOF_RESULT_CONTRACT_ID,
    status: 'ok',
    passed: true,
    segment_count: 1,
    sample_count: 2,
    matched_count: 1,
    max_render_duration_ms: 2,
    segments: [{
      segment_index: 0,
      sample_count: 2,
      matched_count: 1,
      passed: true,
      render_duration_ms: 2,
      error_code: null,
    }],
    pixels_returned: false,
    pixels_persisted: false,
    error_code: null,
  }
  assert.deepEqual(normalizeDesktopWorldFramebufferProofResult(result), result)
  assert.throws(
    () => normalizeDesktopWorldFramebufferProofResult({ ...result, rgba: [0, 255, 0, 255] }),
    { code: 'INVALID_SCENE_FRAMEBUFFER_PROOF_RESULT' },
  )
})

test('framebuffer proof renders once, inverts WebGL y, and returns no pixel values', () => {
  const reads = []
  let renders = 0
  const context = {
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    readPixels(x, y, width, height, format, type, output) {
      reads.push({ x, y, width, height, format, type })
      output.set(reads.length === 1 ? [20, 240, 20, 255] : [0, 0, 0, 0])
    },
  }
  const times = [10, 12]
  const result = proveDesktopWorldSceneFramebuffer({
    camera: {},
    now: () => times.shift(),
    renderer: {
      domElement: { width: 100, height: 80 },
      getContext: () => context,
      render: () => { renders += 1 },
    },
    request,
    scene: {},
  })
  assert.equal(renders, 1)
  assert.deepEqual(reads.map(({ x, y }) => [x, y]), [[25, 20], [74, 59]])
  assert.deepEqual(result, {
    status: 'ok',
    passed: true,
    sample_count: 2,
    matched_count: 1,
    render_duration_ms: 2,
    pixels_returned: false,
    pixels_persisted: false,
    error_code: null,
  })
  assert.equal(JSON.stringify(result).includes('rgba'), false)
})

test('framebuffer proof path has no capture, encoding, file, or persistent-render primitives', async () => {
  const sources = await Promise.all([
    'packages/toolkit/scene/desktop-world-framebuffer-proof.js',
    'packages/toolkit/components/desktop-world-stage/scene-framebuffer-proof.js',
  ].map((path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')))
  for (const source of sources) {
    assert.doesNotMatch(source, /ScreenCaptureKit|toDataURL|preserveDrawingBuffer|createRenderTarget|writeFile|setInterval/u)
  }
})
