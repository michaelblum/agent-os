// studio-session.js — draft/save workflow for Studio-backed avatar editing.

import { applyAppearance, snapshotAppearance } from '../../renderer/appearance.js';
import { getActiveAgent, setActiveAgent } from './active-agent.js';
import { loadAgentDoc, putAgentDoc, listAgents, deleteAgent } from './agent-api.js';
import { cloneDraftAgent, createDraftAgent, parseDraftAgent, serializeDraftAgent } from './agent-doc.js';
import { showChoiceModal } from './modal.js';
import { undoLastSave } from './undo-handler.js';

const session = {
  baseline: null,
  baselinePersisted: false,
  syncingDraft: false,
  previewScheduled: false,
  previewDirty: false,
  hooks: null,
  readyNotified: false,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function compareValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalizeInstance(instance = {}) {
  const birthplace = instance.birthplace ?? instance.home ?? { anchor: 'nonant', nonant: 'bottom-right', display: 'main' };
  return {
    ...clone(instance),
    birthplace: {
      anchor: birthplace.anchor ?? 'nonant',
      nonant: birthplace.nonant ?? 'bottom-right',
      display: birthplace.display ?? 'main',
    },
    size: Number(instance.size ?? 180),
  };
}

function emitSync(state, message) {
  document.dispatchEvent(new CustomEvent(`sync:${state}`, message ? { detail: { message } } : undefined));
}

function emitDirtyState() {
  const dirty = isDirty();
  document.dispatchEvent(new CustomEvent('studio:dirty-state', {
    detail: {
      dirty,
      persisted: session.baselinePersisted,
      canRevert: !!session.baseline,
    },
  }));
  if (dirty) {
    emitSync('dirty', session.baselinePersisted ? 'Unsaved changes' : 'Unsaved new avatar');
  } else {
    emitSync('saved', 'All changes saved');
  }
}

function schedulePreview() {
  if (!session.hooks?.pushLivePreview) return;
  session.previewDirty = true;
  if (session.previewScheduled) return;
  session.previewScheduled = true;
  requestAnimationFrame(() => {
    session.previewScheduled = false;
    if (!session.previewDirty) return;
    session.previewDirty = false;
    session.hooks.pushLivePreview(snapshotAppearance());
  });
}

function hydrateFromDraft(draft) {
  session.syncingDraft = true;
  try {
    applyAppearance(draft.appearance);
    session.hooks?.syncUIFromState?.();
    session.hooks?.writeAgentPanel?.(draft);
    session.hooks?.pushLivePreview?.(snapshotAppearance());
    setActiveAgent({
      id: draft.id,
      name: draft.name,
      appearance: clone(draft.appearance),
      instance: clone(draft.instance),
      tags: [...(draft.tags || [])],
      minds: clone(draft.minds || {}),
      prose: draft.prose,
      version: draft.version,
      frontmatterExtra: clone(draft.frontmatterExtra || {}),
      bodyExtra: clone(draft.bodyExtra || {}),
    });
  } finally {
    session.syncingDraft = false;
  }
  emitDirtyState();
}

function loadBaseline(draft, { persisted }) {
  session.baselinePersisted = !!persisted;
  session.baseline = null;
  hydrateFromDraft(cloneDraftAgent(draft));
  session.baseline = cloneDraftAgent(readCurrentDraft());
  document.dispatchEvent(new CustomEvent('roster:refresh'));
  emitDirtyState();
}

async function parsePersistedAgent(id) {
  const markdown = await loadAgentDoc(id);
  if (markdown === null) {
    return {
      draft: createDraftAgent({ id, name: id }),
      persisted: false,
    };
  }
  return {
    draft: parseDraftAgent(markdown, id),
    persisted: true,
  };
}

async function confirmDiscardOrSave() {
  if (!isDirty()) return 'discard';
  return showChoiceModal({
    title: 'Unsaved changes',
    message: 'Save this avatar before switching?',
    choices: [
      { value: 'save', label: 'Save', primary: true },
      { value: 'discard', label: 'Discard' },
      { value: 'cancel', label: 'Cancel', danger: true },
    ],
  });
}

function comparableDraft(draft) {
  return {
    id: draft.id,
    name: draft.name,
    tags: draft.tags,
    prose: draft.prose,
    appearance: draft.appearance,
    minds: draft.minds,
    instance: normalizeInstance(draft.instance),
    version: draft.version ?? 1,
    frontmatterExtra: draft.frontmatterExtra || {},
    bodyExtra: draft.bodyExtra || {},
  };
}

export function readCurrentDraft() {
  const active = getActiveAgent() || createDraftAgent({ id: 'default', name: 'default' });
  const panelState = session.hooks?.readAgentPanel?.() || {};
  return {
    id: active.id,
    name: panelState.name ?? active.name ?? active.id,
    tags: [...(active.tags || ['sigil'])],
    prose: active.prose ?? `Sigil agent: ${panelState.name ?? active.name ?? active.id}.`,
    appearance: snapshotAppearance(),
    minds: clone(active.minds || { skills: [], tools: [], workflows: [] }),
    instance: {
      ...(clone(active.instance || {})),
      ...clone(panelState.instance || {}),
      birthplace: normalizeInstance({
        ...(active.instance || {}),
        ...(panelState.instance || {}),
      }).birthplace,
    },
    version: active.version ?? session.baseline?.version ?? 1,
    frontmatterExtra: clone(active.frontmatterExtra || session.baseline?.frontmatterExtra || {}),
    bodyExtra: clone(active.bodyExtra || session.baseline?.bodyExtra || {}),
  };
}

export function isDirty() {
  if (session.syncingDraft) return false;
  if (!session.baseline) return false;
  if (!session.baselinePersisted) return true;
  return !compareValue(comparableDraft(readCurrentDraft()), comparableDraft(session.baseline));
}

export function markDraftChanged({ preview = true } = {}) {
  if (session.syncingDraft) return;
  if (preview) schedulePreview();
  emitDirtyState();
}

export async function loadAgentIntoStudio(id, { force = false } = {}) {
  const nextId = String(id || 'default');
  const current = getActiveAgent();
  if (!force && current?.id === nextId) return true;

  if (!force) {
    const choice = await confirmDiscardOrSave();
    if (choice === 'cancel') return false;
    if (choice === 'save') {
      const saved = await saveActiveDraft();
      if (!saved) return false;
    }
  }

  const { draft, persisted } = await parsePersistedAgent(nextId);
  loadBaseline(draft, { persisted });
  return true;
}

export async function createUnsavedDraft({ id, name, sourceMarkdown } = {}, { force = false } = {}) {
  if (!force) {
    const choice = await confirmDiscardOrSave();
    if (choice === 'cancel') return false;
    if (choice === 'save') {
      const saved = await saveActiveDraft();
      if (!saved) return false;
    }
  }
  const safeId = String(id || 'draft');
  const safeName = String(name || safeId);
  const draft = sourceMarkdown
    ? parseDraftAgent(sourceMarkdown, safeId)
    : createDraftAgent({ id: safeId, name: safeName });
  draft.id = safeId;
  draft.name = safeName;
  loadBaseline(draft, { persisted: false });
  emitSync('dirty', 'Unsaved new avatar');
  return true;
}

export function updateDraftIdentity({ name }) {
  const active = getActiveAgent();
  if (!active) return;
  setActiveAgent({
    ...active,
    name: name ?? active.name,
  });
  emitDirtyState();
}

export async function saveActiveDraft() {
  const draft = readCurrentDraft();
  emitSync('saving', 'Saving…');
  try {
    if (session.baselinePersisted && session.baseline?.appearance) {
      undoLastSave.buffer.record(draft.id, clone(session.baseline.appearance));
    }
    const markdown = serializeDraftAgent(draft);
    await putAgentDoc(draft.id, markdown);
    session.baseline = cloneDraftAgent(draft);
    session.baselinePersisted = true;
    setActiveAgent({
      ...(getActiveAgent() || {}),
      ...cloneDraftAgent(draft),
    });
    emitDirtyState();
    document.dispatchEvent(new CustomEvent('roster:refresh'));
    return true;
  } catch (error) {
    emitSync('error', String(error.message ?? error));
    return false;
  }
}

export function revertActiveDraft() {
  if (!session.baseline) return;
  hydrateFromDraft(cloneDraftAgent(session.baseline));
}

export function getSessionState() {
  return {
    baselinePersisted: session.baselinePersisted,
    dirty: isDirty(),
  };
}

export async function deleteActiveAgentAndFallback() {
  const active = getActiveAgent();
  if (!active?.id) return;

  if (session.baselinePersisted) {
    await deleteAgent(active.id);
  }

  const remaining = await listAgents();
  const fallbackId = remaining.find((id) => id === 'default') ?? remaining[0] ?? 'default';
  if (fallbackId === active.id && !remaining.length) {
    loadBaseline(createDraftAgent({ id: 'default', name: 'default' }), { persisted: false });
    return;
  }
  await loadAgentIntoStudio(fallbackId, { force: true });
}

function handleWindowMessage(event) {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'studio/select-agent' && msg.agentId) {
    void loadAgentIntoStudio(msg.agentId);
  }
}

export function setupStudioSession(hooks = {}) {
  session.hooks = hooks;
  window.addEventListener('message', handleWindowMessage);
  if (!session.readyNotified) {
    window.parent?.postMessage({ type: 'studio/ready' }, '*');
    session.readyNotified = true;
  }
}
