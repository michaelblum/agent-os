import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findContextMenuElementAt } from '../../apps/sigil/context-menu/menu.js'

function fakeElement(id, rect, selector = '*') {
  return {
    id,
    selector,
    getBoundingClientRect() {
      return {
        left: rect.x,
        top: rect.y,
        right: rect.x + rect.w,
        bottom: rect.y + rect.h,
      }
    },
  }
}

function fakeAnchor(elements, viewportHit = null) {
  return {
    contains(element) {
      return element === viewportHit || elements.includes(element)
    },
    querySelectorAll(selector) {
      return elements.filter((element) => selector.includes(element.selector))
    },
  }
}

test('context menu hit test falls back to off-viewport geometry', () => {
  const range = fakeElement('sigil-menu-line-duration', { x: 600, y: 1450, w: 180, h: 24 }, 'input')
  const card = fakeElement('sigil-menu-line-card', { x: 560, y: 1380, w: 292, h: 448 }, '.ctx-menu-card.active')
  const anchor = fakeAnchor([card, range])
  const doc = {
    elementFromPoint() {
      return null
    },
  }

  assert.equal(findContextMenuElementAt(anchor, { x: 620, y: 1460 }, doc), range)
})

test('context menu hit test prefers viewport hit when available', () => {
  const button = fakeElement('button', { x: 20, y: 20, w: 40, h: 24 }, 'button')
  const fallback = fakeElement('fallback', { x: 20, y: 20, w: 40, h: 24 }, 'button')
  const anchor = fakeAnchor([fallback], button)
  const doc = {
    elementFromPoint() {
      return button
    },
  }

  assert.equal(findContextMenuElementAt(anchor, { x: 30, y: 30 }, doc), button)
})

test('context menu hit test includes checkbox labels in projected fallback', () => {
  const label = fakeElement('line-interdim-label', { x: 600, y: 1450, w: 180, h: 24 }, 'label.checkbox-label')
  const card = fakeElement('sigil-menu-effects', { x: 560, y: 1380, w: 292, h: 448 }, '.ctx-menu-card.active')
  const anchor = fakeAnchor([card, label])
  const doc = {
    elementFromPoint() {
      return null
    },
  }

  assert.equal(findContextMenuElementAt(anchor, { x: 640, y: 1460 }, doc), label)
})
