import {
  buildAnnotationProjectionResult,
  normalizeAnnotationProjectionAdapterResult,
} from './annotation-projection.js'

export const BROWSER_DOM_ELEMENT_PICKER_ADAPTER_ID = 'aos-browser-dom-element-picker'
export const BROWSER_DOM_ELEMENT_PICKER_STATE_KEY = '__aosDomElementPickerState'
export const BROWSER_DOM_ELEMENT_PICKER_VERSION = '0.1.0'

export const ELEMENT_PICKER_STATES = new Set([
  'inactive',
  'hover_candidate',
  'ancestor_picker_open',
  'ancestor_preview_candidate',
  'committed_element_target',
])

const REJECTED_TAGS = new Set(['SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK', 'HTML', 'TEMPLATE', 'NOSCRIPT'])
const DATA_SELECTOR_ATTRS = ['data-testid', 'data-test', 'data-cy', 'data-qa']
const TOOLING_SELECTOR = [
  '[data-aos-overlay]',
  '[data-aos-tooling]',
  '[data-aos-dom-picker-overlay]',
  '[data-surface-inspector-overlay]',
  '[data-testid="aos-dom-element-picker"]',
  '.aos-dom-element-picker',
  '.aos-surface-inspector-overlay',
].join(',')

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim()
  return normalized || fallback
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function stableId(prefix, parts = []) {
  const material = parts.map((part) => text(part)).filter(Boolean).join('|') || prefix
  let hash = 2166136261
  for (let i = 0; i < material.length; i += 1) {
    hash ^= material.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`
}

function nowIso(context = {}) {
  return text(context.now || context.created_at || context.updated_at, '1970-01-01T00:00:00.000Z')
}

function cloneJson(value, fallback = null) {
  if (value === undefined) return fallback
  return JSON.parse(JSON.stringify(value))
}

function cssEscape(value) {
  const raw = String(value ?? '')
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(raw)
  return raw.replace(/[\0-\x1f\x7f]|^-?\d|^-$|[^\w-]/g, (char, index) => {
    if (char === '\0') return '\uFFFD'
    if ((index === 0 && /[-\d]/.test(char)) || (index === 1 && /\d/.test(char) && raw[0] === '-')) {
      return `\\${char.charCodeAt(0).toString(16)} `
    }
    if (/^[\w-]$/.test(char)) return char
    return `\\${char}`
  })
}

function cssString(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function rectFromDomRect(rect = null) {
  if (!rect) return null
  const x = numberOrNull(rect.x ?? rect.left)
  const y = numberOrNull(rect.y ?? rect.top)
  const width = numberOrNull(rect.width)
  const height = numberOrNull(rect.height)
  if ([x, y, width, height].some((item) => item === null)) return null
  return { x, y, width, height }
}

function rectWithXYWH(rect = null) {
  const source = rectFromDomRect(rect)
  return source ? { x: source.x, y: source.y, w: source.width, h: source.height } : null
}

function pageBoundsFromViewport(viewportBounds, doc = null) {
  if (!viewportBounds) return null
  const win = doc?.defaultView
  return {
    x: viewportBounds.x + (numberOrNull(win?.scrollX) ?? numberOrNull(doc?.documentElement?.scrollLeft) ?? 0),
    y: viewportBounds.y + (numberOrNull(win?.scrollY) ?? numberOrNull(doc?.documentElement?.scrollTop) ?? 0),
    width: viewportBounds.width,
    height: viewportBounds.height,
  }
}

function rectIntersectsViewport(rect, viewport = null) {
  if (!rect) return false
  if (!viewport) return rect.width > 0 && rect.height > 0
  const width = numberOrNull(viewport.width)
  const height = numberOrNull(viewport.height)
  if (width === null || height === null) return rect.width > 0 && rect.height > 0
  return rect.width > 0
    && rect.height > 0
    && rect.x + rect.width >= 0
    && rect.y + rect.height >= 0
    && rect.x <= width
    && rect.y <= height
}

function normalizePoint(point = null) {
  if (!point || typeof point !== 'object') return null
  const x = numberOrNull(point.x)
  const y = numberOrNull(point.y)
  if (x === null || y === null) return null
  return { x, y }
}

function elementTagName(element = null) {
  return text(element?.tagName).toLowerCase()
}

function elementMatches(element, selector) {
  try {
    return Boolean(element?.matches?.(selector))
  } catch {
    return false
  }
}

function elementClosest(element, selector) {
  try {
    return element?.closest?.(selector) || null
  } catch {
    return null
  }
}

function stableAttributeValue(value) {
  const normalized = text(value)
  if (!normalized) return ''
  if (normalized.length > 96) return ''
  if (/^\d+$/.test(normalized)) return ''
  if (/(^|[-_:])(?:[a-f0-9]{8,}|[0-9]{6,}|uuid|generated|random)([-_:]|$)/i.test(normalized)) return ''
  return normalized
}

function stableClassTokens(element = null) {
  const tokens = Array.from(element?.classList || [])
    .map((item) => text(item))
    .filter(Boolean)
    .filter((item) => item.length <= 48)
    .filter((item) => !/(^|[-_:])(?:[a-f0-9]{8,}|[0-9]{4,}|active|focus|hover|selected|open|closed|enter|leave)([-_:]|$)/i.test(item))
  return [...new Set(tokens)].slice(0, 3)
}

function visibleStyleAllowsTarget(element = null, doc = null) {
  const view = doc?.defaultView
  const style = view?.getComputedStyle?.(element)
  if (!style) return true
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
  if (Number(style.opacity) === 0) return false
  return true
}

export function viewportBoundsForElement(element = null) {
  return rectFromDomRect(element?.getBoundingClientRect?.())
}

export function isRejectableBrowserDomTarget(element = null, options = {}) {
  const doc = options.document || element?.ownerDocument || null
  if (!element || element.nodeType !== 1) return { rejected: true, reason: 'not_an_element' }
  if (REJECTED_TAGS.has(text(element.tagName).toUpperCase())) return { rejected: true, reason: 'unsupported_tag' }
  if (elementMatches(element, options.toolingSelector || TOOLING_SELECTOR) || elementClosest(element, options.toolingSelector || TOOLING_SELECTOR)) {
    return { rejected: true, reason: 'overlay_or_tooling_dom' }
  }
  if (!visibleStyleAllowsTarget(element, doc)) return { rejected: true, reason: 'hidden_target' }
  const rect = viewportBoundsForElement(element)
  if (!rect || rect.width <= 0 || rect.height <= 0) return { rejected: true, reason: 'zero_area_target' }
  return { rejected: false, reason: '' }
}

export function resolveBrowserDomElementAtPoint(doc, point = {}, options = {}) {
  const x = numberOrNull(point.x)
  const y = numberOrNull(point.y)
  if (!doc || x === null || y === null) return { element: null, skipped: [], blocker_reason: 'invalid_point_or_document' }
  const stack = typeof doc.elementsFromPoint === 'function'
    ? Array.from(doc.elementsFromPoint(x, y) || [])
    : [doc.elementFromPoint?.(x, y)].filter(Boolean)
  const skipped = []
  for (const element of stack) {
    const rejection = isRejectableBrowserDomTarget(element, { ...options, document: doc })
    if (!rejection.rejected) return { element, skipped, blocker_reason: '' }
    skipped.push({ tag_name: elementTagName(element), reason: rejection.reason })
  }
  return { element: null, skipped, blocker_reason: skipped[0]?.reason || 'no_dom_target_at_point' }
}

function parentAcrossShadowBoundary(element = null) {
  if (!element) return null
  if (element.parentElement) return element.parentElement
  const root = element.getRootNode?.()
  return root?.host || null
}

export function buildBrowserDomAncestorChain(element = null, options = {}) {
  const doc = options.document || element?.ownerDocument || null
  const chain = []
  let current = element
  const seen = new Set()
  while (current && current.nodeType === 1 && !seen.has(current)) {
    seen.add(current)
    const rejection = isRejectableBrowserDomTarget(current, { ...options, document: doc })
    if (!rejection.rejected || current === element) {
      chain.push(describeBrowserDomElement(current, { document: doc }))
    }
    if (elementTagName(current) === 'body') break
    current = parentAcrossShadowBoundary(current)
  }
  if (!chain.some((item) => item.tag_name === 'body') && doc?.body && current !== doc.body) {
    chain.push(describeBrowserDomElement(doc.body, { document: doc }))
  }
  return chain
}

function nativeRole(element = null) {
  const tag = elementTagName(element)
  if (tag === 'a' && element?.getAttribute?.('href')) return 'link'
  if (tag === 'button') return 'button'
  if (tag === 'textarea') return 'textbox'
  if (tag === 'select') return 'combobox'
  if (tag === 'input') {
    const type = text(element.getAttribute('type'), 'text').toLowerCase()
    if (['button', 'submit', 'reset'].includes(type)) return 'button'
    if (type === 'checkbox') return 'checkbox'
    if (type === 'radio') return 'radio'
    if (type === 'range') return 'slider'
    return 'textbox'
  }
  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) return 'heading'
  if (tag === 'img') return 'img'
  if (tag === 'nav') return 'navigation'
  if (tag === 'main') return 'main'
  if (tag === 'section') return 'region'
  return ''
}

function labelById(doc, id) {
  const target = doc?.getElementById?.(id)
  return text(target?.textContent)
}

export function accessibleNameForElement(element = null, options = {}) {
  const doc = options.document || element?.ownerDocument || null
  const labelledBy = text(element?.getAttribute?.('aria-labelledby'))
  if (labelledBy) {
    const joined = labelledBy.split(/\s+/).map((id) => labelById(doc, id)).filter(Boolean).join(' ')
    if (joined) return joined
  }
  for (const attr of ['aria-label', 'alt', 'title', 'placeholder', 'name', 'value']) {
    const value = stableAttributeValue(element?.getAttribute?.(attr))
    if (value) return value
  }
  if (element?.id) {
    const label = doc?.querySelector?.(`label[for="${cssString(element.id)}"]`)
    if (text(label?.textContent)) return text(label.textContent)
  }
  return text(element?.textContent).replace(/\s+/g, ' ').slice(0, 120)
}

export function browserDomTextExcerpt(element = null, maxLength = 160) {
  const value = text(element?.innerText || element?.textContent).replace(/\s+/g, ' ')
  return value.slice(0, maxLength)
}

function nthOfTypeSelector(element = null) {
  const tag = elementTagName(element) || '*'
  let index = 1
  let sibling = element?.previousElementSibling || null
  while (sibling) {
    if (elementTagName(sibling) === tag) index += 1
    sibling = sibling.previousElementSibling
  }
  return `${tag}:nth-of-type(${index})`
}

function parentPathSelector(element = null, maxDepth = 4) {
  const parts = []
  let current = element
  while (current && current.nodeType === 1 && elementTagName(current) !== 'html' && parts.length < maxDepth) {
    const id = stableAttributeValue(current.getAttribute?.('id'))
    if (id) {
      parts.unshift(`#${cssEscape(id)}`)
      break
    }
    const dataAttr = DATA_SELECTOR_ATTRS.find((attr) => stableAttributeValue(current.getAttribute?.(attr)))
    if (dataAttr) {
      parts.unshift(`[${dataAttr}="${cssString(current.getAttribute(dataAttr))}"]`)
      break
    }
    parts.unshift(nthOfTypeSelector(current))
    if (elementTagName(current) === 'body') break
    current = parentAcrossShadowBoundary(current)
  }
  return parts.join(' > ')
}

export function buildBrowserDomSelectorCandidates(element = null, options = {}) {
  if (!element) return []
  const candidates = []
  const add = (selector) => {
    const normalized = text(selector)
    if (normalized && !candidates.includes(normalized)) candidates.push(normalized)
  }
  const id = stableAttributeValue(element.getAttribute?.('id'))
  if (id) add(`#${cssEscape(id)}`)
  for (const attr of DATA_SELECTOR_ATTRS) {
    const value = stableAttributeValue(element.getAttribute?.(attr))
    if (value) add(`[${attr}="${cssString(value)}"]`)
  }
  const name = stableAttributeValue(element.getAttribute?.('name'))
  if (name) add(`${elementTagName(element)}[name="${cssString(name)}"]`)
  const role = text(element.getAttribute?.('role') || nativeRole(element))
  const label = accessibleNameForElement(element, options)
  if (role && label) add(`[role="${cssString(role)}"][aria-label="${cssString(label)}"]`)
  const classTokens = stableClassTokens(element)
  if (classTokens.length) add(`${elementTagName(element)}.${classTokens.map(cssEscape).join('.')}`)
  add(parentPathSelector(element))
  return candidates
}

export function buildBrowserDomXPath(element = null) {
  if (!element || element.nodeType !== 1) return null
  const parts = []
  let current = element
  while (current && current.nodeType === 1) {
    const tag = elementTagName(current)
    if (!tag || tag === 'html') break
    let index = 1
    let sibling = current.previousElementSibling
    while (sibling) {
      if (elementTagName(sibling) === tag) index += 1
      sibling = sibling.previousElementSibling
    }
    parts.unshift(`${tag}[${index}]`)
    if (tag === 'body') break
    current = parentAcrossShadowBoundary(current)
  }
  return parts.length ? `/${parts.join('/')}` : null
}

export function describeBrowserDomElement(element = null, options = {}) {
  const doc = options.document || element?.ownerDocument || null
  const viewport_bounds = viewportBoundsForElement(element)
  const page_bounds = pageBoundsFromViewport(viewport_bounds, doc)
  const selector_candidates = buildBrowserDomSelectorCandidates(element, { document: doc })
  const tag_name = elementTagName(element)
  const role = text(element?.getAttribute?.('role') || nativeRole(element))
  const label = accessibleNameForElement(element, { document: doc })
  const text_excerpt = browserDomTextExcerpt(element)
  return {
    id: stableId('dom-node', [selector_candidates[0], tag_name, label, text_excerpt, JSON.stringify(page_bounds)]),
    tag_name,
    role,
    label,
    text_excerpt,
    selector_candidates,
    preferred_selector: selector_candidates[0] || null,
    xpath: buildBrowserDomXPath(element),
    viewport_bounds,
    page_bounds,
  }
}

export function buildBrowserDomElementTargetRecord(element = null, context = {}) {
  const doc = context.document || element?.ownerDocument || null
  const descriptor = describeBrowserDomElement(element, { document: doc })
  const ancestor_chain = buildBrowserDomAncestorChain(element, { document: doc })
  const sourceUrl = text(context.source_url || doc?.location?.href)
  const sourcePath = text(context.source_path)
  const anchorPoint = normalizePoint(context.anchor_point) || (descriptor.viewport_bounds
    ? {
      x: descriptor.viewport_bounds.x + descriptor.viewport_bounds.width / 2,
      y: descriptor.viewport_bounds.y + descriptor.viewport_bounds.height / 2,
    }
    : null)
  const id = text(context.id, stableId('element-target', [
    sourceUrl,
    sourcePath,
    descriptor.preferred_selector,
    descriptor.xpath,
    JSON.stringify(anchorPoint),
  ]))
  const timestamp = nowIso(context)
  const visible = rectIntersectsViewport(descriptor.viewport_bounds, context.viewport)

  return {
    id,
    ordinal: Number.isInteger(context.ordinal) ? context.ordinal : 1,
    kind: 'element_target',
    surface_id: text(context.surface_id, 'browser-page'),
    surface_type: 'browser_page',
    source_url: sourceUrl || null,
    source_path: sourcePath || null,
    coordinate_space: 'viewport',
    point: anchorPoint,
    anchor_point: anchorPoint,
    bounds: descriptor.viewport_bounds,
    viewport_bounds: descriptor.viewport_bounds,
    page_bounds: descriptor.page_bounds,
    selector_candidates: descriptor.selector_candidates,
    preferred_selector: descriptor.preferred_selector,
    xpath: descriptor.xpath,
    tag_name: descriptor.tag_name,
    role: descriptor.role,
    label: descriptor.label,
    accessible_name: descriptor.label,
    text_excerpt: descriptor.text_excerpt,
    ancestor_chain: ancestor_chain.map((item) => item.preferred_selector || item.xpath || item.tag_name).filter(Boolean),
    ancestor_descriptors: ancestor_chain,
    note: text(context.note, 'Browser DOM element target.'),
    actor: context.actor || { role: 'operator', id: 'gdi' },
    status: text(context.status, 'committed'),
    lifecycle: {
      clearable: context.clearable !== false,
      committed_at: context.status === 'draft' ? null : timestamp,
      resolved_at: null,
      rejected_at: null,
      recovered_from: null,
      ...cloneJson(context.lifecycle, {}),
    },
    capture: {
      prepare: {
        annotation_layer_visible: false,
        target_content_mutated: false,
        browser_dom_picker_overlay_hidden: true,
        ...(context.capture?.prepare || {}),
      },
      restore: {
        annotation_layer_visible: true,
        browser_dom_picker_overlay_hidden: false,
        ...(context.capture?.restore || {}),
      },
    },
    created_at: timestamp,
    updated_at: timestamp,
    metadata: {
      picker: {
        source: text(context.source, 'element_picker'),
        state_version: BROWSER_DOM_ELEMENT_PICKER_VERSION,
      },
      visibility: {
        state: visible ? 'visible' : 'unsupported',
        can_reveal: Boolean(context.can_reveal ?? descriptor.preferred_selector),
        reveal_action: descriptor.preferred_selector ? 'scrollIntoView' : null,
        blocker_reason: visible ? '' : 'target_not_visible_or_zero_area',
      },
      later: {
        playwright_locator: context.playwright_locator ?? null,
        codegen: context.codegen ?? null,
      },
      ...(context.metadata || {}),
    },
  }
}

export function buildBrowserDomAncestorPickerModel(doc, point = {}, context = {}) {
  const resolved = resolveBrowserDomElementAtPoint(doc, point, context)
  if (!resolved.element) {
    return {
      state: 'inactive',
      point: { x: numberOrNull(point.x) ?? 0, y: numberOrNull(point.y) ?? 0, coordinate_space: 'viewport' },
      candidate: null,
      options: [],
      skipped: resolved.skipped,
      blocker_reason: resolved.blocker_reason,
    }
  }
  const chain = buildBrowserDomAncestorChain(resolved.element, { document: doc })
  return {
    state: 'ancestor_picker_open',
    point: { x: numberOrNull(point.x) ?? 0, y: numberOrNull(point.y) ?? 0, coordinate_space: 'viewport' },
    candidate: chain[0] || null,
    options: chain.map((item, index) => ({
      index,
      id: item.id,
      label: [item.tag_name, item.role, item.label].filter(Boolean).join(' '),
      preview_bounds: item.viewport_bounds,
      selector_candidates: item.selector_candidates,
      descriptor: item,
    })),
    skipped: resolved.skipped,
    blocker_reason: '',
  }
}

export function buildBrowserDomProjectionAdapterResult(record = {}, options = {}) {
  const visible = record.metadata?.visibility?.state === 'visible' && record.viewport_bounds
  const canReveal = Boolean(record.metadata?.visibility?.can_reveal ?? record.preferred_selector)
  return normalizeAnnotationProjectionAdapterResult({
    adapter_id: BROWSER_DOM_ELEMENT_PICKER_ADAPTER_ID,
    subject_id: record.id,
    subject_path: ['browser_page', text(record.surface_id, 'browser-page'), 'dom', text(record.preferred_selector || record.xpath || record.id)],
    root_id: text(record.surface_id, 'browser-page'),
    root_path: ['browser_page', text(record.surface_id, 'browser-page')],
    subject_kind: text(record.tag_name || record.role, 'dom_element'),
    source_tree_node_metadata: {
      kind: record.kind,
      source_url: record.source_url,
      source_path: record.source_path,
      preferred_selector: record.preferred_selector,
      selector_candidates: record.selector_candidates || [],
      xpath: record.xpath ?? null,
      accessible_name: record.accessible_name || record.label || '',
    },
    current_render_status: options.current_render_status || (visible ? 'visible' : (canReveal ? 'offscreen_scrollable' : 'unsupported')),
    can_project_display_overlay: Boolean(visible),
    can_reveal: canReveal,
    display_space_rect: visible ? record.viewport_bounds : null,
    local_space_rect: record.page_bounds || record.viewport_bounds || null,
    ancestor_viewport_clip_chain: [],
    scrollable_ancestor_chain: canReveal && !visible ? [{
      id: text(record.surface_id, 'browser-page'),
      kind: 'browser_page_scroll',
      rect: null,
      overflow: 'scroll',
      scroll: { x: null, y: null, max_x: null, max_y: null },
    }] : [],
    blocker_reason: visible ? '' : text(record.metadata?.visibility?.blocker_reason, canReveal ? 'target_requires_scrollIntoView' : 'browser_dom_target_not_projectable'),
    refreshed_at: text(options.refreshed_at || record.updated_at || record.created_at, '1970-01-01T00:00:00.000Z'),
    provenance_source_payload_id: text(options.provenance_source_payload_id || record.id),
  })
}

export function buildBrowserDomElementAnnotationCandidate(record = {}, options = {}) {
  const projection = buildBrowserDomProjectionAdapterResult(record, options)
  const contentRect = rectWithXYWH(options.content_rect || options.browser_content_rect)
  const viewportRect = rectWithXYWH(record.viewport_bounds || record.bounds)
  const canProject = Boolean(contentRect && viewportRect && projection.can_project_display_overlay !== false)
  const displayRect = canProject
    ? {
        x: contentRect.x + viewportRect.x,
        y: contentRect.y + viewportRect.y,
        w: viewportRect.w,
        h: viewportRect.h,
      }
    : null
  const blockerReason = canProject
    ? ''
    : text(options.blocker_reason || projection.blocker_reason || (!contentRect ? 'browser_content_inset_unresolved' : 'browser_dom_target_not_projectable'))
  return {
    id: text(record.id || projection.subject_id),
    adapter_id: BROWSER_DOM_ELEMENT_PICKER_ADAPTER_ID,
    root_id: projection.root_id,
    root_kind: 'browser_page',
    root_label: text(options.root_label || record.source_url || record.surface_id || projection.root_id, projection.root_id),
    subject_id: projection.subject_id,
    subject_path: projection.subject_path,
    subject_kind: projection.subject_kind,
    role: text(record.role || record.tag_name || projection.subject_kind),
    label: text(record.accessible_name || record.label || record.text_excerpt || projection.subject_id, projection.subject_id),
    text_excerpt: text(record.text_excerpt),
    preferred_selector: record.preferred_selector || null,
    selector_candidates: Array.isArray(record.selector_candidates) ? [...record.selector_candidates] : [],
    xpath: record.xpath ?? null,
    display_space_rect: displayRect,
    local_space_rect: rectWithXYWH(record.page_bounds || record.viewport_bounds || record.bounds),
    projection: {
      ...projection,
      status: canProject ? 'visible' : 'unsupported',
      current_render_status: canProject ? 'visible' : 'unsupported',
      can_project_display_overlay: canProject,
      projectable: canProject,
      display_space_rect: displayRect,
      visible_display_rect: displayRect,
      coordinate_space: 'desktop_world',
      blocker_reason: blockerReason,
      source_tree_node_metadata: {
        ...(projection.source_tree_node_metadata || {}),
        frame_chain: Array.isArray(record.frame_chain) ? [...record.frame_chain] : [],
        shadow_chain: Array.isArray(record.shadow_chain) ? [...record.shadow_chain] : [],
        selector_candidates: Array.isArray(record.selector_candidates) ? [...record.selector_candidates] : [],
        preferred_selector: record.preferred_selector || null,
        xpath: record.xpath ?? null,
        source_url: record.source_url || null,
        browser_content_rect: contentRect,
        skipped_stack: Array.isArray(record.skipped) ? cloneJson(record.skipped, []) : [],
        rejection_reasons: Array.isArray(record.rejection_reasons)
          ? cloneJson(record.rejection_reasons, [])
          : (Array.isArray(record.skipped) ? record.skipped.map((entry) => text(entry.reason)).filter(Boolean) : []),
      },
    },
    blocker_reason: blockerReason,
    blocker: blockerReason ? { reason: blockerReason } : null,
    source_metadata: {
      adapter_scope: 'explicit_browser_dom_element',
      source_url: record.source_url || null,
      source_path: record.source_path || null,
      frame_chain: Array.isArray(record.frame_chain) ? [...record.frame_chain] : [],
      shadow_chain: Array.isArray(record.shadow_chain) ? [...record.shadow_chain] : [],
      selector_candidates: Array.isArray(record.selector_candidates) ? [...record.selector_candidates] : [],
      preferred_selector: record.preferred_selector || null,
      xpath: record.xpath ?? null,
      tag_name: record.tag_name || null,
      role: record.role || null,
      label: record.accessible_name || record.label || '',
      text_excerpt: record.text_excerpt || '',
      browser_content_rect: contentRect,
      skipped_stack: Array.isArray(record.skipped) ? cloneJson(record.skipped, []) : [],
      rejection_reasons: Array.isArray(record.rejection_reasons)
        ? cloneJson(record.rejection_reasons, [])
        : (Array.isArray(record.skipped) ? record.skipped.map((entry) => text(entry.reason)).filter(Boolean) : []),
      browser_attachment: options.browser_attachment || 'explicit_local_page',
      browser_session_id: options.browser_session_id || record.browser_session_id || null,
      browser_window_id: options.browser_window_id || record.browser_window_id || null,
      browser_pid: options.browser_pid || record.browser_pid || null,
      provenance: options.provenance || 'browser_dom_element_picker',
    },
  }
}

export function buildBrowserDomAnnotationProjection(record = {}, options = {}) {
  return buildAnnotationProjectionResult({
    surface_binding: {
      surface_id: text(record.surface_id, 'browser-page'),
      surface_type: 'browser_page',
      source_path: record.source_path || null,
      source_url: record.source_url || null,
      tab_id: options.tab_id || null,
      window_id: options.window_id || null,
    },
    viewport: options.viewport || {
      width: record.metadata?.viewport?.width || 0,
      height: record.metadata?.viewport?.height || 0,
      scroll_x: 0,
      scroll_y: 0,
      zoom: 1,
      scale: 1,
      device_pixel_ratio: 1,
      view_mode: 'browser_page',
    },
    annotations: [record],
    adapter_projections: [{
      annotation_id: record.id,
      status: record.viewport_bounds ? 'resolved' : 'unsupported',
      anchor_type: 'element_target',
      rects: record.viewport_bounds ? [record.viewport_bounds] : [],
      precision: 'browser_dom_element',
      confidence: record.viewport_bounds ? 0.9 : 0,
      reason: record.viewport_bounds ? '' : 'browser_dom_target_not_visible',
      ...buildBrowserDomProjectionAdapterResult(record, options),
    }],
    layer: options.layer || {},
  })
}

export function createBrowserDomElementPickerState(initial = {}) {
  return {
    schema: 'browser_dom_element_picker_state',
    version: BROWSER_DOM_ELEMENT_PICKER_VERSION,
    state: ELEMENT_PICKER_STATES.has(initial.state) ? initial.state : 'inactive',
    hover_candidate: initial.hover_candidate || null,
    ancestor_picker: initial.ancestor_picker || null,
    ancestor_preview_candidate: initial.ancestor_preview_candidate || null,
    committed_element_target: initial.committed_element_target || null,
    blockers: Array.isArray(initial.blockers) ? initial.blockers : [],
  }
}

export function createBrowserDomElementPickerController(doc, context = {}) {
  const state = createBrowserDomElementPickerState(context.initial_state || {})
  const elementsByDescriptorId = new Map()

  function rememberChain(point = {}, chain = []) {
    elementsByDescriptorId.clear()
    let current = resolveBrowserDomElementAtPoint(doc, point)?.element
    for (const descriptor of chain) {
      if (current) elementsByDescriptorId.set(descriptor.id, current)
      current = parentAcrossShadowBoundary(current)
    }
  }

  function hoverAt(x, y) {
    const resolved = resolveBrowserDomElementAtPoint(doc, { x, y }, context)
    if (!resolved.element) {
      Object.assign(state, createBrowserDomElementPickerState({
        state: 'inactive',
        blockers: [resolved.blocker_reason],
      }))
      return state
    }
    const descriptor = describeBrowserDomElement(resolved.element, { document: doc })
    Object.assign(state, {
      state: 'hover_candidate',
      hover_candidate: {
        ...descriptor,
        anchor_point: { x, y, coordinate_space: 'viewport' },
      },
      ancestor_picker: null,
      ancestor_preview_candidate: null,
      committed_element_target: null,
      blockers: [],
    })
    return state
  }

  function selectAt(x, y, pickContext = {}) {
    const picker = buildBrowserDomAncestorPickerModel(doc, { x, y }, context)
    if (picker.options.length) rememberChain({ x, y }, picker.options.map((item) => item.descriptor))
    Object.assign(state, {
      state: picker.options.length ? 'ancestor_picker_open' : 'inactive',
      ancestor_picker: picker.options.length ? picker : null,
      hover_candidate: picker.candidate ? { ...picker.candidate, anchor_point: picker.point } : null,
      ancestor_preview_candidate: null,
      committed_element_target: null,
      blockers: picker.blocker_reason ? [picker.blocker_reason] : [],
      source: text(pickContext.source, 'element_picker'),
    })
    return state
  }

  function hoverAncestor(index) {
    const option = state.ancestor_picker?.options?.[index]
    if (!option) return state
    Object.assign(state, {
      state: 'ancestor_preview_candidate',
      ancestor_preview_candidate: option.descriptor,
      blockers: [],
    })
    return state
  }

  function commitAncestor(index, commitContext = {}) {
    const option = state.ancestor_picker?.options?.[index]
    if (!option) return state
    const element = elementsByDescriptorId.get(option.id)
    const record = element
      ? buildBrowserDomElementTargetRecord(element, {
        ...context,
        ...commitContext,
        source: text(commitContext.source || state.source, 'element_picker'),
        anchor_point: state.ancestor_picker?.point,
      })
      : {
        ...option.descriptor,
        kind: 'element_target',
        source: text(commitContext.source || state.source, 'element_picker'),
      }
    Object.assign(state, {
      state: 'committed_element_target',
      ancestor_preview_candidate: option.descriptor,
      committed_element_target: record,
      blockers: [],
    })
    return state
  }

  return {
    state,
    hoverAt,
    selectAt,
    contextClickAt: (x, y, pickContext = {}) => selectAt(x, y, { source: 'right_click_badge', ...pickContext }),
    hoverAncestor,
    commitAncestor,
  }
}

export function installBrowserDomElementPicker(doc = globalThis.document, context = {}) {
  const controller = createBrowserDomElementPickerController(doc, context)
  const win = doc?.defaultView || globalThis
  win[BROWSER_DOM_ELEMENT_PICKER_STATE_KEY] = controller.state
  win.__aosDomElementPicker = controller
  return controller
}
