// agent-actions.js — flows that change agent destination (fork/rename/delete/undo).
// Each flow is wired to a custom event emitted by chip-menu or roster.

import { forkAgent } from '../../renderer/agent-fork.js';
import { listAgents, loadAgentDoc, putAgentDoc, deleteAgent } from './agent-api.js';
import { parseAgentDoc } from '../../renderer/agent-loader.js';
import { applyAppearance } from '../../renderer/appearance.js';
import { getActiveAgent, setActiveAgent } from './active-agent.js';
import { undoLastSave } from './undo-handler.js';

// --- Modal prompt helper ---
function prompt({ title, fields, confirmLabel = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const host = document.getElementById('modal-host');
    const fieldHtml = fields.map(f => `
      <label>${f.label}</label>
      <input data-key="${f.key}" value="${f.value ?? ''}" ${f.pattern ? `pattern="${f.pattern}"` : ''}>
    `).join('');
    host.innerHTML = `
      <div class="modal">
        <h3>${title}</h3>
        ${fieldHtml}
        <div class="buttons">
          <button data-act="cancel">Cancel</button>
          <button data-act="ok" class="primary ${danger ? 'danger' : ''}">${confirmLabel}</button>
        </div>
      </div>
    `;
    host.hidden = false;
    const firstInput = host.querySelector('input');
    firstInput?.focus();
    firstInput?.select();
    host.addEventListener('click', (e) => {
      const act = e.target?.dataset?.act;
      if (act === 'cancel') { close(null); }
      else if (act === 'ok') {
        const values = {};
        for (const input of host.querySelectorAll('input')) values[input.dataset.key] = input.value.trim();
        close(values);
      }
    });
    function close(result) { host.hidden = true; host.innerHTML = ''; resolve(result); }
  });
}

// --- Fork (save-as / + new / clone) ---
async function doFork(sourceId) {
  const source = sourceId ? await loadAgentDoc(sourceId) : '';
  const result = await prompt({
    title: sourceId ? `Fork "${sourceId}"` : 'Create new agent',
    fields: [
      { key: 'id', label: 'Id (lowercase, no spaces)', value: '', pattern: '[a-z0-9_-]+' },
      { key: 'name', label: 'Display name', value: '' },
    ],
    confirmLabel: 'Create',
  });
  if (!result || !result.id || !result.name) return;
  const existing = await listAgents();
  if (existing.includes(result.id)) {
    alert(`Agent id "${result.id}" already exists.`);
    return;
  }
  const newDoc = forkAgent(source, result.id, result.name);
  await putAgentDoc(result.id, newDoc);
  const parsed = parseAgentDoc(newDoc); parsed.id = result.id;
  applyAppearance(parsed.appearance);
  setActiveAgent(parsed);
  document.dispatchEvent(new CustomEvent('roster:refresh'));
}

// --- Rename ---
async function doRename(id) {
  const md = await loadAgentDoc(id);
  if (!md) return;
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  const currentName = m ? (m[1].match(/^name:\s*(.+)$/m)?.[1] ?? id) : id;
  const result = await prompt({
    title: `Rename "${id}"`,
    fields: [{ key: 'name', label: 'Display name', value: currentName }],
    confirmLabel: 'Rename',
  });
  if (!result || !result.name) return;
  const updated = md.replace(/^name:\s*.+$/m, `name: ${result.name}`);
  await putAgentDoc(id, updated);
  const active = getActiveAgent();
  if (active?.id === id) setActiveAgent({ ...active, name: result.name });
  document.dispatchEvent(new CustomEvent('roster:refresh'));
}

// --- Delete ---
async function doDelete(id) {
  const confirmed = await prompt({
    title: `Delete "${id}"?`,
    fields: [],
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!confirmed) return;
  await deleteAgent(id);
  const active = getActiveAgent();
  if (active?.id === id) {
    const remaining = await listAgents();
    const fallback = remaining.find(x => x === 'default') ?? remaining[0];
    if (fallback) {
      const md = await loadAgentDoc(fallback);
      const parsed = parseAgentDoc(md); parsed.id = fallback;
      applyAppearance(parsed.appearance);
      setActiveAgent(parsed);
    }
  }
  document.dispatchEvent(new CustomEvent('roster:refresh'));
}

// --- Undo ---
async function doUndo() {
  const id = getActiveAgent()?.id;
  if (!id) return;
  const entry = undoLastSave.buffer.undo(id);
  if (!entry) return;
  applyAppearance(entry.appearance);
  document.dispatchEvent(new CustomEvent('undo:applied'));
  document.dispatchEvent(new CustomEvent('persist:request'));
}

// --- Roster kebab menu ---
function openRosterKebab(id, anchor) {
  const menu = document.getElementById('chip-menu');
  menu.innerHTML = `
    <div class="item" data-act="rename">Rename</div>
    <div class="item" data-act="clone">Clone…</div>
    <div class="sep"></div>
    <div class="item danger" data-act="delete">Delete…</div>
  `;
  const rect = anchor.getBoundingClientRect();
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom + 4}px`;
  menu.hidden = false;
  const onClick = async (e) => {
    const act = e.target?.dataset?.act;
    if (!act) return;
    menu.hidden = true;
    menu.removeEventListener('click', onClick);
    if (act === 'rename') doRename(id);
    else if (act === 'clone') doFork(id);
    else if (act === 'delete') doDelete(id);
  };
  const onDoc = (e) => {
    if (!menu.contains(e.target)) {
      menu.hidden = true;
      document.removeEventListener('click', onDoc, true);
      menu.removeEventListener('click', onClick);
    }
  };
  setTimeout(() => {
    menu.addEventListener('click', onClick);
    document.addEventListener('click', onDoc, true);
  }, 0);
}

export function setupAgentActions() {
  document.addEventListener('chip:save-as', () => doFork(getActiveAgent()?.id));
  document.addEventListener('chip:rename', () => doRename(getActiveAgent()?.id));
  document.addEventListener('chip:delete', () => doDelete(getActiveAgent()?.id));
  document.addEventListener('chip:undo', doUndo);
  document.addEventListener('roster:new', () => doFork(null));
  document.addEventListener('roster:kebab', (e) => openRosterKebab(e.detail.id, e.detail.anchor));
}
