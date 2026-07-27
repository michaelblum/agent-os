function proofError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function coordinate(permille, size, invert = false) {
  const normalized = (invert ? 1000 - permille : permille) / 1000
  return Math.min(size - 1, Math.max(0, Math.round(normalized * (size - 1))))
}

function regionOrigin(permille, extent, sampleSize, invert = false) {
  const center = coordinate(permille, extent, invert)
  return Math.min(extent - sampleSize, Math.max(0, center - Math.floor(sampleSize / 2)))
}

function matchingPixelCount(pixels, descriptor) {
  let matching = 0
  for (let offset = 0; offset < pixels.length; offset += 4) {
    let match = true
    for (let component = 0; component < 4; component += 1) {
      const value = pixels[offset + component]
      if (value < descriptor.rgbaMin[component] || value > descriptor.rgbaMax[component]) {
        match = false
        break
      }
    }
    if (match) matching += 1
  }
  return matching
}

export function createDesktopWorldFramebufferProofRateLimiter({
  limit = 2,
  now = () => performance.now(),
  windowMs = 1000,
} = {}) {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs <= 0
      || typeof now !== 'function') {
    throw new TypeError('DesktopWorld framebuffer proof rate limit is invalid.')
  }
  let windowStartedAt = Number.NEGATIVE_INFINITY
  let count = 0
  return Object.freeze({
    admit() {
      const at = now()
      if (!Number.isFinite(at)) return false
      if (at - windowStartedAt >= windowMs) {
        windowStartedAt = at
        count = 0
      }
      count += 1
      return count <= limit
    },
  })
}

export function proveDesktopWorldSceneFramebuffer({
  admit = () => true,
  camera,
  descriptor,
  now = () => performance.now(),
  renderer,
  scene,
} = {}) {
  if (typeof admit !== 'function' || !admit()) {
    throw proofError(
      'SCENE_FRAMEBUFFER_PROOF_RATE_LIMITED',
      'DesktopWorld framebuffer proof rate limit was exceeded.',
    )
  }
  const context = renderer?.getContext?.()
  const width = renderer?.domElement?.width
  const height = renderer?.domElement?.height
  if (!context || typeof context.readPixels !== 'function'
      || typeof context.getError !== 'function'
      || typeof context.isContextLost !== 'function'
      || !Number.isInteger(width) || width < 1
      || !Number.isInteger(height) || height < 1
      || !descriptor
      || width < descriptor.sampleSize?.[0]
      || height < descriptor.sampleSize?.[1]) {
    throw proofError(
      'SCENE_FRAMEBUFFER_PROOF_UNAVAILABLE',
      'DesktopWorld framebuffer proof is unavailable.',
    )
  }
  if (context.isContextLost() || context.getError() !== context.NO_ERROR) {
    throw proofError(
      'SCENE_FRAMEBUFFER_READBACK_FAILED',
      'DesktopWorld framebuffer is not readable.',
    )
  }

  const startedAt = now()
  renderer.render(scene, camera)
  const [sampleWidth, sampleHeight] = descriptor.sampleSize
  const pixels = new Uint8Array(sampleWidth * sampleHeight * 4)
  pixels.fill(0xa5)
  context.readPixels(
    regionOrigin(descriptor.uvPermille[0], width, sampleWidth),
    regionOrigin(descriptor.uvPermille[1], height, sampleHeight, true),
    sampleWidth,
    sampleHeight,
    context.RGBA,
    context.UNSIGNED_BYTE,
    pixels,
  )
  if (context.isContextLost() || context.getError() !== context.NO_ERROR) {
    throw proofError(
      'SCENE_FRAMEBUFFER_READBACK_FAILED',
      'DesktopWorld framebuffer readback failed.',
    )
  }
  const matching = matchingPixelCount(pixels, descriptor)
  const passed = matching >= descriptor.matchingPixels[0]
    && matching <= descriptor.matchingPixels[1]
  return Object.freeze({
    passed,
    pixels_persisted: false,
    pixels_returned: false,
    proof_id: descriptor.id,
    readback_duration_ms: Math.max(0, now() - startedAt),
  })
}
