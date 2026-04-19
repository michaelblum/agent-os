import { esc } from '../../runtime/bridge.js';
import { normalizeCanvasInputMessage } from '../../runtime/input-events.js';
import { normalizeMarks } from '../canvas-inspector/marks/normalize.js';
import { createMarksState, applySnapshot, evictCanvas } from '../canvas-inspector/marks/reconcile.js';
import { createScheduler } from '../canvas-inspector/marks/scheduler.js';
import {
  buildSpatialTelemetrySnapshot,
  formatPoint,
  formatRect,
  normalizeDisplays,
} from './model.js';

const MAX_EVENTS = 120;
const BASE_TITLE = 'Spatial Telemetry';

function summarizeEvent(msg) {
  const input = normalizeCanvasInputMessage(msg);
  if (input) {
    return `input_event ${input.type || 'move'} @ ${Math.round(input.x || 0)},${Math.round(input.y || 0)}`;
  }
  const payload = msg.payload || msg.data || msg;
  switch (msg.type) {
    case 'bootstrap':
      return `bootstrap displays=${(payload.displays || []).length} canvases=${(payload.canvases || []).length}`;
    case 'display_geometry':
      return `display_geometry displays=${(payload.displays || []).length}`;
    case 'canvas_lifecycle':
      return `canvas ${payload.action || '?'} ${payload.canvas_id || '?'}`;
    case 'canvas_object.marks':
      return `marks ${payload.canvas_id || '?'} count=${(payload.objects || []).length}`;
    default:
      return `${msg.type || 'event'}`;
  }
}

function ts() {
  const now = new Date();
  return String(now.getHours()).padStart(2, '0') + ':'
    + String(now.getMinutes()).padStart(2, '0') + ':'
    + String(now.getSeconds()).padStart(2, '0');
}

function renderRectCell(rect) {
  return `<td class="mono">${esc(formatRect(rect))}</td>`;
}

function renderPointCell(point) {
  return `<td class="mono">${esc(formatPoint(point))}</td>`;
}

function renderDisplayHeader(columns) {
  return columns.map((column) => `<th>${esc(column.label)}</th>`).join('');
}

function renderDisplayRows(snapshot) {
  if (snapshot.displayRows.length === 0) {
    return '<div class="empty-state">Waiting for display geometry…</div>';
  }
  const rows = snapshot.displayRows.map((row) => (
    `<tr>`
      + `<td>${esc(row.label)}</td>`
      + `<td class="mono">${row.scale_factor == null ? '—' : esc(String(row.scale_factor))}</td>`
      + renderRectCell(row.nativeBounds)
      + renderRectCell(row.bounds)
      + renderRectCell(row.nativeVisibleBounds)
      + renderRectCell(row.visibleBounds)
      + `</tr>`
  )).join('');
  return (
    `<table class="telemetry-table">`
      + `<thead><tr><th>display</th><th>scale</th><th>native bounds</th><th>DesktopWorld</th><th>native visible</th><th>VisibleDesktopWorld</th></tr></thead>`
      + `<tbody>${rows}</tbody>`
      + `</table>`
  );
}

function renderCanvasRows(snapshot) {
  if (snapshot.canvasRows.length === 0) {
    return '<div class="empty-state">No canvases</div>';
  }
  const rows = snapshot.canvasRows.map((row) => (
    `<tr>`
      + `<td>${esc(row.id)}</td>`
      + `<td>${esc(row.parent || '—')}</td>`
      + `<td>${esc(row.owner)}</td>`
      + `<td>${esc(row.track || '—')}</td>`
      + `<td>${row.interactive ? 'yes' : 'no'}</td>`
      + renderRectCell(row.worldRect)
      + renderRectCell(row.desktopWorldLocal)
      + renderRectCell(row.parentLocal)
      + snapshot.displayColumns.map((column) => renderRectCell(row.perDisplay[column.id])).join('')
      + `</tr>`
  )).join('');
  return (
    `<table class="telemetry-table">`
      + `<thead><tr><th>canvas</th><th>parent</th><th>owner</th><th>track</th><th>int</th><th>DesktopWorld</th><th>world local</th><th>parent local</th>${renderDisplayHeader(snapshot.displayColumns)}</tr></thead>`
      + `<tbody>${rows}</tbody>`
      + `</table>`
  );
}

function renderMarkRows(snapshot) {
  if (snapshot.markRows.length === 0) {
    return '<div class="empty-state">No object marks</div>';
  }
  const rows = snapshot.markRows.map((row) => (
    `<tr>`
      + `<td>${esc(row.canvasId)}</td>`
      + `<td>${esc(row.id)}</td>`
      + `<td>${esc(row.name)}</td>`
      + `<td>${esc(row.owner)}</td>`
      + renderPointCell(row.worldPoint)
      + renderPointCell(row.desktopWorldLocal)
      + renderPointCell(row.canvasLocal)
      + snapshot.displayColumns.map((column) => renderPointCell(row.perDisplay[column.id])).join('')
      + `</tr>`
  )).join('');
  return (
    `<table class="telemetry-table">`
      + `<thead><tr><th>canvas</th><th>mark</th><th>name</th><th>owner</th><th>DesktopWorld</th><th>world local</th><th>canvas local</th>${renderDisplayHeader(snapshot.displayColumns)}</tr></thead>`
      + `<tbody>${rows}</tbody>`
      + `</table>`
  );
}

function renderCursor(snapshot) {
  if (!snapshot.cursorRow) {
    return '<div class="empty-state">No cursor event received yet</div>';
  }
  const row = snapshot.cursorRow;
  return (
    `<table class="telemetry-table">`
      + `<thead><tr><th>owner</th><th>DesktopWorld</th><th>world local</th>${renderDisplayHeader(snapshot.displayColumns)}</tr></thead>`
      + `<tbody><tr>`
      + `<td>${esc(row.owner)}</td>`
      + renderPointCell(row.worldPoint)
      + renderPointCell(row.desktopWorldLocal)
      + snapshot.displayColumns.map((column) => renderPointCell(row.perDisplay[column.id])).join('')
      + `</tr></tbody></table>`
  );
}

function renderEventLog(events) {
  if (events.length === 0) {
    return '<div class="empty-state">No events yet</div>';
  }
  return (
    `<div class="event-log">`
      + events.map((entry) => (
        `<div class="event-row">`
          + `<span class="event-ts">${esc(entry.ts)}</span>`
          + `<span class="event-type">${esc(entry.type)}</span>`
          + `<span class="event-summary">${esc(entry.summary)}</span>`
          + `</div>`
      )).join('')
      + `</div>`
  );
}

function renderSnapshot(snapshot, events) {
  const summary = snapshot.desktopWorld
    ? `<div class="union-summary">DesktopWorld <span class="mono">${esc(formatRect(snapshot.desktopWorld))}</span> <span class="pill">${snapshot.displayColumns.length} display${snapshot.displayColumns.length === 1 ? '' : 's'}</span> <span class="mono">visible ${esc(formatRect(snapshot.visibleDesktopWorld))}</span></div>`
    : '<div class="union-summary">Waiting for DesktopWorld geometry…</div>';

  return (
    `<div class="spatial-telemetry-body">`
      + `<div class="telemetry-header">${summary}</div>`
      + `<section class="telemetry-section"><h3>Displays</h3>${renderDisplayRows(snapshot)}</section>`
      + `<section class="telemetry-section"><h3>Cursor</h3>${renderCursor(snapshot)}</section>`
      + `<section class="telemetry-section"><h3>Canvases</h3>${renderCanvasRows(snapshot)}</section>`
      + `<section class="telemetry-section"><h3>Object Marks</h3>${renderMarkRows(snapshot)}</section>`
      + `<section class="telemetry-section"><h3>Event Log</h3>${renderEventLog(events)}</section>`
      + `</div>`
  );
}

export default function SpatialTelemetry() {
  let contentEl = null;
  let host = null;
  let displays = [];
  let canvases = [];
  let cursor = { x: 0, y: 0, valid: false };
  const events = [];
  const marksState = createMarksState();
  const marksScheduler = createScheduler({
    state: marksState,
    onChange: () => rerender(),
  });

  function appendEvent(msg) {
    events.push({
      ts: ts(),
      type: msg.type || 'event',
      summary: summarizeEvent(msg),
    });
    while (events.length > MAX_EVENTS) events.shift();
  }

  function applyLifecycle(data) {
    const id = data.canvas_id || data.id;
    if (!id) return;
    if (data.action === 'removed') {
      canvases = canvases.filter((canvas) => canvas.id !== id);
      evictCanvas(marksState, id);
      return;
    }
    const next = {
      ...(canvases.find((canvas) => canvas.id === id) || {}),
      ...(data.canvas || {}),
      id,
      at: data.at || data.canvas?.at || (canvases.find((canvas) => canvas.id === id)?.at) || [0, 0, 0, 0],
      parent: data.parent ?? data.canvas?.parent ?? null,
      track: data.track ?? data.canvas?.track ?? null,
      interactive: data.interactive ?? data.canvas?.interactive ?? false,
      scope: data.scope ?? data.canvas?.scope ?? 'global',
    };
    const existingIndex = canvases.findIndex((canvas) => canvas.id === id);
    if (existingIndex >= 0) {
      canvases[existingIndex] = next;
    } else {
      canvases.push(next);
    }
  }

  function updateTitle(snapshot) {
    if (!host) return;
    host.setTitle(`${BASE_TITLE} — ${snapshot.canvasRows.length}/${snapshot.markRows.length}`);
  }

  function syncDebugState(snapshot) {
    window.__spatialTelemetryState = {
      snapshot,
      raw: {
        displays,
        canvases,
        cursor,
        marksByCanvas: Object.fromEntries(
          [...marksState.marksByCanvas].map(([key, value]) => [key, value.marks]),
        ),
      },
      events,
    };
  }

  function rerender() {
    if (!contentEl) return;
    const snapshot = buildSpatialTelemetrySnapshot({
      displays,
      canvases,
      cursor,
      marksByCanvas: marksState.marksByCanvas,
    });
    contentEl.innerHTML = renderSnapshot(snapshot, events);
    updateTitle(snapshot);
    syncDebugState(snapshot);
  }

  return {
    manifest: {
      name: 'spatial-telemetry',
      title: BASE_TITLE,
      accepts: ['bootstrap', 'canvas_lifecycle', 'display_geometry', 'input_event', 'canvas_object.marks'],
      emits: [],
      channelPrefix: 'spatial-telemetry',
      requires: ['canvas_lifecycle', 'display_geometry', 'input_event', 'canvas_object.marks'],
      defaultSize: { w: 920, h: 620 },
    },

    render(host_) {
      host = host_;
      host.contentEl.style.overflow = 'hidden';
      contentEl = document.createElement('div');
      contentEl.className = 'spatial-telemetry-root';
      contentEl.innerHTML = '<div class="empty-state">Waiting for telemetry…</div>';
      window.__spatialTelemetryDebug = {
        clearLog() {
          events.length = 0;
          rerender();
        },
      };
      rerender();
      return contentEl;
    },

    onMessage(msg) {
      appendEvent(msg);

      if (msg.type === 'bootstrap') {
        const payload = msg.payload || msg;
        if (payload.displays) displays = normalizeDisplays(payload.displays);
        if (payload.canvases) canvases = payload.canvases;
        if (payload.cursor && typeof payload.cursor.x === 'number' && typeof payload.cursor.y === 'number') {
          cursor = { x: payload.cursor.x, y: payload.cursor.y, valid: true };
        }
        rerender();
        return;
      }

      if (msg.type === 'display_geometry') {
        const payload = msg.payload || msg;
        if (payload.displays) displays = normalizeDisplays(payload.displays);
        rerender();
        return;
      }

      if (msg.type === 'canvas_lifecycle') {
        applyLifecycle(msg.payload || msg.data || msg);
        rerender();
        return;
      }

      const input = normalizeCanvasInputMessage(msg);
      if (input) {
        if (typeof input.x === 'number' && typeof input.y === 'number') {
          cursor = { x: input.x, y: input.y, valid: true };
        }
        rerender();
        return;
      }

      if (msg.type === 'canvas_object.marks') {
        const payload = msg.payload || msg;
        const canvasId = payload.canvas_id;
        if (canvasId && typeof canvasId === 'string') {
          const normalized = normalizeMarks(canvasId, payload.objects || []);
          applySnapshot(marksState, canvasId, normalized, Date.now());
          if (marksState.marksByCanvas.size > 0) marksScheduler.start();
        }
        rerender();
      }
    },
  };
}
