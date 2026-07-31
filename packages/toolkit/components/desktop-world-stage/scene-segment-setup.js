export function requireDesktopWorldSceneSegment(outlet, segment, topology) {
  if (outlet?.updateSegment?.(segment, topology) === true) return true
  const error = new Error('DesktopWorld scene segment configuration failed.')
  error.code = outlet?.snapshot?.().faultCode ?? 'SCENE_SEGMENT_CONFIGURATION_FAILED'
  throw error
}
