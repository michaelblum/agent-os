import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildProjectedSelectionModeOverlay,
  createSigilSelectionModeRuntime,
} from '../../apps/sigil/renderer/live-modules/selection-mode-runtime.js'

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
  const rendererState = {}
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
    getPointer: () => ({ x: 40, y: 40, valid: true }),
    getDisplays: () => [display],
    getCandidateList: () => options.candidates || [],
    projectPoint: options.projectPoint || ((point) => ({ x: point.x + 1, y: point.y + 2, valid: point.valid })),
    getOverlayBounds: () => options.overlayBounds || { x: 0, y: 0, w: 800, h: 600 },
    closeContextMenu: () => { closedContextMenu += 1 },
    exitAnnotationReticle: () => { exitedReticle += 1 },
    clearGestureState: () => { clearedGesture += 1 },
    syncInputRegions: () => { syncedRegions += 1 },
    scheduleRenderFrame: () => { scheduled.push('frame') },
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
  assert.equal(liveState.selectionModeOverlay.cursorGlyph.shape, 'bespoke_arrow_outline')
  assert.equal(liveState.selectionModeOverlay.cursorTrail.repeatShape, 'bespoke_arrow_outline')
  assert.equal(liveState.selectionModeOverlay.badgeLayout.order, 'leaf-to-root')
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
  assert.equal(grouped.fanoutDirection, 'right')
  const primary = overlay.badges.find((badge) => badge.id === grouped.primaryId)
  const secondary = overlay.badges.find((badge) => badge.id === grouped.secondaryIds[0])
  assert.equal(secondary.kind, 'secondary')
  assert.ok(secondary.rect.x > primary.rect.x)
  assert.ok(overlay.badges.some((badge) => badge.token === 'display'))
  assert.ok(overlay.badges.some((badge) => badge.token === 'app'))
})

test('Selection Mode badge click selects an existing ancestor without reacquiring', () => {
  const windowCandidate = candidate('window', { x: 50, y: 50, w: 300, h: 220 }, { kind: 'window', role: 'native_window', label: 'Window' })
  const buttonCandidate = candidate('button', { x: 80, y: 90, w: 80, h: 32 }, { kind: 'button', role: 'button', label: 'Save' })
  const { runtime, liveState, commands } = createRuntime({
    candidates: [buttonCandidate, windowCandidate],
    projectPoint: (point) => point,
  })

  runtime.enter({ x: 100, y: 100, valid: true }, 'test')
  runtime.handleInput({ type: 'left_mouse_up', x: 100, y: 100 })
  const ancestorBadge = liveState.selectionModeOverlay.badges.find((badge) => (
    badge.nodeId === liveState.selectionMode.context_session.artifacts[0].path[1].id
  ))
  assert.ok(ancestorBadge)
  runtime.handleInput({
    type: 'left_mouse_up',
    x: ancestorBadge.rect.x + ancestorBadge.rect.width / 2,
    y: ancestorBadge.rect.y + ancestorBadge.rect.height / 2,
  })

  assert.deepEqual(commands.map((entry) => entry.command), ['acquire', 'selectBadge'])
  assert.equal(liveState.selectionMode.context_session.artifacts[0].active_target_node_id, ancestorBadge.nodeId)
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
