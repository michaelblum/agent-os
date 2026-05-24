import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const html = readFileSync(new URL('../../apps/sigil/codex-terminal/index.html', import.meta.url), 'utf8')
const toolkitHtml = readFileSync(new URL('../../packages/toolkit/components/agent-terminal/index.html', import.meta.url), 'utf8')
const toolkitLauncher = readFileSync(new URL('../../packages/toolkit/components/agent-terminal/launch.sh', import.meta.url), 'utf8')
const sigilAgentEntrypoint = readFileSync(new URL('../../apps/sigil/agent-terminal/index.html', import.meta.url), 'utf8')

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

test('Sigil Agent Terminal keeps avatar-toggle minimize behavior as a Sigil override', () => {
  assert.match(html, /onMinimize:\s*isSigilSurface \? function onMinimize\(\)/)
  assert.match(html, /emit\(\{\s*type:\s*'agent_terminal\.avatar_toggle'\s*\}\)/)
})

test('Agent Terminal preserves toolkit bridge handlers when adding app messages', () => {
  assert.match(html, /const previousHeadsupReceive = window\.headsup\.receive/)
  assert.match(html, /previousHeadsupReceive\?\.\(b64\)/)
})

test('toolkit Agent Terminal entrypoint is generic and neutral', () => {
  assert.match(toolkitHtml, /<title>AOS Agent Terminal<\/title>/)
  assert.match(toolkitHtml, /params\.set\('surface', 'generic'\)/)
  assert.doesNotMatch(toolkitHtml, /Sigil \/ Agent Terminal/)
  assert.doesNotMatch(toolkitHtml, /Sigil Agent terminal launched/)
  assert.doesNotMatch(toolkitHtml, /agent_terminal\.avatar_toggle/)
  assert.doesNotMatch(toolkitHtml, /avatar-main/)
})

test('generic toolkit launcher does not create or require avatar-main', () => {
  assert.match(toolkitLauncher, /AOS Agent Terminal launched\./)
  assert.match(toolkitLauncher, /components\/agent-terminal\/index\.html/)
  assert.doesNotMatch(toolkitLauncher, /AVATAR_ID/)
  assert.doesNotMatch(toolkitLauncher, /avatar-main/)
  assert.doesNotMatch(toolkitLauncher, /renderer\/index\.html/)
  assert.doesNotMatch(toolkitLauncher, /Sigil Agent terminal launched/)
})

test('shared terminal page gates Sigil-only avatar controls behind surface mode', () => {
  assert.match(html, /const surfaceMode = params\.get\('surface'\) === 'generic' \? 'generic' : 'sigil'/)
  assert.match(html, /const isSigilSurface = surfaceMode === 'sigil'/)
  assert.match(html, /const surfaceTitle = isSigilSurface \? 'Sigil \/ Agent Terminal' : 'AOS Agent Terminal'/)
  assert.match(html, /if \(isSigilSurface\) \{/)
  assert.match(html, /emits: isSigilSurface \? \['ready', 'agent_terminal\.avatar_toggle'\] : \['ready'\]/)
})

test('existing Sigil compatibility entrypoint still resolves to the bridge page', () => {
  assert.match(sigilAgentEntrypoint, /<title>Sigil Agent Terminal<\/title>/)
  assert.match(sigilAgentEntrypoint, /location\.replace\(`\.\.\/codex-terminal\/index\.html/)
})
