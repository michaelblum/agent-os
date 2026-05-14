import {
  BROWSER_DOM_ELEMENT_PICKER_ADAPTER_ID,
  buildBrowserDomElementTargetRecord,
  buildBrowserDomProjectionAdapterResult,
  createBrowserDomElementPickerController,
  isRejectableBrowserDomTarget,
} from './browser-dom-element-picker.js'

export const CONTROLLED_BROWSER_DOM_SURFACE_ID = 'controlled-browser-page'
export const CONTROLLED_BROWSER_DOM_FIXTURE_PATH = 'docs/design/fixtures/browser-dom-element-picker-v0/controlled-page.html'
export const CONTROLLED_BROWSER_DOM_TARGETS_REQUEST_TYPE = 'canvas_inspector.semantic_targets.request'
export const CONTROLLED_BROWSER_DOM_TARGETS_PAYLOAD_TYPE = 'canvas_inspector.semantic_targets'
export const CONTROLLED_BROWSER_DOM_PUBLISHER_VERSION = '0.1.0'

const DEFAULT_TARGET_SELECTORS = [
  'section[data-testid="hero-card"]',
  '#stable-cta',
  '#offscreen-target',
  '[data-qa="campaign-hero"]',
]

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim()
  return normalized || fallback
}

function cloneJson(value, fallback = null) {
  if (value === undefined) return fallback
  return JSON.parse(JSON.stringify(value))
}

function rectPayload(rect = null) {
  if (!rect) return null
  const x = Number(rect.x ?? rect.left)
  const y = Number(rect.y ?? rect.top)
  const width = Number(rect.width ?? rect.w)
  const height = Number(rect.height ?? rect.h)
  if (![x, y, width, height].every(Number.isFinite)) return null
  return { x, y, width, height }
}

function rectVisible(rect = null, viewport = {}) {
  if (!rect) return false
  const width = Number(viewport.width)
  const height = Number(viewport.height)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return rect.width > 0 && rect.height > 0
  return rect.width > 0
    && rect.height > 0
    && rect.x + rect.width >= 0
    && rect.y + rect.height >= 0
    && rect.x <= width
    && rect.y <= height
}

function selectorList(selectors = DEFAULT_TARGET_SELECTORS) {
  return [...new Set((Array.isArray(selectors) ? selectors : DEFAULT_TARGET_SELECTORS).map(text).filter(Boolean))]
}

function resolveDocumentTargets(doc, selectors = DEFAULT_TARGET_SELECTORS) {
  const seen = new Set()
  const targets = []
  for (const selector of selectorList(selectors)) {
    let nodes = []
    try {
      nodes = selector.includes(',') ? Array.from(doc?.querySelectorAll?.(selector) || []) : [doc?.querySelector?.(selector)].filter(Boolean)
    } catch {
      nodes = []
    }
    for (const node of nodes) {
      if (!node || seen.has(node)) continue
      seen.add(node)
      const rejection = isRejectableBrowserDomTarget(node, { document: doc })
      if (!rejection.rejected) targets.push(node)
    }
  }
  return targets
}

function normalizeViewport(doc, viewport = {}) {
  const win = doc?.defaultView || globalThis
  return {
    width: Number(viewport.width ?? win?.innerWidth) || 0,
    height: Number(viewport.height ?? win?.innerHeight) || 0,
    scroll_x: Number(viewport.scroll_x ?? viewport.scrollX ?? win?.scrollX) || 0,
    scroll_y: Number(viewport.scroll_y ?? viewport.scrollY ?? win?.scrollY) || 0,
    view_mode: text(viewport.view_mode, 'controlled_browser_fixture'),
  }
}

function sourceUrlAllowed(sourceUrl = '') {
  if (!sourceUrl) return true
  if (sourceUrl.startsWith('file:') && sourceUrl.endsWith(CONTROLLED_BROWSER_DOM_FIXTURE_PATH)) return true
  return false
}

function fixturePathAllowed(sourcePath = '') {
  return !sourcePath || sourcePath === CONTROLLED_BROWSER_DOM_FIXTURE_PATH
}

function assertControlledFixture(context = {}) {
  const sourcePath = text(context.source_path, CONTROLLED_BROWSER_DOM_FIXTURE_PATH)
  const sourceUrl = text(context.source_url || context.document?.location?.href)
  if (!fixturePathAllowed(sourcePath) || !sourceUrlAllowed(sourceUrl)) {
    throw new Error('controlled browser DOM publisher only supports the local controlled-page.html fixture')
  }
}

function selectorTarget(target = {}) {
  return [
    target.preferred_selector,
    ...(Array.isArray(target.selector_candidates) ? target.selector_candidates : []),
    target.source_tree_node_metadata?.preferred_selector,
    ...(Array.isArray(target.source_tree_node_metadata?.selector_candidates) ? target.source_tree_node_metadata.selector_candidates : []),
  ].map(text).filter(Boolean)
}

function resolveTargetElement(doc, target = {}) {
  for (const selector of selectorTarget(target)) {
    try {
      const element = doc?.querySelector?.(selector)
      if (element) return element
    } catch {}
  }
  return null
}

export function createControlledBrowserDomSurfacePublisher(doc = globalThis.document, context = {}) {
  assertControlledFixture({ ...context, document: doc })
  const viewport = normalizeViewport(doc, context.viewport)
  const sourcePath = text(context.source_path, CONTROLLED_BROWSER_DOM_FIXTURE_PATH)
  const sourceUrl = text(context.source_url || doc?.location?.href)
  const surfaceId = text(context.surface_id, CONTROLLED_BROWSER_DOM_SURFACE_ID)
  const now = text(context.now, '2026-05-10T00:00:00.000Z')
  const controller = createBrowserDomElementPickerController(doc, {
    surface_id: surfaceId,
    source_path: sourcePath,
    source_url: sourceUrl,
    viewport,
    now,
  })
  const state = {
    schema: 'controlled_browser_dom_surface_publisher_state',
    version: CONTROLLED_BROWSER_DOM_PUBLISHER_VERSION,
    surface_id: surfaceId,
    source_path: sourcePath,
    source_url: sourceUrl || null,
    selected_point: cloneJson(context.selected_point),
    ancestor_options: [],
    committed_element_target: null,
    targets: [],
    publish_count: 0,
    last_payload: null,
    last_reveal_result: null,
    opened_live_url: false,
  }

  function currentTargets() {
    const elements = resolveDocumentTargets(doc, context.target_selectors)
    return elements.map((element, index) => buildBrowserDomElementTargetRecord(element, {
      surface_id: surfaceId,
      source_path: sourcePath,
      source_url: sourceUrl,
      viewport,
      now,
      document: doc,
      ordinal: index + 1,
      metadata: {
        publisher: {
          adapter_id: BROWSER_DOM_ELEMENT_PICKER_ADAPTER_ID,
          controlled_fixture: true,
        },
      },
    }))
  }

  function publish(options = {}) {
    const targets = currentTargets()
    state.publish_count += 1
    state.targets = cloneJson(targets, [])
    const payload = {
      type: CONTROLLED_BROWSER_DOM_TARGETS_PAYLOAD_TYPE,
      surface_type: 'browser_page',
      canvas_id: surfaceId,
      surface: surfaceId,
      source_path: sourcePath,
      source_url: sourceUrl || null,
      semantic_targets: targets,
      targets,
      request_id: options.request_id || undefined,
      replay_reason: options.reason || 'publish',
      refreshed_at: text(options.refreshed_at || now),
      publish_count: state.publish_count,
    }
    state.last_payload = cloneJson(payload)
    return payload
  }

  function selectAt(x, y) {
    state.selected_point = { x: Number(x), y: Number(y), coordinate_space: 'viewport' }
    controller.contextClickAt(x, y, { source: 'surface_inspector_request' })
    state.ancestor_options = cloneJson(controller.state.ancestor_picker?.options || [], [])
    return cloneJson(state)
  }

  function commitAncestor(index = 0, commitContext = {}) {
    controller.commitAncestor(index, commitContext)
    state.committed_element_target = cloneJson(controller.state.committed_element_target)
    return state.committed_element_target
  }

  function revealTarget(target = {}) {
    const requestedAt = text(target.requested_at, now)
    const element = resolveTargetElement(doc, target)
    if (!element) {
      state.last_reveal_result = {
        status: 'target_absent',
        adapter_id: BROWSER_DOM_ELEMENT_PICKER_ADAPTER_ID,
        subject_id: text(target.subject_id || target.id),
        blocker_reason: 'browser_dom_target_not_found',
        requested_at: requestedAt,
        completed_at: requestedAt,
      }
      return cloneJson(state.last_reveal_result)
    }
    const before = rectPayload(element.getBoundingClientRect?.())
    const beforeVisible = rectVisible(before, viewport)
    if (!beforeVisible && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
    }
    const after = rectPayload(element.getBoundingClientRect?.())
    const afterVisible = rectVisible(after, viewport)
    const record = buildBrowserDomElementTargetRecord(element, {
      surface_id: surfaceId,
      source_path: sourcePath,
      source_url: sourceUrl,
      viewport,
      now: requestedAt,
      document: doc,
      metadata: { visibility: { state: afterVisible ? 'visible' : 'unsupported' } },
    })
    state.last_reveal_result = {
      status: beforeVisible ? 'already_visible' : (afterVisible ? 'revealed' : 'blocked'),
      adapter_id: BROWSER_DOM_ELEMENT_PICKER_ADAPTER_ID,
      subject_id: record.id,
      blocker_reason: afterVisible ? '' : 'scroll_into_view_did_not_make_target_visible',
      requested_at: requestedAt,
      completed_at: requestedAt,
      projection: buildBrowserDomProjectionAdapterResult(record),
    }
    return cloneJson(state.last_reveal_result)
  }

  function onMessage(message = {}) {
    if ((message.type || message.event) !== CONTROLLED_BROWSER_DOM_TARGETS_REQUEST_TYPE) return null
    return publish({
      request_id: message.request_id,
      reason: message.reason || 'request',
      refreshed_at: message.requested_at || now,
    })
  }

  return {
    state,
    controller,
    publish,
    onMessage,
    selectAt,
    commitAncestor,
    revealTarget,
  }
}

export function installControlledBrowserDomSurfacePublisher(doc = globalThis.document, context = {}) {
  const publisher = createControlledBrowserDomSurfacePublisher(doc, context)
  const win = doc?.defaultView || globalThis
  win.__aosControlledBrowserDomSurface = publisher.state
  win.__aosControlledBrowserDomPublisher = publisher
  win.aosSurfaceInspector = {
    ...(win.aosSurfaceInspector || {}),
    revealTarget: publisher.revealTarget,
  }
  return publisher
}
