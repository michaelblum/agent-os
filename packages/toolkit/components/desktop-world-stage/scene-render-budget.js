const MAX_DISPLAY_SEGMENTS = 16
const MAX_NATIVE_DEVICE_PIXEL_RATIO = 4
const COLOR_BYTES_PER_PIXEL = 4
const DEPTH_STENCIL_BYTES_PER_PIXEL = 4
const FALLBACK_MAX_RENDERBUFFER_SIZE = 16_384

function positiveFinite(value, fallback = null) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function bounds(value) {
  if (!Array.isArray(value) || value.length < 4) return null
  const result = value.slice(0, 4).map(Number)
  return result.every(Number.isFinite) && result[2] > 0 && result[3] > 0 ? result : null
}

function scaleFactor(segment, fallback = 1) {
  const value = positiveFinite(segment?.scale_factor ?? segment?.scaleFactor, fallback)
  return value !== null && value <= MAX_NATIVE_DEVICE_PIXEL_RATIO ? value : null
}

function segmentBackingMetrics(segment, fallbackScale = 1) {
  const frame = bounds(segment?.dw_bounds ?? segment?.dwBounds)
  if (!frame) return null
  const nativeScale = scaleFactor(segment, fallbackScale)
  if (nativeScale === null) return null
  const backingWidth = Math.max(1, Math.round(frame[2] * nativeScale))
  const backingHeight = Math.max(1, Math.round(frame[3] * nativeScale))
  return Object.freeze({
    backingHeight,
    backingPixels: backingWidth * backingHeight,
    backingWidth,
    displayId: segment?.display_id ?? segment?.displayId ?? segment?.displayID ?? null,
    nativeScale,
  })
}

function contextInteger(context, key, fallback) {
  try {
    const value = Number(context?.getParameter?.(context?.[key]))
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
  } catch {
    return fallback
  }
}

function contextDimensions(context) {
  try {
    const value = context?.getParameter?.(context?.MAX_VIEWPORT_DIMS)
    if (value && value.length >= 2) {
      const width = positiveFinite(value[0])
      const height = positiveFinite(value[1])
      if (width !== null && height !== null) return [Math.floor(width), Math.floor(height)]
    }
  } catch {}
  return [FALLBACK_MAX_RENDERBUFFER_SIZE, FALLBACK_MAX_RENDERBUFFER_SIZE]
}

function estimatedBackingBytes(backingPixels, msaaSamples) {
  const resolvedBytes = backingPixels * (COLOR_BYTES_PER_PIXEL + DEPTH_STENCIL_BYTES_PER_PIXEL)
  const multisampleBytes = msaaSamples > 1
    ? backingPixels * msaaSamples * (COLOR_BYTES_PER_PIXEL + DEPTH_STENCIL_BYTES_PER_PIXEL)
    : 0
  return resolvedBytes + multisampleBytes
}

export function resolveDesktopWorldNativeRenderMetrics({
  context = null,
  devicePixelRatio = 1,
  height,
  segment = null,
  topology = [],
  width,
} = {}) {
  const cssWidth = positiveFinite(width)
  const cssHeight = positiveFinite(height)
  if (cssWidth === null || cssHeight === null) return null

  const requestedDevicePixelRatio = scaleFactor(segment, positiveFinite(devicePixelRatio, 1))
  if (requestedDevicePixelRatio === null) return null
  const backingWidth = Math.max(1, Math.round(cssWidth * requestedDevicePixelRatio))
  const backingHeight = Math.max(1, Math.round(cssHeight * requestedDevicePixelRatio))
  const maxRenderbufferSize = contextInteger(
    context,
    'MAX_RENDERBUFFER_SIZE',
    FALLBACK_MAX_RENDERBUFFER_SIZE,
  )
  const maxViewportDimensions = contextDimensions(context)
  if (
    backingWidth > maxRenderbufferSize
    || backingHeight > maxRenderbufferSize
    || backingWidth > maxViewportDimensions[0]
    || backingHeight > maxViewportDimensions[1]
  ) return null

  if (Array.isArray(topology) && topology.length > MAX_DISPLAY_SEGMENTS) return null
  const segments = Array.isArray(topology) && topology.length > 0
    ? topology
    : [{ dw_bounds: [0, 0, cssWidth, cssHeight], scale_factor: requestedDevicePixelRatio }]
  const displayMetrics = segments.map((entry) => (
    segmentBackingMetrics(entry, requestedDevicePixelRatio)
  ))
  if (displayMetrics.some((entry) => entry === null)) return null
  const topologyBackingPixels = displayMetrics.reduce((total, entry) => total + entry.backingPixels, 0)
  const backingPixels = backingWidth * backingHeight
  const msaaSamples = contextInteger(context, 'SAMPLES', 0)

  return Object.freeze({
    backingHeight,
    backingPixels,
    backingWidth,
    constrained: false,
    cssHeight,
    cssWidth,
    displayMetrics: Object.freeze(displayMetrics),
    effectiveDevicePixelRatio: requestedDevicePixelRatio,
    estimatedBackingBytes: estimatedBackingBytes(backingPixels, msaaSamples),
    estimatedTopologyBackingBytes: estimatedBackingBytes(topologyBackingPixels, msaaSamples),
    maxRenderbufferSize,
    maxViewportDimensions: Object.freeze(maxViewportDimensions),
    msaaSamples,
    requestedDevicePixelRatio,
    topologyBackingPixels,
  })
}

export const DESKTOP_WORLD_NATIVE_RENDER_LIMITS = Object.freeze({
  maxDisplaySegments: MAX_DISPLAY_SEGMENTS,
  maxNativeDevicePixelRatio: MAX_NATIVE_DEVICE_PIXEL_RATIO,
})
