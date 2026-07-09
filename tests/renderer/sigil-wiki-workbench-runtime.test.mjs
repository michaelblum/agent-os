import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  WIKI_WORKBENCH_CANVAS_ID,
} from '../../apps/sigil/renderer/live-modules/utility-canvas-config.js'
import {
  createSigilWikiWorkbenchRuntime,
  fetchWikiMarkdownDocument,
  normalizeWikiWorkbenchPath,
} from '../../apps/sigil/renderer/live-modules/wiki-workbench-runtime.js'

function response({ ok = true, status = 200, text = '' } = {}) {
  return {
    ok,
    status,
    text: async () => text,
  }
}

test('Sigil wiki workbench normalizes wiki paths', () => {
  assert.equal(normalizeWikiWorkbenchPath('/aos/concepts/runtime-modes.md'), 'aos/concepts/runtime-modes.md')
  assert.equal(normalizeWikiWorkbenchPath(''), 'aos/concepts/runtime-modes.md')
})

test('Sigil wiki workbench fetches markdown through the toolkit open payload builder', async () => {
  const calls = []
  const message = await fetchWikiMarkdownDocument('/aos/concepts/runtime-modes.md', {
    fetchImpl: async (...args) => {
      calls.push(args)
      return response({ text: '# Runtime Modes' })
    },
  })

  assert.deepEqual(calls, [['/wiki/aos/concepts/runtime-modes.md', { cache: 'no-store' }]])
  assert.deepEqual(message, {
    type: 'markdown_document.open',
    path: 'aos/concepts/runtime-modes.md',
    source: {
      kind: 'wiki',
      path: 'aos/concepts/runtime-modes.md',
      page: {
        path: 'aos/concepts/runtime-modes.md',
        frontmatter: {},
      },
    },
    content: '# Runtime Modes',
  })
})

test('Sigil wiki workbench reports failed wiki fetches', async () => {
  await assert.rejects(
    fetchWikiMarkdownDocument('missing.md', {
      fetchImpl: async () => response({ ok: false, status: 404 }),
    }),
    /wiki fetch failed for missing\.md: 404/,
  )
})

test('Sigil wiki runtime opens canvas, sends document, and advances activation', async () => {
  const posts = []
  const activationUpdates = []
  const runtime = createSigilWikiWorkbenchRuntime({
    ensureUtilityCanvasVisible: async (kind, options) => ({ kind, options, id: WIKI_WORKBENCH_CANVAS_ID }),
    fetchImpl: async () => response({ text: '# Runtime Modes' }),
    post: (type, payload) => posts.push({ type, payload }),
    sendActivationUpdate: (activation, phase, extra) => {
      const update = { ...activation, phase, extra }
      activationUpdates.push(update)
      return update
    },
  })

  const result = await runtime.open('/aos/concepts/runtime-modes.md', {
    target_surface: 'avatar-main',
    transition: { id: 'transition-1' },
  })

  assert.deepEqual(result.canvas, {
    kind: 'wiki-workbench',
    options: { focus: true },
    id: WIKI_WORKBENCH_CANVAS_ID,
  })
  assert.equal(posts.length, 1)
  assert.equal(posts[0].type, 'canvas.send')
  assert.equal(posts[0].payload.target, WIKI_WORKBENCH_CANVAS_ID)
  assert.equal(posts[0].payload.message.type, 'markdown_document.open')
  assert.equal(activationUpdates.length, 2)
  assert.equal(activationUpdates[0].phase, 'surface_transition')
  assert.equal(activationUpdates[1].phase, 'completed')
  assert.equal(activationUpdates[1].extra.result.subject.path, 'aos/concepts/runtime-modes.md')
})

test('Sigil main delegates wiki workbench opening to a runtime module', async () => {
  const source = await readFile(new URL('../../apps/sigil/renderer/live-modules/main.js', import.meta.url), 'utf8')

  assert.match(source, /createSigilWikiWorkbenchRuntime/)
  assert.match(source, /wikiWorkbenchRuntime\.open/)
  assert.doesNotMatch(source, /async function fetchWikiMarkdownDocument/)
  assert.doesNotMatch(source, /type:\s*'markdown_document\.open'/)
})
