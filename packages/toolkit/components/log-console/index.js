// log-console — Content factory for the scrolling timestamped log panel.
//
// Displays log entries with severity levels (info/warn/error/debug).
// Fed by `aos log` which pushes log/append messages and log/clear.
// The router strips the log/ prefix before delivery.

import { esc } from '../../runtime/bridge.js'

const MAX_ENTRIES = 500
const BASE_TITLE = 'Log'

export default function LogConsole() {
  let entriesEl = null
  let host = null
  let countdown = null

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

  function upsertCountdown({ title, remaining, deadline, active }) {
    if (!entriesEl) return
    if (!countdown) {
      countdown = document.createElement('div')
      countdown.className = 'entry input-safety-countdown'
      countdown.setAttribute('role', 'status')
      countdown.setAttribute('aria-live', 'assertive')
      entriesEl.appendChild(countdown)
    }
    countdown.dataset.deadline = deadline || ''
    countdown.dataset.remaining = String(remaining ?? '')
    countdown.dataset.active = active ? 'true' : 'false'
    const displayRemaining = Number.isFinite(Number(remaining)) ? String(Number(remaining)) : ''
    countdown.innerHTML =
      `<span class="ts">${esc(ts())}</span>` +
      `<span class="level warn">warn</span>` +
      `<span class="msg">${esc(title || 'AOS input passthrough')}<br>${esc(displayRemaining)}</span>`
    if (entriesEl.parentElement) {
      entriesEl.parentElement.scrollTop = entriesEl.parentElement.scrollHeight
    }
  }

  return {
    manifest: {
      name: 'log-console',
      title: BASE_TITLE,
      accepts: ['append', 'clear', 'input_safety_countdown'],
      emits: [],
      channelPrefix: 'log',
      defaultSize: { w: 450, h: 300 },
    },

    render(host_) {
      host = host_
      entriesEl = document.createElement('div')
      entriesEl.id = 'entries'
      entriesEl.setAttribute('role', 'log')
      entriesEl.setAttribute('aria-label', 'Log entries')
      entriesEl.setAttribute('aria-live', 'polite')
      entriesEl.setAttribute('aria-relevant', 'additions text')
      return entriesEl
    },

    onMessage(msg) {
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
        countdown = null
        updateTitle()
        return
      }

      if (msg.type === 'input_safety_countdown') {
        const p = msg.payload || {}
        upsertCountdown({
          title: p.title,
          remaining: p.remaining,
          deadline: p.deadline,
          active: p.active !== false,
        })
        updateTitle()
        return
      }
    },

    serialize() {
      if (!entriesEl) return { entries: [] }
      const entries = Array.from(entriesEl.querySelectorAll('.entry:not(.input-safety-countdown)')).map(el => ({
        ts: el.querySelector('.ts')?.textContent || '',
        level: el.querySelector('.level')?.textContent || 'info',
        text: el.querySelector('.msg')?.textContent || '',
      }))
      return {
        entries,
        input_safety_countdown: countdown
          ? {
              active: countdown.dataset.active === 'true',
              remaining: Number(countdown.dataset.remaining || 0),
              deadline: countdown.dataset.deadline || null,
              text: countdown.querySelector('.msg')?.textContent || '',
            }
          : null,
      }
    },

    restore(state, host_) {
      if (host_) host = host_
      if (!entriesEl || !state?.entries) return
      entriesEl.innerHTML = ''
      for (const e of state.entries) {
        appendEntry({ ts: e.ts, level: e.level || 'info', text: e.text })
      }
      if (state.input_safety_countdown) {
        upsertCountdown({
          title: 'AOS input passthrough',
          remaining: state.input_safety_countdown.remaining,
          deadline: state.input_safety_countdown.deadline,
          active: state.input_safety_countdown.active,
        })
      }
      updateTitle()
    },
  }
}
