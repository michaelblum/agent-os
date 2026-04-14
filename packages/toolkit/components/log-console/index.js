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
  let host = null
  let count = 0

  function ts() {
    const now = new Date()
    return String(now.getHours()).padStart(2, '0') + ':' +
           String(now.getMinutes()).padStart(2, '0') + ':' +
           String(now.getSeconds()).padStart(2, '0')
  }

  return {
    manifest: {
      name: 'log-console',
      title: BASE_TITLE,
      accepts: ['append', 'clear'],
      emits: [],
      channelPrefix: 'log',
      defaultSize: { w: 450, h: 300 },
    },

    render(_host) {
      host = _host
      entriesEl = document.createElement('div')
      entriesEl.id = 'entries'
      return entriesEl
    },

    onMessage(msg, _host) {
      if (msg.type === 'append') {
        if (!entriesEl) return
        const p = msg.payload || {}
        const text = p.text || p.message || ''
        const level = p.level || 'info'

        const entry = document.createElement('div')
        entry.className = 'entry'
        entry.innerHTML =
          `<span class="ts">${ts()}</span>` +
          `<span class="level ${esc(level)}">${esc(level)}</span>` +
          `<span class="msg">${esc(text)}</span>`

        entriesEl.appendChild(entry)
        count++

        while (entriesEl.children.length > MAX_ENTRIES) {
          entriesEl.removeChild(entriesEl.firstChild)
        }

        entriesEl.parentElement && (entriesEl.parentElement.scrollTop = entriesEl.parentElement.scrollHeight)

        const h = _host || host
        if (h) h.setTitle(`${BASE_TITLE} \u2014 ${count}`)
        return
      }

      if (msg.type === 'clear') {
        if (!entriesEl) return
        entriesEl.innerHTML = ''
        count = 0
        const h = _host || host
        if (h) h.setTitle(BASE_TITLE)
        return
      }
    },

    serialize() {
      if (!entriesEl) return { entries: [], count }
      const entries = Array.from(entriesEl.querySelectorAll('.entry')).map(el => ({
        ts: el.querySelector('.ts')?.textContent || '',
        level: el.querySelector('.level')?.textContent || 'info',
        text: el.querySelector('.msg')?.textContent || '',
      }))
      return { entries, count }
    },

    restore(state) {
      if (!entriesEl || !state?.entries) return
      entriesEl.innerHTML = ''
      count = 0
      for (const e of state.entries) {
        const entry = document.createElement('div')
        entry.className = 'entry'
        entry.innerHTML =
          `<span class="ts">${esc(e.ts)}</span>` +
          `<span class="level ${esc(e.level)}">${esc(e.level)}</span>` +
          `<span class="msg">${esc(e.text)}</span>`
        entriesEl.appendChild(entry)
        count++
      }
      if (host) host.setTitle(count > 0 ? `${BASE_TITLE} \u2014 ${count}` : BASE_TITLE)
    },
  }
}
