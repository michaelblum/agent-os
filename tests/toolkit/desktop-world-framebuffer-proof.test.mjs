import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import {
  createDesktopWorldFramebufferProofRateLimiter,
  proveDesktopWorldSceneFramebuffer,
} from '../../packages/toolkit/components/desktop-world-stage/scene-framebuffer-proof.js'
import {
  normalizeDesktopWorldFramebufferProofId,
  normalizeDesktopWorldFramebufferProofResult,
} from '../../packages/toolkit/scene/desktop-world-framebuffer-proof.js'

const repoRoot = path.resolve(import.meta.dirname, '../..')

function descriptor(overrides = {}) {
  return {
    id: 'capture-overlay-visible',
    matchingPixels: [4, 16],
    rgbaMax: [40, 255, 40, 255],
    rgbaMin: [0, 220, 0, 220],
    sampleSize: [4, 4],
    uvPermille: [500, 500],
    ...overrides,
  }
}

function fixture({ errors = [0, 0], lost = [false, false], write } = {}) {
  let readCount = 0
  let renderCount = 0
  const context = {
    NO_ERROR: 0,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    getError() { return errors.shift() ?? 0 },
    isContextLost() { return lost.shift() ?? false },
    readPixels(x, y, width, height, format, type, pixels) {
      readCount += 1
      write?.({ format, height, pixels, type, width, x, y })
    },
  }
  return {
    context,
    renderer: {
      domElement: { height: 80, width: 100 },
      getContext: () => context,
      render() { renderCount += 1 },
    },
    counts: () => ({ readCount, renderCount }),
  }
}

test('framebuffer proof IDs follow the canonical shared scene identifier corpus', async () => {
  const corpus = JSON.parse(await readFile(
    path.join(repoRoot, 'tests/fixtures/desktop-world-framebuffer-proof-identifiers.json'),
    'utf8',
  ))
  for (const value of corpus.valid) assert.equal(normalizeDesktopWorldFramebufferProofId(value), value)
  for (const value of corpus.invalid) {
    assert.throws(() => normalizeDesktopWorldFramebufferProofId(value), /proof ID is invalid/u)
  }
})

test('framebuffer proof performs one bounded region read and returns no pixels', () => {
  const input = fixture({
    write({ format, height, pixels, type, width, x, y }) {
      assert.deepEqual({ format, height, type, width, x, y }, {
        format: 0x1908,
        height: 4,
        type: 0x1401,
        width: 4,
        x: 48,
        y: 38,
      })
      pixels.fill(0)
      for (let offset = 0; offset < 4 * 4; offset += 4) {
        pixels.set([0, 255, 0, 255], offset)
      }
    },
  })
  const times = [10, 12]
  const result = proveDesktopWorldSceneFramebuffer({
    camera: {},
    descriptor: descriptor(),
    now: () => times.shift(),
    renderer: input.renderer,
    scene: {},
  })

  assert.deepEqual(result, {
    passed: true,
    pixels_persisted: false,
    pixels_returned: false,
    proof_id: 'capture-overlay-visible',
    readback_duration_ms: 2,
  })
  assert.deepEqual(input.counts(), { readCount: 1, renderCount: 1 })
  assert.equal(Object.values(result).some((value) => value instanceof Uint8Array), false)
})

test('framebuffer proof reports a normal mismatch without exposing match counts', () => {
  const input = fixture({ write({ pixels }) { pixels.fill(0) } })
  const result = proveDesktopWorldSceneFramebuffer({
    camera: {}, descriptor: descriptor(), now: () => 1, renderer: input.renderer, scene: {},
  })

  assert.equal(result.passed, false)
  assert.equal(Object.hasOwn(result, 'matching_pixels'), false)
  assert.deepEqual(input.counts(), { readCount: 1, renderCount: 1 })
})

test('framebuffer proof uses a fresh buffer and fails explicitly on context or WebGL errors', () => {
  const first = fixture({ write({ pixels }) { pixels.fill(0); pixels.set([0, 255, 0, 255], 0) } })
  const second = fixture()
  const onePixel = descriptor({ matchingPixels: [1, 1], sampleSize: [1, 1] })
  assert.equal(proveDesktopWorldSceneFramebuffer({
    camera: {}, descriptor: onePixel, now: () => 1, renderer: first.renderer, scene: {},
  }).passed, true)
  assert.equal(proveDesktopWorldSceneFramebuffer({
    camera: {}, descriptor: onePixel, now: () => 1, renderer: second.renderer, scene: {},
  }).passed, false)

  const lost = fixture({ lost: [true] })
  assert.throws(
    () => proveDesktopWorldSceneFramebuffer({ camera: {}, descriptor: onePixel, renderer: lost.renderer, scene: {} }),
    { code: 'SCENE_FRAMEBUFFER_READBACK_FAILED' },
  )
  assert.deepEqual(lost.counts(), { readCount: 0, renderCount: 0 })

  const webglError = fixture({ errors: [0, 0x0502] })
  assert.throws(
    () => proveDesktopWorldSceneFramebuffer({ camera: {}, descriptor: onePixel, renderer: webglError.renderer, scene: {} }),
    { code: 'SCENE_FRAMEBUFFER_READBACK_FAILED' },
  )
  assert.deepEqual(webglError.counts(), { readCount: 1, renderCount: 1 })
})

test('framebuffer proof throttling rejects before render or readback', () => {
  let at = 100
  const limiter = createDesktopWorldFramebufferProofRateLimiter({ now: () => at })
  const input = fixture({ write({ pixels }) { pixels.fill(0) } })
  const options = {
    admit: () => limiter.admit(),
    camera: {},
    descriptor: descriptor(),
    now: () => at,
    renderer: input.renderer,
    scene: {},
  }
  proveDesktopWorldSceneFramebuffer(options)
  proveDesktopWorldSceneFramebuffer(options)
  assert.throws(
    () => proveDesktopWorldSceneFramebuffer(options),
    { code: 'SCENE_FRAMEBUFFER_PROOF_RATE_LIMITED' },
  )
  assert.deepEqual(input.counts(), { readCount: 2, renderCount: 2 })

  at += 1000
  proveDesktopWorldSceneFramebuffer(options)
  assert.deepEqual(input.counts(), { readCount: 3, renderCount: 3 })
})

test('framebuffer proof result normalization is content-free and internally consistent', () => {
  const result = normalizeDesktopWorldFramebufferProofResult({
    contract: 'aos.desktop-world.framebuffer-proof.result.v1',
    extension_digest: 'a'.repeat(64),
    max_readback_duration_ms: 2.5,
    passed: false,
    passed_segment_count: 1,
    pixels_persisted: false,
    pixels_returned: false,
    proof_id: 'capture-overlay-visible',
    resource_revision: 4,
    segment_count: 2,
  })
  assert.equal(result.passed, false)
  assert.equal(Object.isFrozen(result), true)
  assert.throws(
    () => normalizeDesktopWorldFramebufferProofResult({ ...result, passed: true }),
    /pass state is inconsistent/u,
  )
  assert.throws(
    () => normalizeDesktopWorldFramebufferProofResult({ ...result, rgba: [0, 255, 0, 255] }),
    /unknown or missing fields/u,
  )
})
