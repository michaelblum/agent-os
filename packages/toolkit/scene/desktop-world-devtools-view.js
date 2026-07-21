import { esc } from '../runtime/bridge.js'
import {
  buildDesktopWorldMinimapLayout,
  normalizeDesktopWorldDevToolsSnapshot,
} from './desktop-world-devtools.js'

const TABS = Object.freeze([
  ['world', 'World'],
  ['resources', 'Resources'],
  ['interactions', 'Interactions'],
  ['performance', 'Performance'],
  ['events', 'Events'],
])

function metric(value, digits = 1) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : '--'
}

function eventTime(value) {
  if (!Number.isFinite(value) || value <= 0) return '--'
  return new Date(value).toLocaleTimeString([], { hour12: false })
}

function selectedResources(snapshot) {
  const selected = snapshot.session.selectedResource
  return selected ? snapshot.stage.resources.filter((entry) => entry.id === selected) : snapshot.stage.resources
}

function renderTabs(snapshot) {
  return `<nav class="dw-tabs" aria-label="DesktopWorld inspector views">${TABS.map(([id, label]) => (
    `<button type="button" data-tab="${id}" aria-selected="${snapshot.session.activeTab === id}">${label}</button>`
  )).join('')}</nav>`
}

function renderToolbar(snapshot) {
  const options = snapshot.stage.resources.map((resource) => (
    `<option value="${esc(resource.id)}"${snapshot.session.selectedResource === resource.id ? ' selected' : ''}>${esc(resource.id)}</option>`
  )).join('')
  const detach = snapshot.session.host?.kind === 'external'
    ? '<button type="button" class="dw-icon-command" data-command="detach" title="Detach inspector" aria-label="Detach inspector">&#8599;</button>'
    : ''
  return `<div class="dw-toolbar">
    <label><span>Resource</span><select data-field="resource"><option value="">All resources</option>${options}</select></label>
    <label class="dw-query"><span>Filter</span><input data-field="query" value="${esc(snapshot.session.filters.query)}" placeholder="Filter IDs and events"></label>
    <label class="dw-record"><input type="checkbox" data-field="recording"${snapshot.session.recording ? ' checked' : ''}><span>Record</span></label>
    ${detach}
  </div>`
}

function renderMinimap(snapshot) {
  const minimap = buildDesktopWorldMinimapLayout(snapshot, { width: 720, height: 380, padding: 20 })
  if (!minimap.bounds) return '<div class="dw-empty">No display topology is available.</div>'
  const displays = minimap.displays.map((display) => {
    const [x, y, width, height] = display.frame
    return `<g><rect class="dw-display" x="${x}" y="${y}" width="${width}" height="${height}" rx="3"></rect><text x="${x + 8}" y="${y + 18}">${esc(display.id)}</text></g>`
  }).join('')
  const regions = minimap.hitRegions.map((region) => {
    const [x, y, width, height] = region.frame
    return `<rect class="dw-hit-region${region.registered ? ' registered' : ''}" x="${x}" y="${y}" width="${width}" height="${height}"><title>${esc(region.affordanceId)}</title></rect>`
  }).join('')
  const nodes = minimap.nodes.map((node) => (
    `<circle class="dw-node" cx="${node.point[0]}" cy="${node.point[1]}" r="5"><title>${esc(node.resourceId)} / ${esc(node.id)}</title></circle>`
  )).join('')
  const gestures = snapshot.stage.world.gestures.map((gesture) => (
    `<li><strong>${esc(gesture.kind)}</strong><span>${esc(gesture.resourceId)} / ${esc(gesture.affordanceId)}</span><em>${esc(gesture.phase)}</em><small>${esc(gesture.pointerSessionId ?? '--')}</small></li>`
  )).join('') || '<li class="dw-muted">No active gestures</li>'
  const routes = snapshot.stage.world.routes.map((route) => (
    `<li><strong>${esc(route.kind)}</strong><span>${esc(route.resourceId)}</span><em>${Math.round(route.progress * 100)}%</em></li>`
  )).join('') || '<li class="dw-muted">No active routes</li>'
  return `<div class="dw-world-layout">
    <div class="dw-minimap"><svg viewBox="0 0 720 380" role="img" aria-label="DesktopWorld minimap">${displays}${regions}${nodes}</svg></div>
    <aside class="dw-world-facts">
      <dl>
        <div><dt>Displays</dt><dd>${snapshot.stage.counters.displays}</dd></div>
        <div><dt>Resources</dt><dd>${snapshot.stage.counters.resources}</dd></div>
        <div><dt>Nodes</dt><dd>${snapshot.stage.counters.nodes}</dd></div>
        <div><dt>Hit regions</dt><dd>${snapshot.stage.counters.hitRegions}</dd></div>
        <div><dt>Affordances</dt><dd>${snapshot.stage.counters.affordances}</dd></div>
        <div><dt>Active gestures</dt><dd>${snapshot.stage.counters.activeGestures}</dd></div>
        <div><dt>Active routes</dt><dd>${snapshot.stage.counters.activeRoutes}</dd></div>
      </dl>
      <h3>Gesture arena</h3><ul>${gestures}</ul>
      <h3>Routes</h3><ul>${routes}</ul>
    </aside>
  </div>`
}

function renderResources(snapshot) {
  const rows = selectedResources(snapshot).map((resource) => `<tr>
    <td><button type="button" class="dw-row-command" data-resource="${esc(resource.id)}">${esc(resource.id)}</button><small>${esc(resource.owner)} / ${esc(resource.sceneId)}</small><small>${resource.implementations.map(esc).join(', ') || '--'}</small></td>
    <td>${esc(resource.lifecycle)}</td><td>${resource.revision}</td><td>${resource.objectCount}</td>
    <td>${resource.animationCount}</td><td>${resource.signalCount}</td><td>${resource.interactionCount}</td>
    <td>${resource.allocations.geometries}/${resource.allocations.materials}/${resource.allocations.textures}</td>
  </tr>`).join('')
  return rows ? `<div class="dw-table-wrap"><table><thead><tr><th>Resource</th><th>Lifecycle</th><th>Rev</th><th>Objects</th><th>Anim</th><th>Signals</th><th>Input</th><th>G/M/T</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<div class="dw-empty">No matching resources.</div>'
}

function renderInteractions(snapshot) {
  const selected = snapshot.session.selectedResource
  const entries = selected
    ? snapshot.stage.interactions.filter((entry) => entry.resourceId === selected)
    : snapshot.stage.interactions
  const rows = entries.map((entry) => `<tr>
    <td>${esc(entry.resourceId)}<small>${esc(entry.owner)}</small></td>
    <td><span class="dw-state ${entry.active ? 'active' : ''}">${entry.active ? 'active' : entry.suspended ? 'suspended' : 'idle'}</span></td>
    <td>${entry.regionCount}</td><td>${entry.recognizers.map(esc).join('<br>') || '--'}</td><td>${esc(entry.errorCode ?? '--')}</td>
  </tr>`).join('')
  const gestureRows = snapshot.stage.world.gestures.map((gesture) => `<tr>
    <td>${esc(gesture.resourceId)}</td><td>${esc(gesture.kind)}</td><td>${esc(gesture.phase)}</td><td>${esc(gesture.affordanceId)}</td><td>${esc(gesture.pointerSessionId ?? '--')}</td>
  </tr>`).join('')
  return `<div class="dw-split-tables"><section><h2>Leases</h2>${rows ? `<div class="dw-table-wrap"><table><thead><tr><th>Resource</th><th>State</th><th>Regions</th><th>Recognizers</th><th>Error</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="dw-empty">No interaction leases.</div>'}</section>
    <section><h2>Active gestures</h2>${gestureRows ? `<div class="dw-table-wrap"><table><thead><tr><th>Resource</th><th>Kind</th><th>Phase</th><th>Affordance</th><th>Pointer</th></tr></thead><tbody>${gestureRows}</tbody></table></div>` : '<div class="dw-empty">No active gestures.</div>'}</section></div>`
}

function renderPerformance(snapshot) {
  const p = snapshot.stage.performance
  const metrics = [
    ['FPS', metric(p.currentFps)], ['Frame budget', `${metric(p.budgetMs)} ms`],
    ['P95 frame', `${metric(p.p95FrameMs)} ms`], ['Max frame', `${metric(p.maxFrameMs)} ms`],
    ['Avg frame', `${metric(p.avgFrameMs)} ms`], ['Render', `${metric(p.avgRenderMs)} ms`],
    ['Update', `${metric(p.avgUpdateMs)} ms`], ['GPU', `${metric(p.avgGpuMs)} ms`],
    ['Draw calls', metric(p.drawCalls, 0)], ['Triangles', metric(p.triangles, 0)],
    ['Geometries', metric(p.geometries, 0)], ['Textures', metric(p.textures, 0)],
    ['Programs', metric(p.programs, 0)], ['Backing pixels', metric(p.backingPixels, 0)],
  ]
  return `<div class="dw-performance"><header><strong class="dw-health ${esc(p.state)}">${esc(p.state)}</strong><span>${p.sampleCount} samples</span><span>${p.recording ? 'recording every frame' : '500 ms sampling'}</span></header><dl>${metrics.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl></div>`
}

function renderEvents(snapshot) {
  const query = snapshot.session.filters.query.trim().toLowerCase()
  const events = snapshot.stage.events.filter((event) => {
    if (snapshot.session.filters.errorsOnly && !event.code) return false
    if (snapshot.session.filters.eventKinds.length && !snapshot.session.filters.eventKinds.includes(event.kind)) return false
    return !query || [event.kind, event.resourceId, event.code].some((value) => String(value ?? '').toLowerCase().includes(query))
  })
  const rows = events.slice().reverse().map((event) => `<tr><td>${event.sequence}</td><td>${eventTime(event.at)}</td><td>${esc(event.kind)}</td><td>${esc(event.resourceId ?? '--')}</td><td>${esc(event.code ?? '--')}</td></tr>`).join('')
  return rows ? `<div class="dw-table-wrap"><table><thead><tr><th>Seq</th><th>Time</th><th>Event</th><th>Resource</th><th>Code</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<div class="dw-empty">No matching events.</div>'
}

function renderContent(snapshot) {
  switch (snapshot.session.activeTab) {
    case 'resources': return renderResources(snapshot)
    case 'interactions': return renderInteractions(snapshot)
    case 'performance': return renderPerformance(snapshot)
    case 'events': return renderEvents(snapshot)
    default: return renderMinimap(snapshot)
  }
}

export function createDesktopWorldDevToolsView({ root, onCommand = () => {} } = {}) {
  if (!root) throw new TypeError('DesktopWorld DevTools view requires a root element.')
  let snapshot = null
  let active = true

  function command(action, data = {}) {
    if (!active || !snapshot) return false
    onCommand({ action, session: snapshot.session.id, expectedRevision: snapshot.session.revision, ...data })
    return true
  }

  function render() {
    if (!active) return
    if (!snapshot) {
      root.innerHTML = '<div class="dw-empty">Waiting for DesktopWorld telemetry.</div>'
      return
    }
    root.innerHTML = `${renderToolbar(snapshot)}${renderTabs(snapshot)}<main class="dw-view">${renderContent(snapshot)}</main>`
    root.querySelectorAll('[data-tab]').forEach((button) => button.addEventListener('click', () => command('update', { active_tab: button.dataset.tab })))
    root.querySelector('[data-field="resource"]')?.addEventListener('change', (event) => command('update', { selected_resource: event.target.value || null }))
    root.querySelector('[data-field="query"]')?.addEventListener('change', (event) => command('update', {
      filters: {
        errors_only: snapshot.session.filters.errorsOnly,
        event_kinds: snapshot.session.filters.eventKinds,
        query: event.target.value,
      },
    }))
    root.querySelector('[data-field="recording"]')?.addEventListener('change', (event) => command('update', { recording: event.target.checked }))
    root.querySelector('[data-command="detach"]')?.addEventListener('click', () => command('detach'))
    root.querySelectorAll('[data-resource]').forEach((button) => button.addEventListener('click', () => command('update', { selected_resource: button.dataset.resource, active_tab: 'world' })))
  }

  render()
  return Object.freeze({
    dispose() {
      if (!active) return false
      active = false
      root.replaceChildren()
      snapshot = null
      return true
    },
    request: command,
    setActive(value) {
      active = value !== false
      root.hidden = !active
      if (active) render()
    },
    update(value) {
      snapshot = normalizeDesktopWorldDevToolsSnapshot(value)
      render()
      return snapshot
    },
  })
}
