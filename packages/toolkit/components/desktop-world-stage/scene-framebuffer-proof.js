import { normalizeDesktopWorldFramebufferProofRequest } from '../../scene/desktop-world-framebuffer-proof.js'

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

function pixelCoordinate(value, size, invert = false) {
  const normalized = invert ? 1 - value : value
  return Math.min(size - 1, Math.max(0, Math.round(normalized * (size - 1))))
}

function matchesRange(pixel, sample) {
  return pixel.every((entry, index) => (
    entry >= sample.rgba_min[index] && entry <= sample.rgba_max[index]
  ))
}

export function proveDesktopWorldSceneFramebuffer({
  camera,
  now = () => performance.now(),
  renderer,
  request,
  scene,
} = {}) {
  const normalized = normalizeDesktopWorldFramebufferProofRequest(request)
  const context = renderer?.getContext?.()
  const width = renderer?.domElement?.width
  const height = renderer?.domElement?.height
  if (!context || typeof context.readPixels !== 'function'
      || !Number.isInteger(width) || width < 1
      || !Number.isInteger(height) || height < 1) {
    fail('SCENE_FRAMEBUFFER_PROOF_UNAVAILABLE', 'DesktopWorld framebuffer is unavailable.')
  }
  const startedAt = now()
  renderer.render(scene, camera)
  const pixel = new Uint8Array(4)
  let matchedCount = 0
  for (const sample of normalized.samples) {
    context.readPixels(
      pixelCoordinate(sample.uv[0], width),
      pixelCoordinate(sample.uv[1], height, true),
      1,
      1,
      context.RGBA,
      context.UNSIGNED_BYTE,
      pixel,
    )
    if (matchesRange(pixel, sample)) matchedCount += 1
  }
  const renderDurationMs = Math.max(0, now() - startedAt)
  return Object.freeze({
    status: 'ok',
    passed: matchedCount >= normalized.minimum_matches
      && matchedCount <= normalized.maximum_matches,
    sample_count: normalized.samples.length,
    matched_count: matchedCount,
    render_duration_ms: renderDurationMs,
    pixels_returned: false,
    pixels_persisted: false,
    error_code: null,
  })
}
