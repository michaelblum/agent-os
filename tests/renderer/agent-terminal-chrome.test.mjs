import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const toolkitComponentDir = new URL('../../packages/toolkit/components/agent-terminal/', import.meta.url)
const toolkitHtml = readFileSync(new URL('index.html', toolkitComponentDir), 'utf8')
const toolkitLauncher = readFileSync(new URL('launch.sh', toolkitComponentDir), 'utf8')
const toolkitBridgeServer = readFileSync(new URL('bridge-server.mjs', toolkitComponentDir), 'utf8')
const toolkitInspectorServer = readFileSync(new URL('session-inspector-server.mjs', toolkitComponentDir), 'utf8')
const sigilAgentLauncher = readFileSync(new URL('../../apps/sigil/agent-terminal/launch.sh', import.meta.url), 'utf8')
const sigilCompatLauncher = readFileSync(new URL('../../apps/sigil/codex-terminal/launch.sh', import.meta.url), 'utf8')
const sigilAgentEntrypoint = readFileSync(new URL('../../apps/sigil/agent-terminal/index.html', import.meta.url), 'utf8')
const sigilCompatEntrypoint = readFileSync(new URL('../../apps/sigil/codex-terminal/index.html', import.meta.url), 'utf8')
const sigilCompatServer = readFileSync(new URL('../../apps/sigil/codex-terminal/server.mjs', import.meta.url), 'utf8')
const sigilCompatInspector = readFileSync(new URL('../../apps/sigil/codex-terminal/session-inspector.mjs', import.meta.url), 'utf8')
const html = toolkitHtml

function functionBody(source, functionName) {
  const start = source.indexOf(`function ${functionName}(`)
  assert.notEqual(start, -1)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(open + 1, index)
  }
  assert.fail(`Unable to find function body for ${functionName}`)
}

function relativeAssetPathsFromHtml(source) {
  const paths = []
  for (const match of source.matchAll(/(?:href|src)="(\.\/node_modules\/@xterm\/[^"]+)"/g)) {
    paths.push(match[1])
  }
  return paths
}

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
  assert.match(html, /await import\('\.\/bridge-client\.js'\)/)
  assert.match(html, /createAgentTerminalBridgeClient\(\{ port \}\)/)
  assert.match(html, /const previousHeadsupReceive = window\.headsup\.receive/)
  assert.match(html, /previousHeadsupReceive\?\.\(b64\)/)
})

test('Agent Terminal consumes the toolkit session rail model module', () => {
  assert.match(html, /await import\('\.\/session-rail-model\.js'\)/)
  assert.match(html, /createSessionRailModel\(sessions,\s*\{/)
  assert.match(html, /findMatchingSession\(sessions, selectedSession\)/)
  assert.doesNotMatch(html, /function sessionSortTimestamp/)
  assert.doesNotMatch(html, /function compareSessionsForRail/)
})

test('Agent Terminal consumes the toolkit session rail view module', () => {
  const renderSessionsBody = functionBody(html, 'renderSessions')
  assert.match(html, /await import\('\.\/session-rail-view\.js'\)/)
  assert.match(html, /renderSessionRail\(sessionList, rows,\s*\{/)
  assert.match(html, /onSessionClick\(row\)/)
  assert.doesNotMatch(renderSessionsBody, /document\.createElement\('button'\)/)
  assert.doesNotMatch(renderSessionsBody, /document\.createElement\('span'\)/)
  assert.doesNotMatch(renderSessionsBody, /setAttribute\('aria-current'/)
})

test('Agent Terminal consumes the toolkit session inspector model module', () => {
  assert.match(html, /await import\('\.\/session-inspector-view\.js'\)/)
  assert.match(html, /renderSessionInspector\(sessionInspector, record, payload\)/)
  assert.match(html, /emit\(\{\s*type:\s*'agent_terminal\.session_telemetry', payload\s*\}\)/)
  assert.doesNotMatch(html, /function formatNumber/)
  assert.doesNotMatch(html, /function formatRatio/)
  assert.doesNotMatch(html, /function sourceDisplay/)
  assert.doesNotMatch(html, /function appendText/)
  assert.doesNotMatch(html, /function appendRow/)
  assert.doesNotMatch(html, /function appendSection/)
})

test('Agent Terminal consumes the toolkit terminal controller module', () => {
  assert.match(html, /await import\('\.\/terminal-controller\.js'\)/)
  assert.match(html, /createDefaultTerminalOptions\(\)/)
  assert.match(html, /createAgentTerminalController\(\{/)
  assert.match(html, /terminalController\.connectTerminal\(\)/)
  assert.match(html, /terminalController\.forwardInput\(data\)/)
  assert.doesNotMatch(html, /function connectTerminal/)
  assert.doesNotMatch(html, /function createDefaultTerminalOptions/)
  assert.doesNotMatch(html, /bridgeClient\.formatResizeFrame\(\{ cols, rows \}\)/)
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

test('generic toolkit launcher starts toolkit-owned bridge substrate', () => {
  assert.match(toolkitLauncher, /BRIDGE_DIR="\$REPO_ROOT\/packages\/toolkit\/components\/agent-terminal"/)
  assert.match(toolkitLauncher, /"\$BRIDGE_DIR\/bridge-server\.mjs"/)
  assert.doesNotMatch(toolkitLauncher, /apps\/sigil\/codex-terminal/)
  assert.match(toolkitBridgeServer, /function startServer\(\)/)
  assert.match(toolkitBridgeServer, /export \{ appendProcessStderr, startServer \}/)
  assert.match(toolkitBridgeServer, /\.\/session-inspector-server\.mjs/)
  assert.match(toolkitInspectorServer, /export function buildSessionInspector/)
})

test('canonical Sigil Agent Terminal launcher owns Sigil wrapper launch', () => {
  assert.match(sigilAgentLauncher, /Sigil Agent terminal launched\./)
  assert.match(sigilAgentLauncher, /AVATAR_ID="\$\{AVATAR_ID:-avatar-main\}"/)
  assert.match(sigilAgentLauncher, /show create --id "\$AVATAR_ID"/)
  assert.match(sigilAgentLauncher, /renderer\/index\.html\?toolkit-root=\$TOOLKIT_CONTENT_ROOT/)
  assert.match(sigilAgentLauncher, /agent-terminal\/index\.html\?port=\$\{PORT\}&session=\$\{SESSION\}&cwd=\$\{encoded_cwd\}&toolkit-root=\$TOOLKIT_CONTENT_ROOT/)
  assert.match(sigilAgentLauncher, /BRIDGE_DIR="\$REPO_ROOT\/packages\/toolkit\/components\/agent-terminal"/)
  assert.match(sigilAgentLauncher, /"\$BRIDGE_DIR\/bridge-server\.mjs"/)
  assert.match(sigilAgentLauncher, /--new-codex/)
  assert.match(sigilAgentLauncher, /--new-claude/)
  assert.match(sigilAgentLauncher, /--pick/)
  assert.match(sigilAgentLauncher, /--last/)
  assert.match(sigilAgentLauncher, /--restart/)
  assert.doesNotMatch(sigilAgentLauncher, /\.\.\/codex-terminal\/launch\.sh/)
  assert.doesNotMatch(sigilAgentLauncher, /exec "\$SCRIPT_DIR\/\.\.\/codex-terminal\/launch\.sh"/)
})

test('historical Codex terminal launcher delegates to canonical Sigil launcher', () => {
  assert.match(sigilCompatLauncher, /Historical compatibility launcher/)
  assert.match(sigilCompatLauncher, /exec "\$SCRIPT_DIR\/\.\.\/agent-terminal\/launch\.sh" "\$@"/)
  assert.doesNotMatch(sigilCompatLauncher, /show create/)
  assert.doesNotMatch(sigilCompatLauncher, /avatar-main/)
  assert.doesNotMatch(sigilCompatLauncher, /bridge-server\.mjs/)
})

test('generic toolkit launcher prepares component-local xterm runtime assets', () => {
  const assetPaths = relativeAssetPathsFromHtml(toolkitHtml)
  assert.deepEqual(assetPaths, [
    './node_modules/@xterm/xterm/css/xterm.css',
    './node_modules/@xterm/xterm/lib/xterm.js',
    './node_modules/@xterm/addon-fit/lib/addon-fit.js',
  ])
  assert.ok(existsSync(new URL('package.json', toolkitComponentDir)))
  assert.ok(existsSync(new URL('package-lock.json', toolkitComponentDir)))
  assert.match(toolkitLauncher, /ensure_runtime_assets\(\)/)
  assert.match(toolkitLauncher, /node_modules\/@xterm\/xterm\/css\/xterm\.css/)
  assert.match(toolkitLauncher, /node_modules\/@xterm\/xterm\/lib\/xterm\.js/)
  assert.match(toolkitLauncher, /node_modules\/@xterm\/addon-fit\/lib\/addon-fit\.js/)
  assert.match(toolkitLauncher, /npm ci --prefix "\$SCRIPT_DIR" --omit=dev --no-audit --no-fund/)
  assert.match(toolkitLauncher, /Agent terminal runtime asset was not prepared/)
  assert.doesNotMatch(toolkitHtml, /apps\/sigil\/codex-terminal\/node_modules/)
  assert.doesNotMatch(toolkitHtml, /aos:\/\/sigil\/[^"']*node_modules/)
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
  assert.match(sigilCompatServer, /packages\/toolkit\/components\/agent-terminal\/bridge-server\.mjs/)
  assert.match(sigilCompatServer, /startServer\(\)/)
  assert.match(sigilCompatInspector, /packages\/toolkit\/components\/agent-terminal\/session-inspector-server\.mjs/)
})
