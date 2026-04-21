import { esc } from '../../runtime/bridge.js'

const DEFAULT_BROKER_URL = 'http://127.0.0.1:47231'

function prettyAge(isoString) {
  if (!isoString) return 'unknown'
  const deltaMs = Date.now() - Date.parse(isoString)
  if (!Number.isFinite(deltaMs)) return 'unknown'
  const deltaSec = Math.max(0, Math.round(deltaMs / 1000))
  if (deltaSec < 60) return `${deltaSec}s ago`
  const deltaMin = Math.round(deltaSec / 60)
  if (deltaMin < 60) return `${deltaMin}m ago`
  const deltaHr = Math.round(deltaMin / 60)
  if (deltaHr < 24) return `${deltaHr}h ago`
  return `${Math.round(deltaHr / 24)}d ago`
}

function statusTone(status) {
  switch (status) {
    case 'ready':
    case 'succeeded':
      return 'good'
    case 'disabled':
    case 'planned':
      return 'muted'
    case 'running':
      return 'active'
    case 'failed':
    case 'error':
      return 'bad'
    default:
      return 'muted'
  }
}

export default function IntegrationHub(options = {}) {
  const brokerUrl = options.brokerUrl || window.__AOS_INTEGRATION_BROKER_URL__ || DEFAULT_BROKER_URL
  const pollMs = options.pollMs || 5000

  let host = null
  let pollTimer = null
  let rootEl = null
  let state = {
    brokerUrl,
    loading: true,
    error: null,
    snapshot: null,
    activeSurface: 'jobs',
    simulateText: 'status',
    simulateReply: null,
    sending: false,
  }

  const dom = {}

  function setState(patch = {}) {
    state = { ...state, ...patch }
    renderState()
  }

  function updateTitle() {
    const jobs = state.snapshot?.jobs?.length || 0
    host?.setTitle(jobs > 0 ? `Ops - ${jobs}` : 'Ops')
  }

  async function loadSnapshot() {
    setState({ loading: true, error: null })
    try {
      const res = await fetch(`${state.brokerUrl}/api/integrations/snapshot?limit=12`)
      if (!res.ok) throw new Error(`snapshot request failed: ${res.status}`)
      const snapshot = await res.json()
      const nextSurface = snapshot.surfaces?.some((surface) => surface.id === state.activeSurface)
        ? state.activeSurface
        : (snapshot.surfaces?.[0]?.id || 'jobs')
      setState({
        loading: false,
        error: null,
        snapshot,
        activeSurface: nextSurface,
      })
    } catch (error) {
      setState({
        loading: false,
        error: String(error),
        snapshot: null,
      })
    }
  }

  async function runSimulation() {
    const text = state.simulateText.trim()
    if (!text) return
    setState({ sending: true, simulateReply: null, error: null })
    try {
      const res = await fetch(`${state.brokerUrl}/api/integrations/simulate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'slack',
          requester: 'sigil-workbench',
          text,
          channel: 'sigil-workbench',
        }),
      })
      if (!res.ok) throw new Error(`simulate request failed: ${res.status}`)
      const reply = await res.json()
      setState({
        sending: false,
        simulateReply: reply,
        activeSurface: 'activity',
      })
      await loadSnapshot()
    } catch (error) {
      setState({
        sending: false,
        error: String(error),
      })
    }
  }

  function renderProviders() {
    const providers = state.snapshot?.providers || []
    if (providers.length === 0) {
      return '<div class="integration-hub-empty">No providers registered.</div>'
    }
    return providers.map((provider) => `
      <article class="integration-hub-card">
        <div class="integration-hub-card-header">
          <div>
            <div class="integration-hub-card-kicker">${esc(provider.kind)}</div>
            <h3>${esc(provider.label)}</h3>
          </div>
          <span class="integration-hub-pill tone-${statusTone(provider.status)}">${esc(provider.status)}</span>
        </div>
        <p>${esc(provider.configured ? 'Configured transport.' : 'Not configured yet.')}</p>
        <div class="integration-hub-meta-row">
          ${(provider.capabilities || []).map((capability) => `<span class="integration-hub-chip">${esc(capability)}</span>`).join('')}
        </div>
        ${provider.notes?.length ? `<div class="integration-hub-notes">${provider.notes.map((note) => `<div>${esc(note)}</div>`).join('')}</div>` : ''}
      </article>
    `).join('')
  }

  function renderWorkflows() {
    const workflows = state.snapshot?.workflows || []
    if (workflows.length === 0) {
      return '<div class="integration-hub-empty">No workflows loaded.</div>'
    }
    return workflows.map((workflow) => `
      <article class="integration-hub-card">
        <div class="integration-hub-card-header">
          <div>
            <div class="integration-hub-card-kicker">${esc(workflow.surface)}</div>
            <h3>${esc(workflow.title)}</h3>
          </div>
          <code>${esc(workflow.command?.usage || workflow.command?.label || workflow.id)}</code>
        </div>
        <p>${esc(workflow.description)}</p>
        <div class="integration-hub-meta-row">
          ${(workflow.command?.examples || []).map((example) => `<span class="integration-hub-chip">${esc(example)}</span>`).join('')}
        </div>
      </article>
    `).join('')
  }

  function renderJobs() {
    const jobs = state.snapshot?.jobs || []
    if (jobs.length === 0) {
      return '<div class="integration-hub-empty">No jobs yet. Use the activity console to simulate a Slack request.</div>'
    }
    return jobs.map((job) => `
      <article class="integration-hub-card integration-hub-job">
        <div class="integration-hub-card-header">
          <div>
            <div class="integration-hub-card-kicker">${esc(job.provider)} -> ${esc(job.surface || 'jobs')}</div>
            <h3>${esc(job.workflowTitle || job.workflowId || job.commandText)}</h3>
          </div>
          <span class="integration-hub-pill tone-${statusTone(job.status)}">${esc(job.status)}</span>
        </div>
        <p>${esc(job.summary || job.errorText || job.commandText)}</p>
        <div class="integration-hub-meta-row">
          <span class="integration-hub-chip">${esc(job.requester || 'unknown requester')}</span>
          <span class="integration-hub-chip">${esc(prettyAge(job.updatedAt))}</span>
          <span class="integration-hub-chip">${esc(job.id)}</span>
        </div>
      </article>
    `).join('')
  }

  function renderActivity() {
    const reply = state.simulateReply?.text
    return `
      <section class="integration-hub-console">
        <div class="integration-hub-console-copy">
          <div class="integration-hub-card-kicker">Local Simulation</div>
          <h3>Send a pilot command through the broker</h3>
          <p>Use this from Sigil to exercise the same routing path Slack will use. Good inputs: <code>status</code>, <code>features</code>, <code>workflows</code>, or <code>wiki sigil</code>.</p>
        </div>
        <label class="integration-hub-console-label" for="integration-hub-command">Command</label>
        <div class="integration-hub-console-row">
          <input id="integration-hub-command" class="integration-hub-input" value="${esc(state.simulateText)}" placeholder="status">
          <button type="button" class="integration-hub-action">${state.sending ? 'Sending…' : 'Send'}</button>
        </div>
        ${reply ? `<pre class="integration-hub-reply">${esc(reply)}</pre>` : '<div class="integration-hub-empty">No broker reply yet.</div>'}
      </section>
    `
  }

  function renderSurfaces() {
    switch (state.activeSurface) {
      case 'integrations':
        return renderProviders()
      case 'workflows':
        return renderWorkflows()
      case 'activity':
        return renderActivity()
      case 'jobs':
      default:
        return renderJobs()
    }
  }

  function wireConsole() {
    const input = rootEl.querySelector('#integration-hub-command')
    const button = rootEl.querySelector('.integration-hub-action')
    if (input) {
      input.addEventListener('input', (event) => {
        setState({ simulateText: event.target.value })
      })
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          void runSimulation()
        }
      })
    }
    if (button) {
      button.addEventListener('click', () => {
        void runSimulation()
      })
    }
  }

  function renderState() {
    if (!rootEl) return
    const surfaces = state.snapshot?.surfaces || [
      { id: 'jobs', label: 'Jobs' },
      { id: 'workflows', label: 'Workflows' },
      { id: 'integrations', label: 'Integrations' },
      { id: 'activity', label: 'Activity' },
    ]
    const providerCount = state.snapshot?.providers?.length || 0
    const workflowCount = state.snapshot?.workflows?.length || 0
    const jobCount = state.snapshot?.jobs?.length || 0

    rootEl.innerHTML = `
      <div class="integration-hub-shell">
        <section class="integration-hub-hero">
          <div>
            <div class="integration-hub-kicker">Operator Surface</div>
            <h2>Chat broker for Slack first, other transports later</h2>
            <p>Provider adapters stay outside toolkit and Sigil. The browser only consumes the shared broker snapshot: providers, workflows, jobs, and activity.</p>
          </div>
          <div class="integration-hub-hero-stats">
            <div><span>${providerCount}</span><label>integrations</label></div>
            <div><span>${workflowCount}</span><label>workflows</label></div>
            <div><span>${jobCount}</span><label>jobs</label></div>
          </div>
        </section>

        <section class="integration-hub-toolbar">
          <div class="integration-hub-broker">${esc(state.snapshot?.broker?.url || state.brokerUrl)}</div>
          <div class="integration-hub-status ${state.error ? 'has-error' : ''}">
            ${state.loading ? 'loading snapshot…' : (state.error ? esc(state.error) : `updated ${esc(prettyAge(state.snapshot?.generated_at))}`)}
          </div>
          <button type="button" class="integration-hub-refresh">Refresh</button>
        </section>

        <section class="integration-hub-surface-tabs" role="tablist" aria-label="Integration broker surfaces">
          ${surfaces.map((surface) => `
            <button
              type="button"
              class="integration-hub-surface-tab${surface.id === state.activeSurface ? ' active' : ''}"
              data-surface="${esc(surface.id)}"
            >${esc(surface.label)}</button>
          `).join('')}
        </section>

        <section class="integration-hub-surface-copy">
          ${esc(surfaces.find((surface) => surface.id === state.activeSurface)?.description || '')}
        </section>

        <section class="integration-hub-grid">
          ${renderSurfaces()}
        </section>
      </div>
    `

    rootEl.querySelector('.integration-hub-refresh')?.addEventListener('click', () => {
      void loadSnapshot()
    })
    rootEl.querySelectorAll('.integration-hub-surface-tab').forEach((button) => {
      button.addEventListener('click', () => {
        setState({ activeSurface: button.dataset.surface || 'jobs' })
      })
    })
    wireConsole()
    updateTitle()
  }

  return {
    manifest: {
      name: 'integration-hub',
      title: 'Ops',
      accepts: [],
      emits: [],
      channelPrefix: 'integration-hub',
      defaultSize: { w: 820, h: 560 },
    },

    render(host_) {
      host = host_
      rootEl = document.createElement('div')
      rootEl.className = 'integration-hub-root'
      renderState()
      void loadSnapshot()
      pollTimer = window.setInterval(() => { void loadSnapshot() }, pollMs)
      return rootEl
    },

    onMessage() {},

    serialize() {
      return {
        activeSurface: state.activeSurface,
        simulateText: state.simulateText,
      }
    },

    restore(savedState) {
      if (!savedState) return
      setState({
        activeSurface: savedState.activeSurface || state.activeSurface,
        simulateText: savedState.simulateText || state.simulateText,
      })
    },

    teardown() {
      if (pollTimer) {
        window.clearInterval(pollTimer)
        pollTimer = null
      }
    },
  }
}
