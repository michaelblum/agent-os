import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const html = readFileSync(new URL('../../apps/sigil/codex-terminal/index.html', import.meta.url), 'utf8')

test('Agent Terminal exposes direct window controls', () => {
  assert.match(html, /id="minimizeTerminal"/)
  assert.match(html, /aria-label="Minimize terminal to avatar"/)
  assert.match(html, /id="closeTerminal"/)
  assert.match(html, /aria-label="Close agent terminal"/)
  assert.match(html, /class="window-controls"/)
})

test('Agent Terminal close button uses the daemon close protocol', () => {
  assert.match(html, /getElementById\('closeTerminal'\)\.addEventListener\('click'/)
  assert.match(html, /emit\(\{\s*type:\s*'close'\s*\}\)/)
})

test('Agent Terminal minimize button reuses the avatar toggle path', () => {
  assert.match(html, /getElementById\('minimizeTerminal'\)\.addEventListener\('click'/)
  assert.match(html, /emit\(\{\s*type:\s*'agent_terminal\.avatar_toggle'\s*\}\)/)
})
