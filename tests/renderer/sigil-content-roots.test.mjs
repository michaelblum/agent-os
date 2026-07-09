import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  currentContentRoot,
  currentToolkitRoot,
  documentContentUrl,
  sigilUrl,
  siblingContentRoot,
  toolkitSpecifier,
  toolkitUrl,
} from '../../apps/sigil/renderer/live-modules/content-roots.js'

test('Sigil content roots infer branch-scoped toolkit root from current Sigil root', () => {
  const loc = new URL('http://127.0.0.1:54526/sigil_codex_wiki_workbench_layout_polish/renderer/index.html')

  assert.equal(currentContentRoot({ loc }), 'sigil_codex_wiki_workbench_layout_polish')
  assert.equal(currentToolkitRoot({ loc }), 'toolkit_codex_wiki_workbench_layout_polish')
  assert.equal(
    toolkitUrl('components/wiki-subject-browser/index.html', { loc }),
    'aos://toolkit_codex_wiki_workbench_layout_polish/components/wiki-subject-browser/index.html',
  )
  assert.equal(
    documentContentUrl(currentToolkitRoot({ loc }), 'components/wiki-subject-browser/index.html', { loc }),
    '/toolkit_codex_wiki_workbench_layout_polish/components/wiki-subject-browser/index.html',
  )
  assert.equal(
    sigilUrl('renderer/hit-area.html', { loc }),
    'aos://sigil_codex_wiki_workbench_layout_polish/renderer/hit-area.html',
  )
})

test('Sigil content roots accept explicit toolkit root override', () => {
  const loc = new URL('http://127.0.0.1:54526/sigil/renderer/index.html?toolkit-root=toolkit_preview')

  assert.equal(currentToolkitRoot({ loc }), 'toolkit_preview')
  assert.equal(
    toolkitUrl('runtime/spatial.js', { loc }),
    'aos://toolkit_preview/runtime/spatial.js',
  )
})

test('Sigil content roots preserve aos scheme when loaded before URL rewrite', () => {
  const loc = new URL('aos://sigil_codex_example/renderer/index.html')

  assert.equal(currentContentRoot({ loc }), 'sigil_codex_example')
  assert.equal(siblingContentRoot({ fromRoot: 'sigil_codex_example' }), 'toolkit_codex_example')
  assert.equal(
    toolkitUrl('runtime/menu-activation.js', { loc }),
    'aos://toolkit_codex_example/runtime/menu-activation.js',
  )
})

test('Sigil toolkit specifier keeps local Node tests on filesystem imports', () => {
  assert.equal(
    toolkitSpecifier('runtime/spatial.js', { loc: null }),
    '../../../../packages/toolkit/runtime/spatial.js',
  )
  assert.equal(
    toolkitSpecifier('runtime/spatial.js', { loc: null, local: '../../../packages/toolkit/runtime/spatial.js' }),
    '../../../packages/toolkit/runtime/spatial.js',
  )
})

test('Sigil renderer routes wiki workbench through scoped toolkit resolver', async () => {
  const source = await readFile(new URL('../../apps/sigil/renderer/live-modules/main.js', import.meta.url), 'utf8')
  const utilityConfigSource = await readFile(new URL('../../apps/sigil/renderer/live-modules/utility-canvas-config.js', import.meta.url), 'utf8')
  const wikiRuntimeSource = await readFile(new URL('../../apps/sigil/renderer/live-modules/wiki-workbench-runtime.js', import.meta.url), 'utf8')

  assert.match(utilityConfigSource, /toolkitUrl\('components\/wiki-subject-browser\/index\.html'/)
  assert.doesNotMatch(utilityConfigSource, /WIKI_WORKBENCH_URL\s*=\s*['"]aos:\/\/toolkit\/components\/wiki-subject-browser\/index\.html/)
  assert.doesNotMatch(utilityConfigSource, /toolkitUrl\('components\/markdown-workbench\/index\.html'/)
  assert.match(source, /sigilUrl\('renderer\/hit-area\.html'\)/)
  assert.match(wikiRuntimeSource, /sendCanvasMessage\(targetCanvasId, message\)/)
})
