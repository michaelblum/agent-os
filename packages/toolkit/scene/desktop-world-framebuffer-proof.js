export const DESKTOP_WORLD_FRAMEBUFFER_PROOF_REQUEST_CONTRACT_ID =
  'aos.desktop-world.framebuffer-proof.request.v1'
export const DESKTOP_WORLD_FRAMEBUFFER_PROOF_RESULT_CONTRACT_ID =
  'aos.desktop-world.framebuffer-proof.result.v1'

export const DESKTOP_WORLD_FRAMEBUFFER_PROOF_LIMITS = Object.freeze({
  maxSamples: 8,
  maxSegments: 16,
})

function fail(code, message) {
  const error = new TypeError(message)
  error.code = code
  throw error
}

function exactKeys(value, expected, label, code = 'INVALID_SCENE_FRAMEBUFFER_PROOF') {
  const keys = Object.keys(value).sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail(code, `${label} contains unknown or missing fields.`)
  }
}

function byteVector(value, label) {
  if (!Array.isArray(value) || value.length !== 4
      || value.some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 255)) {
    fail('INVALID_SCENE_FRAMEBUFFER_PROOF', `${label} must contain four byte values.`)
  }
  return Object.freeze([...value])
}

function normalizedUv(value) {
  if (!Array.isArray(value) || value.length !== 2
      || value.some((entry) => !Number.isFinite(entry) || entry < 0 || entry > 1)) {
    fail('INVALID_SCENE_FRAMEBUFFER_PROOF', 'Framebuffer proof uv must contain two normalized values.')
  }
  return Object.freeze([...value])
}

export function normalizeDesktopWorldFramebufferProofRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('INVALID_SCENE_FRAMEBUFFER_PROOF', 'Framebuffer proof request must be an object.')
  }
  exactKeys(input, ['contract', 'maximum_matches', 'minimum_matches', 'samples'], 'Framebuffer proof request')
  if (input.contract !== DESKTOP_WORLD_FRAMEBUFFER_PROOF_REQUEST_CONTRACT_ID) {
    fail('INVALID_SCENE_FRAMEBUFFER_PROOF', 'Framebuffer proof request contract is invalid.')
  }
  if (!Array.isArray(input.samples) || input.samples.length < 1
      || input.samples.length > DESKTOP_WORLD_FRAMEBUFFER_PROOF_LIMITS.maxSamples) {
    fail('SCENE_FRAMEBUFFER_PROOF_LIMIT_EXCEEDED', 'Framebuffer proof sample count is out of bounds.')
  }
  if (!Number.isInteger(input.minimum_matches) || input.minimum_matches < 0
      || input.minimum_matches > input.samples.length
      || !Number.isInteger(input.maximum_matches)
      || input.maximum_matches < input.minimum_matches
      || input.maximum_matches > input.samples.length) {
    fail('INVALID_SCENE_FRAMEBUFFER_PROOF', 'Framebuffer proof match bounds are invalid.')
  }
  const samples = input.samples.map((sample) => {
    if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
      fail('INVALID_SCENE_FRAMEBUFFER_PROOF', 'Framebuffer proof sample must be an object.')
    }
    exactKeys(sample, ['rgba_max', 'rgba_min', 'uv'], 'Framebuffer proof sample')
    const rgbaMin = byteVector(sample.rgba_min, 'rgba_min')
    const rgbaMax = byteVector(sample.rgba_max, 'rgba_max')
    if (rgbaMin.some((entry, index) => entry > rgbaMax[index])) {
      fail('INVALID_SCENE_FRAMEBUFFER_PROOF', 'Framebuffer proof color range is inverted.')
    }
    return Object.freeze({
      uv: normalizedUv(sample.uv),
      rgba_min: rgbaMin,
      rgba_max: rgbaMax,
    })
  })
  return Object.freeze({
    contract: DESKTOP_WORLD_FRAMEBUFFER_PROOF_REQUEST_CONTRACT_ID,
    minimum_matches: input.minimum_matches,
    maximum_matches: input.maximum_matches,
    samples: Object.freeze(samples),
  })
}

export function normalizeDesktopWorldFramebufferProofResult(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('INVALID_SCENE_FRAMEBUFFER_PROOF_RESULT', 'Framebuffer proof result must be an object.')
  }
  exactKeys(input, [
    'contract', 'error_code', 'matched_count', 'max_render_duration_ms',
    'passed', 'pixels_persisted', 'pixels_returned', 'sample_count',
    'segment_count', 'segments', 'status',
  ], 'Framebuffer proof result', 'INVALID_SCENE_FRAMEBUFFER_PROOF_RESULT')
  if (input.contract !== DESKTOP_WORLD_FRAMEBUFFER_PROOF_RESULT_CONTRACT_ID
      || input.status !== 'ok'
      || typeof input.passed !== 'boolean'
      || input.pixels_returned !== false
      || input.pixels_persisted !== false
      || input.error_code !== null
      || !Number.isInteger(input.segment_count)
      || input.segment_count < 1
      || input.segment_count > DESKTOP_WORLD_FRAMEBUFFER_PROOF_LIMITS.maxSegments
      || !Number.isInteger(input.sample_count)
      || input.sample_count < input.segment_count
      || !Number.isInteger(input.matched_count)
      || input.matched_count < 0
      || input.matched_count > input.sample_count
      || !Number.isFinite(input.max_render_duration_ms)
      || input.max_render_duration_ms < 0
      || !Array.isArray(input.segments)
      || input.segments.length !== input.segment_count) {
    fail('INVALID_SCENE_FRAMEBUFFER_PROOF_RESULT', 'Framebuffer proof result is invalid.')
  }
  const segments = input.segments.map((segment, index) => {
    if (!segment || typeof segment !== 'object' || Array.isArray(segment)) {
      fail('INVALID_SCENE_FRAMEBUFFER_PROOF_RESULT', 'Framebuffer proof segment is invalid.')
    }
    exactKeys(segment, [
      'error_code', 'matched_count', 'passed', 'render_duration_ms',
      'sample_count', 'segment_index',
    ], 'Framebuffer proof segment', 'INVALID_SCENE_FRAMEBUFFER_PROOF_RESULT')
    if (segment.segment_index !== index
        || !Number.isInteger(segment.sample_count)
        || segment.sample_count < 1
        || !Number.isInteger(segment.matched_count)
        || segment.matched_count < 0
        || segment.matched_count > segment.sample_count
        || typeof segment.passed !== 'boolean'
        || !Number.isFinite(segment.render_duration_ms)
        || segment.render_duration_ms < 0
        || segment.error_code !== null) {
      fail('INVALID_SCENE_FRAMEBUFFER_PROOF_RESULT', 'Framebuffer proof segment fields are invalid.')
    }
    return Object.freeze({ ...segment })
  })
  if (segments.reduce((total, segment) => total + segment.sample_count, 0) !== input.sample_count
      || segments.reduce((total, segment) => total + segment.matched_count, 0) !== input.matched_count
      || segments.every((segment) => segment.passed) !== input.passed) {
    fail('INVALID_SCENE_FRAMEBUFFER_PROOF_RESULT', 'Framebuffer proof aggregate does not match its segments.')
  }
  return Object.freeze({ ...input, segments: Object.freeze(segments) })
}
