// log-console — Content factory for the scrolling timestamped log panel.
//
// Displays log entries with severity levels (info/warn/error/debug).
// Fed by `aos log` which pushes log/append messages and log/clear.
// The router strips the log/ prefix and delivers as {type:'append'|'clear'}.

import { esc } from '../../runtime/bridge.js'

const MAX_ENTRIES = 500
const BASE_TITLE = 'Log'

export default function LogConsole() {
  let entriesEl = null
  let dragDebugEl = null
  let host = null

  function ts() {
    const now = new Date()
    return String(now.getHours()).padStart(2, '0') + ':' +
           String(now.getMinutes()).padStart(2, '0') + ':' +
           String(now.getSeconds()).padStart(2, '0')
  }

  function updateTitle() {
    if (!host) return
    const n = entriesEl ? entriesEl.children.length : 0
    host.setTitle(n > 0 ? `${BASE_TITLE} \u2014 ${n}` : BASE_TITLE)
  }

  function appendEntry({ ts: tsStr, level, text }) {
    if (!entriesEl) return
    const entry = document.createElement('div')
    entry.className = 'entry'
    entry.innerHTML =
      `<span class="ts">${esc(tsStr)}</span>` +
      `<span class="level ${esc(level)}">${esc(level)}</span>` +
      `<span class="msg">${esc(text)}</span>`
    entriesEl.appendChild(entry)
    while (entriesEl.children.length > MAX_ENTRIES) {
      entriesEl.removeChild(entriesEl.firstChild)
    }
  }

  function setDragDebug(text, active = false) {
    if (!dragDebugEl) return
    dragDebugEl.textContent = text
    dragDebugEl.dataset.active = active ? 'true' : 'false'
  }

  return {
    manifest: {
      name: 'log-console',
      title: BASE_TITLE,
      accepts: ['append', 'clear', 'drag.telemetry', 'drag.started', 'drag.ended'],
      emits: [],
      channelPrefix: 'log',
      defaultSize: { w: 450, h: 300 },
    },

    render(host_) {
      host = host_
      const root = document.createElement('div')
      root.id = 'log-console-root'
      dragDebugEl = document.createElement('div')
      dragDebugEl.id = 'drag-debug'
      setDragDebug('drag idle', false)
      entriesEl = document.createElement('div')
      entriesEl.id = 'entries'
      root.appendChild(dragDebugEl)
      root.appendChild(entriesEl)
      return root
    },

    onMessage(msg) {
      if (msg.type === 'drag.started') {
        setDragDebug('drag active', true)
        return
      }

      if (msg.type === 'drag.ended') {
        setDragDebug('drag ended', false)
        return
      }

      if (msg.type === 'drag.telemetry') {
        const p = msg.payload || {}
        const mouse = p.mouse || {}
        const requested = p.requestedTopLeft || {}
        const actual = p.actualTopLeft || {}
        setDragDebug(
          `mouse ${fmt(mouse.x)},${fmt(mouse.y)}  req ${fmt(requested.x)},${fmt(requested.y)}  tl ${fmt(actual.x)},${fmt(actual.y)}`,
          true
        )
        return
      }

      if (msg.type === 'append') {
        if (!entriesEl) return
        const p = msg.payload || {}
        const text = p.text || ''
        const level = p.level || 'info'
        appendEntry({ ts: ts(), level, text })
        if (entriesEl.parentElement) {
          entriesEl.parentElement.scrollTop = entriesEl.parentElement.scrollHeight
        }
        updateTitle()
        return
      }

      if (msg.type === 'clear') {
        if (!entriesEl) return
        entriesEl.innerHTML = ''
        updateTitle()
        return
      }
    },

    serialize() {
      if (!entriesEl) return { entries: [] }
      const entries = Array.from(entriesEl.querySelectorAll('.entry')).map(el => ({
        ts: el.querySelector('.ts')?.textContent || '',
        level: el.querySelector('.level')?.textContent || 'info',
        text: el.querySelector('.msg')?.textContent || '',
      }))
      return { entries, dragDebug: dragDebugEl?.textContent || 'drag idle' }
    },

    restore(state, host_) {
      if (host_) host = host_
      if (!entriesEl || !state?.entries) return
      setDragDebug(state.dragDebug || 'drag idle', false)
      entriesEl.innerHTML = ''
      for (const e of state.entries) {
        appendEntry({ ts: e.ts, level: e.level || 'info', text: e.text })
      }
      updateTitle()
    },
  }
}

function fmt(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '?'
  return String(Math.round(value))
}
