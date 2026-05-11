export const HTML_WORKBENCH_EXPRESSION_OPEN_TYPE = 'html_workbench_expression.open'
export const HTML_WORKBENCH_EXPRESSION_SURFACE = 'html-workbench-expression'
export const HTML_WORKBENCH_EXPRESSION_SEMANTIC_TARGETS_REQUEST_TYPE = 'canvas_inspector.semantic_targets.request'

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim()
  return normalized || fallback
}

function cloneJson(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function payloadFromMessage(message = {}) {
  return message.payload && typeof message.payload === 'object' ? message.payload : message
}

function expressionTitle(metadata = {}) {
  return text(
    metadata.semantic_targets?.find?.((target) => target.kind === 'document')?.accessible_label
      || metadata.semantic_targets?.[0]?.accessible_label
      || metadata.expression_id,
    'HTML Workbench Expression',
  )
}

export function createHtmlWorkbenchExpressionState({
  metadata = null,
  html = '',
  source = null,
} = {}) {
  return {
    metadata: metadata && typeof metadata === 'object' ? cloneJson(metadata) : null,
    html: String(html ?? ''),
    source: source && typeof source === 'object' ? cloneJson(source) : null,
    last_result: null,
  }
}

export function openHtmlWorkbenchExpression(state, message = {}) {
  const payload = payloadFromMessage(message)
  const metadata = payload.metadata && typeof payload.metadata === 'object' ? cloneJson(payload.metadata) : null
  const html = String(payload.html ?? '')
  if (!metadata?.expression_id) {
    state.last_result = {
      type: 'html_workbench_expression.open.result',
      status: 'rejected',
      reason: 'metadata.expression_id is required',
    }
    return state.last_result
  }
  state.metadata = metadata
  state.html = html
  state.source = payload.source && typeof payload.source === 'object' ? cloneJson(payload.source) : null
  state.last_result = {
    type: 'html_workbench_expression.open.result',
    status: 'opened',
    expression_id: metadata.expression_id,
    semantic_target_count: Array.isArray(metadata.semantic_targets) ? metadata.semantic_targets.length : 0,
  }
  return state.last_result
}

export function htmlWorkbenchExpressionSnapshot(state) {
  return {
    surface: HTML_WORKBENCH_EXPRESSION_SURFACE,
    expression_id: state.metadata?.expression_id || null,
    source_path: state.metadata?.source?.path || null,
    semantic_target_count: state.metadata?.semantic_targets?.length || 0,
    last_result: state.last_result ? cloneJson(state.last_result) : null,
  }
}

function rectPayload(rect = null) {
  if (!rect) return null
  const x = Number(rect.x ?? rect.left)
  const y = Number(rect.y ?? rect.top)
  const w = Number(rect.w ?? rect.width)
  const h = Number(rect.h ?? rect.height)
  if (![x, y, w, h].every(Number.isFinite)) return null
  return { x, y, w, h }
}

function targetId(target = {}) {
  return text(target.id || target.target_id || target.semantic_target_id || target.ref || target.data_aos_ref)
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value))
  return String(value).replace(/["\\]/g, '\\$&')
}

function targetSelectors(target = {}) {
  const selectors = []
  if (target.selector) selectors.push(String(target.selector))
  if (target.target_id) selectors.push(`[data-semantic-target-id="${cssEscape(target.target_id)}"]`)
  if (target.id) selectors.push(`[data-semantic-target-id="${cssEscape(target.id)}"]`)
  if (target.data_aos_ref) selectors.push(`[data-aos-ref="${cssEscape(target.data_aos_ref)}"]`)
  if (target.aos_ref) selectors.push(`[data-aos-ref="${cssEscape(target.aos_ref)}"]`)
  return [...new Set(selectors.filter(Boolean))]
}

function resolveTargetElement(document_, target = {}) {
  for (const selector of targetSelectors(target)) {
    try {
      const element = document_?.querySelector?.(selector)
      if (element) return element
    } catch {}
  }
  return null
}

export function buildHtmlWorkbenchSemanticTargetsPayload(state, {
  document_ = globalThis.document,
  viewport = null,
  now = new Date().toISOString(),
} = {}) {
  const metadataTargets = Array.isArray(state.metadata?.semantic_targets) ? state.metadata.semantic_targets : []
  const viewportRect = viewport || rectPayload(document_?.querySelector?.('.html-expression-content-wrap')?.getBoundingClientRect?.())
  const targets = metadataTargets.map((target) => {
    const element = resolveTargetElement(document_, target)
    const rect = rectPayload(element?.getBoundingClientRect?.())
    const visible = Boolean(rect && (
      viewportRect
        ? rect.x + rect.w >= viewportRect.x && rect.y + rect.h >= viewportRect.y && rect.x <= viewportRect.x + viewportRect.w && rect.y <= viewportRect.y + viewportRect.h
        : rect.x + rect.w >= 0 && rect.y + rect.h >= 0
    ))
    const canReveal = target.reveal_eligible !== false && Boolean(element || target.selector || target.target_id || target.data_aos_ref || target.aos_ref)
    return {
      ...target,
      id: targetId(target),
      canvas_id: HTML_WORKBENCH_EXPRESSION_SURFACE,
      surface: HTML_WORKBENCH_EXPRESSION_SURFACE,
      name: target.accessible_label || target.name || targetId(target),
      label: target.accessible_label || target.label || targetId(target),
      current_render_status: visible ? 'visible' : (canReveal ? 'offscreen_scrollable' : 'unsupported'),
      display_space_rect: visible ? rect : null,
      local_space_rect: rect,
      can_reveal: canReveal,
      revealable: canReveal,
      refreshed_at: now,
      blocker_reason: canReveal ? '' : 'semantic_target_not_resolved',
    }
  })
  return {
    type: 'canvas_inspector.semantic_targets',
    canvas_id: HTML_WORKBENCH_EXPRESSION_SURFACE,
    surface: HTML_WORKBENCH_EXPRESSION_SURFACE,
    semantic_targets: targets,
    refreshed_at: now,
  }
}

function expressionBodyHtml(html) {
  const parser = new DOMParser()
  const document_ = parser.parseFromString(String(html || ''), 'text/html')
  document_.querySelectorAll('script').forEach((node) => node.remove())
  document_.querySelectorAll('*').forEach((node) => {
    for (const attribute of [...node.attributes]) {
      if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name)
    }
  })
  return document_.body?.innerHTML || '<p>HTML expression content was not provided.</p>'
}

export default function HtmlWorkbenchExpression(options = {}) {
  let host = null
  const state = createHtmlWorkbenchExpressionState(options)
  const dom = {}
  let publishFrame = 0

  function emit(type, payload = {}) {
    host?.emit?.(type, payload)
  }

  function sendToCanvas(target, message = {}) {
    if (!target) return
    window.webkit?.messageHandlers?.headsup?.postMessage?.({
      type: 'canvas.send',
      payload: {
        target,
        message,
      },
    })
  }

  function sendToSurfaceInspector(message = {}) {
    sendToCanvas('canvas-inspector', message)
  }

  function publishSemanticTargets(options = {}) {
    publishFrame = 0
    if (!state.metadata) return
    const payload = buildHtmlWorkbenchSemanticTargetsPayload(state)
    emit('canvas_inspector.semantic_targets', payload)
    const target = text(options.reply_to || options.requester_canvas_id, 'canvas-inspector')
    sendToCanvas(target, {
      ...payload,
      request_id: options.request_id || undefined,
      replay_reason: options.reason || undefined,
    })
    return payload
  }

  function scheduleSemanticTargetsPublish() {
    if (publishFrame || typeof window === 'undefined') return
    publishFrame = window.requestAnimationFrame(publishSemanticTargets)
  }

  function render() {
    const root = document.createElement('section')
    root.className = 'html-expression-workbench'
    root.dataset.aosRef = `${HTML_WORKBENCH_EXPRESSION_SURFACE}:root`
    root.dataset.aosSurface = HTML_WORKBENCH_EXPRESSION_SURFACE

    const toolbar = document.createElement('header')
    toolbar.className = 'html-expression-toolbar'
    toolbar.dataset.aosRef = `${HTML_WORKBENCH_EXPRESSION_SURFACE}:toolbar`

    dom.title = document.createElement('div')
    dom.title.className = 'html-expression-title'

    dom.meta = document.createElement('div')
    dom.meta.className = 'html-expression-meta'

    toolbar.append(dom.title, dom.meta)

    const frameWrap = document.createElement('div')
    frameWrap.className = 'html-expression-content-wrap'
    frameWrap.dataset.aosRef = `${HTML_WORKBENCH_EXPRESSION_SURFACE}:content-wrap`

    dom.content = document.createElement('div')
    dom.content.className = 'html-expression-content'
    dom.content.dataset.aosRef = `${HTML_WORKBENCH_EXPRESSION_SURFACE}:content`
    frameWrap.append(dom.content)
    frameWrap.addEventListener('scroll', scheduleSemanticTargetsPublish, { passive: true })

    dom.empty = document.createElement('div')
    dom.empty.className = 'html-expression-empty'
    dom.empty.textContent = 'Open an HTML Workbench Expression to review.'
    frameWrap.append(dom.empty)

    root.append(toolbar, frameWrap)
    sync()
    return root
  }

  function sync() {
    const metadata = state.metadata
    dom.title.textContent = expressionTitle(metadata || {})
    dom.meta.innerHTML = ''
    if (metadata) {
      const sourceLabel = document.createElement('span')
      sourceLabel.textContent = 'Source'
      const source = document.createElement('code')
      source.textContent = metadata.source?.path || 'unknown'
      const targetLabel = document.createElement('span')
      targetLabel.textContent = 'Targets'
      const targets = document.createElement('code')
      targets.textContent = String(metadata.semantic_targets?.length || 0)
      dom.meta.append(sourceLabel, source, targetLabel, targets)
      dom.content.innerHTML = expressionBodyHtml(state.html)
      dom.content.hidden = false
      dom.empty.hidden = true
    } else {
      const status = document.createElement('span')
      status.textContent = 'Waiting for expression payload'
      dom.meta.append(status)
      dom.content.hidden = true
      dom.content.innerHTML = ''
      dom.empty.hidden = false
    }
    window.__htmlWorkbenchExpressionState = htmlWorkbenchExpressionSnapshot(state)
    window.aosSurfaceInspector = {
      ...(window.aosSurfaceInspector || {}),
      revealTarget,
    }
    scheduleSemanticTargetsPublish()
  }

  function revealTarget(target = {}) {
    const now = new Date().toISOString()
    const metadataTarget = state.metadata?.semantic_targets?.find?.((item) => {
      const id = targetId(item)
      return id && [target.subject_id, target.id, target.target_id].map(String).includes(String(id))
    }) || target.source_tree_node_metadata || target
    const element = resolveTargetElement(document, metadataTarget)
    if (!element) return { status: 'target_absent', blocker_reason: 'semantic_target_not_found', completed_at: now }
    const before = rectPayload(element.getBoundingClientRect())
    const viewport = rectPayload(dom.content?.parentElement?.getBoundingClientRect?.())
    const alreadyVisible = before && viewport
      ? before.x + before.w >= viewport.x && before.y + before.h >= viewport.y && before.x <= viewport.x + viewport.w && before.y <= viewport.y + viewport.h
      : Boolean(before)
    if (!alreadyVisible && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
    }
    if (typeof element.focus === 'function' && (element.tabIndex >= 0 || /^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/i.test(element.tagName))) {
      element.focus({ preventScroll: true })
    }
    const rect = rectPayload(element.getBoundingClientRect())
    const nextViewport = rectPayload(dom.content?.parentElement?.getBoundingClientRect?.())
    const visible = rect && nextViewport
      ? rect.x + rect.w >= nextViewport.x && rect.y + rect.h >= nextViewport.y && rect.x <= nextViewport.x + nextViewport.w && rect.y <= nextViewport.y + nextViewport.h
      : Boolean(rect)
    scheduleSemanticTargetsPublish()
    return {
      status: alreadyVisible ? 'already_visible' : (visible ? 'revealed' : 'blocked'),
      blocker_reason: visible ? '' : 'scroll_into_view_did_not_make_target_visible',
      completed_at: now,
      projection: {
        status: visible ? 'visible' : 'clipped',
        can_reveal: true,
        display_space_rect: visible ? rect : null,
        local_space_rect: rect,
        refreshed_at: now,
      },
    }
  }

  function onMessage(message = {}) {
    const type = message?.type || message?.event || ''
    if (type === HTML_WORKBENCH_EXPRESSION_OPEN_TYPE) {
      const result = openHtmlWorkbenchExpression(state, message)
      emit(result.type, result)
      sync()
    } else if (type === HTML_WORKBENCH_EXPRESSION_SEMANTIC_TARGETS_REQUEST_TYPE) {
      publishSemanticTargets({
        request_id: message.request_id,
        reply_to: message.reply_to,
        requester_canvas_id: message.requester_canvas_id,
        reason: message.reason || 'request',
      })
    }
  }

  return {
    manifest: {
      name: HTML_WORKBENCH_EXPRESSION_SURFACE,
      title: 'HTML Workbench Expression',
      accepts: [HTML_WORKBENCH_EXPRESSION_OPEN_TYPE, HTML_WORKBENCH_EXPRESSION_SEMANTIC_TARGETS_REQUEST_TYPE],
      emits: ['html_workbench_expression.open.result', 'canvas_inspector.semantic_targets', 'canvas.send'],
      channelPrefix: HTML_WORKBENCH_EXPRESSION_SURFACE,
      defaultSize: { w: 1180, h: 760 },
    },

    render(host_) {
      host = host_
      host.contentEl.style.overflow = 'hidden'
      return render()
    },

    onMessage,

    serialize() {
      return htmlWorkbenchExpressionSnapshot(state)
    },
  }
}
