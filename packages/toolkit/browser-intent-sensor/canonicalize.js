export const LOCATOR_STRATEGY_VERSION = 'aos.browser-locator.v0'
export const LOCATOR_PRIORITY = Object.freeze(['role_name', 'text', 'css', 'ref', 'rect'])

function quoteJS(value) {
  return JSON.stringify(String(value ?? ''))
}

function normalizeRect(rect) {
  if (!rect || typeof rect !== 'object') return null
  const x = Number(rect.x)
  const y = Number(rect.y)
  const width = Number(rect.width ?? rect.w)
  const height = Number(rect.height ?? rect.h)
  if (![x, y, width, height].every(Number.isFinite)) return null
  return { x, y, width, height }
}

function defaultValidator() {
  return true
}

export async function buildLocatorCandidates(descriptor = {}, options = {}) {
  const validateCandidate = options.validateCandidate ?? defaultValidator
  const candidates = []

  if (descriptor.role && descriptor.name) {
    candidates.push({
      id: 'role_name',
      kind: 'role',
      role: descriptor.role,
      name: descriptor.name,
      playwright: `page.getByRole(${quoteJS(descriptor.role)}, { name: ${quoteJS(descriptor.name)} })`,
    })
  }

  if (descriptor.text) {
    candidates.push({
      id: 'text',
      kind: 'text',
      text: descriptor.text,
      playwright: `page.getByText(${quoteJS(descriptor.text)})`,
    })
  }

  if (descriptor.selector) {
    candidates.push({
      id: 'css',
      kind: 'css',
      selector: descriptor.selector,
      playwright: `page.locator(${quoteJS(descriptor.selector)})`,
    })
  }

  if (descriptor.ref) {
    candidates.push({
      id: 'ref',
      kind: 'ref',
      ref: descriptor.ref,
      playwright: `page.locator(${quoteJS(`[data-aos-ref="${descriptor.ref}"]`)})`,
    })
  }

  const rect = normalizeRect(descriptor.rect)
  if (rect) {
    candidates.push({
      id: 'rect',
      kind: 'rect',
      rect,
      playwright: `page.mouse.click(${Math.round(rect.x + rect.width / 2)}, ${Math.round(rect.y + rect.height / 2)})`,
    })
  }

  const validated = []
  for (const candidate of candidates) {
    validated.push({
      ...candidate,
      validated_at_mark_time: await validateCandidate(candidate, descriptor),
    })
  }
  return validated
}

export function selectLocatorCandidate(candidates) {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  for (const id of LOCATOR_PRIORITY) {
    const candidate = byId.get(id)
    if (candidate?.validated_at_mark_time) return id
  }
  return candidates[0]?.id ?? null
}

export async function canonicalizeBrowserMark(rawMark, options = {}) {
  if (!rawMark || typeof rawMark !== 'object') throw new Error('raw mark must be an object')

  const descriptor = rawMark.descriptor ?? {}
  const target = normalizeTarget(rawMark, descriptor)
  const rect = normalizeRect(rawMark.rect ?? descriptor.rect)
  const candidates = await buildLocatorCandidates({ ...descriptor, rect }, options)
  if (candidates.length === 0) throw new Error('browser mark requires at least one locator candidate')
  const selected = selectLocatorCandidate(candidates)

  const anchors = {
    replay: {
      locator_strategy_version: LOCATOR_STRATEGY_VERSION,
      selected_locator: selected,
      locator_candidates: candidates,
      aos_target: target.target_id,
    },
  }

  const semantic = semanticAnchors(rawMark, descriptor)
  if (Object.keys(semantic).length > 0) anchors.semantic = semantic
  if (rect) anchors.spatial = { viewport_rect: rect }
  if (rawMark.desktop_rect) anchors.spatial = { ...(anchors.spatial ?? {}), desktop_rect: normalizeRect(rawMark.desktop_rect) }
  if (rawMark.screenshot_path || rawMark.crop_path) {
    anchors.visual = {}
    if (rawMark.screenshot_path) anchors.visual.screenshot_path = rawMark.screenshot_path
    if (rawMark.crop_path) anchors.visual.crop_path = rawMark.crop_path
  }

  const mark = {
    type: 'human.mark',
    event_id: rawMark.event_id ?? options.idGenerator?.('event') ?? `evt_${rawMark.mark_id ?? Date.now()}`,
    session_id: rawMark.session_id ?? options.session_id ?? 'unknown',
    mark_id: rawMark.mark_id ?? options.idGenerator?.('mark') ?? `mark_${Date.now()}`,
    kind: rawMark.kind ?? 'element',
    target,
    anchors,
    resolution: rawMark.resolution ?? 'unresolved',
    at: rawMark.at ?? options.clock?.() ?? new Date().toISOString(),
  }

  if (rawMark.utterance ?? rawMark.comment) mark.utterance = rawMark.utterance ?? rawMark.comment
  if (Number.isFinite(rawMark.confidence)) mark.confidence = rawMark.confidence
  if (rawMark.parent_mark_id) mark.parent_mark_id = rawMark.parent_mark_id
  return mark
}

export function canonicalizeBrowserAnnotation(rawAnnotation, options = {}) {
  if (!rawAnnotation?.mark_id) throw new Error('annotation requires mark_id')
  return {
    type: 'human.annotation',
    event_id: rawAnnotation.event_id ?? options.idGenerator?.('event') ?? `evt_${rawAnnotation.mark_id}_${Date.now()}`,
    session_id: rawAnnotation.session_id ?? options.session_id ?? 'unknown',
    annotation_id: rawAnnotation.annotation_id ?? options.idGenerator?.('annotation') ?? `anno_${Date.now()}`,
    mark_id: rawAnnotation.mark_id,
    note: rawAnnotation.note ?? rawAnnotation.comment ?? '',
    at: rawAnnotation.at ?? options.clock?.() ?? new Date().toISOString(),
  }
}

function normalizeTarget(rawMark, descriptor) {
  const target = rawMark.target ?? {}
  const targetId = target.target_id
    ?? rawMark.target_id
    ?? (descriptor.ref ? `browser:${rawMark.browser_session ?? rawMark.session_id ?? 'unknown'}/${descriptor.ref}` : `browser:${rawMark.browser_session ?? rawMark.session_id ?? 'unknown'}`)

  return {
    surface: 'browser',
    target_id: targetId,
    ...(target.app || rawMark.app ? { app: target.app ?? rawMark.app } : {}),
    ...(target.window_id !== undefined || rawMark.window_id !== undefined ? { window_id: target.window_id ?? rawMark.window_id } : {}),
    url: target.url ?? rawMark.url ?? descriptor.url ?? 'about:blank',
    ...(target.title || rawMark.title ? { title: target.title ?? rawMark.title } : {}),
  }
}

function semanticAnchors(rawMark, descriptor) {
  const semantic = {}
  if (descriptor.role) semantic.role = descriptor.role
  if (descriptor.name) semantic.name = descriptor.name
  if (descriptor.text) semantic.text = descriptor.text
  if (descriptor.selector) semantic.selector_hints = [descriptor.selector]
  if (Array.isArray(rawMark.contained_elements) && rawMark.contained_elements.length) {
    semantic.contained_elements = rawMark.contained_elements.map((entry, index) => ({
      descriptor_id: entry.descriptor_id ?? entry.ref ?? `contained_${index + 1}`,
      ...(entry.role ? { role: entry.role } : {}),
      ...(entry.name ? { name: entry.name } : {}),
      ...(entry.selector ? { selector: entry.selector } : {}),
      ...(entry.text ? { text: entry.text } : {}),
    }))
  }
  return semantic
}
