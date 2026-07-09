import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Sigil utility canvas lifecycle delegates to utility runtime and toolkit manager', async () => {
  const main = await readFile(new URL('../../apps/sigil/renderer/live-modules/main.js', import.meta.url), 'utf8')
  const runtime = await readFile(new URL('../../apps/sigil/renderer/live-modules/utility-canvas-runtime.js', import.meta.url), 'utf8')

  assert.match(main, /createSigilUtilityCanvasRuntime/)
  assert.match(main, /utilityRuntime\.handleCanvasLifecycle\(msg\)/)
  assert.doesNotMatch(main, /utilityCanvasOpenPromises\.set/)
  assert.doesNotMatch(main, /function animateUtilityCanvasFrame/)
  assert.match(runtime, /createUtilitySurfaceManager/)
  assert.match(runtime, /collapseAgentTerminalToStatus/)
})
