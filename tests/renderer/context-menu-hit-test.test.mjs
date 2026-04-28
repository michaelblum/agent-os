import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  findContextMenuElementAt,
  menuMarkup,
} from '../../apps/sigil/context-menu/menu.js'

function fakeElement(id, rect, selector = '*') {
  return {
    id,
    selector,
    parentCard: null,
    classList: {
      contains(name) {
        return selector.includes(`.${name}`)
      },
    },
    closest(query) {
      if (query === '.ctx-menu-card' && this.parentCard) return this.parentCard
      return null
    },
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

test('context menu hit test skips controls inside departing cards', () => {
  const activeCard = fakeElement('sigil-menu-root', { x: 560, y: 1380, w: 292, h: 448 }, '.ctx-menu-card.active')
  const departingCard = fakeElement('sigil-menu-line-card', { x: 560, y: 1380, w: 292, h: 448 }, '.ctx-menu-card.departing')
  const departingButton = fakeElement('edge-scatter', { x: 600, y: 1450, w: 180, h: 24 }, 'button')
  const activeButton = fakeElement('wormhole-settings', { x: 600, y: 1450, w: 180, h: 24 }, 'button')
  departingButton.parentCard = departingCard
  activeButton.parentCard = activeCard
  const anchor = fakeAnchor([activeCard, departingCard, departingButton, activeButton])
  const doc = {
    elementFromPoint() {
      return null
    },
  }

  assert.equal(findContextMenuElementAt(anchor, { x: 640, y: 1460 }, doc), activeButton)
})

test('context menu hit test does not return only a departing control', () => {
  const departingCard = fakeElement('sigil-menu-line-card', { x: 560, y: 1380, w: 292, h: 448 }, '.ctx-menu-card.departing')
  const departingButton = fakeElement('edge-scatter', { x: 600, y: 1450, w: 180, h: 24 }, 'button')
  departingButton.parentCard = departingCard
  const anchor = fakeAnchor([departingCard, departingButton])
  const doc = {
    elementFromPoint() {
      return null
    },
  }

  assert.equal(findContextMenuElementAt(anchor, { x: 640, y: 1460 }, doc), null)
})

test('context menu markup exposes standard accessibility structure', () => {
  const html = menuMarkup()

  assert.match(html, /id="sigil-context-menu"[^>]*role="dialog"[^>]*aria-label="Sigil avatar context menu"/)
  assert.match(html, /id="sigil-menu-root"[^>]*role="region"[^>]*aria-label="Sigil context menu root"/)
  assert.match(html, /class="ctx-tabs"[^>]*role="tablist"[^>]*aria-label="Sigil context menu sections"/)
  assert.match(html, /id="sigil-menu-tab-effects"[^>]*role="tab"[^>]*aria-label="Effects"[^>]*aria-selected="false"[^>]*aria-controls="sigil-menu-effects"[^>]*data-ctx-tab="sigil-menu-effects"/)
  assert.match(html, /id="sigil-menu-effects"[^>]*role="tabpanel"[^>]*aria-labelledby="sigil-menu-tab-effects"/)
  assert.match(html, /<label for="sigil-menu-line-duration">Travel Duration<\/label>/)
  assert.match(html, /id="sigil-menu-line-duration"[^>]*aria-describedby="sigil-menu-line-duration-value"/)
  assert.match(html, /id="sigil-menu-line-card"[^>]*role="region"[^>]*aria-label="Line trail settings"/)
  assert.match(html, /role="radiogroup"[^>]*aria-labelledby="sigil-menu-line-trail-effect-label"/)
  assert.match(html, /role="radio"[^>]*aria-checked="false"[^>]*data-sigil-line-trail-mode="shrink"/)
})
