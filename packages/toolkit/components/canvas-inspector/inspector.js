// inspector.js — Canvas inspector component
//
// Shows a spatial minimap of displays with canvas overlays,
// plus a canvas list with per-canvas controls.

import { AosComponent, esc, postToHost } from '../_base/base.js';

const SELF_ID = 'canvas-inspector';
const TINT_COLORS = [
  'rgba(255,80,80,0.25)',   // red
  'rgba(80,180,255,0.25)',  // blue
  'rgba(80,255,120,0.25)',  // green
  'rgba(255,200,60,0.25)',  // yellow
  'rgba(200,80,255,0.25)',  // purple
  'rgba(255,140,60,0.25)',  // orange
];

class CanvasInspector extends AosComponent {
  constructor() {
    super({ title: 'Canvas Inspector', id: SELF_ID });
    this.displays = [];
    this.canvases = [];
    this.tintedIds = new Set();
    this._tintMap = {};  // canvasId -> color
    this._tintIdx = 0;
    this._eventCount = 0;
  }

  onMessage(msg) {
    // canvas_lifecycle events arrive from daemon subscription
    if (msg.event === 'canvas_lifecycle' || msg.type === 'canvas_lifecycle') {
      const data = msg.data || msg;
      this._eventCount++;
      this._handleLifecycle(data);
    }
    // Bootstrap data from eval
    if (msg.type === 'bootstrap') {
      if (msg.displays) this.displays = msg.displays;
      if (msg.canvases) this.canvases = msg.canvases;
      this._render();
    }
  }

  _handleLifecycle(data) {
    const { canvas_id, action, at } = data;
    if (action === 'created' || action === 'updated') {
      const existing = this.canvases.find(c => c.id === canvas_id);
      if (existing) {
        if (at) existing.at = at;
      } else {
        this.canvases.push({ id: canvas_id, at: at || [0, 0, 0, 0], interactive: false });
      }
    } else if (action === 'removed') {
      this.canvases = this.canvases.filter(c => c.id !== canvas_id);
      this.tintedIds.delete(canvas_id);
    }
    this._render();
  }

  renderContent() {
    return '<div class="empty-state">Loading canvas data...</div>';
  }

  _render() {
    const filteredCanvases = this.canvases.filter(c => c.id !== SELF_ID);

    let html = '';
    html += this._renderMinimap(filteredCanvases);
    html += this._renderList(filteredCanvases);

    this.setContent(html);
    this.setTitle(`Canvas Inspector (${filteredCanvases.length})`);
    this._bindListEvents();
  }

  _renderMinimap(canvases) {
    if (this.displays.length === 0) return '';

    // Calculate bounding box of all displays
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const d of this.displays) {
      minX = Math.min(minX, d.bounds.x);
      minY = Math.min(minY, d.bounds.y);
      maxX = Math.max(maxX, d.bounds.x + d.bounds.w);
      maxY = Math.max(maxY, d.bounds.y + d.bounds.h);
    }
    const totalW = maxX - minX;
    const totalH = maxY - minY;

    // Scale to fit in minimap (max 280px wide, proportional height)
    const mapW = 280;
    const scale = mapW / totalW;
    const mapH = Math.round(totalH * scale);

    let html = `<div class="minimap" style="width:${mapW}px;height:${mapH}px">`;

    // Draw displays
    for (const d of this.displays) {
      const x = Math.round((d.bounds.x - minX) * scale);
      const y = Math.round((d.bounds.y - minY) * scale);
      const w = Math.round(d.bounds.w * scale);
      const h = Math.round(d.bounds.h * scale);
      html += `<div class="minimap-display" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">`;
      html += `<span class="minimap-display-label">${d.is_main ? '\u2605 ' : ''}${d.width}\u00d7${d.height}</span>`;
      html += `</div>`;
    }

    // Draw canvases
    for (const c of canvases) {
      if (!c.at || c.at.length < 4) continue;
      const [cx, cy, cw, ch] = c.at;
      const x = Math.round((cx - minX) * scale);
      const y = Math.round((cy - minY) * scale);
      const w = Math.max(2, Math.round(cw * scale));
      const h = Math.max(2, Math.round(ch * scale));
      const tint = this._tintMap[c.id];
      const tintStyle = tint ? `background:${tint};` : '';
      const cls = c.id === SELF_ID ? 'minimap-canvas self' : (tint ? 'minimap-canvas tinted' : 'minimap-canvas');
      html += `<div class="${cls}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;${tintStyle}" title="${esc(c.id)}"></div>`;
    }

    html += `</div>`;
    return html;
  }

  _renderList(canvases) {
    if (canvases.length === 0) {
      return '<div class="empty-state">No canvases active</div>';
    }

    let html = '<div class="canvas-list">';
    for (const c of canvases) {
      const isSelf = c.id === SELF_ID;
      const cls = isSelf ? 'canvas-item self' : 'canvas-item';
      const [x, y, w, h] = c.at || [0, 0, 0, 0];
      const dims = `${Math.round(w)}\u00d7${Math.round(h)} @ ${Math.round(x)},${Math.round(y)}`;
      const isTinted = this.tintedIds.has(c.id);

      html += `<div class="${cls}" data-id="${esc(c.id)}">`;
      html += `<span class="canvas-id">${esc(c.id)}</span>`;
      html += `<span class="canvas-dims">${dims}</span>`;
      html += `<span class="canvas-flags">`;
      if (c.interactive) html += `<span class="flag interactive">int</span>`;
      if (c.scope === 'connection') html += `<span class="flag scoped">conn</span>`;
      if (c.ttl != null) html += `<span class="flag">ttl:${Math.round(c.ttl)}s</span>`;
      if (!isSelf) {
        html += `<button class="btn tint-btn${isTinted ? ' active' : ''}" data-id="${esc(c.id)}">tint</button>`;
        html += `<button class="btn remove-btn" data-id="${esc(c.id)}">\u2715</button>`;
      }
      html += `</span>`;
      html += `</div>`;
    }
    html += '</div>';

    html += `<div class="status-bar"><span class="event-count">${this._eventCount} events</span><span>live</span></div>`;
    return html;
  }

  _bindListEvents() {
    // Tint buttons
    for (const btn of document.querySelectorAll('.tint-btn')) {
      btn.addEventListener('click', (e) => {
        const id = e.target.dataset.id;
        if (this.tintedIds.has(id)) {
          this.tintedIds.delete(id);
          delete this._tintMap[id];
        } else {
          this.tintedIds.add(id);
          this._tintMap[id] = TINT_COLORS[this._tintIdx % TINT_COLORS.length];
          this._tintIdx++;
          // Eval tint on the actual canvas
          postToHost({ action: 'eval_canvas', target: id, js: `document.body.style.background='${this._tintMap[id]}'` });
        }
        this._render();
      });
    }

    // Remove buttons
    for (const btn of document.querySelectorAll('.remove-btn')) {
      btn.addEventListener('click', (e) => {
        const id = e.target.dataset.id;
        postToHost({ action: 'remove_canvas', target: id });
      });
    }
  }
}

// Boot
const inspector = new CanvasInspector();
inspector.mount(document.getElementById('app'));
