import { resolveSceneAffordanceCursorPresentation } from '../../scene/index.js'
import { normalizeCanvasInputMessage } from '../../runtime/input-events.js'

export function sceneCursorRegionMetadata(descriptor) {
  const hover = resolveSceneAffordanceCursorPresentation(descriptor, 'hover')
  const captured = resolveSceneAffordanceCursorPresentation(descriptor, 'captured')
  return Object.freeze({
    ...(hover.system === 'hidden' ? { cursor_hover_system: 'hidden' } : {}),
    ...(hover.visual ? { cursor_hover_visual: 'true' } : {}),
    ...(captured.system === 'hidden' ? { cursor_captured_system: 'hidden' } : {}),
    ...(captured.visual ? { cursor_captured_visual: 'true' } : {}),
  })
}

export function normalizeSceneCursorPresentationMessage(message) {
  if (message?.type !== 'input_region.cursor') return null
  const cursor = message.cursor_presentation
  if (!cursor || cursor.cursor_schema_version !== 1) return null
  if (!['enter', 'leave', 'move'].includes(cursor.phase)) return null
  if (!['captured', 'hover'].includes(cursor.mode)) return null
  if (typeof cursor.region_id !== 'string' || cursor.region_id.length < 1) return null
  const point = cursor.desktop_world
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
  return Object.freeze({
    mode: cursor.mode,
    phase: cursor.phase,
    point: Object.freeze({ x: point.x, y: point.y }),
    regionId: cursor.region_id,
  })
}

export function dispatchSceneCursorPresentation({
  cursor,
  inputAdmissionClosed,
  stageSuspended,
  runtimeDisposed,
  retiredRegions,
  leases,
  entryBlocked,
  outlet,
  now,
}) {
  if (inputAdmissionClosed || stageSuspended || runtimeDisposed) return true
  if (retiredRegions.has(cursor.regionId)) return true
  for (const entry of leases.values()) {
    const indexed = entry.regionIds.get(cursor.regionId)
    if (!indexed) continue
    if (entryBlocked(entry) || entry.animationQuiesced) return true
    const presentation = resolveSceneAffordanceCursorPresentation(indexed.descriptor, cursor.mode)
    if (!presentation.visual) return true
    try {
      outlet.applyCursorPresentation?.(entry.key, {
        affordanceId: indexed.affordanceId,
        at: now(),
        mode: cursor.mode,
        phase: cursor.phase,
        point: cursor.point,
        visual: presentation.visual,
      })
    } catch {
      // Consumer cursor art cannot alter native cursor or input ownership.
    }
    return true
  }
  return false
}

export function dispatchSceneCursorAwareInput(message, dispatchCursor, dispatchInput) {
  const cursor = normalizeSceneCursorPresentationMessage(message)
  return cursor ? dispatchCursor(cursor) : dispatchInput(message)
}

export function routeSceneCursorAwareInput({
  message,
  stagedRegionIds,
  maxBufferedInputs,
  dispatchCursor,
  dispatchInput,
}) {
  const cursor = normalizeSceneCursorPresentationMessage(message)
  const input = normalizeCanvasInputMessage(message)
  const regionId = cursor?.regionId ?? input?.regionId
  const staged = regionId ? stagedRegionIds.get(regionId) : null
  if (staged) {
    if (['activating', 'activated', 'committed', 'replaying', 'publishing'].includes(staged.state)) {
      if (staged.bufferedInputs.length < maxBufferedInputs) staged.bufferedInputs.push(message)
      else staged.inputOverflow = true
    }
    return true
  }
  return cursor ? dispatchCursor(cursor) : dispatchInput(message, input)
}
