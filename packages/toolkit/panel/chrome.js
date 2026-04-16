// chrome.js — pure-DOM panel scaffold (header + drag + content slot).
//
// Knows nothing about messaging or contents. Just builds the visual frame
// and reports absolute drag updates through the runtime canvas helper.

import { moveAbsolute } from '../runtime/canvas.js'

export function mountChrome(container, { title = 'AOS', draggable = true } = {}) {
  container.innerHTML = ''
  container.classList.add('aos-panel-root')

  const panel = document.createElement('div')
  panel.className = 'aos-panel'

  const header = document.createElement('div')
  header.className = 'aos-header'
  header.dataset.draggable = String(draggable)

  const titleEl = document.createElement('span')
  titleEl.className = 'aos-title'
  titleEl.textContent = title

  const controlsEl = document.createElement('span')
  controlsEl.className = 'aos-controls'

  header.appendChild(titleEl)
  header.appendChild(controlsEl)

  const content = document.createElement('div')
  content.className = 'aos-content'

  panel.appendChild(header)
  panel.appendChild(content)
  container.appendChild(panel)

  if (draggable) wireDrag(header, controlsEl)

  return {
    panelEl: panel,
    headerEl: header,
    titleEl,
    controlsEl,
    contentEl: content,
    setTitle(text) { titleEl.textContent = text },
    setControls(html) { controlsEl.innerHTML = html },
  }
}

function wireDrag(header, controlsEl) {
  header.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    if (e.target instanceof Node && controlsEl.contains(e.target)) return
    const pointerId = e.pointerId
    const offsetX = e.clientX
    const offsetY = e.clientY
    header.dataset.dragging = 'true'
    e.preventDefault()

    try { header.setPointerCapture(pointerId) } catch {}

    const onMove = (ev) => {
      if (ev.pointerId !== pointerId) return
      moveAbsolute(ev.screenX, ev.screenY, offsetX, offsetY)
    }

    const onUp = (ev) => {
      if (ev && ev.pointerId !== pointerId) return
      delete header.dataset.dragging
      header.removeEventListener('pointermove', onMove)
      header.removeEventListener('pointerup', onUp)
      header.removeEventListener('pointercancel', onUp)
      header.removeEventListener('lostpointercapture', onUp)
      try {
        if (header.hasPointerCapture(pointerId)) header.releasePointerCapture(pointerId)
      } catch {}
    }

    header.addEventListener('pointermove', onMove)
    header.addEventListener('pointerup', onUp)
    header.addEventListener('pointercancel', onUp)
    header.addEventListener('lostpointercapture', onUp)
  })
}
