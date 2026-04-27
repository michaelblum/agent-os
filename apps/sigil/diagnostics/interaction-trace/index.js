import { esc } from '/toolkit/runtime/bridge.js'
import { evalCanvas } from '/toolkit/runtime/canvas.js'

const AVATAR_ID = 'avatar-main'
const POLL_MS = 250

function formatTime(ts) {
  if (!Number.isFinite(ts)) return ''
  const date = new Date(ts)
  return date.toLocaleTimeString([], { hour12: false })
}

function summarize(entry = {}) {
  const data = entry.data || {}
  switch (entry.stage) {
    case 'input':
      return `${data.type || '?'} ${data.x ?? ''},${data.y ?? ''}`
    case 'host-message':
      return `${data.rawType || '?'} -> ${data.type || '?'} ${data.x ?? ''},${data.y ?? ''}`
    case 'context-menu:pointer:target':
      return `${data.kind || '?'} target=${data.target?.id || data.target?.tag || '?'} input=${data.input?.id || data.input?.tag || '?'}`
    case 'context-menu:checkbox-toggle':
      return `${data.id || '?'}=${data.checked ? 'on' : 'off'} via ${data.via || '?'}`
    case 'context-menu:duplicate-check':
      return `${data.duplicate ? 'duplicate' : 'not duplicate'} ${data.reason || ''} dt=${Math.round(data.elapsed ?? 0)}`
    case 'context-menu:open':
    case 'context-menu:open-request':
      return `${data.x ?? data.point?.x ?? ''},${data.y ?? data.point?.y ?? ''}`
    case 'context-menu:close':
      return data.reason || 'close'
    default:
      return JSON.stringify(data).slice(0, 180)
  }
}

function renderEntry(entry) {
  return (
    `<tr>`
      + `<td class="mono">${esc(entry.seq)}</td>`
      + `<td class="mono">${esc(formatTime(entry.ts))}</td>`
      + `<td>${esc(entry.stage)}</td>`
      + `<td>${esc(summarize(entry))}</td>`
      + `</tr>`
  )
}

function renderDetails(trace) {
  if (!trace) return '<div class="empty-state">No trace snapshot yet.</div>'
  const entries = trace.entries || []
  const runtime = trace.runtime || {}
  const snap = trace.snapshot || {}
  const contextMenu = snap.contextMenu || {}
  const capture = trace.capture || null
  const latestCapture = trace.latestCapture || null
  const rows = entries.slice(-180).reverse().map(renderEntry).join('')
  return (
    `<div class="trace-summary">`
      + `<span class="pill">events ${esc(trace.count || 0)}</span>`
      + `<span class="pill">state ${esc(snap.state || 'unknown')}</span>`
      + `<span class="pill">menu ${contextMenu.open ? 'open' : 'closed'}</span>`
      + `<span class="pill">trace ${trace.enabled === false ? 'off' : 'on'}</span>`
      + `<span class="pill">capture ${capture ? `armed ${capture.count || 0}` : 'idle'}</span>`
      + `<span class="mono runtime">${esc(runtime.loadedAt || '')}</span>`
      + `</div>`
      + `<div class="capture-strip">`
      + `<span>${capture ? `Armed: ${esc(capture.id)}` : latestCapture ? `Latest: ${esc(latestCapture.id)} (${esc(latestCapture.count || 0)} events)` : 'No saved capture'}</span>`
      + `</div>`
      + `<div class="trace-json-block">`
      + `<div class="json-title">Context</div>`
      + `<pre>${esc(JSON.stringify({
        runtime,
        avatarPos: snap.avatarPos,
        hitTargetFrame: snap.hitTargetFrame,
        hitTargetInteractive: snap.hitTargetInteractive,
        contextMenu: snap.contextMenu,
        surface: snap.surface,
      }, null, 2))}</pre>`
      + `</div>`
      + `<table class="trace-table">`
      + `<thead><tr><th>#</th><th>time</th><th>stage</th><th>summary</th></tr></thead>`
      + `<tbody>${rows || '<tr><td colspan="4">No interaction events recorded yet.</td></tr>'}</tbody>`
      + `</table>`
      + `</div>`
  )
}

export default function InteractionTrace() {
  let host = null
  let root = null
  let latest = null
  let lastError = null
  let paused = false
  let timer = null

  async function fetchTrace() {
    if (paused) return
    try {
      const result = await evalCanvas(
        AVATAR_ID,
        'JSON.stringify(window.__sigilDebug?.interactionTrace?.() ?? null)',
        { timeoutMs: 1500 },
      )
      latest = result ? JSON.parse(result) : null
      lastError = null
      render()
    } catch (error) {
      lastError = String(error)
      render()
    }
  }

  async function clearTrace() {
    try {
      await evalCanvas(AVATAR_ID, 'window.__sigilDebug?.clearInteractionTrace?.(); "ok"', { timeoutMs: 1500 })
      latest = null
      await fetchTrace()
    } catch (error) {
      lastError = String(error)
      render()
    }
  }

  async function armTrace() {
    try {
      const label = `manual-${new Date().toISOString()}`
      await evalCanvas(AVATAR_ID, `window.__sigilDebug?.armInteractionTrace?.(${JSON.stringify(label)}); "ok"`, { timeoutMs: 1500 })
      await fetchTrace()
    } catch (error) {
      lastError = String(error)
      render()
    }
  }

  async function stopTrace() {
    try {
      await evalCanvas(AVATAR_ID, 'window.__sigilDebug?.stopInteractionTrace?.("operator-stop"); "ok"', { timeoutMs: 1500 })
      await fetchTrace()
    } catch (error) {
      lastError = String(error)
      render()
    }
  }

  async function copyTrace() {
    const text = JSON.stringify(latest || { error: lastError }, null, 2)
    try {
      await navigator.clipboard?.writeText(text)
      lastError = 'copied trace JSON'
    } catch {
      lastError = text
    }
    render()
  }

  function render() {
    if (!root) return
    if (host) host.setTitle(`Sigil Trace - ${latest?.count ?? 0}`)
    root.innerHTML = (
      `<div class="trace-toolbar">`
        + `<button data-action="refresh">Refresh</button>`
        + `<button data-action="arm">${latest?.capture ? 'Re-arm' : 'Arm Capture'}</button>`
        + `<button data-action="stop" ${latest?.capture ? '' : 'disabled'}>Stop Capture</button>`
        + `<button data-action="pause">${paused ? 'Resume' : 'Pause'}</button>`
        + `<button data-action="clear">Clear</button>`
        + `<button data-action="copy">Copy JSON</button>`
        + `<span class="trace-status">${esc(lastError || '')}</span>`
      + `</div>`
      + renderDetails(latest)
    )
  }

  function installActions() {
    root.addEventListener('click', (event) => {
      const button = event.target?.closest?.('[data-action]')
      if (!button) return
      const action = button.dataset.action
      if (action === 'refresh') fetchTrace()
      if (action === 'arm') armTrace()
      if (action === 'stop') stopTrace()
      if (action === 'pause') {
        paused = !paused
        render()
      }
      if (action === 'clear') clearTrace()
      if (action === 'copy') copyTrace()
    })
  }

  return {
    manifest: {
      name: 'sigil-interaction-trace',
      title: 'Sigil Interaction Trace',
      accepts: [],
      emits: [],
      defaultSize: { w: 760, h: 620 },
    },

    render(host_) {
      host = host_
      host.contentEl.style.overflow = 'hidden'
      root = document.createElement('div')
      root.className = 'sigil-interaction-trace'
      installActions()
      render()
      fetchTrace()
      timer = setInterval(fetchTrace, POLL_MS)
      return root
    },

    serialize() {
      return { latest, lastError, paused }
    },

    restore(state = {}) {
      latest = state.latest || latest
      lastError = state.lastError || lastError
      paused = !!state.paused
      render()
    },

    destroy() {
      if (timer) clearInterval(timer)
    },
  }
}
