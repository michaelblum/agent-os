// base.js — AosComponent base class (ES module)
//
// Provides shared plumbing for toolkit components:
//   - Bridge wiring (headsup.receive → onMessage)
//   - Panel chrome (header bar with title, drag handle)
//   - Drag support (mousedown on header → postToHost move_delta)
//
// Usage:
//   import { AosComponent } from '../_base/base.js';
//   class MyComponent extends AosComponent {
//     constructor() { super({ title: 'My Tool', id: 'my-tool' }); }
//     onMessage(msg) { /* handle incoming messages */ }
//     renderContent() { return '<div>body here</div>'; }
//   }
//   new MyComponent().mount();

import { esc, initBridge, postToHost } from './bridge.js';

export { esc, postToHost };

export class AosComponent {
  constructor({ title = 'AOS', id = 'aos-component' } = {}) {
    this.title = title;
    this.id = id;
  }

  // Override in subclass — called for each headsup message
  onMessage(msg) {}

  // Override in subclass — return inner HTML for the content area
  renderContent() { return ''; }

  // Mount the component into the DOM
  mount(container = document.body) {
    container.innerHTML = '';

    // Panel wrapper
    const panel = document.createElement('div');
    panel.className = 'aos-panel';
    panel.id = this.id;
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';

    // Header
    const header = document.createElement('div');
    header.className = 'aos-header aos-drag-handle';
    header.style.cssText = 'padding:6px 10px;border-bottom:1px solid var(--border-subtle);flex-shrink:0;display:flex;justify-content:space-between;align-items:center;cursor:grab;user-select:none;';
    header.innerHTML = `<span class="aos-title">${esc(this.title)}</span><span class="aos-controls"></span>`;
    panel.appendChild(header);

    // Content area
    const content = document.createElement('div');
    content.className = 'aos-content';
    content.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;';
    content.innerHTML = this.renderContent();
    panel.appendChild(content);

    container.appendChild(panel);

    this._panel = panel;
    this._header = header;
    this._content = content;

    // Wire bridge
    initBridge((msg) => this.onMessage(msg));

    // Wire drag
    this._initDrag(header);
  }

  // Update the content area
  setContent(html) {
    if (this._content) this._content.innerHTML = html;
  }

  // Update header title
  setTitle(text) {
    const el = this._header?.querySelector('.aos-title');
    if (el) el.textContent = text;
  }

  // Drag implementation — posts position delta to host
  _initDrag(handle) {
    let startX, startY;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('.aos-controls')) return;
      startX = e.screenX;
      startY = e.screenY;
      handle.style.cursor = 'grabbing';

      const onMove = (e) => {
        const dx = e.screenX - startX;
        const dy = e.screenY - startY;
        startX = e.screenX;
        startY = e.screenY;
        postToHost({ action: 'move_delta', dx, dy });
      };

      const onUp = () => {
        handle.style.cursor = 'grab';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}
