// command-surface — generic manifest/recommendation projection for developer
// command plans. It renders data and emits operator intent; it does not execute
// commands.

const BASE_TITLE = 'Command Surface'

function escapeHTML(value) {
  if (value === null || value === undefined) return ''
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function commandText(command) {
  if (!Array.isArray(command) || command.length === 0) return ''
  return command.map((part) => String(part)).join(' ')
}

function normalizeStep(step = {}, index = 0) {
  const command = commandText(step.command)
  return {
    step_id: step.step_id || `step_${String(index + 1).padStart(3, '0')}`,
    kind: step.kind || 'action',
    command,
    reason: step.reason || '',
    source_rules: Array.isArray(step.source_rules) ? step.source_rules : [],
    mutates_runtime: step.mutates_runtime === true,
    requires: Array.isArray(step.requires) ? step.requires : [],
  }
}

export function normalizeCommandSurfacePayload(payload = {}) {
  const steps = Array.isArray(payload.steps)
    ? payload.steps.map(normalizeStep)
    : Array.isArray(payload.recommended_actions)
      ? payload.recommended_actions
          .filter((action) => action.kind !== 'classify_only')
          .map(normalizeStep)
      : []

  return {
    status: payload.status || 'unknown',
    manifest: payload.manifest || null,
    changed_paths: Array.isArray(payload.changed_paths) ? payload.changed_paths : [],
    unmatched_paths: Array.isArray(payload.unmatched_paths) ? payload.unmatched_paths : [],
    matched_rules: Array.isArray(payload.matched_rules)
      ? payload.matched_rules
      : Array.isArray(payload.matches)
        ? payload.matches.map((match) => match.id).filter(Boolean)
        : [],
    operating_paths: Array.isArray(payload.operating_paths) ? payload.operating_paths : [],
    steps,
    verification: Array.isArray(payload.verification) ? payload.verification : [],
    human_handoffs: Array.isArray(payload.human_handoffs) ? payload.human_handoffs : [],
    next: payload.next || '',
  }
}

function renderTag(value, cls = '') {
  return `<span class="cs-tag ${escapeHTML(cls)}">${escapeHTML(value)}</span>`
}

function renderPathList(paths, emptyText) {
  if (!paths.length) return `<div class="cs-empty">${escapeHTML(emptyText)}</div>`
  return `<ul class="cs-path-list">${paths.map((path) => `<li>${escapeHTML(path)}</li>`).join('')}</ul>`
}

function renderStep(step, index) {
  const classes = ['cs-step']
  if (step.mutates_runtime) classes.push('mutates')
  const source = step.source_rules.map((rule) => renderTag(rule)).join('')
  const requires = step.requires.length
    ? `<div class="cs-requires">requires ${step.requires.map((item) => renderTag(item, 'muted')).join('')}</div>`
    : ''
  const command = step.command || step.kind
  return `<section class="${classes.join(' ')}" data-step-id="${escapeHTML(step.step_id)}">`
    + `<div class="cs-step-index">${String(index + 1).padStart(2, '0')}</div>`
    + `<div class="cs-step-main">`
    + `<div class="cs-step-head">`
    + `<span class="cs-step-id">${escapeHTML(step.step_id)}</span>`
    + renderTag(step.kind, step.mutates_runtime ? 'warn' : '')
    + source
    + `</div>`
    + `<code class="cs-command">${escapeHTML(command)}</code>`
    + (step.reason ? `<p class="cs-reason">${escapeHTML(step.reason)}</p>` : '')
    + requires
    + `<div class="cs-actions">`
    + `<button data-action="select" data-step-id="${escapeHTML(step.step_id)}">Select</button>`
    + `<button data-action="copy" data-command="${escapeHTML(command)}">Copy</button>`
    + `<button data-action="done" data-step-id="${escapeHTML(step.step_id)}">Done</button>`
    + `<button data-action="blocked" data-step-id="${escapeHTML(step.step_id)}">Blocked</button>`
    + `</div>`
    + `</div>`
    + `</section>`
}

function renderVerification(items) {
  if (!items.length) return ''
  return `<section class="cs-section">`
    + `<h2>Verification</h2>`
    + items.map((item) => {
      const command = commandText(item.command)
      return `<div class="cs-check">`
        + `<div>${escapeHTML(item.when || item.id || 'Check')}</div>`
        + (command ? `<code>${escapeHTML(command)}</code>` : '')
        + `</div>`
    }).join('')
    + `</section>`
}

function renderHandoffs(items) {
  if (!items.length) return ''
  return `<section class="cs-section">`
    + `<h2>Human Handoffs</h2>`
    + items.map((item) => {
      const resume = commandText(item.resume_command)
      return `<div class="cs-handoff">`
        + `<div class="cs-condition">${escapeHTML(item.condition || '')}</div>`
        + `<p>${escapeHTML(item.instruction || '')}</p>`
        + (resume ? `<code>${escapeHTML(resume)}</code>` : '')
        + `</div>`
    }).join('')
    + `</section>`
}

export function renderCommandSurface(payload = {}) {
  const data = normalizeCommandSurfacePayload(payload)
  const title = data.manifest?.id || 'workflow recommendation'
  const paths = data.operating_paths.map((path) => renderTag(path, 'path')).join('')
  const rules = data.matched_rules.map((rule) => renderTag(rule)).join('')

  return `<div class="command-surface">`
    + `<header class="cs-header">`
    + `<div>`
    + `<div class="cs-kicker">AOS dev workflow</div>`
    + `<h1>${escapeHTML(title)}</h1>`
    + `</div>`
    + `<span class="cs-status">${escapeHTML(data.status)}</span>`
    + `</header>`
    + `<section class="cs-section cs-summary">`
    + `<div><span class="cs-label">Changed</span><strong>${data.changed_paths.length}</strong></div>`
    + `<div><span class="cs-label">Unmatched</span><strong>${data.unmatched_paths.length}</strong></div>`
    + `<div><span class="cs-label">Steps</span><strong>${data.steps.length}</strong></div>`
    + `</section>`
    + `<section class="cs-section">`
    + `<h2>Operating Paths</h2>`
    + `<div class="cs-tags">${paths || renderTag('agent/dev', 'path')}</div>`
    + `</section>`
    + `<section class="cs-section">`
    + `<h2>Matched Rules</h2>`
    + `<div class="cs-tags">${rules || renderTag('none', 'muted')}</div>`
    + `</section>`
    + `<section class="cs-section">`
    + `<h2>Steps</h2>`
    + (data.steps.length ? data.steps.map(renderStep).join('') : `<div class="cs-empty">${escapeHTML(data.next || 'No deterministic steps')}</div>`)
    + `</section>`
    + renderVerification(data.verification)
    + renderHandoffs(data.human_handoffs)
    + `<section class="cs-section">`
    + `<h2>Changed Paths</h2>`
    + renderPathList(data.changed_paths, 'No changed paths provided')
    + `</section>`
    + `</div>`
}

export default function CommandSurface() {
  let contentEl = null
  let host = null
  let state = null

  function renderState() {
    if (!contentEl) return
    contentEl.innerHTML = state
      ? renderCommandSurface(state)
      : '<div class="cs-empty initial">Post a workflow recommendation payload to render commands.</div>'
  }

  function emitAction(type, payload) {
    if (host && typeof host.emit === 'function') host.emit(type, payload)
  }

  async function handleClick(event) {
    const button = event.target?.closest?.('button[data-action]')
    if (!button) return
    const action = button.dataset.action
    const stepID = button.dataset.stepId
    const command = button.dataset.command || ''
    if (action === 'copy') {
      try { await navigator.clipboard?.writeText(command) } catch (_) {}
      emitAction('command_copied', { command })
      return
    }
    emitAction(`step_${action}`, { step_id: stepID })
  }

  return {
    manifest: {
      name: 'command-surface',
      title: BASE_TITLE,
      accepts: ['recommendation', 'workflow', 'clear'],
      emits: ['step_select', 'step_done', 'step_blocked', 'command_copied'],
      channelPrefix: 'command-surface',
      defaultSize: { w: 520, h: 640 },
    },

    render(host_) {
      host = host_
      contentEl = document.createElement('div')
      contentEl.className = 'command-surface-body'
      contentEl.addEventListener('click', handleClick)
      renderState()
      return contentEl
    },

    onMessage(msg, host_) {
      if (host_) host = host_
      if (msg.type === 'clear') {
        state = null
        renderState()
        return
      }
      if (msg.type === 'recommendation' || msg.type === 'workflow') {
        state = msg.payload || {}
        renderState()
        if (host && state?.steps) host.setTitle(`${BASE_TITLE} - ${state.steps.length} steps`)
      }
    },

    serialize() {
      return { state }
    },

    restore(saved, host_) {
      if (host_) host = host_
      state = saved?.state || null
      renderState()
    },
  }
}
