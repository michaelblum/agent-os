import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BROWSER_DOM_ELEMENT_PICKER_ADAPTER_ID,
  buildBrowserDomAnnotationProjection,
  buildBrowserDomElementTargetRecord,
  buildBrowserDomProjectionAdapterResult,
  buildBrowserDomSelectorCandidates,
  buildBrowserDomXPath,
  buildBrowserDomAncestorPickerModel,
  buildBrowserDomAncestorChain,
  createBrowserDomElementPickerController,
  resolveBrowserDomElementAtPoint,
} from '../../packages/toolkit/workbench/browser-dom-element-picker.js'
import {
  CONTROLLED_BROWSER_DOM_FIXTURE_PATH,
  createControlledBrowserDomSurfacePublisher,
} from '../../packages/toolkit/workbench/controlled-browser-dom-surface.js'
import { assertAnnotationProjectionResultShape } from '../../packages/toolkit/workbench/annotation-projection.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

class FakeElement {
  constructor(tagName, attrs = {}, rect = { x: 0, y: 0, width: 1, height: 1 }, text = '') {
    this.nodeType = 1
    this.tagName = tagName.toUpperCase()
    this.attrs = new Map(Object.entries(attrs))
    this.rect = rect
    this.textContent = text
    this.innerText = text
    this.children = []
    this.parentElement = null
    this.previousElementSibling = null
    this.ownerDocument = null
    this.classList = new Set(String(attrs.class || '').split(/\s+/).filter(Boolean))
  }

  append(child) {
    child.parentElement = this
    child.previousElementSibling = this.children.at(-1) || null
    child.ownerDocument = this.ownerDocument
    this.children.push(child)
    return child
  }

  get id() {
    return this.getAttribute('id')
  }

  getAttribute(name) {
    return this.attrs.get(name) ?? null
  }

  getBoundingClientRect() {
    return this.rect
  }

  getRootNode() {
    return this.ownerDocument
  }

  matches(selector) {
    if (selector.includes('[data-aos-dom-picker-overlay]')) return this.attrs.has('data-aos-dom-picker-overlay')
    if (selector.startsWith('#')) return this.id === selector.slice(1)
    if (selector === 'section[data-testid="hero-card"]') return this.tagName === 'SECTION' && this.getAttribute('data-testid') === 'hero-card'
    if (selector === '[data-qa="campaign-hero"]') return this.getAttribute('data-qa') === 'campaign-hero'
    if (selector === '[data-testid="hero-card"]') return this.getAttribute('data-testid') === 'hero-card'
    if (selector === '[data-testid="primary-cta"]') return this.getAttribute('data-testid') === 'primary-cta'
    if (selector === '[data-cy="offscreen-cta"]') return this.getAttribute('data-cy') === 'offscreen-cta'
    return false
  }

  closest(selector) {
    let current = this
    while (current) {
      if (current.matches(selector)) return current
      current = current.parentElement
    }
    return null
  }
}

function createFixtureDocument() {
  const doc = {
    nodeType: 9,
    location: { href: 'file:///fixture/controlled-page.html' },
    defaultView: {
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 1,
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    },
    documentElement: { scrollLeft: 0, scrollTop: 0 },
    getElementById: (id) => doc.all.find((item) => item.id === id) || null,
    querySelector: () => null,
    querySelectorAll: (selector) => doc.all.filter((item) => item.matches(selector)),
    elementsFromPoint: () => [],
    all: [],
  }
  const body = new FakeElement('body', {}, { x: 0, y: 0, width: 800, height: 1800 }, '')
  const overlay = new FakeElement('div', { 'data-aos-dom-picker-overlay': '' }, { x: 90, y: 100, width: 20, height: 20 }, '')
  const main = new FakeElement('main', { class: 'hero', 'data-qa': 'campaign-hero', 'aria-label': 'Campaign hero' }, { x: 32, y: 32, width: 570, height: 154 }, 'Build a candidate story from exact page evidence. Request demo')
  const section = new FakeElement('section', { class: 'hero-card', 'data-testid': 'hero-card', 'aria-label': 'Employer brand hero' }, { x: 56, y: 56, width: 522, height: 106 }, 'Build a candidate story from exact page evidence. Request demo')
  const copy = new FakeElement('p', { class: 'primary-copy' }, { x: 72, y: 72, width: 360, height: 20 }, 'Build a candidate story from exact page evidence.')
  const button = new FakeElement('button', { id: 'stable-cta', 'data-testid': 'primary-cta', 'aria-label': 'Request demo' }, { x: 72, y: 104, width: 164, height: 40 }, 'Request demo')
  const offscreen = new FakeElement('button', { id: 'offscreen-target', 'data-cy': 'offscreen-cta', 'aria-label': 'Offscreen action' }, { x: 32, y: 1240, width: 220, height: 54 }, 'Offscreen action')
  offscreen.scrollIntoView = () => {
    doc.defaultView.scrollY = 940
    doc.documentElement.scrollTop = 940
    offscreen.rect = { x: 32, y: 300, width: 220, height: 54 }
  }
  for (const element of [body, overlay, main, section, copy, button, offscreen]) {
    element.ownerDocument = doc
    doc.all.push(element)
  }
  doc.body = body
  body.append(overlay)
  body.append(main)
  main.append(section)
  section.append(copy)
  section.append(button)
  body.append(offscreen)
  doc.elementsFromPoint = (x, y) => {
    if (x === 96 && y === 112) return [overlay, button, section, main, body]
    if (x === 90 && y === 120) return [button, section, main, body]
    if (x === 40 && y === 1260) return [offscreen, body]
    return [body]
  }
  doc.querySelector = (selector) => doc.all.find((item) => item.matches(selector)) || null
  return { doc, body, main, section, button, offscreen, overlay }
}

test('DOM adapter resolves the deepest non-tooling target and selector candidates', () => {
  const { doc, button } = createFixtureDocument()
  const resolved = resolveBrowserDomElementAtPoint(doc, { x: 96, y: 112 })
  assert.equal(resolved.element, button)
  assert.deepEqual(resolved.skipped, [{ tag_name: 'div', reason: 'overlay_or_tooling_dom' }])

  const selectors = buildBrowserDomSelectorCandidates(button, { document: doc })
  assert.deepEqual(selectors.slice(0, 3), ['#stable-cta', '[data-testid="primary-cta"]', '[role="button"][aria-label="Request demo"]'])
  assert.equal(buildBrowserDomXPath(button), '/body[1]/main[1]/section[1]/button[1]')
})

test('element picker state supports hover, ancestor preview, and committed element_target records', () => {
  const { doc } = createFixtureDocument()
  const controller = createBrowserDomElementPickerController(doc, {
    surface_id: 'controlled-browser-page',
    source_path: 'docs/design/fixtures/browser-dom-element-picker-v0/controlled-page.html',
    viewport: { width: 800, height: 600 },
    now: '2026-05-10T00:00:00.000Z',
  })

  controller.hoverAt(90, 120)
  assert.equal(controller.state.state, 'hover_candidate')
  assert.equal(controller.state.hover_candidate.tag_name, 'button')

  controller.contextClickAt(90, 120)
  assert.equal(controller.state.state, 'ancestor_picker_open')
  assert.deepEqual(controller.state.ancestor_picker.options.map((item) => item.descriptor.tag_name), ['button', 'section', 'main', 'body'])

  controller.hoverAncestor(1)
  assert.equal(controller.state.state, 'ancestor_preview_candidate')
  assert.equal(controller.state.ancestor_preview_candidate.tag_name, 'section')

  controller.commitAncestor(1, { ordinal: 3, actor: { role: 'human', id: 'operator' } })
  const record = controller.state.committed_element_target
  assert.equal(controller.state.state, 'committed_element_target')
  assert.equal(record.kind, 'element_target')
  assert.equal(record.surface_type, 'browser_page')
  assert.equal(record.preferred_selector, '[data-testid="hero-card"]')
  assert.equal(record.metadata.picker.source, 'right_click_badge')
  assert.equal(record.metadata.later.playwright_locator, null)
})

test('committed browser DOM targets are annotation projection compatible and model reveal blockers', () => {
  const { doc, button, offscreen } = createFixtureDocument()
  const visible = buildBrowserDomElementTargetRecord(button, {
    surface_id: 'controlled-browser-page',
    source_url: 'file:///fixture/controlled-page.html',
    viewport: { width: 800, height: 600 },
    now: '2026-05-10T00:00:00.000Z',
    document: doc,
  })
  const offscreenRecord = buildBrowserDomElementTargetRecord(offscreen, {
    surface_id: 'controlled-browser-page',
    source_url: 'file:///fixture/controlled-page.html',
    viewport: { width: 800, height: 600 },
    now: '2026-05-10T00:00:00.000Z',
    document: doc,
  })

  const adapter = buildBrowserDomProjectionAdapterResult(visible)
  assert.equal(adapter.adapter_id, BROWSER_DOM_ELEMENT_PICKER_ADAPTER_ID)
  assert.equal(adapter.current_render_status, 'visible')
  assert.equal(adapter.can_project_display_overlay, true)

  const offscreenAdapter = buildBrowserDomProjectionAdapterResult(offscreenRecord)
  assert.equal(offscreenAdapter.current_render_status, 'offscreen_scrollable')
  assert.equal(offscreenAdapter.can_reveal, true)
  assert.equal(offscreenAdapter.blocker_reason, 'target_not_visible_or_zero_area')

  const projection = buildBrowserDomAnnotationProjection(visible, {
    viewport: { width: 800, height: 600, view_mode: 'controlled_fixture' },
  })
  assertAnnotationProjectionResultShape(projection)
  assert.equal(projection.surface_binding.surface_type, 'browser_page')
  assert.equal(projection.projections[0].anchor_type, 'element_target')
  assert.equal(projection.projections[0].source_anchor.selector_candidates[0], '#stable-cta')
})

test('browser DOM element target fixture validates against the annotation schema', () => {
  const { doc, button } = createFixtureDocument()
  const record = buildBrowserDomElementTargetRecord(button, {
    surface_id: 'controlled-browser-page',
    source_path: 'docs/design/fixtures/browser-dom-element-picker-v0/controlled-page.html',
    viewport: { width: 800, height: 600 },
    now: '2026-05-10T00:00:00.000Z',
    document: doc,
  })
  const schemaPath = path.join(repoRoot, 'shared/schemas/annotation.schema.json')
  const result = spawnSync('python3', [
    '-c',
    `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator
schema = json.loads(Path(sys.argv[1]).read_text())
instance = {"schema": "annotations", "version": "0.2.0", "annotations": [json.loads(sys.stdin.read())]}
errors = sorted(Draft202012Validator(schema).iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors:
        print(error.message)
    sys.exit(1)
`,
    schemaPath,
  ], {
    input: JSON.stringify(record),
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})

test('ancestor picker model reports an explicit blocker when only rejected targets are hit', () => {
  const { doc, overlay } = createFixtureDocument()
  doc.elementsFromPoint = () => [overlay]
  const picker = buildBrowserDomAncestorPickerModel(doc, { x: 4, y: 4 })
  assert.equal(picker.state, 'inactive')
  assert.equal(picker.blocker_reason, 'overlay_or_tooling_dom')
  assert.deepEqual(picker.options, [])
})

test('controlled browser DOM surface publisher emits, replays, commits, and reveals local fixture targets', () => {
  const { doc } = createFixtureDocument()
  const publisher = createControlledBrowserDomSurfacePublisher(doc, {
    surface_id: 'controlled-browser-page',
    source_path: CONTROLLED_BROWSER_DOM_FIXTURE_PATH,
    source_url: `file:///repo/${CONTROLLED_BROWSER_DOM_FIXTURE_PATH}`,
    viewport: { width: 800, height: 600 },
    now: '2026-05-10T00:00:00.000Z',
  })

  const initial = publisher.publish({ reason: 'initial' })
  assert.equal(initial.type, 'canvas_inspector.semantic_targets')
  assert.equal(initial.surface_type, 'browser_page')
  assert.ok(initial.semantic_targets.some((target) => target.preferred_selector === '[data-testid="hero-card"]'))
  assert.ok(initial.semantic_targets.some((target) => target.preferred_selector === '#offscreen-target'))
  assert.ok(!initial.semantic_targets.some((target) => target.selector_candidates.includes('[data-aos-dom-picker-overlay]')))

  const replay = publisher.onMessage({
    type: 'canvas_inspector.semantic_targets.request',
    request_id: 'late-attach',
    reason: 'late_surface_inspector_attach',
  })
  assert.equal(replay.request_id, 'late-attach')
  assert.equal(replay.publish_count, 2)
  assert.equal(publisher.state.publish_count, 2)

  publisher.selectAt(90, 120)
  assert.deepEqual(publisher.state.ancestor_options.map((item) => item.descriptor.tag_name), ['button', 'section', 'main', 'body'])
  const committed = publisher.commitAncestor(1, { ordinal: 4 })
  assert.equal(committed.kind, 'element_target')
  assert.equal(committed.preferred_selector, '[data-testid="hero-card"]')

  const hero = replay.semantic_targets.find((target) => target.preferred_selector === '[data-testid="hero-card"]')
  const offscreen = replay.semantic_targets.find((target) => target.preferred_selector === '#offscreen-target')
  assert.equal(publisher.revealTarget(hero).status, 'already_visible')
  const revealed = publisher.revealTarget(offscreen)
  assert.equal(revealed.status, 'revealed')
  assert.equal(revealed.projection.current_render_status, 'visible')
})

test('controlled browser DOM surface publisher rejects non-controlled sources', () => {
  const { doc } = createFixtureDocument()
  assert.throws(() => createControlledBrowserDomSurfacePublisher(doc, {
    source_path: 'docs/design/fixtures/other.html',
    source_url: 'https://example.com/',
  }), /only supports the local controlled-page\.html fixture/)
})

test('DOM adapter rejects unsupported targets and crosses shadow roots through the host', () => {
  const { doc, body } = createFixtureDocument()
  const script = new FakeElement('script', {}, { x: 10, y: 10, width: 40, height: 20 }, '')
  const hidden = new FakeElement('button', { id: 'hidden-button' }, { x: 10, y: 10, width: 40, height: 20 }, 'Hidden')
  const zero = new FakeElement('button', { id: 'zero-button' }, { x: 10, y: 10, width: 0, height: 20 }, 'Zero')
  const visible = new FakeElement('button', { id: 'shadow-action', 'aria-label': 'Shadow action' }, { x: 10, y: 10, width: 80, height: 24 }, 'Shadow action')
  const host = new FakeElement('div', { id: 'shadow-host' }, { x: 8, y: 8, width: 100, height: 40 }, 'Shadow host')
  for (const element of [script, hidden, zero, visible, host]) {
    element.ownerDocument = doc
    doc.all.push(element)
  }
  body.append(host)
  visible.parentElement = null
  visible.getRootNode = () => ({ host })
  doc.defaultView.getComputedStyle = (element) => (
    element === hidden
      ? { display: 'none', visibility: 'visible', opacity: '1' }
      : { display: 'block', visibility: 'visible', opacity: '1' }
  )
  doc.elementsFromPoint = () => [script, hidden, zero, visible]

  const resolved = resolveBrowserDomElementAtPoint(doc, { x: 16, y: 16 })
  assert.equal(resolved.element, visible)
  assert.deepEqual(resolved.skipped.map((item) => item.reason), [
    'unsupported_tag',
    'hidden_target',
    'zero_area_target',
  ])
  assert.deepEqual(buildBrowserDomAncestorChain(visible, { document: doc }).map((item) => item.tag_name), [
    'button',
    'div',
    'body',
  ])
})
