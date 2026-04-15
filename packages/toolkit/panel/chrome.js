// chrome.js — pure-DOM panel scaffold (header + drag + content slot).
//
// Knows nothing about messaging or contents. Just builds the visual frame
// and reports drag deltas via raw move postMessage (daemon-supported legacy
// relative-move type that auto-targets the calling canvas).

import { move } from '../runtime/canvas.js'

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
  header.addEventListener('mousedown', (e) => {
    if (e.target instanceof Node && controlsEl.contains(e.target)) return
    let lastX = e.screenX, lastY = e.screenY
    header.dataset.dragging = 'true'
    const onMove = (ev) => {
      const dx = ev.screenX - lastX
      const dy = ev.screenY - lastY
      lastX = ev.screenX; lastY = ev.screenY
      // Drag deltas → Layer 1a move helper (wraps daemon's legacy relative-move).
      move(dx, dy)
    }
    const onUp = () => {
      delete header.dataset.dragging
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })
}
