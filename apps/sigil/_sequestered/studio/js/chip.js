// chip.js — agent chip (identity pill + sync status + menu).
// Sources active-agent state from a small shared module bus so roster.js
// and chip.js stay in sync when the user switches agents.

import { getActiveAgent, onActiveAgentChange } from './active-agent.js';
import { openChipMenu } from './chip-menu.js';

export function setupChip() {
  const chip = document.getElementById('agent-chip');
  const nameEl = chip.querySelector('.name');
  const orbEl = chip.querySelector('.orb');
  const syncEl = chip.querySelector('.sync');
  const syncLabel = syncEl.querySelector('.label');
  const saveBtn = document.getElementById('btn-save');
  const revertBtn = document.getElementById('btn-revert');

  function render(agent) {
    nameEl.textContent = agent?.name ?? agent?.id ?? '—';
    const [c1, c2] = agent?.appearance?.colors?.face ?? ['#bc13fe', '#4a2b6e'];
    orbEl.style.setProperty('--orb-gradient', `linear-gradient(135deg, ${c1}, ${c2})`);
  }
  render(getActiveAgent());
  onActiveAgentChange(render);

  function setSync(state, label) {
    syncEl.setAttribute('data-state', state);
    syncLabel.textContent = label;
  }
  document.addEventListener('studio:dirty-state', (e) => {
    const dirty = !!e.detail?.dirty;
    if (saveBtn) saveBtn.disabled = !dirty;
    if (revertBtn) revertBtn.disabled = !dirty;
  });
  document.addEventListener('sync:dirty',  (e) => setSync('dirty',  e.detail?.message ?? 'Unsaved changes'));
  document.addEventListener('sync:saving', () => setSync('saving', 'Saving…'));
  document.addEventListener('sync:saved',  (e) => setSync('saved',  e.detail?.message ?? 'All changes saved'));
  document.addEventListener('sync:error',  (e) => setSync('error',  `Save failed — ${e.detail?.message ?? 'retry'}`));

  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    openChipMenu(chip);
  });
  chip.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openChipMenu(chip); }
  });
}
