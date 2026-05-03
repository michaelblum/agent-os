import { emit, esc } from '../../runtime/bridge.js';
import {
  TRANSFORM_GROUPS,
  VECTOR_AXES,
  applyRegistryMessage,
  applyTransformResultMessage,
  buildTripletPatchMessage,
  canPatchObject,
  createObjectTransformState,
  formatTripletValue,
  objectAddressLabel,
  patchDeliveryForTarget,
  selectObject,
  selectedObject,
  sortedObjectEntries,
  updateEntryTransformDraft,
} from './model.js';
import {
  objectRowAttrs,
  tripletInputAttrs,
} from './semantics.js';

const BASE_TITLE = 'Object Transform';

let requestCounter = 0;

function nextRequestId() {
  requestCounter += 1;
  return `object-transform-${Date.now().toString(36)}-${requestCounter}`;
}

function shortStatus(result) {
  if (!result) return 'No transform result yet';
  const detail = result.message || result.reason || objectAddressLabel({ canvas_id: result.target.canvas_id, object_id: result.target.object_id });
  return `${result.status}: ${detail}`;
}

function unitForGroup(entry, group) {
  const def = TRANSFORM_GROUPS.find((candidate) => candidate.key === group);
  return entry?.units?.[def?.unitKey] || '';
}

function renderObjectList(entries, selectedKey) {
  if (entries.length === 0) {
    return '<div class="object-transform-empty">Waiting for addressable objects</div>';
  }
  return (
    `<div class="object-transform-list" role="listbox" aria-label="Addressable objects">`
      + entries.map((entry) => {
        const selected = entry.key === selectedKey;
        const visible = entry.visible === null ? '' : `<span>${entry.visible ? 'visible' : 'hidden'}</span>`;
        return (
          `<button type="button" class="object-transform-row${selected ? ' selected' : ''}" data-object-key="${esc(entry.key)}" ${objectRowAttrs(entry, selected)}>`
            + `<strong>${esc(entry.name)}</strong>`
            + `<small>${esc(entry.canvas_id)} / ${esc(entry.object_id)}</small>`
            + `<em>${esc(entry.kind)}${visible}</em>`
          + `</button>`
        );
      }).join('')
    + `</div>`
  );
}

function renderTriplet(entry, groupDef) {
  const triplet = entry.transform[groupDef.key];
  const unit = unitForGroup(entry, groupDef.key);
  return (
    `<fieldset class="object-transform-triplet" data-transform-group="${esc(groupDef.key)}">`
      + `<legend><span>${esc(groupDef.label)}</span><em>${esc(unit)}</em></legend>`
      + `<div class="object-transform-triplet-grid">`
        + VECTOR_AXES.map((axis) => {
          const value = formatTripletValue(triplet[axis]);
          return (
            `<label>`
              + `<span>${axis.toUpperCase()}</span>`
              + `<input class="object-transform-input" type="number" step="0.001" inputmode="decimal" value="${esc(value)}" `
                + `data-transform-group="${esc(groupDef.key)}" data-transform-axis="${esc(axis)}" `
                + `${tripletInputAttrs(entry, groupDef.key, axis, value)}>`
            + `</label>`
          );
        }).join('')
      + `</div>`
    + `</fieldset>`
  );
}

function renderEditor(entry, state) {
  if (!entry) {
    return (
      `<div class="object-transform-editor empty">`
        + `<div class="object-transform-empty">Select an advertised object to edit its transform</div>`
      + `</div>`
    );
  }

  const patchable = canPatchObject(entry);
  const capabilityText = patchable ? 'patchable' : 'read only';
  return (
    `<div class="object-transform-editor">`
      + `<header class="object-transform-target">`
        + `<div>`
          + `<strong>${esc(entry.name)}</strong>`
          + `<span>${esc(objectAddressLabel(entry))}</span>`
        + `</div>`
        + `<em class="${patchable ? 'ok' : 'warn'}">${esc(capabilityText)}</em>`
      + `</header>`
      + `<div class="object-transform-triplets">`
        + TRANSFORM_GROUPS.map((group) => renderTriplet(entry, group)).join('')
      + `</div>`
      + `<div class="object-transform-status ${esc(state.lastResult?.status || '')}" role="status" aria-live="polite">`
        + `${esc(shortStatus(state.lastResult))}`
      + `</div>`
    + `</div>`
  );
}

function renderSnapshot(state) {
  const entries = sortedObjectEntries(state);
  const selected = selectedObject(state);
  return (
    `<div class="object-transform-body">`
      + `<aside class="object-transform-sidebar">`
        + `<header><span>Objects</span><strong>${entries.length}</strong></header>`
        + renderObjectList(entries, state.selectedKey)
      + `</aside>`
      + renderEditor(selected, state)
    + `</div>`
  );
}

export default function ObjectTransformPanel() {
  let host = null;
  let root = null;
  const state = createObjectTransformState();

  function syncDebugState() {
    window.__objectTransformPanelState = {
      objects: sortedObjectEntries(state),
      selected: selectedObject(state),
      lastResult: state.lastResult,
      errors: [...state.errors],
      pending: [...state.pendingByRequest.keys()],
    };
  }

  function updateTitle() {
    if (!host) return;
    const count = sortedObjectEntries(state).length;
    const selected = selectedObject(state);
    host.setTitle(`${BASE_TITLE} - ${count}${selected ? ` - ${selected.name}` : ''}`);
  }

  function rerender() {
    if (!root) return;
    root.innerHTML = renderSnapshot(state);
    updateTitle();
    syncDebugState();
  }

  function emitTripletPatch(group, values) {
    const entry = selectedObject(state);
    if (!entry) return null;
    try {
      const patch = buildTripletPatchMessage(entry, group, values, { requestId: nextRequestId() });
      state.pendingByRequest.set(patch.request_id, {
        key: entry.key,
        group,
        sent_at: Date.now(),
      });
      state.objectsByKey.set(entry.key, updateEntryTransformDraft(entry, group, values));
      const delivery = patchDeliveryForTarget(entry, patch);
      emit(delivery.type, delivery.payload);
      state.lastResult = {
        request_id: patch.request_id,
        target: patch.target,
        key: entry.key,
        status: 'pending',
        reason: '',
        message: 'waiting for owner',
        transform: null,
      };
      rerender();
      return patch;
    } catch (error) {
      state.errors.push(error.message);
      state.lastResult = {
        request_id: '',
        target: { canvas_id: entry.canvas_id, object_id: entry.object_id },
        key: entry.key,
        status: 'rejected',
        reason: 'invalid_patch',
        message: error.message,
        transform: null,
      };
      rerender();
      return null;
    }
  }

  function tripletValuesFromDom(group) {
    const values = {};
    for (const axis of VECTOR_AXES) {
      const input = root.querySelector?.(`.object-transform-input[data-transform-group="${group}"][data-transform-axis="${axis}"]`);
      if (input) values[axis] = input.value;
    }
    return values;
  }

  function handleClick(event) {
    const row = event.target?.closest?.('[data-object-key]');
    if (!row) return;
    selectObject(state, row.dataset.objectKey);
    rerender();
  }

  function handleChange(event) {
    const input = event.target?.closest?.('.object-transform-input');
    if (!input) return;
    const group = input.dataset.transformGroup;
    if (!group) return;
    emitTripletPatch(group, tripletValuesFromDom(group));
  }

  function handleMessage(msg) {
    if (msg.type === 'canvas_object.registry') {
      applyRegistryMessage(state, msg);
      rerender();
      return;
    }
    if (msg.type === 'canvas_object.transform.result') {
      applyTransformResultMessage(state, msg);
      rerender();
    }
  }

  return {
    manifest: {
      name: 'object-transform-panel',
      title: BASE_TITLE,
      accepts: ['canvas_object.registry', 'canvas_object.transform.result'],
      emits: ['canvas.send'],
      channelPrefix: 'object-transform',
      requires: ['canvas_object.registry', 'canvas_object.transform.result'],
      defaultSize: { w: 620, h: 420 },
    },

    render(host_) {
      host = host_;
      host.contentEl.style.overflow = 'hidden';
      root = document.createElement('div');
      root.className = 'object-transform-root';
      root.setAttribute('role', 'region');
      root.setAttribute('aria-label', BASE_TITLE);
      root.addEventListener('click', handleClick);
      root.addEventListener('change', handleChange);
      window.__objectTransformPanelDebug = {
        applyRegistry(message) {
          applyRegistryMessage(state, message);
          rerender();
          return window.__objectTransformPanelState;
        },
        applyResult(message) {
          applyTransformResultMessage(state, message);
          rerender();
          return window.__objectTransformPanelState;
        },
        select(key) {
          selectObject(state, key);
          rerender();
          return selectedObject(state);
        },
        emitTriplet(group, values) {
          return emitTripletPatch(group, values);
        },
      };
      rerender();
      return root;
    },

    onMessage: handleMessage,
  };
}
