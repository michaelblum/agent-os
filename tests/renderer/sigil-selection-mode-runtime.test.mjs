import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildProjectedSelectionModeOverlay,
  createSigilSelectionModeRuntime,
  resolveSigilAvatarIdleRotation,
} from '../../apps/sigil/renderer/live-modules/selection-mode-runtime.js'
import {
  canvasLocalRectToDesktopWorld,
  normalizeCanvasFrameToDesktopWorld,
  normalizeDisplays,
} from '../../packages/toolkit/runtime/spatial.js'

const display = {
  id: 'display-1',
  label: 'Display 1',
  visibleBounds: { x: 0, y: 0, w: 800, h: 600 },
}

function candidate(id, rect, extra = {}) {
  return {
    id,
    subject_id: id,
    subject_path: ['display-1', ...String(id).split(':')],
    subject_kind: extra.kind || 'frame',
    role: extra.role || '',
    label: extra.label || id,
    adapter_id: 'test-selection-mode',
    root_id: 'display-1',
    root_kind: 'display',
    root_label: 'Display 1',
    projection: {
      adapter_id: 'test-selection-mode',
      subject_id: id,
      subject_kind: extra.kind || 'frame',
      current_render_status: 'visible',
      can_project_display_overlay: true,
      visible_display_rect: rect,
      display_space_rect: rect,
      coordinate_space: 'desktop_world',
      blocker_reason: '',
    },
  }
}

function createRuntime(options = {}) {
  const liveState = {}
  const rendererState = options.rendererState || {}
  const commands = []
  const activeContexts = []
  const scheduled = []
  let closedContextMenu = 0
  let exitedReticle = 0
  let clearedGesture = 0
  let syncedRegions = 0
  let nowIndex = 0
  let runtime
  runtime = createSigilSelectionModeRuntime({
    liveState,
    rendererState,
    nowIso: () => `2026-05-28T12:00:0${nowIndex++}.000Z`,
    nowMs: options.nowMs || (() => 100000 + nowIndex * 1000),
    getPointer: () => ({ x: 40, y: 40, valid: true }),
    getDisplays: () => [display],
    getCandidateList: () => options.candidates || [],
    projectPoint: options.projectPoint || ((point) => ({ x: point.x + 1, y: point.y + 2, valid: point.valid })),
    getOverlayBounds: () => options.overlayBounds || { x: 0, y: 0, w: 800, h: 600 },
    closeContextMenu: () => { closedContextMenu += 1 },
    exitAnnotationReticle: () => { exitedReticle += 1 },
    clearGestureState: () => { clearedGesture += 1 },
    syncInputRegions: () => { syncedRegions += 1 },
    scheduleRenderFrame: (options = {}) => { scheduled.push(options) },
    clearSelectionModeEntryReleasePending: () => {},
    consumeSelectionModeEntryRelease: () => false,
    isOnAvatar: () => false,
    consumeAvatarDoubleClick: () => false,
    setActiveContextProvider: (payload) => {
      activeContexts.push(payload)
      return { context_keyframe: { id: 'keyframe:selection' } }
    },
    executeCommand(command, msg, commandOptions = {}) {
      commands.push({ command, msg })
      if (command === 'acquire') return runtime.acquire({ x: msg.x, y: msg.y, valid: true })
      if (command === 'selectBadge') return runtime.selectTargetNode(commandOptions.nodeId || msg.nodeId || msg.node_id, { reason: 'badge-click' })
      if (command === 'commit') return runtime.commit('enter')
      if (command === 'tabPreviousTarget' || command === 'arrowUpPreviousTarget') return runtime.cycleTarget(-1)
      if (command === 'arrowDownNextTarget') return runtime.cycleTarget(1)
      return null
    },
  })
  return {
    runtime,
    liveState,
    rendererState,
    commands,
    activeContexts,
    scheduled,
    sideEffects: () => ({ closedContextMenu, exitedReticle, clearedGesture, syncedRegions }),
  }
}

test('Selection Mode runtime owns entry, acquisition, target cycling, comments, and commit state', () => {
  const windowCandidate = candidate('window', { x: 50, y: 50, w: 300, h: 220 }, { kind: 'window', label: 'Window' })
  const buttonCandidate = candidate('button', { x: 80, y: 90, w: 80, h: 32 }, { kind: 'button', role: 'button', label: 'Save' })
  const {
    runtime,
    liveState,
    rendererState,
    commands,
    activeContexts,
    sideEffects,
  } = createRuntime({ candidates: [buttonCandidate, windowCandidate] })

  runtime.enter({ x: 40, y: 40, valid: true }, 'test')
  assert.equal(liveState.selectionMode.active, true)
  assert.deepEqual(sideEffects(), {
    closedContextMenu: 1,
    exitedReticle: 1,
    clearedGesture: 1,
    syncedRegions: 1,
  })

  const handled = runtime.handleInput({ type: 'left_mouse_up', x: 100, y: 100 })
  assert.equal(handled, true)
  assert.equal(commands[0].command, 'acquire')
  assert.equal(liveState.selectionMode.context_session.schema, 'aos_context_session')
  assert.deepEqual(
    liveState.selectionMode.context_session.artifacts[0].path.map((node) => node.label),
    ['Display 1', 'Window', 'Save'],
  )
  assert.equal(liveState.selectionModeOverlay.visible, true)
  assert.equal(liveState.selectionModeOverlay.cursor.x, 101)
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.model_kind, 'sigil_model')
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.source, 'avatar_render_state')
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.appearance_source, 'current_live_sigil_avatar')
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.material_source, 'current_avatar_render_model')
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.shape, 'avatar_derived_triangular_pointer')
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.geometry.primitive, 'triangular_pyramid')
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.geometry.cross_section, 'equilateral_triangle')
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.geometry.long_axis, 'screen_north_west')
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.geometry.base_screen_quadrant, 'down_right')
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.animation.source, 'selection_mode_pointer_single_axis')
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.animation.axis, 'scene_z')
  assert.deepEqual(liveState.selectionModeOverlay.cursorGlyph.hotspot, {
    kind: 'tip',
    x: 101,
    y: 102,
    local: { x: 0, y: 0, z: 0 },
  })
  assert.equal(liveState.selectionModeOverlay.cursorTrail.repeatShape, 'avatar_derived_triangular_pointer')
  assert.equal(liveState.selectionModeOverlay.cursorTrail.repeatGeometry, 'triangular_pyramid')
  assert.equal(liveState.selectionModeOverlay.badgeLayout.order, 'leaf-to-root')
  assert.ok(liveState.selectionMode.events.some((entry) => entry.type === 'selection_mode_aura_spike'))
  assert.deepEqual(
    liveState.selectionModeOverlay.badges.filter((badge) => badge.kind === 'primary').map((badge) => badge.nodeId),
    liveState.selectionMode.context_session.artifacts[0].path.map((node) => node.id).reverse(),
  )
  assert.equal(rendererState.selectionMode, liveState.selectionMode)

  const leafNodeId = liveState.selectionMode.selected_node_id
  runtime.cycleTarget(-1)
  const activeNodeId = liveState.selectionMode.selected_node_id
  assert.notEqual(activeNodeId, leafNodeId)
  assert.equal(liveState.selectionMode.context_session.artifacts[0].active_target_node_id, activeNodeId)

  runtime.setNodeComment(activeNodeId, 'Use this ancestor scope.', {
    id: 'comment:test',
    created_at: '2026-05-28T12:00:10.000Z',
    updated_at: '2026-05-28T12:00:10.000Z',
  })
  const activeNode = liveState.selectionMode.context_session.artifacts[0].path
    .find((node) => node.id === activeNodeId)
  assert.equal(activeNode.comments[0].text, 'Use this ancestor scope.')

  const committed = runtime.commit('test-commit')
  assert.equal(committed.schema, 'aos_context_session')
  assert.equal(liveState.selectionMode.active, false)
  assert.equal(activeContexts[0].source, 'selection_mode')
  assert.equal(activeContexts[0].contextSession.id, committed.id)
})

test('Selection Mode pointer movement updates overlay and schedules visual-only render work', () => {
  const { runtime, liveState, scheduled, commands } = createRuntime()

  runtime.enter({ x: 40, y: 40, valid: true }, 'test')
  const handled = runtime.handleInput({ type: 'mouse_moved', x: 120, y: 130 })

  assert.equal(handled, true)
  assert.equal(commands.length, 0)
  assert.equal(liveState.selectionMode.cursor.x, 120)
  assert.equal(liveState.selectionMode.cursor.y, 130)
  assert.equal(liveState.selectionModeOverlay.cursor.x, 121)
  assert.equal(liveState.selectionModeOverlay.cursor.y, 132)
  assert.deepEqual(scheduled.at(-1), { structural: false })
})

test('Selection Mode overlay aligns semantic targets from normalized DesktopWorld canvas frames', () => {
  const displays = normalizeDisplays([
    {
      id: 'left',
      bounds: { x: -207, y: 0, w: 207, h: 900 },
      visible_bounds: { x: -207, y: 0, w: 207, h: 900 },
    },
    {
      id: 'main',
      is_main: true,
      bounds: { x: 0, y: 0, w: 1512, h: 982 },
      visible_bounds: { x: 0, y: 25, w: 1512, h: 919 },
    },
  ])
  const canvas = {
    id: 'target-canvas',
    at: [120, 120, 360, 260],
    atResolved: [327, 120, 360, 260],
    at_resolved_coordinate_space: 'desktop_world',
  }
  const canvasFrame = normalizeCanvasFrameToDesktopWorld(canvas, displays)
  const semanticRect = canvasLocalRectToDesktopWorld(canvas, { x: 24, y: 36, w: 90, h: 44 }, displays)
  assert.deepEqual(canvasFrame.rect, { x: 327, y: 120, w: 360, h: 260 })
  assert.deepEqual(semanticRect, { x: 351, y: 156, w: 90, h: 44 })

  const surfaceCandidate = candidate('target-canvas', canvasFrame.rect, { kind: 'canvas_window', label: 'Canvas' })
  const semanticCandidate = candidate('target-button', semanticRect, { kind: 'button', role: 'button', label: 'Save' })
  const overlay = buildProjectedSelectionModeOverlay({
    active: true,
    cursor: { x: 370, y: 170, valid: true },
    selected_node_id: 'target-button',
    context_session: {
      artifacts: [{
        path: [surfaceCandidate, semanticCandidate],
        active_target_node_id: 'target-button',
        acquisition: { leaf_node_id: 'target-button', pointer: { x: 370, y: 170, valid: true } },
      }],
    },
  }, {
    projectPoint: (point) => point,
    overlayBounds: { x: 0, y: 0, w: 1512, h: 982 },
  })

  assert.deepEqual(overlay.frames.map((frame) => frame.rect), [
    { x: 327, y: 120, width: 360, height: 260 },
    { x: 351, y: 156, width: 90, height: 44 },
  ])
})

test('Selection Mode badge ladder chooses visible diagonal directions near corners', () => {
  const path = [
    candidate('display-root', { x: 0, y: 0, w: 800, h: 600 }, { kind: 'display', role: 'display', label: 'Display' }),
    candidate('window', { x: 12, y: 12, w: 360, h: 260 }, { kind: 'window', role: 'native_window', label: 'Window' }),
    candidate('button', { x: 24, y: 24, w: 80, h: 32 }, { kind: 'button', role: 'button', label: 'Save' }),
  ]
  const topLeft = buildProjectedSelectionModeOverlay({
    active: true,
    cursor: { x: 15, y: 15, valid: true },
    selected_node_id: 'button',
    path_candidates: path,
    context_session: {
      artifacts: [{
        path,
        active_target_node_id: 'button',
        acquisition: { leaf_node_id: 'button', pointer: { x: 15, y: 15, valid: true } },
      }],
    },
  }, { overlayBounds: { x: 0, y: 0, w: 220, h: 180 } })
  assert.equal(topLeft.badgeLayout.direction, 'down-right')
  assert.ok(topLeft.badges.every((badge) => badge.rect.x >= 6 && badge.rect.y >= 6))
  assert.ok(topLeft.badges.every((badge) => badge.rect.x + badge.rect.width <= 214))
  assert.ok(topLeft.badges.every((badge) => badge.rect.y + badge.rect.height <= 174))

  const bottomRight = buildProjectedSelectionModeOverlay({
    active: true,
    cursor: { x: 205, y: 165, valid: true },
    selected_node_id: 'button',
    path_candidates: path,
    context_session: {
      artifacts: [{
        path,
        active_target_node_id: 'button',
        acquisition: { leaf_node_id: 'button', pointer: { x: 205, y: 165, valid: true } },
      }],
    },
  }, { overlayBounds: { x: 0, y: 0, w: 220, h: 180 } })
  assert.equal(bottomRight.badgeLayout.direction, 'up-left')
  assert.ok(bottomRight.badges.every((badge) => badge.rect.x >= 6 && badge.rect.y >= 6))
  assert.ok(bottomRight.badges.every((badge) => badge.rect.x + badge.rect.width <= 214))
  assert.ok(bottomRight.badges.every((badge) => badge.rect.y + badge.rect.height <= 174))
})

function badgeOverlapArea(a, b) {
  const left = Math.max(a.rect.x, b.rect.x)
  const right = Math.min(a.rect.x + a.rect.width, b.rect.x + b.rect.width)
  const top = Math.max(a.rect.y, b.rect.y)
  const bottom = Math.min(a.rect.y + a.rect.height, b.rect.y + b.rect.height)
  return Math.max(0, right - left) * Math.max(0, bottom - top)
}

function badgesSubstantiallyOverlap(a, b) {
  const overlap = badgeOverlapArea(a, b)
  const smallerArea = Math.min(a.rect.width * a.rect.height, b.rect.width * b.rect.height)
  return a.rect.x === b.rect.x && a.rect.y === b.rect.y
    || (smallerArea > 0 && overlap / smallerArea > 0.35)
    || (a.rect.x < b.rect.x + b.rect.width
    && a.rect.x + a.rect.width > b.rect.x
    && a.rect.y < b.rect.y + b.rect.height
    && a.rect.y + a.rect.height > b.rect.y
    && overlap > 64)
}

test('Selection Mode grouped badge fan-out remains distinct near overlay edges', () => {
  const path = [
    candidate('display-root', { x: 0, y: 0, w: 220, h: 180 }, { kind: 'display', role: 'display', label: 'Display' }),
    candidate('app', { x: 20, y: 20, w: 180, h: 140 }, { kind: 'application', role: 'native_app', label: 'Example App' }),
    candidate('group-a', { x: 36, y: 38, w: 130, h: 80 }, { kind: 'group', role: 'group', label: 'Group' }),
    candidate('group-b', { x: 38, y: 40, w: 130, h: 80 }, { kind: 'group', role: 'group', label: 'Group' }),
    candidate('group-c', { x: 40, y: 42, w: 130, h: 80 }, { kind: 'group', role: 'group', label: 'Group' }),
    candidate('leaf', { x: 80, y: 60, w: 40, h: 24 }, { kind: 'button', role: 'button', label: 'Save' }),
  ]
  const overlay = buildProjectedSelectionModeOverlay({
    active: true,
    cursor: { x: 130, y: 20, valid: true },
    selected_node_id: 'leaf',
    path_candidates: path,
    context_session: {
      artifacts: [{
        path,
        active_target_node_id: 'leaf',
        acquisition: { leaf_node_id: 'leaf', pointer: { x: 130, y: 20, valid: true } },
      }],
    },
  }, { overlayBounds: { x: 0, y: 0, w: 220, h: 180 } })

  const grouped = overlay.badgeGroups.find((group) => group.groupedCount >= 2)
  assert.ok(grouped, 'expected at least two grouped secondary badges')
  assert.ok(overlay.badges.every((badge) => badge.rect.x >= 6 && badge.rect.y >= 6))
  assert.ok(overlay.badges.every((badge) => badge.rect.x + badge.rect.width <= 214))
  assert.ok(overlay.badges.every((badge) => badge.rect.y + badge.rect.height <= 174))
  for (let i = 0; i < overlay.badges.length; i += 1) {
    for (let j = i + 1; j < overlay.badges.length; j += 1) {
      assert.equal(badgesSubstantiallyOverlap(overlay.badges[i], overlay.badges[j]), false, `${overlay.badges[i].id} overlaps ${overlay.badges[j].id}`)
    }
  }
})

test('Selection Mode groups same-size deep ancestors into horizontal badge fan-out and marks key ancestors', () => {
  const wrapper = candidate('wrapper', { x: 40, y: 40, w: 300, h: 220 }, { kind: 'group', role: 'group', label: 'Group' })
  const wrapperInner = candidate('wrapper-inner', { x: 42, y: 42, w: 300, h: 220 }, { kind: 'group', role: 'group', label: 'Group' })
  const app = candidate('app', { x: 20, y: 20, w: 420, h: 320 }, { kind: 'application', role: 'native_app', label: 'Example App' })
  const button = candidate('button', { x: 80, y: 90, w: 80, h: 32 }, { kind: 'button', role: 'button', label: 'Save' })
  const { runtime, liveState } = createRuntime({
    candidates: [app, wrapper, wrapperInner, button],
    projectPoint: (point) => point,
  })

  runtime.enter({ x: 100, y: 100, valid: true }, 'test')
  runtime.acquire({ x: 100, y: 100, valid: true })

  const overlay = liveState.selectionModeOverlay
  const grouped = overlay.badgeGroups.find((group) => group.groupedCount > 0)
  assert.ok(grouped, 'expected same-size ancestors to group behind a primary badge')
  const primary = overlay.badges.find((badge) => badge.id === grouped.primaryId)
  const secondary = overlay.badges.find((badge) => badge.id === grouped.secondaryIds[0])
  assert.equal(secondary.kind, 'secondary')
  assert.notDeepEqual(secondary.rect, primary.rect)
  assert.ok(overlay.badges.some((badge) => badge.token === 'display'))
  assert.ok(overlay.badges.some((badge) => badge.token === 'app'))
})

test('Selection Mode acquires DesktopWorld semantic leaf at visible button center', () => {
  const canvasWindow = candidate('selection-mode-live-target', { x: 574, y: 173, w: 360, h: 260 }, {
    kind: 'canvas_window',
    label: 'selection-mode-live-target',
  })
  const saveButton = candidate('selection-mode-live-save-button', { x: 598, y: 209, w: 90, h: 44 }, {
    kind: 'button',
    role: 'button',
    label: 'Save',
  })
  const { runtime, liveState } = createRuntime({
    candidates: [canvasWindow, saveButton],
    projectPoint: (point) => point,
  })

  runtime.enter({ x: 643, y: 231, valid: true }, 'test')
  runtime.acquire({ x: 643, y: 231, valid: true })

  assert.equal(liveState.selectionMode.leaf_candidate.id, 'selection-mode-live-save-button')
  assert.equal(liveState.selectionMode.selected_node_id, 'node:selection-mode:selection-mode-live-save-button:selection-mode-live-save-button')
  assert.deepEqual(
    liveState.selectionMode.context_session.artifacts[0].path.map((node) => node.label),
    ['Display 1', 'selection-mode-live-target', 'Save'],
  )
  assert.equal(liveState.selectionModeOverlay.leafNodeId, liveState.selectionMode.selected_node_id)
})

test('Selection Mode badge click retargets while preserving original acquisition evidence', () => {
  const windowCandidate = candidate('window', { x: 50, y: 50, w: 300, h: 220 }, { kind: 'window', role: 'native_window', label: 'Window' })
  const buttonCandidate = candidate('button', { x: 80, y: 90, w: 80, h: 32 }, { kind: 'button', role: 'button', label: 'Save' })
  const { runtime, liveState, commands } = createRuntime({
    candidates: [buttonCandidate, windowCandidate],
    projectPoint: (point) => point,
  })

  runtime.enter({ x: 100, y: 100, valid: true }, 'test')
  runtime.handleInput({ type: 'left_mouse_up', x: 100, y: 100 })
  const acquiredArtifact = liveState.selectionMode.context_session.artifacts[0]
  const acquiredPointer = structuredClone(acquiredArtifact.acquisition.pointer)
  const acquiredLeafNodeId = acquiredArtifact.acquisition.leaf_node_id
  const acquiredPathNodeIds = acquiredArtifact.path.map((node) => node.id)
  const ancestorBadge = liveState.selectionModeOverlay.badges.find((badge) => (
    badge.nodeId === acquiredArtifact.path[1].id
  ))
  assert.ok(ancestorBadge)
  const originalBadgeRects = new Map(liveState.selectionModeOverlay.badges.map((badge) => [
    badge.nodeId,
    structuredClone(badge.rect),
  ]))
  runtime.handleInput({
    type: 'left_mouse_up',
    x: ancestorBadge.rect.x + ancestorBadge.rect.width / 2,
    y: ancestorBadge.rect.y + ancestorBadge.rect.height / 2,
  })

  assert.deepEqual(commands.map((entry) => entry.command), ['acquire', 'selectBadge'])
  const retargetedArtifact = liveState.selectionMode.context_session.artifacts[0]
  assert.equal(retargetedArtifact.active_target_node_id, ancestorBadge.nodeId)
  assert.deepEqual(retargetedArtifact.acquisition.pointer, acquiredPointer)
  assert.equal(retargetedArtifact.acquisition.leaf_node_id, acquiredLeafNodeId)
  assert.deepEqual(retargetedArtifact.path.map((node) => node.id), acquiredPathNodeIds)
  assert.equal(retargetedArtifact.acquisition.candidate_report.clicked_leaf.node_id, acquiredLeafNodeId)
  for (const badge of liveState.selectionModeOverlay.badges) {
    assert.deepEqual(badge.rect, originalBadgeRects.get(badge.nodeId))
  }
  assert.notDeepEqual(liveState.selectionMode.cursor, acquiredPointer)
})

test('Selection Mode cursor model exposes current avatar effect descriptors, trail, and rotation fields', () => {
  const path = [
    candidate('display-root', { x: 0, y: 0, w: 800, h: 600 }, { kind: 'display', role: 'display', label: 'Display' }),
    candidate('leaf', { x: 80, y: 90, w: 80, h: 32 }, { kind: 'button', role: 'button', label: 'Save' }),
  ]
  const overlay = buildProjectedSelectionModeOverlay({
    active: true,
    cursor: { x: 100, y: 100, valid: true },
    selected_node_id: 'leaf',
    context_session: {
      artifacts: [{
        path,
        active_target_node_id: 'leaf',
        acquisition: { leaf_node_id: 'leaf', pointer: { x: 100, y: 100, valid: true } },
      }],
    },
  }, {
    rendererState: {
      colors: { face: ['#112233', '#445566'], aura: ['#778899', '#aabbcc'] },
      idleSpinSpeed: 0.08,
      sessionVitality: { scaleMultiplier: 1.25 },
      trailStyle: 'line',
      trailLength: 12,
      trailOpacity: 0.7,
      trailFadeMs: 640,
      auraReach: 1.7,
      auraIntensity: 1.4,
      isPulsarEnabled: true,
      pulsarRayCount: 4,
    },
  })

  assert.equal(overlay.cursorGlyph.source, 'avatar_render_state')
  assert.equal(overlay.cursorGlyph.appearance_source, 'current_live_sigil_avatar')
  assert.equal(overlay.cursorGlyph.material_source, 'current_avatar_render_model')
  assert.equal(overlay.cursorGlyph.effects_source, 'current_avatar_effect_descriptors')
  assert.equal(overlay.cursorGlyph.color, undefined)
  assert.equal(overlay.cursorGlyph.aura, undefined)
  assert.equal(overlay.cursorGlyph.avatar_effects.source, 'current_avatar_effect_descriptors')
  assert.equal(overlay.cursorGlyph.avatar_effects.appearance_source, 'current_live_sigil_avatar')
  assert.deepEqual(overlay.cursorGlyph.avatar_effects.rendered_pointer_families, ['aura_glow', 'aura_core'])
  assert.deepEqual(overlay.cursorGlyph.avatar_effects.inherited_descriptor_families, ['pulsar'])
  assert.deepEqual(overlay.cursorGlyph.avatar_effects.aura, {
    enabled: true,
    primary: '#778899',
    secondary: '#aabbcc',
    reach: 1.7,
    intensity: 1.4,
    pulseRate: 0.005,
    wobbleCount: 0,
  })
  assert.equal(overlay.cursorGlyph.trail.style, 'line')
  assert.equal(overlay.cursorGlyph.trail.count, 12)
  assert.equal(overlay.cursorGlyph.trail.opacity, 0.7)
  assert.equal(overlay.cursorGlyph.animation.source, 'selection_mode_pointer_single_axis')
  assert.equal(overlay.cursorGlyph.animation.axis, 'scene_z')
  assert.equal(overlay.cursorGlyph.animation.rotation_speed, 0.01)
  assert.equal(overlay.cursorGlyph.animation.session_vitality_multiplier, 1.25)
  assert.equal(overlay.cursorGlyph.animation.visible_avatar_y_speed, 0)
  assert.equal(overlay.cursorGlyph.animation.visible_avatar_x_speed, 0)
  assert.deepEqual(resolveSigilAvatarIdleRotation({ idleSpinSpeed: 0.08 }), {
    source: 'sigil_avatar_idle_rotation',
    base_speed: 0.08,
    cursor_long_axis_speed: 0.08,
    visible_avatar_y_speed: 0.04,
    visible_avatar_x_speed: 0.016,
  })
})

test('Selection Mode cursor trail uses Selection Mode trail settings instead of fast-travel line state', () => {
  const path = [
    candidate('display-root', { x: 0, y: 0, w: 800, h: 600 }, { kind: 'display', role: 'display', label: 'Display' }),
    candidate('leaf', { x: 80, y: 90, w: 80, h: 32 }, { kind: 'button', role: 'button', label: 'Save' }),
  ]
  const overlay = buildProjectedSelectionModeOverlay({
    active: true,
    cursor: { x: 100, y: 100, valid: true },
    selected_node_id: 'leaf',
    context_session: {
      artifacts: [{
        path,
        active_target_node_id: 'leaf',
        acquisition: { leaf_node_id: 'leaf', pointer: { x: 100, y: 100, valid: true } },
      }],
    },
  }, {
    rendererState: {
      selectionModeTrailDuration: 0.33,
      selectionModeTrailDelay: 0.04,
      selectionModeTrailRepeatCount: 4,
      selectionModeTrailRepeatDuration: 1.25,
      selectionModeTrailMode: 'hold',
      selectionModeTrailLag: 0.11,
      selectionModeTrailScale: 1.9,
      fastTravelLineDuration: 9,
      fastTravelLineRepeatCount: 99,
      fastTravelLineLag: 0.4,
      fastTravelLineScale: 8,
    },
  })

  assert.equal(overlay.cursorTrail.timingSource, 'selection_mode_trail')
  assert.deepEqual(overlay.cursorTrail.timing, {
    source: 'selection_mode_trail',
    interDimensional: true,
    duration: 0.33,
    delay: 0.04,
    repeatCount: 4,
    repeatDuration: 1.25,
    trailMode: 'hold',
    lag: 0.11,
    scale: 1.9,
  })
})

test('Selection Mode entry and exit effects produce bounded renderable overlay transitions', () => {
  let clock = 200000
  const { runtime, liveState, scheduled } = createRuntime({ nowMs: () => clock })
  runtime.enter({ x: 40, y: 40, valid: true }, 'test')
  assert.deepEqual(liveState.selectionMode.effects.map((effect) => [effect.phase, effect.effect]), [
    ['enter', 'supernova'],
  ])
  assert.deepEqual(liveState.selectionModeOverlay.visualEffects.map((effect) => [effect.phase, effect.effect, effect.active]), [
    ['enter', 'supernova', true],
  ])
  assert.equal(liveState.selectionModeOverlay.visualEffects[0].anchor.x, 41)
  assert.equal(liveState.selectionModeOverlay.visualEffects[0].bounded, true)

  clock += 240
  runtime.handleInput({ type: 'key_down', key: 'Escape' })
  assert.equal(liveState.selectionMode.active, false)
  assert.deepEqual(liveState.selectionMode.effects.map((effect) => [effect.phase, effect.effect]), [
    ['enter', 'supernova'],
    ['exit', 'reverse_supernova'],
  ])
  assert.equal(liveState.selectionModeOverlay.visible, true)
  assert.equal(liveState.selectionModeOverlay.active, false)
  assert.equal(liveState.selectionModeOverlay.visualEffects.at(-1).phase, 'exit')
  assert.equal(liveState.selectionModeOverlay.visualEffects.at(-1).effect, 'reverse_supernova')
  assert.equal(liveState.selectionModeOverlay.visualEffects.at(-1).active, true)

  clock += liveState.selectionModeOverlay.visualEffects.at(-1).duration_ms + 1
  assert.equal(liveState.selectionModeOverlay.visible, true)
  const cleaned = runtime.reconcileOverlayLifecycle({ render: true })
  assert.equal(cleaned, true)
  assert.equal(liveState.selectionModeOverlay.visible, false)
  assert.equal(liveState.selectionModeOverlay.visualEffects.every((effect) => effect.active === false), true)
  assert.ok(scheduled.length >= 1)
  const expired = runtime.buildProjectedOverlay()
  assert.equal(expired.visible, false)
  assert.equal(expired.visualEffects.every((effect) => effect.active === false), true)

  const overridden = createRuntime({
    rendererState: {
      selectionModeEffects: { enter: 'nova_bloom', exit: 'nova_collapse' },
    },
  })
  overridden.runtime.enter({ x: 40, y: 40, valid: true }, 'test')
  overridden.runtime.exit('cancel')
  overridden.runtime.exit('cancel-again')
  assert.deepEqual(overridden.liveState.selectionMode.effects.map((effect) => [effect.phase, effect.effect]), [
    ['enter', 'nova_bloom'],
    ['exit', 'nova_collapse'],
  ])
  assert.deepEqual(overridden.liveState.selectionModeOverlay.visualEffects.map((effect) => [effect.phase, effect.effect]), [
    ['enter', 'nova_bloom'],
    ['exit', 'nova_collapse'],
  ])
})

test('Selection Mode overlay badge, frame, connector, and effect styles derive from avatar colors', () => {
  const path = [
    candidate('display-root', { x: 0, y: 0, w: 800, h: 600 }, { kind: 'display', role: 'display', label: 'Display' }),
    candidate('leaf', { x: 80, y: 90, w: 80, h: 32 }, { kind: 'button', role: 'button', label: 'Save' }),
  ]
  const overlay = buildProjectedSelectionModeOverlay({
    active: true,
    cursor: { x: 100, y: 100, valid: true },
    selected_node_id: 'leaf',
    effects: [{
      phase: 'enter',
      effect: 'supernova',
      at: '2026-05-28T12:00:00.000Z',
      started_at_ms: 200000,
      duration_ms: 520,
      anchor: { x: 100, y: 100, valid: true },
    }],
    context_session: {
      artifacts: [{
        path,
        active_target_node_id: 'leaf',
        acquisition: { leaf_node_id: 'leaf', pointer: { x: 100, y: 100, valid: true } },
      }],
    },
  }, {
    nowMs: 200010,
    rendererState: {
      colors: { face: ['#123456'], aura: ['#abcdef', '#fedcba'] },
    },
  })

  assert.equal(overlay.styles.source, 'sigil_avatar')
  assert.equal(overlay.styles.primary, '#123456')
  assert.equal(overlay.styles.frame.active.stroke, 'rgba(18, 52, 86, 0.58)')
  assert.equal(overlay.styles.connector.stroke, 'rgba(254, 220, 186, 0.86)')
  assert.equal(overlay.styles.effect.primary, 'rgba(171, 205, 239, 0.96)')
  assert.equal(overlay.frames.find((frame) => frame.active).style.stroke, 'rgba(18, 52, 86, 0.58)')
  assert.equal(overlay.badges.find((badge) => badge.active).style.stroke, 'rgba(171, 205, 239, 0.96)')
  assert.equal(overlay.visualEffects[0].anchor.x, 100)
})

test('Selection Mode effect defaults roundtrip through appearance state', async () => {
  globalThis.window ??= { innerHeight: 1080 }
  globalThis.window.innerHeight ??= 1080
  const { DEFAULT_APPEARANCE, applyAppearance, snapshotAppearance } = await import('../../apps/sigil/renderer/appearance.js')
  const state = (await import('../../apps/sigil/renderer/state.js')).default

  assert.deepEqual(DEFAULT_APPEARANCE.transitions.selectionMode, {
    enter: 'supernova',
    exit: 'reverse_supernova',
  })
  assert.deepEqual(DEFAULT_APPEARANCE.transitions.selectionModeTrail, {
    interDimensional: true,
    duration: 0.22,
    delay: 0,
    repeatCount: 10,
    repeatDuration: 2.0,
    trailMode: 'fade',
    lagFactor: 0.05,
    scale: 1.5,
  })

  const priorDebug = console.debug
  console.debug = () => {}
  try {
    applyAppearance({
      transitions: {
        selectionMode: { enter: 'nova_bloom', exit: 'nova_collapse' },
        selectionModeTrail: {
          interDimensional: false,
          duration: 0.4,
          delay: 0.05,
          repeatCount: 6,
          repeatDuration: 1.1,
          trailMode: 'hold',
          lagFactor: 0.08,
          scale: 1.8,
        },
      },
    })
  } finally {
    console.debug = priorDebug
  }

  assert.equal(state.selectionModeEnterEffect, 'nova_bloom')
  assert.equal(state.selectionModeExitEffect, 'nova_collapse')
  assert.deepEqual(snapshotAppearance().transitions.selectionMode, {
    enter: 'nova_bloom',
    exit: 'nova_collapse',
  })
  assert.deepEqual(snapshotAppearance().transitions.selectionModeTrail, {
    interDimensional: false,
    duration: 0.4,
    delay: 0.05,
    repeatCount: 6,
    repeatDuration: 1.1,
    trailMode: 'hold',
    lagFactor: 0.08,
    scale: 1.8,
  })
})

test('Selection Mode runtime consumes avatar double-click exit without command dispatch', () => {
  const liveState = {}
  const commands = []
  const runtime = createSigilSelectionModeRuntime({
    liveState,
    getDisplays: () => [display],
    isOnAvatar: () => true,
    consumeAvatarDoubleClick: () => true,
    executeCommand(command) {
      commands.push(command)
    },
  })

  runtime.enter({ x: 40, y: 40, valid: true }, 'test')
  const handled = runtime.handleInput({ type: 'left_mouse_up', x: 40, y: 40 })

  assert.equal(handled, true)
  assert.equal(liveState.selectionMode.active, false)
  assert.deepEqual(commands, [])
})
