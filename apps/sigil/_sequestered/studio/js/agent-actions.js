// agent-actions.js — draft-first agent lifecycle flows.

import { forkAgent } from '../../renderer/agent-fork.js';
import { getActiveAgent } from './active-agent.js';
import { deleteAgent, listAgents, loadAgentDoc } from './agent-api.js';
import { serializeDraftAgent } from './agent-doc.js';
import { showFormModal } from './modal.js';
import {
  createUnsavedDraft,
  deleteActiveAgentAndFallback,
  readCurrentDraft,
  revertActiveDraft,
  saveActiveDraft,
  updateDraftIdentity,
} from './studio-session.js';

async function promptAgentIdentity({ title, confirmLabel = 'OK', defaults = {} }) {
  return showFormModal({
    title,
    confirmLabel,
    fields: [
      { key: 'id', label: 'Id (lowercase, no spaces)', value: defaults.id ?? '', pattern: '[a-z0-9_-]+' },
      { key: 'name', label: 'Display name', value: defaults.name ?? '' },
    ],
  });
}

async function promptDisplayName({ title, currentName }) {
  return showFormModal({
    title,
    confirmLabel: 'Rename',
    fields: [
      { key: 'name', label: 'Display name', value: currentName ?? '' },
    ],
  });
}

async function doFork(sourceId) {
  const active = getActiveAgent();
  const sourceMarkdown = sourceId && sourceId === active?.id
    ? serializeDraftAgent(readCurrentDraft())
    : (sourceId ? await loadAgentDoc(sourceId) : '');

  const result = await promptAgentIdentity({
    title: sourceId ? `Fork "${sourceId}"` : 'Create new agent',
    confirmLabel: 'Create',
  });
  if (!result?.id || !result?.name) return;

  const existing = await listAgents();
  if (existing.includes(result.id)) {
    alert(`Agent id "${result.id}" already exists.`);
    return;
  }

  const newDoc = forkAgent(sourceMarkdown || '', result.id, result.name);
  await createUnsavedDraft({ id: result.id, name: result.name, sourceMarkdown: newDoc });
}

async function doRename() {
  const active = getActiveAgent();
  if (!active?.id) return;
  const result = await promptDisplayName({
    title: `Rename "${active.id}"`,
    currentName: active.name ?? active.id,
  });
  if (!result?.name) return;
  const input = document.getElementById('agentDisplayName');
  if (input) input.value = result.name;
  updateDraftIdentity({ name: result.name });
  document.dispatchEvent(new CustomEvent('studio:draft-input'));
}

async function doDelete() {
  const active = getActiveAgent();
  if (!active?.id) return;
  const confirmed = await showFormModal({
    title: `Delete "${active.id}"?`,
    confirmLabel: 'Delete',
    danger: true,
    fields: [],
  });
  if (!confirmed) return;
  await deleteActiveAgentAndFallback();
  document.dispatchEvent(new CustomEvent('roster:refresh'));
}

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
    closeMenu();
    if (act === 'rename') {
      if (getActiveAgent()?.id === id) await doRename();
      else {
        const md = await loadAgentDoc(id);
        if (!md) return;
        const currentName = md.match(/^name:\s*(.+)$/m)?.[1] ?? id;
        const result = await promptDisplayName({ title: `Rename "${id}"`, currentName });
        if (!result?.name) return;
        await createUnsavedDraft({ id, name: result.name, sourceMarkdown: md.replace(/^name:\s*.+$/m, `name: ${result.name}`) });
      }
    } else if (act === 'clone') {
      await doFork(id);
    } else if (act === 'delete') {
      if (getActiveAgent()?.id !== id) {
        const confirmed = await showFormModal({
          title: `Delete "${id}"?`,
          confirmLabel: 'Delete',
          danger: true,
          fields: [],
        });
        if (!confirmed) return;
        await deleteAgent(id);
        document.dispatchEvent(new CustomEvent('roster:refresh'));
        return;
      }
      await doDelete();
    }
  };

  const onDoc = (e) => {
    if (!menu.contains(e.target)) closeMenu();
  };

  function closeMenu() {
    menu.hidden = true;
    document.removeEventListener('click', onDoc, true);
    menu.removeEventListener('click', onClick);
  }

  setTimeout(() => {
    menu.addEventListener('click', onClick);
    document.addEventListener('click', onDoc, true);
  }, 0);
}

export function setupAgentActions() {
  document.addEventListener('chip:save', () => { void saveActiveDraft(); });
  document.addEventListener('chip:revert', () => { revertActiveDraft(); });
  document.addEventListener('chip:save-as', () => { void doFork(getActiveAgent()?.id); });
  document.addEventListener('chip:rename', () => { void doRename(); });
  document.addEventListener('chip:delete', () => { void doDelete(); });
  document.addEventListener('roster:new', () => { void doFork(null); });
  document.addEventListener('roster:kebab', (e) => openRosterKebab(e.detail.id, e.detail.anchor));
  document.getElementById('btn-save')?.addEventListener('click', () => { void saveActiveDraft(); });
  document.getElementById('btn-revert')?.addEventListener('click', () => { revertActiveDraft(); });
}
