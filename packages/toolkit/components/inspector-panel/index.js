// inspector-panel — Content factory for the AX element inspector overlay.
//
// Fed by `aos inspect` which pushes inspector/element messages (AX data under
// cursor) and inspector/cursor messages (live cursor coords + display number).
// The router strips the inspector/ prefix and delivers as {type:'element'|'cursor'}.

import { esc } from '../../runtime/bridge.js'

const BASE_TITLE = 'AOS Inspector'

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

  return {
    manifest: {
      name: 'inspector-panel',
      title: BASE_TITLE,
      accepts: ['element', 'cursor'],
      emits: [],
      channelPrefix: 'inspector',
      defaultSize: { w: 320, h: 250 },
    },

    render(_host) {
      contentEl = document.createElement('div')
      contentEl.className = 'inspector-panel-body'
      contentEl.innerHTML = renderEmpty()
      return contentEl
    },

    onMessage(msg, host) {
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
