// inspector-panel — Content factory for the AX element inspector overlay.
//
// Fed by `aos inspect` which pushes inspector/target messages (target probe
// bundles), legacy inspector/element messages, and inspector/cursor messages.
// The router strips the inspector/ prefix before delivery.

import { esc } from '../../runtime/bridge.js'

const BASE_TITLE = 'AX Inspector'

export default function InspectorPanel() {
  let contentEl = null

  function renderEmpty() {
    return '<div class="empty">Move cursor to inspect elements</div>'
  }

  function renderElement(data) {
    if (!data || !data.role) return '<div class="empty">No element under cursor</div>'
    let html = ''
    html += `<div class="row"><span class="label">Role</span><span class="value"><span class="role-badge">${esc(data.role)}</span></span></div>`
    if (data.title) html += `<div class="row"><span class="label">Title</span><span class="value">${esc(data.title)}</span></div>`
    if (data.label) html += `<div class="row"><span class="label">Label</span><span class="value">${esc(data.label)}</span></div>`
    if (data.value) html += `<div class="row"><span class="label">Value</span><span class="value">${esc(data.value)}</span></div>`
    if (data.bounds) {
      const b = data.bounds
      html += `<div class="row"><span class="label">Bounds</span><span class="value bounds">${Math.round(b.x)}, ${Math.round(b.y)}  ${Math.round(b.width)} \u00d7 ${Math.round(b.height)}</span></div>`
    }
    if (Array.isArray(data.context_path) && data.context_path.length > 0) {
      html += '<div class="path">'
      data.context_path.forEach((seg, i) => {
        if (i > 0) html += '<span class="sep">\u203a</span>'
        html += `<span>${esc(seg)}</span>`
      })
      html += '</div>'
    }
    return html
  }

  function renderTargetProbe(data) {
    const target = data?.target || {}
    const surface = data?.surface || {}
    if (!target.kind) return '<div class="empty">No target under cursor</div>'

    let html = ''
    html += `<div class="row"><span class="label">Target</span><span class="value"><span class="role-badge">${esc(target.kind)}</span></span></div>`
    if (target.role) html += `<div class="row"><span class="label">Role</span><span class="value">${esc(target.role)}</span></div>`
    if (target.name) html += `<div class="row"><span class="label">Name</span><span class="value">${esc(target.name)}</span></div>`
    else if (target.label) html += `<div class="row"><span class="label">Label</span><span class="value">${esc(target.label)}</span></div>`
    if (target.value_preview) html += `<div class="row"><span class="label">Value</span><span class="value">${esc(target.value_preview)}</span></div>`
    if (surface.app) html += `<div class="row"><span class="label">App</span><span class="value">${esc(surface.app)}</span></div>`
    if (target.bounds) {
      const b = target.bounds
      html += `<div class="row"><span class="label">Bounds</span><span class="value bounds">${Math.round(b.x)}, ${Math.round(b.y)}  ${Math.round(b.width)} \u00d7 ${Math.round(b.height)}</span></div>`
    }
    if (Array.isArray(data.path) && data.path.length > 0) {
      html += '<div class="path">'
      data.path.forEach((node, i) => {
        if (i > 0) html += '<span class="sep">\u203a</span>'
        html += `<span>${esc(node.label || node.kind || '')}</span>`
      })
      html += '</div>'
    }
    return html
  }

  return {
    manifest: {
      name: 'inspector-panel',
      title: BASE_TITLE,
      accepts: ['target', 'element', 'cursor'],
      emits: [],
      channelPrefix: 'inspector',
      defaultSize: { w: 320, h: 250 },
    },

    render(_host) {
      contentEl = document.createElement('div')
      contentEl.className = 'inspector-panel-body'
      contentEl.setAttribute('role', 'region')
      contentEl.setAttribute('aria-label', BASE_TITLE)
      contentEl.innerHTML = renderEmpty()
      return contentEl
    },

    onMessage(msg, host) {
      if (msg.type === 'target') {
        if (!contentEl) return
        contentEl.innerHTML = renderTargetProbe(msg.payload)
        return
      }
      if (msg.type === 'element') {
        if (!contentEl) return
        contentEl.innerHTML = renderElement(msg.payload)
        return
      }
      if (msg.type === 'cursor') {
        const p = msg.payload || {}
        host.setTitle(`${BASE_TITLE} \u2014 ${Math.round(p.x)}, ${Math.round(p.y)}  Display ${p.display}`)
        return
      }
    },
  }
}
