import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  AGENT_TERMINAL_CANVAS_ID,
  LEGACY_CODEX_TERMINAL_CANVAS_ID,
  RENDER_PERFORMANCE_CANVAS_ID,
  WIKI_WORKBENCH_CANVAS_ID,
  WIKI_WORKBENCH_DEFAULT_PATH,
  createSigilUtilityCanvasIdSet,
  mainDisplayVisibleBounds,
  sigilAgentTerminalUrl,
  utilityConfig,
  utilityFrame,
  wikiWorkbenchDefaultUrl,
} from '../../apps/sigil/renderer/live-modules/utility-canvas-config.js'

test('Sigil utility config chooses the main display visible bounds', () => {
  assert.deepEqual(
    mainDisplayVisibleBounds({
      visibleBounds: { x: 0, y: 0, w: 100, h: 100 },
      displays: [
        { index: 1, visibleBounds: { x: 500, y: 0, w: 900, h: 700 } },
        { is_main: true, visible_bounds: { x: 10, y: 20, w: 1440, h: 900 } },
      ],
    }),
    { x: 10, y: 20, w: 1440, h: 900 },
  )
  assert.deepEqual(
    mainDisplayVisibleBounds({ visibleBounds: { x: 1, y: 2, w: 3, h: 4 }, displays: [] }),
    { x: 1, y: 2, w: 3, h: 4 },
  )
})

test('Sigil utility frames are deterministic for display bounds', () => {
  const bounds = { x: 100, y: 50, w: 1600, h: 1000 }

  assert.deepEqual(utilityFrame('log-console', { visibleBounds: bounds }), [120, 710, 512, 320])
  assert.deepEqual(utilityFrame('wiki-workbench', { visibleBounds: bounds }), [324, 98, 1152, 740])
  assert.deepEqual(utilityFrame('agent-terminal', { visibleBounds: bounds }), [1059, 442, 613, 580])
  assert.deepEqual(utilityFrame('unknown', { visibleBounds: bounds }), [1320, 70, 360, 520])
})

test('Sigil utility configs resolve stable canvas ids and scoped content URLs', () => {
  const loc = new URL('http://127.0.0.1:54526/sigil_branch/renderer/index.html')
  const options = { loc, visibleBounds: { x: 0, y: 0, w: 1200, h: 800 } }

  assert.deepEqual(utilityConfig('log-console', options), {
    id: '__log__',
    url: 'aos://toolkit_branch/components/log-console/index.html',
    frame: [20, 520, 420, 260],
  })
  assert.equal(utilityConfig('render-performance', options).id, RENDER_PERFORMANCE_CANVAS_ID)
  assert.equal(utilityConfig('wiki-workbench', options).id, WIKI_WORKBENCH_CANVAS_ID)
  assert.equal(
    utilityConfig('wiki-workbench', options).url,
    `aos://toolkit_branch/components/wiki-subject-browser/index.html?wiki=${encodeURIComponent(WIKI_WORKBENCH_DEFAULT_PATH)}&transition=fade-in`,
  )
  assert.deepEqual(utilityConfig('codex-terminal', options), {
    id: AGENT_TERMINAL_CANVAS_ID,
    url: 'aos://sigil_branch/agent-terminal/index.html?port=17761&session=sigil-agent-terminal-agent-os',
    frame: [692, 292, 480, 480],
  })
})

test('Sigil utility URL helpers preserve scoped content roots', () => {
  const loc = new URL('http://127.0.0.1:54526/sigil_codex_example/renderer/index.html')

  assert.equal(
    wikiWorkbenchDefaultUrl({ loc }),
    `aos://toolkit_codex_example/components/wiki-subject-browser/index.html?wiki=${encodeURIComponent(WIKI_WORKBENCH_DEFAULT_PATH)}&transition=fade-in`,
  )
  assert.equal(
    sigilAgentTerminalUrl({ loc }),
    'aos://sigil_codex_example/agent-terminal/index.html?port=17761&session=sigil-agent-terminal-agent-os',
  )
})

test('Sigil utility id set includes known utility canvases plus caller-owned extras', () => {
  const ids = createSigilUtilityCanvasIdSet(['sigil-avatar-controls-avatar-main'])

  assert.equal(ids.has('__log__'), true)
  assert.equal(ids.has(AGENT_TERMINAL_CANVAS_ID), true)
  assert.equal(ids.has(LEGACY_CODEX_TERMINAL_CANVAS_ID), true)
  assert.equal(ids.has(WIKI_WORKBENCH_CANVAS_ID), true)
  assert.equal(ids.has('sigil-avatar-controls-avatar-main'), true)
})

test('Sigil main delegates utility canvas config out of the monolith', async () => {
  const source = await readFile(new URL('../../apps/sigil/renderer/live-modules/main.js', import.meta.url), 'utf8')

  assert.match(source, /utilityConfig as createUtilityConfig/)
  assert.match(source, /createSigilUtilityCanvasIdSet/)
  assert.doesNotMatch(source, /function mainDisplayVisibleBounds/)
  assert.doesNotMatch(source, /function utilityFrame/)
})
