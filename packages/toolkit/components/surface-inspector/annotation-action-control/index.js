import { emit } from '../../../runtime/bridge.js'
import { declareManifest, emitReady } from '../../../runtime/manifest.js'

const params = new URLSearchParams(window.location.search)
const target = params.get('target') || 'surface-inspector'
const canvasId = params.get('canvas') || ''
const action = params.get('action') || 'add_comment'
const label = params.get('label') || 'Annotation action'
const icon = params.get('icon') || 'plus'
const accent = params.get('accent') || 'blue'
const pressed = params.get('pressed') === '1'

const button = document.getElementById('action')
button.title = label
button.setAttribute('aria-label', label)
button.setAttribute('data-aos-ref', 'surface-inspector:annotation-action')
button.setAttribute('data-aos-surface', 'surface-inspector')
button.setAttribute('data-semantic-target-id', `annotation-action-${action}`)
button.setAttribute('data-aos-action', action)
button.dataset.action = action
button.dataset.canvasId = canvasId
button.setAttribute('aria-pressed', pressed ? 'true' : 'false')
button.classList.toggle('accent-gold', accent === 'gold')
button.classList.toggle('accent-blue', accent !== 'gold')
button.classList.toggle('is-pressed', pressed)
button.innerHTML = icon === 'frame_anchor'
  ? '<span class="frame-anchor-icon" aria-hidden="true"></span>'
  : '<span class="plus-icon" aria-hidden="true"></span>'

button.addEventListener('click', (event) => {
  event.preventDefault()
  event.stopPropagation()
  emit('canvas.send', {
    target,
    message: {
      type: 'canvas_inspector.annotation_display_action',
      action,
      canvas_id: canvasId,
    },
  })
})

declareManifest({
  name: 'surface-inspector-annotation-action-control',
  title: label,
  accepts: [],
  emits: ['canvas.send'],
})
emitReady()
