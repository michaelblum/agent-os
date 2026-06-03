import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  createRadialMenuTargetSurface,
  radialMenuTargetsFromSnapshot,
  radialMenuWorldRect,
} from '../../apps/sigil/renderer/live-modules/radial-menu-target-surface.js'

const radialSnapshot = {
  phase: 'radial',
  activeItemId: 'wiki-graph',
  items: [
    {
      id: 'avatar-controls',
      label: 'Avatar Controls',
      action: 'avatarControls',
      center: { x: 100, y: 80 },
      hitRadius: 12,
      visualRadius: 10,
    },
    {
      id: 'wiki-graph',
      label: 'Wiki Graph',
    action: 'wikiGraph',
    logical: {
      id: 'wiki-graph',
      label: 'Wiki Graph',
      action: 'wikiGraph',
      role: 'menuitem',
      current: true,
      close_on_select: true,
    },
    center: { x: 180, y: 80 },
      hitRadius: 12,
      visualRadius: 10,
    },
  ],
}

test('radial menu targets enforce AOS-sized hit surfaces', () => {
  const targets = radialMenuTargetsFromSnapshot(radialSnapshot, { targetMinSize: 56 })

  assert.equal(targets.length, 2)
  assert.equal(targets[0].label, 'Avatar Controls')
  assert.equal(targets[0].name, 'Avatar Controls')
  assert.equal(targets[0].ariaLabel, 'Avatar Controls')
  assert.equal(targets[0].role, 'AXButton')
  assert.equal(targets[0].aosRef, 'sigil-radial-item-avatar-controls')
  assert.equal(targets[0].size, 56)
  assert.equal(targets[1].active, true)
  assert.deepEqual(targets[1].logical, {
    id: 'wiki-graph',
    label: 'Wiki Graph',
    action: 'wikiGraph',
    role: 'menuitem',
    current: true,
    close_on_select: true,
  })
})

test('radial menu surface keeps labels in AX attributes, not visible text', async () => {
  const html = await readFile(new URL('../../apps/sigil/renderer/radial-menu-surface.html', import.meta.url), 'utf8')

  assert.match(html, /applySemanticTargetAttributes/)
  assert.match(html, /aria-label="Sigil radial menu"/)
  assert.match(html, /radial_surface_ready/)
  assert.match(html, /radial_item_pointer_down/)
  assert.match(html, /radial_item_pointer_move/)
  assert.match(html, /radial_item_pointer_enter/)
  assert.match(html, /radial_item_pointer_leave/)
  assert.match(html, /radial_item_pointer_up/)
  assert.match(html, /radial_surface_pointer_move/)
  assert.match(html, /radial_item_click/)
  assert.match(html, /setPointerCapture/)
  assert.match(html, /releasePointerCapture/)
  assert.match(html, /itemAction: item\.action \|\| null/)
  assert.match(html, /surfaceBounds: surfaceBoundsPayload\(\)/)
  assert.match(html, /dataset\.radialItemId/)
  assert.match(html, /dataset\.radialAction/)
  assert.doesNotMatch(html, /Sigil radial item:/)
  assert.doesNotMatch(html, /radial-item-label/)
  assert.doesNotMatch(html, /radial-item-action/)
  assert.doesNotMatch(html, /textContent\s*=\s*item\.label/)
  assert.doesNotMatch(html, /button\.title\s*=/)
})

test('radial menu target bounds include all exposed targets', () => {
  const targets = radialMenuTargetsFromSnapshot(radialSnapshot, { targetMinSize: 56 })
  const rect = radialMenuWorldRect(targets, { padding: 10 })

  assert.deepEqual(rect, { x: 62, y: 42, w: 156, h: 76 })
})

test('radial menu target surface creates an offscreen child and posts live item geometry', async () => {
  const creates = []
  const updates = []
  const posts = []
  const runtime = {
    canvasCreate(payload) {
      creates.push(payload)
      return Promise.resolve({ id: payload.id })
    },
    canvasUpdate(payload) {
      updates.push(payload)
    },
    post(type, payload) {
      posts.push({ type, payload })
    },
  }

  const surface = createRadialMenuTargetSurface({
    runtime,
    url: 'aos://sigil/renderer/radial-menu-surface.html',
    id: 'sigil-radial-menu-test',
    targetMinSize: 56,
    framePadding: 10,
  })

  await surface.ensureCreated()
  assert.equal(creates.length, 1)
  assert.equal(creates[0].interactive, false)
  assert.equal(creates[0].window_level, 'screen_saver')
  assert.equal(creates[0].parent, 'avatar-main')
  assert.match(creates[0].url, /parent=avatar-main/)

  assert.equal(surface.sync(radialSnapshot, { displays: [] }), true)
  assert.deepEqual(updates[0], {
    id: 'sigil-radial-menu-test',
    frame: [62, 42, 156, 76],
    interactive: true,
  })
  assert.equal(posts.length, 1)
  assert.equal(posts[0].type, 'canvas.send')
  assert.equal(posts[0].payload.target, 'sigil-radial-menu-test')
  assert.equal(posts[0].payload.message.type, 'radial_menu.surface.update')
  assert.deepEqual(
    posts[0].payload.message.payload.items.map((item) => ({
      id: item.id,
      label: item.label,
      name: item.name,
      action: item.action,
      ariaLabel: item.ariaLabel,
      aosRef: item.aosRef,
      active: item.active,
      x: item.x,
      y: item.y,
      size: item.size,
    })),
    [
      {
        id: 'avatar-controls',
        label: 'Avatar Controls',
        name: 'Avatar Controls',
        action: 'avatarControls',
        ariaLabel: 'Avatar Controls',
        aosRef: 'sigil-radial-item-avatar-controls',
        active: false,
        x: 38,
        y: 38,
        size: 56,
      },
      {
        id: 'wiki-graph',
        label: 'Wiki Graph',
        name: 'Wiki Graph',
        action: 'wikiGraph',
        ariaLabel: 'Wiki Graph',
        aosRef: 'sigil-radial-item-wiki-graph',
        active: true,
        x: 118,
        y: 38,
        size: 56,
      },
    ]
  )

  assert.equal(surface.refreshPayload(), true)
  assert.equal(posts.length, 2)
  assert.deepEqual(posts[1], posts[0])

  assert.equal(surface.sync({ phase: 'idle', items: [] }, { displays: [] }), false)
  assert.deepEqual(updates[1], {
    id: 'sigil-radial-menu-test',
    frame: [-10000, -10000, 156, 76],
    interactive: false,
  })
})
