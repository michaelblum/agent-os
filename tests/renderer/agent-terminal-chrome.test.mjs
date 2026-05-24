import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const toolkitComponentDir = new URL('../../packages/toolkit/components/agent-terminal/', import.meta.url)
const toolkitHtml = readFileSync(new URL('index.html', toolkitComponentDir), 'utf8')
const toolkitLauncher = readFileSync(new URL('launch.sh', toolkitComponentDir), 'utf8')
const toolkitBridgeServer = readFileSync(new URL('bridge-server.mjs', toolkitComponentDir), 'utf8')
const toolkitTerminalSessionManager = readFileSync(new URL('terminal-session-manager.mjs', toolkitComponentDir), 'utf8')
const toolkitProviderSessionRoutes = readFileSync(new URL('provider-session-routes.mjs', toolkitComponentDir), 'utf8')
const toolkitObservationRoutes = readFileSync(new URL('bridge-observation-routes.mjs', toolkitComponentDir), 'utf8')
const toolkitInspectorServer = readFileSync(new URL('session-inspector-server.mjs', toolkitComponentDir), 'utf8')
const sigilAgentLauncher = readFileSync(new URL('../../apps/sigil/agent-terminal/launch.sh', import.meta.url), 'utf8')
const sigilCompatLauncher = readFileSync(new URL('../../apps/sigil/codex-terminal/launch.sh', import.meta.url), 'utf8')
const sigilAgentEntrypoint = readFileSync(new URL('../../apps/sigil/agent-terminal/index.html', import.meta.url), 'utf8')
const sigilCompatEntrypoint = readFileSync(new URL('../../apps/sigil/codex-terminal/index.html', import.meta.url), 'utf8')
const sigilCompatServer = readFileSync(new URL('../../apps/sigil/codex-terminal/server.mjs', import.meta.url), 'utf8')
const sigilCompatInspector = readFileSync(new URL('../../apps/sigil/codex-terminal/session-inspector.mjs', import.meta.url), 'utf8')
const html = toolkitHtml

function functionBody(source, functionName) {
  let start = source.indexOf(`function ${functionName}(`)
  if (start === -1) {
    start = source.indexOf(`${functionName}()`)
  }
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
  assert.match(html, /mountTerminalContextMenu\(\{/)
  assert.match(html, /terminalController\.attachInputHandlers\(\{ element: terminalElement \}\)/)
  assert.match(html, /terminalController\.connectTerminal\(\)/)
  assert.match(html, /terminalController\.forwardInput\(data\)/)
  assert.match(html, /className = 'terminal-context-menu'/)
  assert.match(html, /terminalPasteButton\.textContent = 'Paste'/)
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

test('toolkit and Sigil launchers pass canonical bridge environment names', () => {
  const legacySigilAgentEnv = new RegExp('SIGIL' + '_AGENT_')
  const legacySigilCodexEnv = new RegExp('SIGIL' + '_CODEX_')
  const legacyCodexCommand = new RegExp('CODEX' + '_COMMAND')
  for (const launcher of [toolkitLauncher, sigilAgentLauncher]) {
    assert.match(launcher, /"AGENT_TERMINAL_PORT=" \+ shlex\.quote\(port\)/)
    assert.match(launcher, /"AGENT_TERMINAL_TMUX_SESSION=" \+ shlex\.quote\(session\)/)
    assert.match(launcher, /"AGENT_TERMINAL_CWD=" \+ shlex\.quote\(cwd\)/)
    assert.match(launcher, /"AGENT_TERMINAL_REPO_ROOT=" \+ shlex\.quote\(repo_root\)/)
    assert.match(launcher, /"AGENT_TERMINAL_COMMAND=" \+ shlex\.quote\(command\)/)
    assert.match(launcher, /AGENT_TERMINAL_PORT="\$PORT" \\/)
    assert.match(launcher, /AGENT_TERMINAL_TMUX_SESSION="\$SESSION" \\/)
    assert.match(launcher, /AGENT_TERMINAL_CWD="\$CWD_TARGET" \\/)
    assert.match(launcher, /AGENT_TERMINAL_REPO_ROOT="\$REPO_ROOT" \\/)
    assert.match(launcher, /AGENT_TERMINAL_COMMAND="\$AGENT_COMMAND" \\/)
    assert.doesNotMatch(launcher, legacySigilAgentEnv)
    assert.doesNotMatch(launcher, legacySigilCodexEnv)
    assert.doesNotMatch(launcher, legacyCodexCommand)
  }
})

test('toolkit and Sigil launchers require health to match requested bridge identity', () => {
  for (const launcher of [toolkitLauncher, sigilAgentLauncher]) {
    const startBridgeBody = functionBody(launcher, 'start_bridge')
    assert.match(launcher, /bridge_health_matches\(\)/)
    assert.match(launcher, /AGENT_TERMINAL_HEALTH_JSON="\$health" python3 - "\$SESSION" "\$CWD_TARGET"/)
    assert.match(launcher, /payload\.get\("defaultSession"\) != session/)
    assert.match(launcher, /payload\.get\("defaultCwd"\) != cwd/)
    assert.match(launcher, /if \[\[ "\$RESTART" -eq 0 \]\] && bridge_health_matches; then/)
    assert.match(startBridgeBody, /for _ in \$\(seq 1 30\); do\s+bridge_health_matches && return 0\s+sleep 0\.1\s+done/)
    assert.doesNotMatch(startBridgeBody, /bridge_running && return 0/)
    assert.doesNotMatch(launcher, /if bridge_running; then\s+return 0/)
  }
})

test('bridge substrate no longer contains broad legacy bridge env aliases', () => {
  const legacySigilAgentEnv = new RegExp('SIGIL' + '_AGENT_')
  const legacySigilCodexEnv = new RegExp('SIGIL' + '_CODEX_')
  const legacyCodexCommand = new RegExp('CODEX' + '_COMMAND')
  for (const source of [toolkitBridgeServer, toolkitTerminalSessionManager, toolkitProviderSessionRoutes, toolkitObservationRoutes, readFileSync(new URL('pty-proxy.py', toolkitComponentDir), 'utf8')]) {
    assert.doesNotMatch(source, legacySigilAgentEnv)
    assert.doesNotMatch(source, legacySigilCodexEnv)
    assert.doesNotMatch(source, legacyCodexCommand)
  }
  assert.match(toolkitTerminalSessionManager, /AGENT_TERMINAL_PTY_CHILD_PID/)
})

test('generic toolkit launcher starts toolkit-owned bridge substrate', () => {
  assert.match(toolkitLauncher, /BRIDGE_DIR="\$REPO_ROOT\/packages\/toolkit\/components\/agent-terminal"/)
  assert.match(toolkitLauncher, /"\$BRIDGE_DIR\/bridge-server\.mjs"/)
  assert.doesNotMatch(toolkitLauncher, /apps\/sigil\/codex-terminal/)
  assert.match(toolkitBridgeServer, /function startServer\(\)/)
  assert.match(toolkitBridgeServer, /export \{ appendProcessStderr, startServer \}/)
  assert.match(toolkitBridgeServer, /\.\/provider-session-routes\.mjs/)
  assert.match(toolkitBridgeServer, /\.\/bridge-observation-routes\.mjs/)
  assert.match(toolkitBridgeServer, /\.\/terminal-session-manager\.mjs/)
  assert.match(toolkitBridgeServer, /createTerminalSessionManager\(\{/)
  assert.match(toolkitProviderSessionRoutes, /\.\/session-inspector-server\.mjs/)
  assert.match(toolkitInspectorServer, /export function buildSessionInspector/)
})

test('bridge server delegates terminal lifecycle to toolkit terminal manager', () => {
  assert.match(toolkitTerminalSessionManager, /function createTerminalSessionManager\(/)
  assert.match(toolkitTerminalSessionManager, /function ensureProcessSession\(/)
  assert.match(toolkitTerminalSessionManager, /function ensureTmuxSession\(/)
  assert.match(toolkitTerminalSessionManager, /function attachTerminalSocket\(/)
  assert.match(toolkitTerminalSessionManager, /function appendProcessStderr\(/)
  assert.doesNotMatch(toolkitBridgeServer, /function ensureProcessSession\(/)
  assert.doesNotMatch(toolkitBridgeServer, /function ensureTmuxSession\(/)
  assert.doesNotMatch(toolkitBridgeServer, /function attachTerminalSocket\(/)
  assert.doesNotMatch(toolkitBridgeServer, /spawnSync\(/)
})

test('bridge server delegates provider session route data selection', () => {
  assert.match(toolkitProviderSessionRoutes, /function acceptedProviders\(/)
  assert.match(toolkitProviderSessionRoutes, /AGENT_TERMINAL_CATALOG_HOME/)
  assert.match(toolkitProviderSessionRoutes, /AGENT_TERMINAL_CODEX_ROOT/)
  assert.match(toolkitProviderSessionRoutes, /AGENT_TERMINAL_CLAUDE_ROOT/)
  assert.match(toolkitProviderSessionRoutes, /export function providerSessionsResponseForUrl/)
  assert.match(toolkitProviderSessionRoutes, /export function sessionInspectorResponseForUrl/)
  assert.match(toolkitProviderSessionRoutes, /buildSessionInspector\(record\)/)
  assert.doesNotMatch(toolkitBridgeServer, /function sessionCatalogQueryForUrl/)
  assert.doesNotMatch(toolkitBridgeServer, /function sessionCatalogForUrl/)
  assert.doesNotMatch(toolkitBridgeServer, /listProviderSessions\(/)
  assert.doesNotMatch(toolkitBridgeServer, /buildSessionInspector\(record\)/)
})

test('bridge server delegates health and dock observation response shapes', () => {
  assert.match(toolkitObservationRoutes, /export function healthResponse/)
  assert.match(toolkitObservationRoutes, /export function dockTerminalSessionResponseForUrl/)
  assert.match(toolkitObservationRoutes, /AGENT_TERMINAL_DOCK/)
  assert.match(toolkitObservationRoutes, /AGENT_TERMINAL_DOCK_CWD/)
  assert.match(toolkitObservationRoutes, /createDockTerminalSessionReceipt\(/)
  assert.match(toolkitObservationRoutes, /createAgentTerminalObservation\(receipt/)
  assert.doesNotMatch(toolkitBridgeServer, /function dockTerminalSessionForUrl/)
  assert.doesNotMatch(toolkitBridgeServer, /createDockTerminalSessionReceipt\(/)
  assert.doesNotMatch(toolkitBridgeServer, /createAgentTerminalObservation\(/)
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
