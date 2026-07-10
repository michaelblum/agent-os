import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Sigil host runtime is a thin toolkit compatibility wrapper', async () => {
  const source = await readFile(new URL('../../apps/sigil/renderer/live-modules/host-runtime.js', import.meta.url), 'utf8')

  assert.match(source, /createCanvasHostRuntime/)
  assert.match(source, /requestIdPrefix: 'sigil'/)
  assert.match(source, /loggerLabel: 'sigil'/)
  assert.doesNotMatch(source, /const pending = new Map/)
  assert.doesNotMatch(source, /function resolvePending/)
})
