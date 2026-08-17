import { wireBridge, esc } from '../../runtime/bridge.js'
import { requestHostStopAll, requestOperationSnapshot } from '../../runtime/operation-control.js'
import {
  applyOperationControlMessage,
  createOperationControlModel,
  operationControlCounts,
} from './model.js'

let model = createOperationControlModel()

function renderResourceClaims(operation) {
  if (operation.resource_claims.length === 0) return '—'
  return operation.resource_claims.map((claim) => {
    const broker = claim.broker_id
      ? ` · broker <code>${esc(claim.broker_id)}</code> #${claim.broker_generation}`
      : ''
    const subscriber = claim.subscriber_id
      ? ` · subscriber <code>${esc(claim.subscriber_id)}</code>`
      : ''
    return `<div><code>${esc(claim.claim_id)}</code> · <code>${esc(claim.resource_key)}</code> #${claim.resource_generation} · ${esc(claim.admission_mode)} · ${esc(claim.state)}${broker}${subscriber}</div>`
  }).join('')
}

function renderArtifacts(operation) {
  if (operation.artifacts.length === 0) return '—'
  return operation.artifacts.map((artifact) => {
    const custody = artifact.custody_digest
      ? `<code>${esc(artifact.custody_digest)}</code>`
      : 'none'
    const recovery = artifact.recovery_disposition
      ? ` · ${esc(artifact.recovery_origin_state || 'unknown')} → ${esc(artifact.recovery_disposition)}`
      : ''
    return `<div><code>${esc(artifact.artifact_id)}</code> #${artifact.artifact_generation} · ${esc(artifact.state)} · custody ${custody}${recovery}</div>`
  }).join('')
}

function render() {
  const root = document.querySelector('[data-operation-control]')
  if (!root) return
  const counts = operationControlCounts(model)
  const rows = model.operations.map((operation) => `
    <tr>
      <td><code>${esc(operation.capability_id)}</code></td>
      <td>${esc(operation.state)}</td>
      <td><code>${esc(operation.owner_root_id)}</code></td>
      <td>${renderResourceClaims(operation)}</td>
      <td>${esc(operation.outcome || '—')} · ${esc(operation.blame || '—')}</td>
      <td>${esc(operation.cleanup_result)}</td>
      <td>${renderArtifacts(operation)}</td>
    </tr>`).join('')
  root.innerHTML = `
    <header>
      <div><p class="eyebrow">AOS operation plane</p><h1>${counts.active} active</h1></div>
      <button data-stop-all ${model.barrier.generation < 1 ? 'disabled' : ''}>Stop all</button>
    </header>
    <section class="facts">
      <span>${counts.total} known</span><span>${counts.recording} recording</span>
      <span>${counts.residual} need cleanup</span><span>barrier ${esc(model.barrier.state)}</span>
    </section>
    <table><thead><tr><th>Capability</th><th>State</th><th>Owner</th><th>Resource claims</th><th>Outcome / blame</th><th>Cleanup</th><th>Artifact custody</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="empty">No registered operations</td></tr>'}</tbody></table>`
  root.querySelector('[data-stop-all]')?.addEventListener('click', () => {
    requestHostStopAll(model.barrier.generation)
  })
}

wireBridge((message) => {
  model = applyOperationControlMessage(model, message)
  render()
})

render()
requestOperationSnapshot()
