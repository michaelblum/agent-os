// inspector-panel.js — AX element inspector overlay.
//
// Displays role, title, label, value, bounds, and context path
// for the element under the cursor. Title bar shows live cursor
// coordinates and display number.

import { AosComponent, esc } from '../_base/base.js';

const BASE_TITLE = 'AOS Inspector';

class InspectorPanel extends AosComponent {
  constructor() {
    super({ title: BASE_TITLE, id: 'aos-inspector' });
  }

  onMessage(msg) {
    if (msg.type === 'element') this._updateElement(msg.data);
    if (msg.type === 'cursor') this._updateCursor(msg.x, msg.y, msg.display);
  }

  renderContent() {
    return '<div class="empty">Move cursor to inspect elements</div>';
  }

  _updateElement(data) {
    if (!data || !data.role) {
      this.setContent('<div class="empty">No element under cursor</div>');
      return;
    }

    let html = '';
    html += `<div class="row"><span class="label">Role</span><span class="value"><span class="role-badge">${esc(data.role)}</span></span></div>`;
    if (data.title) {
      html += `<div class="row"><span class="label">Title</span><span class="value">${esc(data.title)}</span></div>`;
    }
    if (data.label) {
      html += `<div class="row"><span class="label">Label</span><span class="value">${esc(data.label)}</span></div>`;
    }
    if (data.value) {
      html += `<div class="row"><span class="label">Value</span><span class="value">${esc(data.value)}</span></div>`;
    }
    if (data.bounds) {
      const b = data.bounds;
      html += `<div class="row"><span class="label">Bounds</span><span class="value bounds">${Math.round(b.x)}, ${Math.round(b.y)}  ${Math.round(b.width)} \u00d7 ${Math.round(b.height)}</span></div>`;
    }
    if (Array.isArray(data.context_path) && data.context_path.length > 0) {
      html += '<div class="path">';
      data.context_path.forEach((seg, i) => {
        if (i > 0) html += '<span class="sep">\u203a</span>';
        html += `<span>${esc(seg)}</span>`;
      });
      html += '</div>';
    }
    this.setContent(html);
  }

  _updateCursor(x, y, display) {
    this.setTitle(`${BASE_TITLE} \u2014 ${Math.round(x)}, ${Math.round(y)}  Display ${display}`);
  }
}

new InspectorPanel().mount(document.getElementById('app'));
