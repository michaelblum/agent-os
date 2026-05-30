import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildProjectedSelectionModeOverlay,
  createSigilSelectionModeRuntime,
  resolveSigilAvatarIdleRotation,
} from '../../apps/sigil/renderer/live-modules/selection-mode-runtime.js'
import {
  hitTestSelectionModeLineageBar,
  hitTestSelectionModeLineageItem,
} from '../../apps/sigil/renderer/live-modules/selection-mode-lineage-bar.js'
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
  const rootId = extra.root_id || 'display-1'
  const adapterId = extra.adapter_id || 'test-selection-mode'
  const subjectPath = extra.subject_path || ['display-1', ...String(id).split(':')]
  return {
    id,
    subject_id: id,
    subject_path: subjectPath,
    subject_kind: extra.kind || 'frame',
    role: extra.role || '',
    label: extra.label || id,
    adapter_id: adapterId,
    root_id: rootId,
    root_kind: extra.root_kind || 'display',
    root_label: extra.root_label || 'Display 1',
    source_metadata: {
      ...(extra.source_metadata || {}),
    },
    projection: {
      adapter_id: adapterId,
      root_id: rootId,
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
      if (command === 'selectLineageNode') return runtime.selectTargetNode(commandOptions.nodeId || msg.nodeId || msg.node_id, { reason: 'lineage-click' })
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
  } = createRuntime({
    candidates: [buttonCandidate, windowCandidate],
    rendererState: {
      currentOpacity: 0.25,
      currentEdgeOpacity: 0.8,
      isMaskEnabled: true,
      cylinderTopRadius: 0.35,
      cylinderBottomRadius: 0.65,
      cylinderHeight: 1,
      tesseron: { enabled: true, proportion: 0.42, matchMother: true },
    },
  })

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
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.shape, 'avatar_derived_prism_pointer')
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.geometry.primitive, 'prism')
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.geometry.geometry_type, 93)
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.geometry.top_radius, 0)
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.geometry.bottom_radius, 0.8)
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.geometry.height, 2)
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.geometry.sides, 3)
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.geometry.cross_section, 'triangular')
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.geometry.faces_visible, false)
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.geometry.face_opacity, 0.25)
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.geometry.edge_opacity, 0.8)
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.geometry.tesseron_enabled, true)
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.geometry.tesseron_proportion, 0.42)
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.geometry.long_axis, 'screen_north_west')
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.geometry.base_screen_quadrant, 'down_right')
  assert.deepEqual(liveState.selectionModeOverlay.cursorGlyph.geometry.orientation_degrees, { x: 0, y: 0, z: 45 })
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.geometry.spin_axis, 'local_y')
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.animation.source, 'selection_mode_pointer_single_axis')
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.animation.axis, 'local_y')
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.animation.rotation_speed, 0.1)
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.animation.rotation_started_at_ms, 101000)
  assert.deepEqual(liveState.selectionModeOverlay.cursorGlyph.hotspot, {
    kind: 'tip',
    x: 101,
    y: 102,
    local: { x: 0, y: 0, z: 0 },
  })
  assert.equal(liveState.selectionModeOverlay.cursorTrail.repeatShape, 'avatar_derived_prism_pointer')
  assert.equal(liveState.selectionModeOverlay.cursorTrail.repeatGeometry, 'prism')
  assert.equal(liveState.selectionModeOverlay.lineageBar.order, 'root-to-leaf')
  assert.equal(liveState.selectionModeOverlay.lineageBar.activeDisplayId, 'display-1')
  assert.ok(liveState.selectionMode.events.some((entry) => entry.type === 'selection_mode_aura_spike'))
  assert.deepEqual(
    liveState.selectionModeOverlay.lineageBar.items.map((item) => item.nodeId),
    liveState.selectionMode.context_session.artifacts[0].path.map((node) => node.id),
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

test('Selection Mode lineage bar pins to the active display visible bounds', () => {
  const displays = [
    {
      id: 'left',
      label: 'Left Display',
      visibleBounds: { x: -240, y: 24, w: 220, h: 160 },
      bounds: { x: -240, y: 0, w: 220, h: 184 },
    },
    {
      id: 'main',
      label: 'Main Display',
      visibleBounds: { x: 0, y: 25, w: 800, h: 575 },
      bounds: { x: 0, y: 0, w: 800, h: 600 },
    },
  ]
  const path = [
    candidate('display-root', { x: -240, y: 24, w: 220, h: 160 }, { kind: 'display', role: 'display', label: 'Left Display' }),
    candidate('window', { x: -220, y: 40, w: 170, h: 120 }, { kind: 'window', role: 'native_window', label: 'Window' }),
    candidate('button', { x: -190, y: 72, w: 80, h: 32 }, { kind: 'button', role: 'button', label: 'Save' }),
  ]
  const overlay = buildProjectedSelectionModeOverlay({
    active: true,
    cursor: { x: 100, y: 100, valid: true },
    selected_node_id: 'button',
    path_candidates: path,
    context_session: {
      artifacts: [{
        path,
        active_target_node_id: 'button',
        acquisition: { leaf_node_id: 'button', pointer: { x: -180, y: 90, valid: true } },
      }],
    },
  }, {
    displays,
    projectPoint: (point) => point,
    overlayBounds: { x: -240, y: 0, w: 1040, h: 600 },
  })

  const bar = overlay.lineageBar
  assert.equal(bar.visible, true)
  assert.equal(bar.activeDisplayId, 'left')
  assert.equal(bar.order, 'root-to-leaf')
  assert.equal(bar.rect.y, 34)
  assert.equal(bar.defaultRect.y, 34)
  assert.equal(bar.placement, 'default_menu_bar_below')
  assert.equal(bar.draggable, true)
  assert.ok(bar.rect.x >= -232)
  assert.ok(bar.rect.x + bar.rect.width <= -28)
  assert.deepEqual(bar.items.map((item) => item.nodeId), path.map((node) => node.id))
  assert.ok(bar.items.filter((item) => item.visibleRect).every((item) => item.visibleRect.x >= bar.rect.x))
  assert.ok(bar.items.filter((item) => item.visibleRect).every((item) => item.visibleRect.x + item.visibleRect.width <= bar.rect.x + bar.rect.width))
  assert.ok(bar.items.every((item) => item.rect.y >= bar.rect.y))
  assert.ok(bar.items.every((item) => item.rect.y + item.rect.height <= bar.rect.y + bar.rect.height))
})

test('Selection Mode lineage bar can be dragged and resets on fresh entry', () => {
  const windowCandidate = candidate('window', { x: 50, y: 50, w: 300, h: 220 }, {
    kind: 'window',
    role: 'native_window',
    label: 'Window',
  })
  const buttonCandidate = candidate('button', { x: 80, y: 90, w: 80, h: 32 }, {
    kind: 'button',
    role: 'button',
    label: 'Save',
  })
  const { runtime, liveState, scheduled } = createRuntime({
    candidates: [buttonCandidate, windowCandidate],
    projectPoint: (point) => point,
  })

  runtime.enter({ x: 100, y: 100, valid: true }, 'test')
  runtime.acquire({ x: 100, y: 100, valid: true })
  const defaultRect = { ...liveState.selectionModeOverlay.lineageBar.rect }

  assert.equal(runtime.handleInput({
    type: 'left_mouse_down',
    x: defaultRect.x + 2,
    y: defaultRect.y + 2,
  }), true)
  assert.equal(runtime.handleInput({
    type: 'left_mouse_dragged',
    x: defaultRect.x + 102,
    y: defaultRect.y + 72,
  }), true)
  assert.equal(runtime.handleInput({
    type: 'left_mouse_up',
    x: defaultRect.x + 102,
    y: defaultRect.y + 72,
  }), true)

  assert.equal(liveState.selectionMode.lineage_bar_drag, null)
  assert.equal(liveState.selectionModeOverlay.lineageBar.placement, 'manual')
  assert.notDeepEqual(liveState.selectionModeOverlay.lineageBar.rect, defaultRect)
  assert.ok(scheduled.some((entry) => entry.structural === false))

  runtime.exit('escape')
  runtime.enter({ x: 100, y: 100, valid: true }, 'test-reenter')
  runtime.acquire({ x: 100, y: 100, valid: true })

  assert.deepEqual(
    liveState.selectionModeOverlay.lineageBar.rect,
    liveState.selectionModeOverlay.lineageBar.defaultRect,
  )
  assert.equal(liveState.selectionModeOverlay.lineageBar.placement, 'default_menu_bar_below')
})

test('Selection Mode lineage bar uses a menu-bar fallback when visible bounds are unavailable', () => {
  const displays = [{
    id: 'main',
    label: 'Main Display',
    visibleBounds: { x: 0, y: 0, w: 800, h: 600 },
    bounds: { x: 0, y: 0, w: 800, h: 600 },
  }]
  const path = [
    candidate('display-root', { x: 0, y: 0, w: 800, h: 600 }, {
      kind: 'display',
      role: 'display',
      label: 'Display',
    }),
    candidate('window', { x: 40, y: 60, w: 500, h: 300 }, {
      kind: 'window',
      role: 'native_window',
      label: 'Window',
    }),
    candidate('leaf', { x: 100, y: 110, w: 60, h: 30 }, {
      kind: 'button',
      role: 'button',
      label: 'Save',
    }),
  ]
  const overlay = buildProjectedSelectionModeOverlay({
    active: true,
    cursor: { x: 120, y: 120, valid: true },
    selected_node_id: 'leaf',
    context_session: {
      artifacts: [{
        path,
        active_target_node_id: 'leaf',
        acquisition: { leaf_node_id: 'leaf', pointer: { x: 120, y: 120, valid: true } },
      }],
    },
  }, {
    displays,
    projectPoint: (point) => point,
    overlayBounds: { x: 0, y: 0, w: 800, h: 600 },
  })

  assert.equal(overlay.lineageBar.defaultRect.y, 34)
  assert.equal(overlay.lineageBar.rect.y, 34)
})

test('Selection Mode frames skip interior scrim and perimeter-fill the nearest major seam ancestor', () => {
  const path = [
    candidate('display-root', { x: 0, y: 25, w: 800, h: 575 }, {
      kind: 'display',
      role: 'display',
      label: 'Display',
    }),
    candidate('app', { x: 20, y: 40, w: 700, h: 500 }, {
      kind: 'application',
      role: 'native_app',
      label: 'Example App',
    }),
    candidate('window', { x: 40, y: 60, w: 500, h: 300 }, {
      kind: 'window',
      role: 'native_window',
      label: 'Window',
    }),
    candidate('container', { x: 80, y: 90, w: 240, h: 120 }, {
      kind: 'group',
      role: 'container',
      label: 'Container',
    }),
    candidate('leaf', { x: 100, y: 110, w: 60, h: 30 }, {
      kind: 'button',
      role: 'button',
      label: 'Save',
    }),
  ]
  const overlay = buildProjectedSelectionModeOverlay({
    active: true,
    cursor: { x: 120, y: 120, valid: true },
    selected_node_id: 'leaf',
    path_candidates: path,
    context_session: {
      artifacts: [{
        path,
        active_target_node_id: 'leaf',
        acquisition: { leaf_node_id: 'leaf', pointer: { x: 120, y: 120, valid: true } },
      }],
    },
  }, {
    displays: [{ id: 'display-1', visibleBounds: { x: 0, y: 25, w: 800, h: 575 } }],
    projectPoint: (point) => point,
    overlayBounds: { x: 0, y: 0, w: 800, h: 600 },
  })

  assert.ok(overlay.frames.every((frame) => frame.style.fill === null))
  assert.equal(overlay.perimeterFillNodeId, 'window')
  const filled = overlay.frames.filter((frame) => frame.perimeterFill)
  assert.equal(filled.length, 1)
  assert.equal(filled[0].id, 'window')
  assert.equal(filled[0].perimeterFill.mode, 'edge_band')
  assert.equal(filled[0].perimeterFill.marginRatio, 0.15)
})

test('Selection Mode lineage bar skips union roots and preserves selectable path nodes', () => {
  const displays = [{
    id: 'display-1',
    label: 'Display 1',
    visibleBounds: { x: 0, y: 25, w: 320, h: 220 },
  }]
  const path = [
    candidate('desktop-union', { x: 0, y: 0, w: 320, h: 245 }, { kind: 'desktop_world_union', role: 'desktop_union', label: 'Desktop Union' }),
    candidate('app', { x: 20, y: 40, w: 260, h: 170 }, { kind: 'application', role: 'native_app', label: 'Example App' }),
    candidate('tab', { x: 30, y: 50, w: 240, h: 140 }, { kind: 'browser_tab', role: 'browser_tab', label: 'Docs Tab' }),
    candidate('dom', { x: 36, y: 62, w: 220, h: 112 }, { kind: 'document', role: 'dom_document', label: 'DOM' }),
    candidate('leaf', { x: 80, y: 90, w: 40, h: 24 }, { kind: 'button', role: 'button', label: 'Save' }),
  ]
  const overlay = buildProjectedSelectionModeOverlay({
    active: true,
    cursor: { x: 90, y: 96, valid: true },
    selected_node_id: 'leaf',
    path_candidates: path,
    context_session: {
      artifacts: [{
        path,
        active_target_node_id: 'leaf',
        acquisition: { leaf_node_id: 'leaf', pointer: { x: 90, y: 96, valid: true } },
      }],
    },
  }, {
    displays,
    projectPoint: (point) => point,
    overlayBounds: { x: 0, y: 0, w: 320, h: 245 },
  })

  const bar = overlay.lineageBar
  assert.equal(bar.activeDisplayId, 'display-1')
  assert.equal(bar.items[0].source, 'active_display')
  assert.equal(bar.items[0].token, 'display')
  assert.equal(bar.items.some((item) => item.nodeId === 'desktop-union'), false)
  assert.deepEqual(bar.items.slice(1).map((item) => item.token), ['app', 'browser_tab', 'document', 'button'])
  assert.equal(bar.itemCount, path.length)
  assert.ok(bar.items.filter((item) => item.visibleRect).every((item) => item.visibleRect.x >= bar.rect.x))
  assert.ok(bar.items.filter((item) => item.visibleRect).every((item) => item.visibleRect.x + item.visibleRect.width <= bar.rect.x + bar.rect.width))
})

test('Selection Mode lineage bar scrolls long paths without compressing target pills', () => {
  const path = [
    candidate('display-root', { x: 0, y: 25, w: 280, h: 190 }, { kind: 'display', role: 'display', label: 'Display' }),
    candidate('app', { x: 10, y: 40, w: 250, h: 160 }, { kind: 'application', role: 'native_app', label: 'Example App With Long Name' }),
    candidate('window', { x: 16, y: 46, w: 238, h: 148 }, { kind: 'window', role: 'native_window', label: 'Window' }),
    candidate('canvas', { x: 20, y: 52, w: 226, h: 136 }, { kind: 'canvas_window', role: 'canvas', label: 'Canvas' }),
    ...Array.from({ length: 8 }, (_, index) => candidate(`container-${index}`, {
      x: 24 + index,
      y: 60 + index,
      w: 190 - index,
      h: 96 - index,
    }, { kind: 'group', role: 'container', label: `Container ${index + 1}` })),
    candidate('leaf', { x: 76, y: 96, w: 42, h: 22 }, { kind: 'button', role: 'button', label: 'Save' }),
  ]
  const overlay = buildProjectedSelectionModeOverlay({
    active: true,
    cursor: { x: 90, y: 105, valid: true },
    selected_node_id: 'leaf',
    path_candidates: path,
    context_session: {
      artifacts: [{
        path,
        active_target_node_id: 'leaf',
        acquisition: { leaf_node_id: 'leaf', pointer: { x: 90, y: 105, valid: true } },
      }],
    },
  }, {
    displays: [{ id: 'display-1', visibleBounds: { x: 0, y: 25, w: 280, h: 190 } }],
    projectPoint: (point) => point,
    overlayBounds: { x: 0, y: 0, w: 280, h: 240 },
  })

  const bar = overlay.lineageBar
  assert.equal(bar.itemCount, path.length)
  assert.equal(bar.rect.x >= 8, true)
  assert.equal(bar.rect.x + bar.rect.width <= 272, true)
  assert.equal(bar.items.length, path.length)
  assert.deepEqual(bar.items.map((item) => item.nodeId), path.map((node) => node.id))
  assert.equal(bar.scroll.axis, 'x')
  assert.equal(bar.scroll.centered, true)
  assert.equal(bar.scroll.targetNodeId, 'leaf')
  assert.ok(bar.contentWidth > bar.rect.width)
  assert.ok(bar.scroll.maxOffset > 0)
  assert.ok(bar.items.every((item) => item.contentRect.x >= bar.rect.x))
  assert.ok(bar.items.some((item) => item.rect.x < bar.rect.x))
  assert.ok(bar.items.every((item) => item.rect.width >= 28))
  const leaf = bar.items.find((item) => item.nodeId === 'leaf')
  assert.ok(leaf)
  assert.ok(leaf.visibleRect)
  const leafCenter = leaf.rect.x + leaf.rect.width / 2
  const barCenter = bar.rect.x + bar.rect.width / 2
  assert.ok(Math.abs(leafCenter - barCenter) <= 1 || bar.scroll.offset === bar.scroll.maxOffset)
})

test('Selection Mode lineage bar hit testing ignores gaps and offscreen items', () => {
  const path = [
    candidate('display-root', { x: 0, y: 25, w: 280, h: 190 }, { kind: 'display', role: 'display', label: 'Display' }),
    candidate('app', { x: 10, y: 40, w: 250, h: 160 }, { kind: 'application', role: 'native_app', label: 'Example App With Long Name' }),
    candidate('window', { x: 16, y: 46, w: 238, h: 148 }, { kind: 'window', role: 'native_window', label: 'Window' }),
    candidate('canvas', { x: 20, y: 52, w: 226, h: 136 }, { kind: 'canvas_window', role: 'canvas', label: 'Canvas' }),
    ...Array.from({ length: 8 }, (_, index) => candidate(`container-${index}`, {
      x: 24 + index,
      y: 60 + index,
      w: 190 - index,
      h: 96 - index,
    }, { kind: 'group', role: 'container', label: `Container ${index + 1}` })),
    candidate('leaf', { x: 76, y: 96, w: 42, h: 22 }, { kind: 'button', role: 'button', label: 'Save' }),
  ]
  const overlay = buildProjectedSelectionModeOverlay({
    active: true,
    cursor: { x: 90, y: 105, valid: true },
    selected_node_id: 'leaf',
    context_session: {
      artifacts: [{
        path,
        active_target_node_id: 'leaf',
        acquisition: { leaf_node_id: 'leaf', pointer: { x: 90, y: 105, valid: true } },
      }],
    },
  }, {
    displays: [{ id: 'display-1', visibleBounds: { x: 0, y: 25, w: 280, h: 190 } }],
    projectPoint: (point) => point,
    overlayBounds: { x: 0, y: 0, w: 280, h: 240 },
  })

  const bar = overlay.lineageBar
  const visibleSeparator = bar.separators.find((separator) => separator.visibleRect)
  assert.ok(visibleSeparator)
  const gapPoint = {
    x: visibleSeparator.visibleRect.x + visibleSeparator.visibleRect.width / 2,
    y: visibleSeparator.visibleRect.y + visibleSeparator.visibleRect.height / 2,
  }
  assert.equal(hitTestSelectionModeLineageItem(overlay, gapPoint), null)
  assert.equal(hitTestSelectionModeLineageBar(overlay, gapPoint).kind, 'bar')

  const offscreenItem = bar.items.find((item) => !item.visibleRect)
  assert.ok(offscreenItem)
  const offscreenPoint = {
    x: offscreenItem.rect.x + offscreenItem.rect.width / 2,
    y: offscreenItem.rect.y + offscreenItem.rect.height / 2,
  }
  assert.equal(hitTestSelectionModeLineageItem(overlay, offscreenPoint), null)
  assert.equal(hitTestSelectionModeLineageBar(overlay, offscreenPoint), null)
})

test('Selection Mode lineage labels preserve useful VSCode nested tree names', () => {
  const path = [
    candidate('display-root', { x: 0, y: 25, w: 900, h: 675 }, { kind: 'display', role: 'display', label: 'Built-in Retina Display' }),
    candidate('vscode-app', { x: 40, y: 50, w: 820, h: 600 }, { kind: 'application', role: 'native_app', label: 'Visual Studio Code' }),
    candidate('vscode-window', { x: 60, y: 70, w: 780, h: 560 }, {
      kind: 'window',
      role: 'native_window',
      label: '/Users/Michael/Documents/GitHub/syborg/t - Visual Studio Code',
    }),
    candidate('split-primary-sidebar', { x: 60, y: 110, w: 260, h: 520 }, {
      kind: 'AXSplitGroup',
      role: 'AXSplitGroup',
      label: 'AXSplitGroup',
      source_metadata: { ax_description: 'Primary Side Bar' },
    }),
    candidate('explorer-outline', { x: 70, y: 160, w: 240, h: 410 }, {
      kind: 'AXOutline',
      role: 'AXOutline',
      label: 'AXOutline',
      source_metadata: { ax_title: 'Explorer' },
    }),
    candidate('src-row', { x: 76, y: 210, w: 224, h: 22 }, {
      kind: 'AXRow',
      role: 'AXRow',
      label: 'AXRow',
      source_metadata: { ax_title: 'src' },
    }),
    candidate('file-text', { x: 96, y: 238, w: 198, h: 18 }, {
      kind: 'AXStaticText',
      role: 'AXStaticText',
      label: 'selection-mode-runtime.js',
    }),
  ]
  const overlay = buildProjectedSelectionModeOverlay({
    active: true,
    cursor: { x: 120, y: 246, valid: true },
    selected_node_id: 'file-text',
    context_session: {
      artifacts: [{
        path,
        active_target_node_id: 'file-text',
        acquisition: { leaf_node_id: 'file-text', pointer: { x: 120, y: 246, valid: true } },
      }],
    },
  }, {
    displays: [{ id: 'display-1', visibleBounds: { x: 0, y: 25, w: 900, h: 675 } }],
    projectPoint: (point) => point,
    overlayBounds: { x: 0, y: 0, w: 900, h: 700 },
  })

  assert.deepEqual(
    overlay.lineageBar.items.map((item) => item.label),
    [
      'Built-in Retina Display',
      'Visual Studio Code',
      '/Users/Michael/Documents/GitHub/syborg/t - Visual Studio Code',
      'Primary Side Bar',
      'Explorer',
      'src',
      'selection-mode-runtime.js',
    ],
  )
  assert.deepEqual(
    overlay.lineageBar.items.map((item) => item.token),
    ['display', 'app', 'window', 'split', 'outline', 'row', 'text'],
  )
})

test('Selection Mode lineage token classification ignores ancestor ids in AX descendant addresses', () => {
  const path = [
    candidate('display-root', { x: 0, y: 25, w: 900, h: 675 }, { kind: 'display', role: 'display', label: 'Built-in Retina Display' }),
    candidate('native-window:112:Visual-Studio-Code', { x: 40, y: 50, w: 820, h: 600 }, {
      kind: 'window',
      role: 'native_window',
      label: 'Visual Studio Code',
    }),
    candidate('ax-element:native-window:112:AXImage:Image', { x: 120, y: 140, w: 420, h: 260 }, {
      kind: 'AXImage',
      role: 'AXImage',
      label: 'Image',
    }),
  ]
  const overlay = buildProjectedSelectionModeOverlay({
    active: true,
    cursor: { x: 240, y: 200, valid: true },
    selected_node_id: path.at(-1).id,
    context_session: {
      artifacts: [{
        path,
        active_target_node_id: path.at(-1).id,
        acquisition: { leaf_node_id: path.at(-1).id, pointer: { x: 240, y: 200, valid: true } },
      }],
    },
  }, {
    displays: [{ id: 'display-1', visibleBounds: { x: 0, y: 25, w: 900, h: 675 } }],
    projectPoint: (point) => point,
    overlayBounds: { x: 0, y: 0, w: 900, h: 700 },
  })

  const imageItem = overlay.lineageBar.items.find((item) => item.nodeId === path.at(-1).id)
  assert.ok(imageItem)
  assert.equal(imageItem.token, 'image')
  assert.equal(imageItem.label, 'Image')
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

test('Selection Mode acquisition keeps only the selected native-window branch', () => {
  const point = { x: 1000, y: 320, valid: true }
  const dockRoot = 'native-window:18376:Dock'
  const cometRoot = 'native-window:111:Comet'
  const settingsRoot = 'native-window:9628:System-Settings'
  const dockWindow = candidate('native-window:18376:Dock', { x: 0, y: 0, w: 1512, h: 982 }, {
    adapter_id: 'macos-ax',
    root_id: dockRoot,
    root_kind: 'native_window',
    kind: 'native_window',
    role: 'native_window',
    label: 'Dock',
    source_metadata: { window_id: '18376', pid: 772 },
  })
  const cometWindow = candidate('native-window:111:Comet', { x: 0, y: 158, w: 1512, h: 824 }, {
    adapter_id: 'macos-ax',
    root_id: cometRoot,
    root_kind: 'native_window',
    kind: 'native_window',
    role: 'native_window',
    label: 'Comet',
    source_metadata: { window_id: '111', pid: 87924 },
  })
  const settingsWindow = candidate('native-window:9628:System-Settings', { x: 883, y: 54, w: 723, h: 841 }, {
    adapter_id: 'macos-ax',
    root_id: settingsRoot,
    root_kind: 'native_window',
    kind: 'native_window',
    role: 'native_window',
    label: 'System Settings',
    source_metadata: { window_id: '9628', pid: 63461 },
  })
  const cometGroup = candidate('ax-element:comet:group', { x: 420, y: 288, w: 661, h: 214 }, {
    adapter_id: 'macos-ax',
    root_id: cometRoot,
    root_kind: 'native_window',
    kind: 'AXGroup',
    role: 'AXGroup',
    label: 'AXGroup',
    source_metadata: { window_id: '111', pid: 87924 },
    subject_path: ['native_window', cometRoot, 'ax_element', 'AXScrollArea', 'ax-element:comet:group'],
  })
  const customizeButton = candidate('ax-element:comet:customize-button', { x: 951, y: 300, w: 118, h: 32 }, {
    adapter_id: 'macos-ax',
    root_id: cometRoot,
    root_kind: 'native_window',
    kind: 'AXButton',
    role: 'AXButton',
    label: 'Customize notebook',
    source_metadata: { window_id: '111', pid: 87924 },
    subject_path: ['native_window', cometRoot, 'ax_element', 'AXScrollArea', 'ax-element:comet:customize-button'],
  })
  const customizeText = candidate('ax-element:comet:customize-text', { x: 992, y: 309, w: 60, h: 15 }, {
    adapter_id: 'macos-ax',
    root_id: cometRoot,
    root_kind: 'native_window',
    kind: 'AXStaticText',
    role: 'AXStaticText',
    label: 'Customize',
    source_metadata: { window_id: '111', pid: 87924 },
    subject_path: ['native_window', cometRoot, 'ax_element', 'OpenAI Agent Builder', 'ax-element:comet:customize-text'],
  })
  const { runtime, liveState } = createRuntime({
    candidates: [dockWindow, cometWindow, settingsWindow, cometGroup, customizeButton, customizeText],
    projectPoint: (p) => p,
  })

  runtime.enter(point, 'test')
  runtime.acquire(point)

  assert.deepEqual(
    liveState.selectionMode.path_candidates.map((item) => item.label),
    ['Display 1', 'Comet', 'AXGroup', 'Customize notebook', 'Customize'],
  )
  assert.equal(liveState.selectionMode.path_candidates.some((item) => item.label === 'Dock'), false)
  assert.equal(liveState.selectionMode.path_candidates.some((item) => item.label === 'System Settings'), false)
  assert.deepEqual(
    liveState.selectionMode.context_session.artifacts[0].path.map((node) => node.label),
    ['Display 1', 'Comet', 'AXGroup', 'Customize notebook', 'Customize'],
  )
})

test('Selection Mode browser lineage uses tab seam and drops generic AXGroup wrapper', () => {
  const point = { x: 1000, y: 320, valid: true }
  const cometRoot = 'native-window:111:Comet'
  const cometWindow = candidate('native-window:111:Comet', { x: 0, y: 88, w: 1512, h: 894 }, {
    adapter_id: 'macos-ax',
    root_id: cometRoot,
    root_kind: 'native_window',
    kind: 'native_window',
    role: 'native_window',
    label: 'Comet',
    source_metadata: { window_id: '111', pid: 87924 },
  })
  const browserTab = candidate('browser-tab:comet:notebooklm', { x: 0, y: 158, w: 1512, h: 824 }, {
    adapter_id: 'browser-content-seam',
    root_id: cometRoot,
    root_kind: 'native_window',
    kind: 'browser_tab',
    role: 'browser_tab',
    label: 'notebooklm',
    source_metadata: {
      window_id: '111',
      pid: 87924,
      active_url: 'https://notebooklm.google.com/notebook/example',
      source_url: 'https://notebooklm.google.com/notebook/example',
    },
    subject_path: ['native_window', cometRoot, 'browser_tab', 'browser-tab:comet:notebooklm'],
  })
  const cometGroup = candidate('ax-element:comet:group', { x: 420, y: 288, w: 661, h: 214 }, {
    adapter_id: 'macos-ax',
    root_id: cometRoot,
    root_kind: 'native_window',
    kind: 'AXGroup',
    role: 'AXGroup',
    label: 'AXGroup',
    source_metadata: { window_id: '111', pid: 87924 },
    subject_path: ['native_window', cometRoot, 'ax_element', 'AXScrollArea', 'ax-element:comet:group'],
  })
  const customizeButton = candidate('ax-element:comet:customize-button', { x: 951, y: 300, w: 118, h: 32 }, {
    adapter_id: 'macos-ax',
    root_id: cometRoot,
    root_kind: 'native_window',
    kind: 'AXButton',
    role: 'AXButton',
    label: 'Customize notebook',
    source_metadata: { window_id: '111', pid: 87924 },
    subject_path: ['native_window', cometRoot, 'ax_element', 'AXScrollArea', 'ax-element:comet:customize-button'],
  })
  const customizeText = candidate('ax-element:comet:customize-text', { x: 992, y: 309, w: 60, h: 15 }, {
    adapter_id: 'macos-ax',
    root_id: cometRoot,
    root_kind: 'native_window',
    kind: 'AXStaticText',
    role: 'AXStaticText',
    label: 'Customize',
    source_metadata: { window_id: '111', pid: 87924 },
    subject_path: ['native_window', cometRoot, 'ax_element', 'OpenAI Agent Builder', 'ax-element:comet:customize-text'],
  })
  const { runtime, liveState } = createRuntime({
    candidates: [cometWindow, browserTab, cometGroup, customizeButton, customizeText],
    projectPoint: (p) => p,
  })

  runtime.enter(point, 'test')
  runtime.acquire(point)

  assert.deepEqual(
    liveState.selectionMode.path_candidates.map((item) => item.label),
    ['Display 1', 'Comet', 'notebooklm', 'Customize notebook', 'Customize'],
  )
  assert.equal(liveState.selectionMode.path_candidates.some((item) => item.label === 'AXGroup'), false)
  const tabNode = liveState.selectionMode.path_candidates.find((item) => item.role === 'browser_tab')
  assert.equal(tabNode?.source_metadata?.active_url, 'https://notebooklm.google.com/notebook/example')
  assert.deepEqual(
    liveState.selectionMode.context_session.artifacts[0].path.map((node) => node.label),
    ['Display 1', 'Comet', 'notebooklm', 'Customize notebook', 'Customize'],
  )
})

test('Selection Mode lineage click retargets while preserving original acquisition evidence', () => {
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
  const ancestorItem = liveState.selectionModeOverlay.lineageBar.items.find((item) => (
    item.nodeId === acquiredArtifact.path[1].id
  ))
  assert.ok(ancestorItem)
  const originalItemRects = new Map(liveState.selectionModeOverlay.lineageBar.items.map((item) => [
    item.nodeId,
    structuredClone(item.rect),
  ]))
  runtime.handleInput({
    type: 'left_mouse_up',
    x: ancestorItem.rect.x + ancestorItem.rect.width / 2,
    y: ancestorItem.rect.y + ancestorItem.rect.height / 2,
  })

  assert.deepEqual(commands.map((entry) => entry.command), ['acquire', 'selectLineageNode'])
  const retargetedArtifact = liveState.selectionMode.context_session.artifacts[0]
  assert.equal(retargetedArtifact.active_target_node_id, ancestorItem.nodeId)
  assert.deepEqual(retargetedArtifact.acquisition.pointer, acquiredPointer)
  assert.equal(retargetedArtifact.acquisition.leaf_node_id, acquiredLeafNodeId)
  assert.deepEqual(retargetedArtifact.path.map((node) => node.id), acquiredPathNodeIds)
  assert.equal(retargetedArtifact.acquisition.candidate_report.clicked_leaf.node_id, acquiredLeafNodeId)
  assert.equal(liveState.selectionMode.selected_node_id, ancestorItem.nodeId)
  assert.equal(liveState.selectionMode.hover_node_id, '')
  assert.equal(liveState.selectionModeOverlay.highlightedNodeId, ancestorItem.nodeId)
  assert.equal(liveState.selectionModeOverlay.frames.find((frame) => frame.active)?.id, ancestorItem.nodeId)
  for (const item of liveState.selectionModeOverlay.lineageBar.items) {
    assert.deepEqual(item.rect, originalItemRects.get(item.nodeId))
  }
  assert.notDeepEqual(liveState.selectionMode.cursor, acquiredPointer)

  runtime.handleInput({
    type: 'mouse_moved',
    x: ancestorItem.rect.x + ancestorItem.rect.width / 2,
    y: ancestorItem.rect.y + ancestorItem.rect.height / 2,
  })
  assert.equal(liveState.selectionMode.hover_node_id, ancestorItem.nodeId)
  assert.equal(liveState.selectionModeOverlay.highlightedNodeId, ancestorItem.nodeId)
  assert.equal(liveState.selectionModeOverlay.frames.find((frame) => frame.active)?.id, ancestorItem.nodeId)

  runtime.handleInput({ type: 'mouse_moved', x: 1, y: 1 })
  assert.equal(liveState.selectionMode.selected_node_id, ancestorItem.nodeId)
  assert.equal(liveState.selectionMode.hover_node_id, '')
  assert.equal(liveState.selectionModeOverlay.highlightedNodeId, ancestorItem.nodeId)
  assert.equal(liveState.selectionModeOverlay.frames.find((frame) => frame.active)?.id, ancestorItem.nodeId)
})

test('Selection Mode lineage bar can target the display node', () => {
  const displayCandidate = candidate('display-root', { x: 0, y: 25, w: 800, h: 575 }, {
    kind: 'display',
    role: 'display',
    label: 'Display 1',
  })
  const windowCandidate = candidate('window', { x: 50, y: 50, w: 300, h: 220 }, {
    kind: 'window',
    role: 'native_window',
    label: 'Window',
  })
  const buttonCandidate = candidate('button', { x: 80, y: 90, w: 80, h: 32 }, {
    kind: 'button',
    role: 'button',
    label: 'Save',
  })
  const { runtime, liveState, commands } = createRuntime({
    candidates: [buttonCandidate, windowCandidate, displayCandidate],
    projectPoint: (point) => point,
  })

  runtime.enter({ x: 100, y: 100, valid: true }, 'test')
  runtime.handleInput({ type: 'left_mouse_up', x: 100, y: 100 })
  const displayItem = liveState.selectionModeOverlay.lineageBar.items.find((item) => item.token === 'display')
  assert.ok(displayItem)

  runtime.handleInput({
    type: 'left_mouse_up',
    x: displayItem.rect.x + displayItem.rect.width / 2,
    y: displayItem.rect.y + displayItem.rect.height / 2,
  })

  assert.deepEqual(commands.map((entry) => entry.command), ['acquire', 'selectLineageNode'])
  assert.equal(liveState.selectionMode.selected_node_id, displayItem.nodeId)
  assert.equal(liveState.selectionMode.context_session.artifacts[0].active_target_node_id, displayItem.nodeId)
  assert.equal(liveState.selectionModeOverlay.highlightedNodeId, displayItem.nodeId)
  assert.equal(liveState.selectionModeOverlay.frames.find((frame) => frame.active)?.id, displayItem.nodeId)
})

test('Selection Mode lineage hover telemetry clears accurately on bar gaps', () => {
  const windowCandidate = candidate('window', { x: 50, y: 50, w: 300, h: 220 }, {
    kind: 'window',
    role: 'native_window',
    label: 'Window',
  })
  const buttonCandidate = candidate('button', { x: 80, y: 90, w: 80, h: 32 }, {
    kind: 'button',
    role: 'button',
    label: 'Save',
  })
  const { runtime, liveState, commands } = createRuntime({
    candidates: [buttonCandidate, windowCandidate],
    projectPoint: (point) => point,
  })

  runtime.enter({ x: 100, y: 100, valid: true }, 'test')
  runtime.handleInput({ type: 'left_mouse_up', x: 100, y: 100 })
  const bar = liveState.selectionModeOverlay.lineageBar
  const windowItem = bar.items.find((item) => item.label === 'Window' || item.nodeId.includes('window'))
  const separator = bar.separators.find((item) => item.visibleRect)
  assert.ok(windowItem)
  assert.ok(separator)

  runtime.handleInput({
    type: 'mouse_moved',
    x: windowItem.rect.x + windowItem.rect.width / 2,
    y: windowItem.rect.y + windowItem.rect.height / 2,
  })
  assert.equal(liveState.selectionMode.hover_node_id, windowItem.nodeId)
  assert.equal(liveState.selectionModeOverlay.highlightedNodeId, windowItem.nodeId)

  runtime.handleInput({
    type: 'mouse_moved',
    x: separator.visibleRect.x + separator.visibleRect.width / 2,
    y: separator.visibleRect.y + separator.visibleRect.height / 2,
  })
  assert.equal(liveState.selectionMode.hover_node_id, '')
  assert.equal(liveState.selectionModeOverlay.highlightedNodeId, liveState.selectionMode.selected_node_id)
  assert.deepEqual(commands.map((entry) => entry.command), ['acquire'])
  const hoverEvents = liveState.selectionMode.events.filter((event) => event.type === 'lineage_hover')
  assert.equal(hoverEvents.at(-2).node_id, windowItem.nodeId)
  assert.equal(hoverEvents.at(-1).node_id, '')
  assert.equal(hoverEvents.at(-1).hit_kind, 'bar')
})

test('Selection Mode lineage bar wheel scrolls long chains and records telemetry', () => {
  const candidates = [
    candidate('display-root', { x: 0, y: 25, w: 280, h: 190 }, { kind: 'display', role: 'display', label: 'Display' }),
    candidate('app', { x: 10, y: 40, w: 250, h: 160 }, { kind: 'application', role: 'native_app', label: 'Example App With Long Name' }),
    candidate('window', { x: 16, y: 46, w: 238, h: 148 }, { kind: 'window', role: 'native_window', label: 'Window' }),
    candidate('canvas', { x: 20, y: 52, w: 226, h: 136 }, { kind: 'canvas_window', role: 'canvas', label: 'Canvas' }),
    ...Array.from({ length: 8 }, (_, index) => candidate(`container-${index}`, {
      x: 24 + index,
      y: 60 + index,
      w: 190 - index,
      h: 96 - index,
    }, { kind: 'group', role: 'container', label: `Container ${index + 1}` })),
    candidate('leaf', { x: 76, y: 96, w: 42, h: 22 }, { kind: 'button', role: 'button', label: 'Save' }),
  ]
  const { runtime, liveState, scheduled } = createRuntime({
    candidates,
    projectPoint: (point) => point,
    overlayBounds: { x: 0, y: 0, w: 280, h: 240 },
  })

  runtime.enter({ x: 90, y: 105, valid: true }, 'test')
  runtime.acquire({ x: 90, y: 105, valid: true })
  const priorBar = liveState.selectionModeOverlay.lineageBar
  assert.ok(priorBar.scroll.offset > 0)
  assert.ok(priorBar.scroll.maxOffset > 0)

  assert.equal(runtime.handleInput({
    type: 'scroll_wheel',
    x: priorBar.rect.x + priorBar.rect.width / 2,
    y: priorBar.rect.y + priorBar.rect.height / 2,
    dy: -64,
  }), true)

  const nextBar = liveState.selectionModeOverlay.lineageBar
  assert.ok(nextBar.scroll.offset < priorBar.scroll.offset)
  assert.equal(nextBar.scroll.centered, false)
  assert.equal(liveState.selectionMode.lineage_bar_scroll_target_node_id, '')
  assert.ok(scheduled.some((entry) => entry.structural === false))
  const event = liveState.selectionMode.events.findLast((entry) => entry.type === 'lineage_scroll')
  assert.equal(event.reason, 'wheel')
  assert.equal(event.delta, -64)
  assert.equal(event.offset, nextBar.scroll.offset)
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
  assert.equal(overlay.cursorGlyph.animation.axis, 'local_y')
  assert.equal(overlay.cursorGlyph.animation.rotation_speed, 0.1)
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
  assert.equal(liveState.selectionModeOverlay.visualEffects[0].duration_ms, 380)
  assert.equal(liveState.selectionModeOverlay.visualEffects[0].profile.source, 'celestial-v1-supernova-release')
  assert.equal(liveState.selectionModeOverlay.visualEffects[0].profile.shockwave_ms, 200)
  assert.deepEqual(liveState.selectionModeOverlay.visualEffects[0].profile.particle_families, [
    'white_release_sparks',
    'edge_color_friction_sparks',
    'white_dwarf_core',
  ])

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
  assert.equal(liveState.selectionModeOverlay.visualEffects.at(-1).duration_ms, 340)
  assert.equal(liveState.selectionModeOverlay.visualEffects.at(-1).profile.source, 'celestial-v1-supernova-release')
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

test('Selection Mode effects reproject desktop-world anchors for each surface segment', () => {
  const overlay = buildProjectedSelectionModeOverlay({
    active: false,
    cursor: { x: 1271, y: 1736, valid: true },
    effects: [{
      phase: 'exit',
      effect: 'reverse_supernova',
      reason: 'secondary-display-exit',
      at: '2026-05-30T12:00:00.000Z',
      started_at_ms: 500000,
      duration_ms: 340,
      anchor: { x: 1271, y: 1736, valid: true },
      bounded: true,
    }],
  }, {
    nowMs: 500080,
    overlayBounds: { x: 0, y: 0, w: 1920, h: 1080 },
    projectPoint: (point) => ({ x: point.x, y: point.y - 982, valid: point.valid }),
  })

  assert.equal(overlay.visible, true)
  assert.equal(overlay.active, false)
  assert.equal(overlay.visualEffects[0].active, true)
  assert.equal(overlay.visualEffects[0].effect, 'reverse_supernova')
  assert.equal(overlay.visualEffects[0].anchor.x, 1271)
  assert.equal(overlay.visualEffects[0].anchor.y, 754)
  assert.equal(overlay.visualEffects[0].profile.source, 'celestial-v1-supernova-release')
})

test('Selection Mode overlay lineage bar, frame, and effect styles derive from avatar colors', () => {
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
  assert.equal(overlay.styles.effect.primary, 'rgba(171, 205, 239, 0.96)')
  assert.equal(overlay.frames.find((frame) => frame.active).style.stroke, 'rgba(18, 52, 86, 0.58)')
  assert.equal(overlay.lineageBar.items.find((item) => item.selected).nodeId, 'leaf')
  assert.equal(overlay.lineageBar.style.selected.stroke, 'rgba(171, 205, 239, 0.96)')
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
