import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHitTargetController } from '../../apps/sigil/renderer/live-modules/hit-target.js'

test('Sigil hit target requests the above-menu window level', async () => {
  const calls = []
  const runtime = {
    canvasCreate(payload) {
      calls.push(payload)
      return Promise.resolve({ id: payload.id })
    },
  }
  const hitTarget = createHitTargetController({
    runtime,
    url: 'aos://sigil/renderer/hit-area.html',
    id: 'sigil-hit-test',
    size: 80,
  })

  await hitTarget.ensureCreated()

  assert.equal(calls.length, 1)
  assert.equal(calls[0].window_level, 'screen_saver')
  assert.equal(calls[0].interactive, false)
  assert.deepEqual(calls[0].frame, [-10000, -10000, 80, 80])
  assert.equal(calls[0].parent, 'avatar-main')
  assert.match(calls[0].url, /parent=avatar-main/)
  assert.match(calls[0].url, /id=sigil-hit-test/)
})

test('Sigil hit target owner id prefers canvas id, surface canvas id, then avatar-main', async () => {
  const cases = [
    [{ __aosCanvasId: 'sigil-status-demo', __aosSurfaceCanvasId: 'sigil-surface-demo' }, 'sigil-status-demo'],
    [{ __aosSurfaceCanvasId: 'sigil-surface-demo' }, 'sigil-surface-demo'],
    [{}, 'avatar-main'],
  ]

  for (const [windowValue, expectedParent] of cases) {
    globalThis.window = windowValue
    try {
      const calls = []
      const runtime = {
        canvasCreate(payload) {
          calls.push(payload)
          return Promise.resolve({ id: payload.id })
        },
      }
      const hitTarget = createHitTargetController({
        runtime,
        url: 'aos://sigil/renderer/hit-area.html',
        id: `sigil-hit-${expectedParent}`,
        size: 80,
      })

      await hitTarget.ensureCreated()

      assert.equal(calls[0].parent, expectedParent)
      assert.match(calls[0].url, new RegExp(`parent=${expectedParent}`))
      assert.equal(hitTarget.hit.parent, expectedParent)
    } finally {
      delete globalThis.window
    }
  }
})

test('Sigil hit target syncs DesktopWorld centers and skips redundant updates', async () => {
  const creates = []
  const updates = []
  const runtime = {
    canvasCreate(payload) {
      creates.push(payload)
      return Promise.resolve({ id: payload.id })
    },
    canvasUpdate(payload) {
      updates.push(payload)
    },
  }
  const hitTarget = createHitTargetController({
    runtime,
    url: 'aos://sigil/renderer/hit-area.html',
    id: 'sigil-hit-test',
    size: 80,
  })

  await hitTarget.ensureCreated()
  hitTarget.syncWorldCenter({ x: 100, y: 100, valid: true }, true)
  hitTarget.syncWorldCenter({ x: 100, y: 100, valid: true }, true)
  hitTarget.syncFrame([60, 60, 80, 80], true)

  assert.equal(creates.length, 1)
  assert.equal(updates.length, 1)
  assert.deepEqual(updates[0], { id: 'sigil-hit-test', frame: [60, 60, 80, 80], interactive: true })
  assert.deepEqual(hitTarget.hit.frame, [60, 60, 80, 80])
  assert.equal(hitTarget.hit.interactive, true)
})

test('Sigil hit target syncs DesktopWorld rects with display offsets', async () => {
  const updates = []
  const runtime = {
    canvasCreate(payload) {
      return Promise.resolve({ id: payload.id })
    },
    canvasUpdate(payload) {
      updates.push(payload)
    },
  }
  const hitTarget = createHitTargetController({
    runtime,
    url: 'aos://sigil/renderer/hit-area.html',
    id: 'sigil-hit-offset',
    size: 80,
  })
  const displays = [
    { nativeBounds: { x: -1440, y: 0, w: 1440, h: 900 } },
    { nativeBounds: { x: 0, y: 0, w: 1728, h: 1117 } },
  ]

  await hitTarget.ensureCreated()
  hitTarget.syncWorldCenter({ x: 100, y: 100, valid: true }, true, { displays })
  hitTarget.syncWorldRect({ x: 200, y: 120, w: 300, h: 140 }, true, { displays })

  assert.deepEqual(updates[0], { id: 'sigil-hit-offset', frame: [-1380, 60, 80, 80], interactive: true })
  assert.deepEqual(updates[1], { id: 'sigil-hit-offset', frame: [-1240, 120, 300, 140] })
  assert.deepEqual(hitTarget.hit.frame, [-1240, 120, 300, 140])
})

test('Sigil hit target disables offscreen and non-interactive', async () => {
  const updates = []
  const runtime = {
    canvasCreate(payload) {
      return Promise.resolve({ id: payload.id })
    },
    canvasUpdate(payload) {
      updates.push(payload)
    },
  }
  const hitTarget = createHitTargetController({
    runtime,
    url: 'aos://sigil/renderer/hit-area.html',
    id: 'sigil-hit-disable',
    size: 80,
  })

  await hitTarget.ensureCreated()
  hitTarget.syncWorldCenter({ x: 100, y: 100, valid: true }, true)
  hitTarget.syncWorldCenter({ x: -10000, y: -10000, valid: true }, false)

  assert.deepEqual(updates.at(-1), { id: 'sigil-hit-disable', frame: [-10000, -10000, 80, 80], interactive: false })
  assert.equal(hitTarget.hit.interactive, false)
  assert.deepEqual(hitTarget.hit.frame, [-10000, -10000, 80, 80])
})

test('Sigil hit target remove delegates and clears state', async () => {
  const removes = []
  const runtime = {
    canvasCreate(payload) {
      return Promise.resolve({ id: payload.id })
    },
    canvasUpdate() {},
    canvasRemove(payload) {
      removes.push(payload)
    },
  }
  const hitTarget = createHitTargetController({
    runtime,
    url: 'aos://sigil/renderer/hit-area.html',
    id: 'sigil-hit-remove',
    size: 80,
  })

  await hitTarget.ensureCreated()
  hitTarget.syncWorldCenter({ x: 100, y: 100, valid: true }, true)
  await hitTarget.remove()

  assert.deepEqual(removes, [{ id: 'sigil-hit-remove' }])
  assert.equal(hitTarget.hit.ready, false)
  assert.equal(hitTarget.hit.interactive, false)
  assert.deepEqual(hitTarget.hit.frame, [-10000, -10000, 80, 80])
})

test('Sigil hit area exposes avatar semantics without visible label text', async () => {
  const html = await readFile(new URL('../../apps/sigil/renderer/hit-area.html', import.meta.url), 'utf8')

  assert.match(html, /id="sigil-avatar-hit-target"/)
  assert.match(html, /aria-label="Sigil avatar"/)
  assert.match(html, /data-aos-surface="sigil\.avatar"/)
  assert.match(html, /data-semantic-target-id="avatar"/)
  assert.match(html, /dataset\.aosRef = HIT_ID/)
  assert.match(html, /dataset\.aosParentCanvas = HIT_PARENT_ID/)
  assert.doesNotMatch(html, />\s*Sigil avatar\s*<\/button>/)
})

test('Sigil hit area forwards canvas-origin identity and local pointer details', async () => {
  const html = await readFile(new URL('../../apps/sigil/renderer/hit-area.html', import.meta.url), 'utf8')

  assert.match(html, /source_origin: 'canvas'/)
  assert.match(html, /source_canvas_id: HIT_ID/)
  assert.match(html, /owner_canvas_id: HIT_PARENT_ID/)
  assert.match(html, /source_event: kind/)
  assert.match(html, /pointer_id: Number\.isFinite\(event\.pointerId\)/)
  assert.match(html, /offsetX:/)
  assert.match(html, /offsetY:/)
  assert.match(html, /payload\.dx/)
  assert.match(html, /payload\.dy/)
})
