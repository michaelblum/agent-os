import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
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
  const runtime = createSigilSelectionModeRuntime({
    liveState,
    rendererState,
    nowIso: () => `2026-05-28T12:00:0${nowIndex++}.000Z`,
    getPointer: () => ({ x: 40, y: 40, valid: true }),
    getDisplays: () => [display],
    getCandidateList: () => options.candidates || [],
    projectPoint: (point) => ({ x: point.x + 1, y: point.y + 2, valid: point.valid }),
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
      commandOptions.fallback?.()
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
