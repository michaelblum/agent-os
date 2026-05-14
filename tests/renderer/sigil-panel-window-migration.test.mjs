import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const radialEditor = readFileSync(new URL('../../apps/sigil/radial-item-editor/index.js', import.meta.url), 'utf8')
const radialWorkbench = readFileSync(new URL('../../apps/sigil/radial-item-workbench/index.js', import.meta.url), 'utf8')
const codexTerminal = readFileSync(new URL('../../apps/sigil/codex-terminal/index.html', import.meta.url), 'utf8')
const chat = readFileSync(new URL('../../apps/sigil/chat/index.html', import.meta.url), 'utf8')
const sigilAgents = readFileSync(new URL('../../apps/sigil/AGENTS.md', import.meta.url), 'utf8')
const placementContract = readFileSync(new URL('../../docs/design/aos-panel-window-placement-contract.md', import.meta.url), 'utf8')

test('Sigil radial item editor uses the toolkit panel/window controller for window drag', () => {
  assert.match(radialEditor, /await import\(`\/\$\{toolkitRoot\}\/panel\/index\.js`\)/)
  assert.match(radialEditor, /createPanelWindowController\(\{/)
  assert.match(radialEditor, /panelWindowController\.wireDrag\(dragHandle,\s*toolbar\)/)
  assert.doesNotMatch(radialEditor, /function postRaw/)
  assert.doesNotMatch(radialEditor, /postRaw\(/)
  assert.doesNotMatch(radialEditor, /type:\s*'move_abs'/)
  assert.doesNotMatch(radialEditor, /type:\s*'drag_start'/)
  assert.doesNotMatch(radialEditor, /type:\s*'drag_end'/)
})

test('Sigil radial item editor preserves separate 3D orbit dragging', () => {
  assert.match(radialEditor, /renderer\.domElement\.addEventListener\('pointerdown'/)
  assert.match(radialEditor, /orbitState\.dragging = true/)
  assert.match(radialEditor, /orbitState\.y \+= dx \* 0\.01/)
  assert.match(radialEditor, /orbitState\.x = Math\.max/)
})

test('Sigil radial item workbench uses the public panel/window controller', () => {
  assert.match(radialWorkbench, /await import\(`\/\$\{toolkitRoot\}\/panel\/index\.js`\)/)
  assert.match(radialWorkbench, /createPanelWindowController\(\{/)
  assert.match(radialWorkbench, /const panelWindowController = /)
  assert.match(radialWorkbench, /panelWindowController\.wireDrag\(dragHandle,\s*workbenchShell\?\.querySelector\('\.aos-window-controls'\)/)
  assert.match(radialWorkbench, /panelWindowController\.wireResize\(workbenchShell/)
  assert.match(radialWorkbench, /panelWindowController\.minimize\(\{ title: workbenchWindowTitle\(\) \}\)/)
  assert.match(radialWorkbench, /panelWindowController\.toggleMaximize\(\)/)
  assert.match(radialWorkbench, /panelWindowController\.close\(\)/)
  assert.doesNotMatch(radialWorkbench, /createMaximizeController/)
  assert.doesNotMatch(radialWorkbench, /,\s*wireDrag\b/)
  assert.doesNotMatch(radialWorkbench, /,\s*wireResize\b/)
  assert.doesNotMatch(radialWorkbench, /panel\/minimized-chip\.html/)
  assert.doesNotMatch(radialWorkbench, /`aos-chip-\$\{/)
  assert.doesNotMatch(radialWorkbench, /spawnChild/)
  assert.doesNotMatch(radialWorkbench, /suspendCanvas/)
})

test('Sigil radial item workbench preserves separate 3D orbit dragging', () => {
  assert.match(radialWorkbench, /renderer\.domElement\.addEventListener\('pointerdown'/)
  assert.match(radialWorkbench, /orbitState\.dragging = true/)
  assert.match(radialWorkbench, /orbitState\.y \+= dx \* 0\.01/)
  assert.match(radialWorkbench, /orbitState\.x = Math\.max/)
})

test('Agent Terminal remains the shared mountChrome precedent', () => {
  assert.match(codexTerminal, /mountChrome\(document\.body/)
  assert.match(codexTerminal, /draggable:\s*true/)
  assert.match(codexTerminal, /minimize:\s*true/)
  assert.match(codexTerminal, /maximize:\s*true/)
  assert.match(codexTerminal, /resizable:\s*true/)
  assert.doesNotMatch(codexTerminal, /type:\s*'move_abs'/)
})

test('legacy Sigil chat is explicitly parked instead of copied as a live pattern', () => {
  assert.match(chat, /type:\s*'move_abs'/)
  assert.match(sigilAgents, /chat\/` \| Legacy conversational canvas prototype/)
  assert.match(sigilAgents, /Do not keep evolving `apps\/sigil\/chat\/` as a second, competing shell/)
  assert.match(placementContract, /legacy Sigil chat marked parked/)
})
