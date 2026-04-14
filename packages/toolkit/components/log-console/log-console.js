// log-console.js — scrolling timestamped log panel.
//
// Renders entries with severity levels (info/warn/error/debug).
// Caps at maxEntries by pruning the oldest entries. Auto-scrolls
// to the newest entry on each append.

import { AosComponent, esc } from '../_base/base.js';

const MAX_ENTRIES = 500;

class LogConsole extends AosComponent {
  constructor() {
    super({ title: 'AOS Log', id: 'aos-log' });
    this._count = 0;
  }

  onMessage(msg) {
    if (msg.type === 'log') this._pushLog(msg.message, msg.level);
    if (msg.type === 'clear') this._clearLog();
  }

  renderContent() {
    return '<div id="entries"></div>';
  }

  mount(container) {
    super.mount(container);
    const controls = this._header.querySelector('.aos-controls');
    if (controls) controls.innerHTML = '<span class="count" id="count">0 entries</span>';
  }

  _entries() { return this._content.querySelector('#entries'); }
  _countEl() { return this._header.querySelector('#count'); }

  _pushLog(message, level) {
    level = level || 'info';
    const entries = this._entries();
    if (!entries) return;

    const entry = document.createElement('div');
    entry.className = 'entry';

    const now = new Date();
    const ts = String(now.getHours()).padStart(2, '0') + ':' +
               String(now.getMinutes()).padStart(2, '0') + ':' +
               String(now.getSeconds()).padStart(2, '0');

    entry.innerHTML =
      `<span class="ts">${ts}</span>` +
      `<span class="level ${esc(level)}">${esc(level)}</span>` +
      `<span class="msg">${esc(message)}</span>`;

    entries.appendChild(entry);
    this._count++;

    while (entries.children.length > MAX_ENTRIES) {
      entries.removeChild(entries.firstChild);
    }

    this._content.scrollTop = this._content.scrollHeight;

    const countEl = this._countEl();
    if (countEl) countEl.textContent = `${this._count} entries`;
  }

  _clearLog() {
    const entries = this._entries();
    if (entries) entries.innerHTML = '';
    this._count = 0;
    const countEl = this._countEl();
    if (countEl) countEl.textContent = '0 entries';
  }
}

new LogConsole().mount(document.getElementById('app'));
