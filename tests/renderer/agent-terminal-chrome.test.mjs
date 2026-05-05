import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const html = readFileSync(new URL('../../apps/sigil/codex-terminal/index.html', import.meta.url), 'utf8')

test('Agent Terminal opts into toolkit panel chrome', () => {
  assert.match(html, /import \{ toolkitSpecifier, toolkitUrl \}/)
  assert.match(html, /await import\(toolkitSpecifier\('panel\/index\.js'/)
  assert.match(html, /createFixedSidebarPane/)
  assert.match(html, /mountChrome\(document\.body/)
  assert.match(html, /draggable:\s*true/)
  assert.match(html, /minimize:\s*true/)
  assert.match(html, /maximize:\s*true/)
  assert.match(html, /resizable:\s*true/)
  assert.match(html, /drag:\s*\{\s*clampOnEnd:\s*true,\s*transfer:\s*true\s*\}/)
})

test('Agent Terminal no longer owns private drag or close controls', () => {
  assert.doesNotMatch(html, /id="dragHandle"/)
  assert.doesNotMatch(html, /id="minimizeTerminal"/)
  assert.doesNotMatch(html, /id="closeTerminal"/)
  assert.doesNotMatch(html, /type:\s*'move_abs'/)
  assert.doesNotMatch(html, /addEventListener\('mousemove'/)
  assert.doesNotMatch(html, /addEventListener\('mouseup'/)
})

test('Agent Terminal sessions rail uses toolkit fixed sidebar behavior', () => {
  assert.match(html, /createFixedSidebarPane\(\{/)
  assert.match(html, /class="rail aos-sidebar-rail"/)
  assert.match(html, /class="rail-top aos-sidebar-rail-top"/)
  assert.match(html, /class="rail-title aos-sidebar-rail-title"/)
  assert.match(html, /class="rail-toggle aos-sidebar-rail-toggle"/)
  assert.match(html, /class="rail-content aos-sidebar-rail-content"/)
  assert.match(html, /root:\s*content/)
  assert.match(html, /mainPane:\s*terminalPane/)
  assert.match(html, /sidebarPane:\s*railPane/)
  assert.match(html, /toggleButton:\s*railToggle/)
  assert.match(html, /openSize:\s*340/)
  assert.match(html, /closedSize:\s*42/)
  assert.doesNotMatch(html, /classList\.toggle\('rail-collapsed'\)/)
  assert.doesNotMatch(html, /shell\.rail-collapsed/)
})

test('Agent Terminal keeps avatar-toggle minimize behavior as a toolkit override', () => {
  assert.match(html, /onMinimize\(\)/)
  assert.match(html, /emit\(\{\s*type:\s*'agent_terminal\.avatar_toggle'\s*\}\)/)
})

test('Agent Terminal preserves toolkit bridge handlers when adding app messages', () => {
  assert.match(html, /const previousHeadsupReceive = window\.headsup\.receive/)
  assert.match(html, /previousHeadsupReceive\?\.\(b64\)/)
})
