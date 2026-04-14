// chrome.js — pure-DOM panel scaffold (header + drag + content slot).
//
// Knows nothing about messaging or contents. Just builds the visual frame
// and reports drag deltas via raw move postMessage (daemon-supported legacy
// relative-move type that auto-targets the calling canvas).

import { esc } from '../runtime/bridge.js'
import { move } from '../runtime/canvas.js'

export function mountChrome(container, { title = 'AOS', draggable = true } = {}) {
  container.innerHTML = ''
  container.style.cssText = 'margin:0;height:100vh;display:flex;flex-direction:column;'

  const panel = document.createElement('div')
  panel.className = 'aos-panel'
  panel.style.cssText = 'flex:1;display:flex;flex-direction:column;'

  const header = document.createElement('div')
  header.className = 'aos-header'
  header.style.cssText = 'padding:6px 10px;flex-shrink:0;display:flex;justify-content:space-between;align-items:center;cursor:' + (draggable ? 'grab' : 'default') + ';user-select:none;gap:8px;'

  const titleEl = document.createElement('span')
  titleEl.className = 'aos-title'
  titleEl.textContent = title

  const controlsEl = document.createElement('span')
  controlsEl.className = 'aos-controls'
  controlsEl.style.cssText = 'display:flex;align-items:center;gap:6px;min-width:0;'

  header.appendChild(titleEl)
  header.appendChild(controlsEl)

  const content = document.createElement('div')
  content.className = 'aos-content'
  content.style.cssText = 'flex:1;overflow:auto;'

  panel.appendChild(header)
  panel.appendChild(content)
  container.appendChild(panel)

  if (draggable) wireDrag(header)

  return {
    panelEl: panel,
    headerEl: header,
    contentEl: content,
    setTitle(text) { titleEl.textContent = text },
    setControls(html) { controlsEl.innerHTML = html },
  }
}

function wireDrag(header) {
  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('.aos-controls')) return
    let lastX = e.screenX, lastY = e.screenY
    header.style.cursor = 'grabbing'
    const onMove = (ev) => {
      const dx = ev.screenX - lastX
      const dy = ev.screenY - lastY
      lastX = ev.screenX; lastY = ev.screenY
      // Drag deltas → Layer 1a move helper (wraps daemon's legacy relative-move).
      move(dx, dy)
    }
    const onUp = () => {
      header.style.cursor = 'grab'
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  })
}
