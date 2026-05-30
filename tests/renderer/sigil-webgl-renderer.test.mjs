import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  configureTransparentSigilRenderer,
  transparentSigilRendererOptions,
} from '../../apps/sigil/renderer/live-modules/webgl-renderer.js'

test('transparent Sigil WebGL renderer uses non-premultiplied alpha for stable desktop compositing', () => {
  assert.deepEqual(transparentSigilRendererOptions(), {
    antialias: true,
    alpha: true,
    premultipliedAlpha: false,
  })
  assert.deepEqual(transparentSigilRendererOptions({ stencil: false }), {
    antialias: true,
    alpha: true,
    premultipliedAlpha: false,
    stencil: false,
  })
})

test('transparent Sigil renderer configuration applies viewport and clear alpha consistently', () => {
  const calls = []
  const renderer = {
    setPixelRatio(value) {
      calls.push(['pixelRatio', value])
    },
    setSize(width, height) {
      calls.push(['size', width, height])
    },
    setClearColor(color, alpha) {
      calls.push(['clear', color, alpha])
    },
  }

  const result = configureTransparentSigilRenderer(renderer, {
    width: 1200,
    height: 800,
    pixelRatio: 2,
  })

  assert.deepEqual(calls, [
    ['pixelRatio', 2],
    ['size', 1200, 800],
    ['clear', 0x000000, 0],
  ])
  assert.deepEqual(result, {
    width: 1200,
    height: 800,
    pixelRatio: 2,
    premultipliedAlpha: false,
  })
})
