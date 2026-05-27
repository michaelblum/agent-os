// chip-menu.js — popover menu anchored to the agent chip.
// Menu items emit custom events on document; task-specific handlers live in
// fork-flow.js, rename-flow.js, delete-flow.js, and undo handler in ui.js.

import { getActiveAgent } from './active-agent.js';
import { getSessionState } from './studio-session.js';

export function openChipMenu(anchor) {
  const menu = document.getElementById('chip-menu');
  const { dirty, baselinePersisted } = getSessionState();
  menu.innerHTML = `
    <div class="item" data-act="save" ${dirty ? '' : 'style="opacity:0.4;pointer-events:none"'}>Save</div>
    <div class="item" data-act="revert" ${dirty || !baselinePersisted ? '' : 'style="opacity:0.4;pointer-events:none"'}>Revert</div>
    <div class="sep"></div>
    <div class="item" data-act="save-as">Save as…</div>
    <div class="item" data-act="rename">Rename</div>
    <div class="sep"></div>
    <div class="item danger" data-act="delete">Delete…</div>
  `;
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom + 4}px`;
  menu.hidden = false;

  const onDoc = (e) => {
    if (!menu.contains(e.target)) { closeMenu(); }
  };
  const onClick = (e) => {
    const act = e.target?.dataset?.act;
    if (!act) return;
    closeMenu();
    document.dispatchEvent(new CustomEvent(`chip:${act}`));
  };
  function closeMenu() {
    menu.hidden = true;
    document.removeEventListener('click', onDoc, true);
    menu.removeEventListener('click', onClick);
  }
  setTimeout(() => {
    document.addEventListener('click', onDoc, true);
    menu.addEventListener('click', onClick);
  }, 0);
}
