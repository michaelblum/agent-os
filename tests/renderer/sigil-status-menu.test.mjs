import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  SIGIL_STATUS_MENU_IDS,
  buildSigilStatusMenuItems,
  normalizeStatusMenuActionId,
  routeSigilStatusMenuAction,
} from '../../apps/sigil/renderer/live-modules/status-menu.js'

test('Sigil status menu composes operator, voice, utility, lifecycle, and quit items', () => {
  const items = buildSigilStatusMenuItems({
    operatorAnnotationItems: [{ id: 'aos.operator_annotation.start', title: 'Annotate' }],
    voiceResponseItems: [{ id: 'sigil.voice.response.backend.system-sound', title: 'Voice Response: System Sound', checked: true }],
    isUtilityCanvasVisible: (id) => id === '__log__' || id === 'surface-inspector',
    annotationReticleActive: true,
  })

  assert.deepEqual(items.map((item) => item.id || item.type), [
    'aos.operator_annotation.start',
    'separator',
    'sigil.voice.response.backend.system-sound',
    'separator',
    SIGIL_STATUS_MENU_IDS.CONSOLE,
    SIGIL_STATUS_MENU_IDS.SURFACE_INSPECTOR,
    SIGIL_STATUS_MENU_IDS.ANNOTATION_MODE,
    'separator',
    SIGIL_STATUS_MENU_IDS.RELOAD,
    SIGIL_STATUS_MENU_IDS.REMOVE,
    'separator',
    SIGIL_STATUS_MENU_IDS.QUIT,
  ])
  assert.equal(items.find((item) => item.id === SIGIL_STATUS_MENU_IDS.CONSOLE).checked, true)
  assert.equal(items.find((item) => item.id === SIGIL_STATUS_MENU_IDS.ANNOTATION_MODE).checked, true)
  assert.equal(items.find((item) => item.id === SIGIL_STATUS_MENU_IDS.RELOAD).key_equivalent, 'r')
})

test('Sigil status menu normalizes action ids from menu messages', () => {
  assert.equal(normalizeStatusMenuActionId(' sigil.status.console '), SIGIL_STATUS_MENU_IDS.CONSOLE)
  assert.equal(normalizeStatusMenuActionId({ action_id: SIGIL_STATUS_MENU_IDS.RELOAD }), SIGIL_STATUS_MENU_IDS.RELOAD)
  assert.equal(normalizeStatusMenuActionId({ id: SIGIL_STATUS_MENU_IDS.QUIT }), SIGIL_STATUS_MENU_IDS.QUIT)
  assert.equal(normalizeStatusMenuActionId({}), '')
})

test('Sigil status menu routes fixed actions through injected handlers', async () => {
  const calls = []
  const handlers = {
    onConsole: () => calls.push('console'),
    onSurfaceInspector: () => calls.push('surface_inspector'),
    onAnnotationMode: () => calls.push('annotation_mode'),
    onReload: () => calls.push('reload'),
    onRemove: () => calls.push('remove'),
    onQuit: () => calls.push('quit'),
  }

  assert.deepEqual(await routeSigilStatusMenuAction(SIGIL_STATUS_MENU_IDS.CONSOLE, handlers), {
    handled: true,
    id: SIGIL_STATUS_MENU_IDS.CONSOLE,
    action: 'console',
  })
  await routeSigilStatusMenuAction(SIGIL_STATUS_MENU_IDS.SURFACE_INSPECTOR, handlers)
  await routeSigilStatusMenuAction(SIGIL_STATUS_MENU_IDS.ANNOTATION_MODE, handlers)
  await routeSigilStatusMenuAction(SIGIL_STATUS_MENU_IDS.RELOAD, handlers)
  await routeSigilStatusMenuAction(SIGIL_STATUS_MENU_IDS.REMOVE, handlers)
  await routeSigilStatusMenuAction(SIGIL_STATUS_MENU_IDS.QUIT, handlers)

  assert.deepEqual(calls, ['console', 'surface_inspector', 'annotation_mode', 'reload', 'remove', 'quit'])
  assert.deepEqual(await routeSigilStatusMenuAction('sigil.status.unknown', handlers), {
    handled: false,
    id: 'sigil.status.unknown',
    action: null,
  })
})

test('Sigil main delegates status menu shape and fixed routing to status-menu module', async () => {
  const source = await readFile(new URL('../../apps/sigil/renderer/live-modules/main.js', import.meta.url), 'utf8')

  assert.match(source, /buildSigilStatusMenuItems/)
  assert.match(source, /routeSigilStatusMenuAction/)
  assert.match(source, /normalizeStatusMenuActionId/)
  assert.doesNotMatch(source, /id: 'sigil\.status\.console'/)
  assert.doesNotMatch(source, /if \(id === 'sigil\.status\.reload'\)/)
})
