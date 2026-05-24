import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const toolkitHtml = readFileSync(new URL('../../packages/toolkit/components/agent-terminal/index.html', import.meta.url), 'utf8')
const toolkitLauncher = readFileSync(new URL('../../packages/toolkit/components/agent-terminal/launch.sh', import.meta.url), 'utf8')
const sigilAgentEntrypoint = readFileSync(new URL('../../apps/sigil/agent-terminal/index.html', import.meta.url), 'utf8')
const sigilCompatEntrypoint = readFileSync(new URL('../../apps/sigil/codex-terminal/index.html', import.meta.url), 'utf8')
const html = toolkitHtml

test('Agent Terminal opts into toolkit panel chrome', () => {
  assert.match(html, /await import\('\.\.\/\.\.\/panel\/index\.js'\)/)
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
  assert.match(toolkitHtml, /<title>Agent Terminal<\/title>/)
  assert.match(toolkitHtml, /const surfaceMode = params\.get\('surface'\) === 'sigil' \? 'sigil' : 'generic'/)
  assert.doesNotMatch(toolkitHtml, /location\.replace\(`aos:\/\/\$\{sigilRoot\}\/codex-terminal\/index\.html/)
  assert.doesNotMatch(toolkitHtml, /location\.replace\([^)]*aos:\/\/sigil/)
  assert.doesNotMatch(toolkitHtml, /Sigil Agent terminal launched/)
  assert.match(toolkitHtml, /const surfaceTitle = isSigilSurface \? 'Sigil \/ Agent Terminal' : 'AOS Agent Terminal'/)
  assert.match(toolkitHtml, /emits: isSigilSurface \? \['ready', 'agent_terminal\.avatar_toggle'\] : \['ready'\]/)
  assert.doesNotMatch(toolkitHtml, /avatar-main/)
})

test('generic toolkit launcher does not create or require avatar-main', () => {
  assert.match(toolkitLauncher, /AOS Agent Terminal launched\./)
  assert.match(toolkitLauncher, /components\/agent-terminal\/index\.html/)
  assert.match(toolkitLauncher, /surface=generic/)
  assert.doesNotMatch(toolkitLauncher, /AVATAR_ID/)
  assert.doesNotMatch(toolkitLauncher, /avatar-main/)
  assert.doesNotMatch(toolkitLauncher, /renderer\/index\.html/)
  assert.doesNotMatch(toolkitLauncher, /Sigil Agent terminal launched/)
  assert.doesNotMatch(toolkitLauncher, /sigil-root/)
  assert.doesNotMatch(toolkitLauncher, /SIGIL_CONTENT_ROOT/)
})

test('shared terminal page gates Sigil-only avatar controls behind surface mode', () => {
  assert.match(html, /const surfaceMode = params\.get\('surface'\) === 'sigil' \? 'sigil' : 'generic'/)
  assert.match(html, /const isSigilSurface = surfaceMode === 'sigil'/)
  assert.match(html, /const surfaceTitle = isSigilSurface \? 'Sigil \/ Agent Terminal' : 'AOS Agent Terminal'/)
  assert.match(html, /if \(isSigilSurface\) \{/)
  assert.match(html, /emits: isSigilSurface \? \['ready', 'agent_terminal\.avatar_toggle'\] : \['ready'\]/)
})

test('existing Sigil compatibility entrypoints still resolve to toolkit Agent Terminal', () => {
  assert.match(sigilAgentEntrypoint, /<title>Sigil Agent Terminal<\/title>/)
  assert.match(sigilAgentEntrypoint, /params\.set\('surface', 'sigil'\)/)
  assert.match(sigilAgentEntrypoint, /components\/agent-terminal\/index\.html/)
  assert.match(sigilCompatEntrypoint, /params\.set\('surface', 'sigil'\)/)
  assert.match(sigilCompatEntrypoint, /components\/agent-terminal\/index\.html/)
})
