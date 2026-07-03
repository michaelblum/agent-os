import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createInteractionOverlay } from '../../apps/sigil/renderer/live-modules/interaction-overlay.js'

function createContext() {
  const state = {}
  return new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop]
      if (prop === 'measureText') return (text) => ({ width: String(text || '').length * 6 })
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => ({ addColorStop() {} })
      }
      return () => {}
    },
    set(target, prop, value) {
      target[prop] = value
      return true
    },
  })
}

function createCanvas() {
  const context = createContext()
  return {
    style: {},
    width: 0,
    height: 0,
    getContext(type) {
      assert.equal(type, '2d')
      return context
    },
    remove() {
      this.removed = true
    },
  }
}

test('Selection Mode lineage bar renders on a lower layer than the cursor scene', () => {
  const appended = []
  const originalDocument = globalThis.document
  const originalWindow = globalThis.window

  globalThis.document = {
    body: {
      appendChild(node) {
        appended.push(node)
      },
    },
    createElement(tag) {
      assert.equal(tag, 'canvas')
      return createCanvas()
    },
  }
  globalThis.window = {
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener() {},
    removeEventListener() {},
  }

  try {
    const overlay = createInteractionOverlay()
    overlay.mount()
    overlay.draw({
      selectionModeOverlay: {
        visible: true,
        lineageBar: {
          visible: true,
          rect: { x: 16, y: 16, width: 180, height: 34 },
          style: {},
          items: [],
          separators: [],
        },
      },
    })

    assert.equal(appended.length, 2)
    assert.equal(appended[0].style.zIndex, '3')
    assert.equal(appended[1].style.zIndex, '0')
  } finally {
    globalThis.document = originalDocument
    globalThis.window = originalWindow
  }
})

test('Selection Mode active frames draw without an unbound time reference', () => {
  const appended = []
  const originalDocument = globalThis.document
  const originalWindow = globalThis.window

  globalThis.document = {
    body: {
      appendChild(node) {
        appended.push(node)
      },
    },
    createElement(tag) {
      assert.equal(tag, 'canvas')
      return createCanvas()
    },
  }
  globalThis.window = {
    devicePixelRatio: 1,
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener() {},
    removeEventListener() {},
  }

  try {
    const overlay = createInteractionOverlay()
    overlay.mount()
    assert.doesNotThrow(() => overlay.draw({
      time: 1.25,
      selectionModeOverlay: {
        active: true,
        frames: [{
          active: true,
          rect: { x: 10, y: 20, w: 30, h: 40 },
          style: {},
        }],
      },
    }))
  } finally {
    globalThis.document = originalDocument
    globalThis.window = originalWindow
  }
})
