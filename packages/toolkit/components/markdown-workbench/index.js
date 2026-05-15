import { renderMarkdown } from '../../markdown/render.js';
import { renderButtonHtml } from '../../controls/button.js';
import { createTextarea } from '../../controls/textarea.js';
import { createSplitPane } from '../../panel/layouts/split-pane.js';
import {
  renderWorkbenchSectionTitle,
  renderWorkbenchStatusBar,
  renderWorkbenchToolbar,
} from '../../shell/index.js';
import { buildAnnotationProjectionResult } from '../../workbench/annotation-projection.js';
import {
  createMarkdownOpenRequestFromWikiSelection,
  createWikiSubjectOpenRequest,
  WIKI_SUBJECT_OPEN_REQUEST_TYPE,
  WIKI_SUBJECT_SELECTION_TYPE,
} from '../../workbench/wiki-subject-opening.js';
import WikiKB from '../wiki-kb/index.js';
import {
  indentMarkdownSelection,
  outdentMarkdownSelection,
} from './editor-commands.js';
import {
  applyMarkdownSaveResult,
  applyMarkdownAnnotations,
  applyMarkdownTextPatch,
  buildMarkdownSaveRequest,
  clearMarkdownAnnotations,
  createMarkdownWorkbenchState,
  markdownWorkbenchAnnotationViewModels,
  markdownWorkbenchSnapshot,
  openMarkdownDocument,
} from './model.js';

function el(tag, className, textContent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

export default function MarkdownWorkbench(options = {}) {
  let host = null;
  let initialUrlOpenStarted = false;
  let viewMode = options.viewMode === 'source' ? 'source' : 'preview';
  let outlineOpen = false;
  let splitOpen = Boolean(options.openContent);
  let graphHost = null;
  let graphWorkbench = null;
  let graphLoadTimer = null;
  let graphFitTimers = [];
  let splitPane = null;
  let annotationLayerVisible = true;
  const expandedAnnotationIds = new Set();
  const state = createMarkdownWorkbenchState(options.document || {});
  const dom = {};

  function emit(type, payload) {
    if (host?.emit) host.emit(type, payload);
  }

  function syncTitle() {
    const prefix = state.source?.kind === 'wiki' ? 'Wiki / Workbench' : 'Markdown / Workbench';
    host?.setTitle?.(`${prefix}${state.dirty ? ' *' : ''}`);
  }

  function syncDiagnostics() {
    const diagnostics = markdownWorkbenchSnapshot(state).diagnostics;
    dom.stats.textContent = `${diagnostics.line_count} lines · ${diagnostics.word_count} words · ${diagnostics.heading_count} headings`;
    dom.outline.replaceChildren();
    if (diagnostics.headings.length === 0) {
      dom.outline.appendChild(el('li', 'markdown-workbench-empty', 'No headings'));
    } else {
      for (const heading of diagnostics.headings) {
        const item = el('li');
        item.style.setProperty('--depth', String(Math.min(4, heading.depth)));
        item.textContent = `${heading.text} · ${heading.line}`;
        dom.outline.appendChild(item);
      }
    }
    dom.warning.hidden = !diagnostics.unclosed_fence;
    dom.mermaid.textContent = diagnostics.mermaid_blocks.length > 0
      ? `${diagnostics.mermaid_blocks.length} Mermaid diagram${diagnostics.mermaid_blocks.length === 1 ? '' : 's'} previewable`
      : 'No Mermaid fences';
  }

  function syncPreview() {
    dom.preview.innerHTML = renderMarkdown(state.content);
  }

  function renderAnnotationBadge(annotation) {
    const badge = el('span', 'markdown-workbench-annotation-badge', String(annotation.ordinal));
    badge.dataset.annotationOrdinal = String(annotation.ordinal);
    badge.dataset.annotationStatus = annotation.status;
    badge.setAttribute('aria-label', `Annotation ${annotation.ordinal}`);
    return badge;
  }

  function lineRange(annotation = {}) {
    const range = annotation.text_range && typeof annotation.text_range === 'object'
      ? annotation.text_range
      : null;
    const startLine = Number(range?.start_line ?? range?.startLine ?? range?.line);
    const endLine = Number(range?.end_line ?? range?.endLine ?? range?.line ?? startLine);
    if (!Number.isFinite(startLine) || startLine < 1) return null;
    return {
      start_line: Math.max(1, Math.floor(startLine)),
      end_line: Math.max(Math.floor(startLine), Number.isFinite(endLine) ? Math.floor(endLine) : Math.floor(startLine)),
    };
  }

  function bodyRect() {
    return dom.documentBody?.getBoundingClientRect?.() || { left: 0, top: 0, width: 0, height: 0 };
  }

  function rectRelativeToBody(rect) {
    const base = bodyRect();
    return {
      x: rect.left - base.left,
      y: rect.top - base.top,
      width: rect.width,
      height: rect.height,
    };
  }

  function sourceLineProjection(annotation) {
    const range = lineRange(annotation);
    if (!range || !dom.editor || dom.sourcePane.hidden) return null;
    const editorRect = rectRelativeToBody(dom.editor.getBoundingClientRect());
    const style = window.getComputedStyle(dom.editor);
    const lineHeight = Number.parseFloat(style.lineHeight) || 19.8;
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(style.paddingRight) || 0;
    const startY = editorRect.y + paddingTop + ((range.start_line - 1) * lineHeight) - dom.editor.scrollTop;
    const height = Math.max(lineHeight, ((range.end_line - range.start_line) + 1) * lineHeight);
    const rect = {
      x: editorRect.x + paddingLeft,
      y: startY,
      width: Math.max(1, editorRect.width - paddingLeft - paddingRight),
      height,
    };
    const visible = rect.y + rect.height >= editorRect.y && rect.y <= editorRect.y + editorRect.height;
    return {
      annotation_id: annotation.id,
      status: visible ? 'resolved' : 'out_of_viewport',
      anchor_type: 'text_range',
      rects: [rect],
      precision: 'editor_line',
      confidence: annotation.text_excerpt ? 0.86 : 0.78,
      reason: visible ? '' : 'line anchor is outside the source editor viewport',
      decorator: {
        placement: 'start-outside',
        x: Math.max(8, rect.x - 10),
        y: Math.max(editorRect.y + 10, Math.min(rect.y + 10, editorRect.y + editorRect.height - 10)),
        avoid_covering_anchor: true,
        detail_preference: 'hover_click_focus',
      },
    };
  }

  function previewLineProjection(annotation) {
    const range = lineRange(annotation);
    if (!range || !dom.preview || dom.previewPane.hidden) return null;
    const target = dom.preview.querySelector(`[data-source-line="${range.start_line}"]`)
      || dom.preview.querySelector('[data-source-line]');
    if (!target) {
      return {
        annotation_id: annotation.id,
        status: 'unresolved',
        anchor_type: 'text_range',
        reason: 'preview does not expose rendered line geometry for this anchor',
        precision: 'none',
      };
    }
    const paneRect = rectRelativeToBody(dom.previewPane.getBoundingClientRect());
    const rect = rectRelativeToBody(target.getBoundingClientRect());
    const visible = rect.y + rect.height >= paneRect.y && rect.y <= paneRect.y + paneRect.height;
    return {
      annotation_id: annotation.id,
      status: visible ? 'resolved' : 'out_of_viewport',
      anchor_type: 'text_range',
      rects: [rect],
      precision: target.dataset.sourceLine === String(range.start_line) ? 'preview_source_line' : 'preview_section_approximate',
      confidence: target.dataset.sourceLine === String(range.start_line) ? 0.74 : 0.46,
      reason: visible ? '' : 'line anchor is outside the preview viewport',
      decorator: {
        placement: 'start-outside',
        x: Math.max(8, rect.x - 12),
        y: Math.max(paneRect.y + 10, Math.min(rect.y + 10, paneRect.y + paneRect.height - 10)),
        avoid_covering_anchor: true,
        detail_preference: 'hover_click_focus',
      },
    };
  }

  function geometryProjection(annotation) {
    const bounds = annotation.bounds || annotation.viewport_bounds || annotation.page_bounds;
    const point = annotation.point || (bounds
      ? { x: bounds.x + (bounds.width / 2), y: bounds.y + (bounds.height / 2) }
      : null);
    if (!point && !bounds) return null;
    const rect = bounds
      ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
      : { x: point.x, y: point.y, width: 1, height: 1 };
    return {
      annotation_id: annotation.id,
      status: 'resolved',
      anchor_type: bounds ? 'region' : 'point',
      rects: [rect],
      precision: annotation.coordinate_space || 'viewport',
      confidence: 0.66,
      decorator: {
        placement: 'start-outside',
        x: Math.max(8, rect.x - 10),
        y: Math.max(10, rect.y + Math.min(10, rect.height / 2)),
        avoid_covering_anchor: true,
        detail_preference: 'hover_click_focus',
      },
    };
  }

  function projectionViewport() {
    const rect = bodyRect();
    const scroller = viewMode === 'source' ? dom.editor : dom.previewPane;
    return {
      width: rect.width,
      height: rect.height,
      scroll_x: scroller?.scrollLeft || 0,
      scroll_y: scroller?.scrollTop || 0,
      zoom: 1,
      scale: 1,
      device_pixel_ratio: window.devicePixelRatio || 1,
      view_mode: viewMode,
    };
  }

  function buildMarkdownAnnotationProjection() {
    const adapter_projections = state.annotations.map((annotation) => {
      if (annotation.kind === 'selection_comment' || annotation.text_range) {
        return viewMode === 'source'
          ? sourceLineProjection(annotation)
          : previewLineProjection(annotation);
      }
      return geometryProjection(annotation);
    }).filter(Boolean);

    return buildAnnotationProjectionResult({
      surface_binding: {
        surface_id: 'markdown-workbench',
        surface_type: 'markdown_workbench',
        source_path: state.source?.path || state.path,
        subject_id: state.source?.kind === 'wiki' ? `wiki:${state.source.path}` : `file:${state.path}`,
      },
      viewport: projectionViewport(),
      annotations: state.annotations,
      adapter_projections,
      layer: {
        visible: annotationLayerVisible,
        dismissed: !annotationLayerVisible,
        decorator_mode: annotationLayerVisible ? 'ordinal_badge' : 'hidden',
        expanded_annotation_ids: [...expandedAnnotationIds],
        capture: {
          prepare: {
            hide_annotation_controls: true,
            keep_target_evidence_visible: true,
          },
          restore: {
            restore_annotation_controls: true,
          },
        },
      },
    });
  }

  function renderAnnotationCard(view) {
    const { annotation } = view;
    const item = el('li', `markdown-workbench-annotation-card${view.secondary ? ' secondary' : ''}`);
    item.dataset.annotationId = annotation.id;
    item.dataset.annotationStatus = annotation.status;
    item.dataset.annotationOrdinal = String(annotation.ordinal);
    item.appendChild(renderAnnotationBadge(annotation));

    const body = el('div', 'markdown-workbench-annotation-body');
    const note = el('div', 'markdown-workbench-annotation-note', annotation.note);
    const meta = el('div', 'markdown-workbench-annotation-meta');
    meta.textContent = `${annotation.actor.role}:${annotation.actor.id} · ${annotation.status} · ${view.anchor_summary}`;
    body.append(note, meta);
    item.appendChild(body);
    return item;
  }

  function renderOverlayDecorator(view, projection) {
    const { annotation } = view;
    if (!projection || !['resolved', 'out_of_viewport'].includes(projection.status)) return null;
    const marker = el('button', `markdown-workbench-annotation-overlay-marker${view.secondary ? ' secondary' : ''}`);
    marker.type = 'button';
    marker.dataset.annotationId = annotation.id;
    marker.dataset.annotationStatus = annotation.status;
    marker.dataset.annotationOrdinal = String(annotation.ordinal);
    marker.dataset.projectionStatus = projection.status;
    marker.dataset.projectionPrecision = projection.precision;
    marker.style.left = `${Math.max(0, projection.decorator.x ?? 0)}px`;
    marker.style.top = `${Math.max(0, projection.decorator.y ?? 0)}px`;
    marker.setAttribute('aria-label', `Annotation ${annotation.ordinal}: ${annotation.note}`);
    marker.setAttribute('aria-expanded', String(expandedAnnotationIds.has(annotation.id)));
    marker.appendChild(renderAnnotationBadge(annotation));
    const detail = el('span', 'markdown-workbench-annotation-popover');
    const note = el('span', 'markdown-workbench-annotation-note', annotation.note);
    const meta = el('span', 'markdown-workbench-annotation-meta');
    meta.textContent = `${annotation.actor.role}:${annotation.actor.id} · ${projection.status} · ${view.anchor_summary}`;
    detail.append(note, meta);
    marker.appendChild(detail);
    marker.addEventListener('click', () => {
      if (expandedAnnotationIds.has(annotation.id)) expandedAnnotationIds.delete(annotation.id);
      else expandedAnnotationIds.add(annotation.id);
      syncAnnotations();
      syncInspectableState();
    });
    return marker;
  }

  function syncAnnotations() {
    const views = markdownWorkbenchAnnotationViewModels(state.annotations);
    const projection = buildMarkdownAnnotationProjection();
    state.annotation_projection = projection;
    const projectionsById = new Map(projection.projections.map((item) => [item.annotation_id, item]));
    dom.annotationPanel.hidden = true;
    dom.annotationList.replaceChildren();
    dom.annotationOverlay.replaceChildren();
    dom.annotationOverlay.hidden = !annotationLayerVisible || views.length === 0;
    dom.annotationToggle.hidden = views.length === 0;
    dom.annotationToggle.classList.toggle('active', annotationLayerVisible);
    dom.annotationToggle.setAttribute('aria-pressed', String(annotationLayerVisible));
    dom.root.dataset.annotations = String(views.length);
    dom.root.dataset.annotationLayer = annotationLayerVisible ? 'visible' : 'hidden';
    for (const view of views) {
      dom.annotationList.appendChild(renderAnnotationCard(view));
      const marker = annotationLayerVisible
        ? renderOverlayDecorator(view, projectionsById.get(view.annotation.id))
        : null;
      if (marker) dom.annotationOverlay.appendChild(marker);
    }
  }

  function syncInspectableState() {
    window.__markdownWorkbenchState = {
      ...markdownWorkbenchSnapshot(state),
      annotation_projection: state.annotation_projection || buildMarkdownAnnotationProjection(),
    };
  }

  function syncViewMode() {
    dom.root.dataset.viewMode = viewMode;
    const previewActive = viewMode === 'preview';
    dom.previewPane.hidden = !previewActive;
    dom.sourcePane.hidden = previewActive;
    for (const button of dom.root.querySelectorAll('[data-view-mode]')) {
      const active = button.dataset.viewMode === viewMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  function syncOutline() {
    dom.outlinePanel.hidden = !outlineOpen;
    dom.outlineToggle.setAttribute('aria-expanded', String(outlineOpen));
    dom.outlineToggle.classList.toggle('active', outlineOpen);
  }

  function syncSplit() {
    dom.root.dataset.splitOpen = String(splitOpen);
    if (splitOpen) splitPane?.openPane('end', { notify: false, persist: false });
    else splitPane?.closePane('end', { notify: false, persist: false });
    dom.documentPane.setAttribute('aria-hidden', String(!splitOpen));
    dom.closeContentButton.hidden = !splitOpen;
  }

  function syncGraphStatus(text) {
    if (dom.graphStatus) dom.graphStatus.textContent = text;
  }

  function collapseEmbeddedGraphControls() {
    const toggle = dom.graph?.querySelector?.('.wiki-kb-controls-toggle');
    if (!toggle || !/hide controls/i.test(toggle.textContent || '')) return;
    toggle.click();
  }

  function scheduleEmbeddedGraphFit(delays = [80]) {
    if (!graphWorkbench || !graphHost || typeof window === 'undefined') return;
    for (const timer of graphFitTimers) window.clearTimeout(timer);
    graphFitTimers = [];

    const fitDelays = Array.isArray(delays) ? delays : [delays];
    for (const delay of fitDelays) {
      const timer = window.setTimeout(() => {
        graphFitTimers = graphFitTimers.filter((entry) => entry !== timer);
        graphWorkbench?.onMessage?.({ type: 'fit-view' }, graphHost);
      }, Math.max(0, Number(delay) || 0));
      graphFitTimers.push(timer);
    }
  }

  function sync({ replaceEditorValue = false } = {}) {
    dom.path.textContent = state.path;
    // Reassigning textarea.value during native input clears WKWebView/browser
    // undo history. Only replace it for external document loads or explicit
    // commands such as Revert.
    if (replaceEditorValue && dom.editor.value !== state.content) {
      dom.editor.value = state.content;
    }
    dom.saveButton.disabled = !state.dirty;
    dom.saveButton.setAttribute('aria-disabled', String(!state.dirty));
    syncTitle();
    syncDiagnostics();
    syncPreview();
    syncAnnotations();
    syncViewMode();
    syncOutline();
    syncSplit();
    syncInspectableState();
  }

  function parseWikiFrontmatter(raw = '') {
    const text = String(raw ?? '');
    if (!text.startsWith('---\n')) return {};
    const end = text.indexOf('\n---', 4);
    if (end < 0) return {};
    const frontmatter = {};
    for (const line of text.slice(4, end).split('\n')) {
      const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!match) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      frontmatter[match[1]] = value;
    }
    return frontmatter;
  }

  function embeddedWikiGraphPayload(payload = {}) {
    const config = payload.config && typeof payload.config === 'object' ? payload.config : {};
    const graphView = config.graphView && typeof config.graphView === 'object' ? config.graphView : {};
    return {
      ...payload,
      config: {
        ...config,
        graphView: {
          ...graphView,
          controls: {
            ...(graphView.controls || {}),
            collapsed: true,
          },
          defaults: {
            ...(graphView.defaults || {}),
            labelMode: 'hover',
          },
        },
      },
    };
  }

  async function openWikiPath(wikiPath, { syncEditor = true, openContent = false } = {}) {
    const path = String(wikiPath || '').replace(/^\/+/, '').trim();
    if (!path) return null;
    try {
      const response = await fetch(`/wiki/${path}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`wiki fetch failed for ${path}: ${response.status}`);
      const content = await response.text();
      openMarkdownDocument(state, {
        type: 'markdown_document.open',
        path,
        source: {
          kind: 'wiki',
          path,
          page: {
            path,
            frontmatter: parseWikiFrontmatter(content),
          },
        },
        content,
      });
      splitOpen = Boolean(openContent);
      sync({ replaceEditorValue: syncEditor });
      void loadWikiGraph({ revealCurrent: splitOpen });
      return markdownWorkbenchSnapshot(state);
    } catch (error) {
      state.lastResult = {
        type: 'markdown_document.open.result',
        status: 'rejected',
        path,
        message: String(error?.message || error),
      };
      sync();
      console.warn('[markdown-workbench] initial wiki open failed:', error);
      return null;
    }
  }

  async function openWikiSubjectSelection(selection) {
    const request = createMarkdownOpenRequestFromWikiSelection(selection);
    if (!request) return null;
    emit(WIKI_SUBJECT_OPEN_REQUEST_TYPE, createWikiSubjectOpenRequest(selection));
    return openWikiPath(request.path, { syncEditor: true, openContent: true });
  }

  async function openInitialWikiFromUrl() {
    if (initialUrlOpenStarted || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search || '');
    const wikiPath = String(params.get('wiki') || '').replace(/^\/+/, '').trim();
    if (!wikiPath) return;
    initialUrlOpenStarted = true;
    await openWikiPath(wikiPath, { syncEditor: true });
  }

  function revealCurrentWikiNode() {
    if (state.source?.kind !== 'wiki' || !state.source.path || !graphWorkbench) return;
    graphWorkbench.onMessage?.({
      type: 'reveal',
      payload: {
        path: state.source.path,
        view: 'graph',
      },
    }, graphHost);
  }

  async function loadWikiGraph({ revealCurrent = false } = {}) {
    if (!graphWorkbench || !graphHost) return;
    if (state.source?.kind !== 'wiki' && !options.loadGraphOnStart) {
      syncGraphStatus('Open a wiki page to load graph');
      return;
    }
    syncGraphStatus('Loading graph...');
    try {
      const response = await fetch('/wiki/.graph?raw=1', { cache: 'no-store' });
      if (!response.ok) throw new Error(`wiki graph request failed: ${response.status}`);
      const payload = embeddedWikiGraphPayload(await response.json());
      graphWorkbench.onMessage?.({ type: 'graph', payload }, graphHost);
      collapseEmbeddedGraphControls();
      syncGraphStatus('Wiki graph');
      if (revealCurrent && state.source?.kind === 'wiki') revealCurrentWikiNode();
      scheduleEmbeddedGraphFit([80, 360, 900]);
    } catch (error) {
      syncGraphStatus('Graph unavailable');
      console.warn('[markdown-workbench] wiki graph load failed:', error);
    }
  }

  function scheduleGraphReload() {
    if (graphLoadTimer) window.clearTimeout(graphLoadTimer);
    graphLoadTimer = window.setTimeout(() => {
      graphLoadTimer = null;
      void loadWikiGraph({ revealCurrent: splitOpen });
    }, 150);
  }

  function setContent(content) {
    state.content = String(content ?? '');
    state.dirty = state.content !== state.savedContent;
    sync();
  }

  async function saveWikiDocument(request) {
    const source = request.source || request.subject?.source;
    if (source?.kind !== 'wiki' || !source.path) {
      throw new Error('markdown document is not wiki-backed');
    }
    const response = await fetch(`/wiki/${String(source.path).replace(/^\/+/, '')}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
      body: String(request.content ?? ''),
    });
    if (!response.ok) throw new Error(`wiki save failed for ${source.path}: ${response.status}`);
    return {
      type: 'markdown_document.save.result',
      request_id: request.request_id,
      status: 'saved',
      path: source.path,
      message: 'Saved to wiki',
    };
  }

  function requestSave() {
    const request = buildMarkdownSaveRequest(state);
    state.lastResult = request;
    if (state.source?.kind === 'wiki') {
      void saveWikiDocument(request)
        .then((result) => {
          applyMarkdownSaveResult(state, result);
          emit('save.result', result);
          sync();
        })
        .catch((error) => {
          const result = {
            type: 'markdown_document.save.result',
            request_id: request.request_id,
            status: 'rejected',
            path: request.path,
            message: String(error?.message || error),
          };
          applyMarkdownSaveResult(state, result);
          emit('save.result', result);
          sync();
        });
    } else {
      emit('save.requested', request);
    }
    sync();
    return request;
  }

  function applyEditorCommand(result) {
    dom.editor.value = result.value;
    state.content = result.value;
    state.dirty = state.content !== state.savedContent;
    sync();
    dom.editor.setSelectionRange(result.selectionStart, result.selectionEnd);
  }

  function handleEditorKeydown(event) {
    const key = String(event.key || '').toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === 's') {
      event.preventDefault();
      requestSave();
      return;
    }
    if (event.key !== 'Tab') return;
    event.preventDefault();
    applyEditorCommand((event.shiftKey ? outdentMarkdownSelection : indentMarkdownSelection)({
      value: dom.editor.value,
      selectionStart: dom.editor.selectionStart,
      selectionEnd: dom.editor.selectionEnd,
    }));
  }

  function render() {
    const root = el('div', 'markdown-workbench-root');
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Markdown Workbench');
    root.dataset.aosRef = 'markdown-workbench:root';
    root.dataset.aosSurface = 'markdown-workbench';
    root.dataset.semanticTargetId = 'root';
    dom.root = root;
    const params = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search || '')
      : new URLSearchParams();
    const transition = String(options.transition || params.get('transition') || '').trim();
    if (transition === 'fade-in') root.dataset.transition = 'fade-in';
    // Source-contract anchor for layout tests:
    // class="markdown-workbench-icon-button" data-action="toggle-outline" aria-label="Index" title="Index"
    // class="aos-window-button aos-window-close markdown-workbench-close-content"
    root.innerHTML = `
      <main class="aos-workbench-main markdown-workbench-main">
        <section class="aos-workbench-preview-pane markdown-workbench-graph-pane" aria-label="Wiki graph" data-aos-ref="markdown-workbench:wiki-graph" data-aos-surface="markdown-workbench" data-semantic-target-id="wiki-graph">
          <div class="markdown-workbench-graph" data-role="graph" data-aos-ref="markdown-workbench:graph-host" data-aos-surface="markdown-workbench" data-semantic-target-id="graph-host"></div>
        </section>
        <section class="aos-workbench-controls-pane markdown-workbench-document-pane" aria-label="Wiki page content" data-aos-ref="markdown-workbench:content-pane" data-aos-surface="markdown-workbench" data-semantic-target-id="content-pane">
          ${renderWorkbenchToolbar({
            tag: 'header',
            className: 'markdown-workbench-document-toolbar',
            attributes: { role: 'toolbar', 'aria-label': 'Document tools' },
            rawAttributes: ['data-density="compact"'],
            content: `
            <div class="markdown-workbench-file" title="Current document">
              <strong data-role="path" data-aos-ref="markdown-workbench:current-path" data-aos-surface="markdown-workbench" data-semantic-target-id="current-path"></strong>
            </div>
            <div class="markdown-workbench-view-toggle aos-segmented" role="group" aria-label="Document view">
              ${renderButtonHtml({ includeBaseClass: false, className: 'active', label: '', pressed: true, rawAttributes: 'data-view-mode="preview" aria-label="Preview" title="Preview" data-aos-ref="markdown-workbench:view-preview" data-aos-action="set_preview" data-aos-surface="markdown-workbench" data-semantic-target-id="view-preview"' }).replace('</button>', '<svg class="markdown-workbench-mode-icon" aria-hidden="true" viewBox="0 0 20 20"><path d="M2.5 10s2.7-4.8 7.5-4.8S17.5 10 17.5 10 14.8 14.8 10 14.8 2.5 10 2.5 10Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="10" cy="10" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>') }
              ${renderButtonHtml({ includeBaseClass: false, label: '', pressed: false, rawAttributes: 'data-view-mode="source" aria-label="Edit" title="Edit" data-aos-ref="markdown-workbench:view-source" data-aos-action="set_source" data-aos-surface="markdown-workbench" data-semantic-target-id="view-source"' }).replace('</button>', '<span class="markdown-workbench-code-icon" aria-hidden="true">&lt;/&gt;</span></button>') }
            </div>
            <div class="markdown-workbench-actions">
              ${renderButtonHtml({ className: 'markdown-workbench-icon-button', label: 'Index', ariaLabel: 'Index', title: 'Index', rawAttributes: 'data-action="toggle-outline" aria-expanded="false" data-aos-ref="markdown-workbench:outline-toggle" data-aos-action="toggle_outline" data-aos-surface="markdown-workbench" data-semantic-target-id="outline-toggle"' })}
              ${renderButtonHtml({ className: 'markdown-workbench-icon-button', label: 'Annotations', ariaLabel: 'Annotations', title: 'Annotations', pressed: true, rawAttributes: 'data-action="toggle-annotations" hidden data-aos-ref="markdown-workbench:annotation-toggle" data-aos-action="toggle_annotations" data-aos-surface="markdown-workbench" data-semantic-target-id="annotation-toggle"' })}
              ${renderButtonHtml({ label: 'Revert', rawAttributes: 'data-action="revert" data-aos-ref="markdown-workbench:revert" data-aos-action="revert_markdown" data-aos-surface="markdown-workbench" data-semantic-target-id="revert"' })}
              ${renderButtonHtml({ label: 'Save', rawAttributes: 'data-action="save" data-aos-ref="markdown-workbench:save" data-aos-action="save_markdown" data-aos-surface="markdown-workbench" data-semantic-target-id="save"' })}
            </div>
            ${renderButtonHtml({ includeBaseClass: false, className: 'aos-window-button aos-window-close markdown-workbench-close-content', classFirst: true, label: 'x', ariaLabel: 'Close content view', title: 'Close content view', rawAttributes: 'data-action="close-content" data-aos-ref="markdown-workbench:content-close" data-aos-action="close_content" data-aos-surface="markdown-workbench" data-semantic-target-id="content-close"' })}
            `,
          })}
          <div class="markdown-workbench-document-body">
            <section class="markdown-workbench-source" aria-label="Markdown source"></section>
            <section class="markdown-workbench-preview-pane" aria-label="Rendered Markdown preview" data-aos-ref="markdown-workbench:preview-pane" data-aos-surface="markdown-workbench" data-semantic-target-id="preview-pane">
              <div class="aos-markdown-preview markdown-workbench-preview" data-aos-ref="markdown-workbench:preview" data-aos-surface="markdown-workbench" data-semantic-target-id="preview"></div>
            </section>
            <div class="markdown-workbench-annotation-overlay" data-role="annotation-overlay" data-aos-ref="markdown-workbench:annotation-overlay" data-aos-surface="markdown-workbench" data-semantic-target-id="annotation-overlay"></div>
            <aside class="markdown-workbench-annotation-panel" aria-label="Annotations" data-role="annotation-panel" hidden data-aos-ref="markdown-workbench:annotations" data-aos-surface="markdown-workbench" data-semantic-target-id="annotations">
              ${renderWorkbenchSectionTitle({ title: 'Annotations', baseClassName: 'markdown-workbench-annotation-title' })}
              <ol data-role="annotation-list"></ol>
            </aside>
            <aside class="markdown-workbench-outline-panel" aria-label="Document index" hidden>
              ${renderWorkbenchSectionTitle({ title: 'Index', baseClassName: 'markdown-workbench-outline-title' })}
              <ol data-role="outline"></ol>
            </aside>
            ${renderWorkbenchStatusBar({
              className: 'markdown-workbench-document-status',
              attributes: { 'aria-label': 'Document status' },
              content: `
              <span data-role="stats"></span>
              <span data-role="mermaid"></span>
              <span class="markdown-workbench-warning" data-role="warning" hidden>Unclosed fenced code block</span>
              `,
            })}
          </div>
        </section>
      </main>
    `;
    const editorControl = createTextarea({
      document,
      spellcheck: true,
      ariaLabel: 'Markdown source editor',
      dataset: {
        aosRef: 'markdown-workbench:source-editor',
        aosAction: 'edit_markdown',
        aosSurface: 'markdown-workbench',
        semanticTargetId: 'source-editor',
      },
    });
    root.querySelector('.markdown-workbench-source')?.appendChild(editorControl.el);
    dom.path = root.querySelector('[data-role="path"]');
    dom.editor = editorControl.el;
    dom.sourcePane = root.querySelector('.markdown-workbench-source');
    dom.previewPane = root.querySelector('.markdown-workbench-preview-pane');
    dom.preview = root.querySelector('.markdown-workbench-preview');
    dom.documentBody = root.querySelector('.markdown-workbench-document-body');
    dom.stats = root.querySelector('[data-role="stats"]');
    dom.mermaid = root.querySelector('[data-role="mermaid"]');
    dom.warning = root.querySelector('[data-role="warning"]');
    dom.outline = root.querySelector('[data-role="outline"]');
    dom.outlinePanel = root.querySelector('.markdown-workbench-outline-panel');
    dom.outlineToggle = root.querySelector('[data-action="toggle-outline"]');
    dom.documentPane = root.querySelector('.markdown-workbench-document-pane');
    dom.closeContentButton = root.querySelector('[data-action="close-content"]');
    dom.saveButton = root.querySelector('[data-action="save"]');
    dom.annotationToggle = root.querySelector('[data-action="toggle-annotations"]');
    dom.graph = root.querySelector('[data-role="graph"]');
    dom.graphStatus = root.querySelector('[data-role="graph-status"]');
    dom.annotationPanel = root.querySelector('[data-role="annotation-panel"]');
    dom.annotationList = root.querySelector('[data-role="annotation-list"]');
    dom.annotationOverlay = root.querySelector('[data-role="annotation-overlay"]');

    const narrowLayout = typeof window !== 'undefined'
      && window.matchMedia?.('(max-width: 940px)')?.matches;
    splitPane = createSplitPane({
      root: root.querySelector('.markdown-workbench-main'),
      startPane: root.querySelector('.markdown-workbench-graph-pane'),
      endPane: dom.documentPane,
      orientation: narrowLayout ? 'vertical' : 'horizontal',
      initialRatio: 0.5,
      minStart: narrowLayout ? 300 : 0,
      minEnd: narrowLayout ? 320 : 420,
      dividerSize: 0,
      closedEndSize: 0,
      ariaLabel: 'Resize wiki graph and document panes',
    });

    graphWorkbench = WikiKB({ chrome: 'embedded', views: ['graph'] });
    graphHost = {
      contentEl: dom.graph,
      setTitle() {},
      emit(type, payload) {
        if (type === WIKI_SUBJECT_SELECTION_TYPE && payload?.path && payload.path !== state.source?.path) {
          void openWikiSubjectSelection(payload);
        } else if (type === WIKI_SUBJECT_SELECTION_TYPE && payload?.path) {
          splitOpen = true;
          sync();
          scheduleEmbeddedGraphFit([260, 520]);
        } else if (type === 'selection' && payload?.path && !payload.subject && !payload.entry_handle) {
          void openWikiPath(payload.path, { syncEditor: true, openContent: true });
        }
        emit(`graph.${type}`, payload);
      },
    };
    const graphRoot = graphWorkbench.render(graphHost);
    dom.graph.replaceChildren(graphRoot);
    requestAnimationFrame(collapseEmbeddedGraphControls);

    dom.editor.addEventListener('input', () => setContent(dom.editor.value));
    dom.editor.addEventListener('keydown', handleEditorKeydown);
    dom.editor.addEventListener('scroll', () => {
      if (viewMode === 'source') {
        syncAnnotations();
        syncInspectableState();
      }
    });
    dom.previewPane.addEventListener('scroll', () => {
      if (viewMode === 'preview') {
        syncAnnotations();
        syncInspectableState();
      }
    });
    for (const button of root.querySelectorAll('[data-view-mode]')) {
      button.addEventListener('click', () => {
        viewMode = button.dataset.viewMode === 'source' ? 'source' : 'preview';
        sync();
        if (viewMode === 'source') dom.editor.focus();
      });
    }
    dom.annotationToggle.addEventListener('click', () => {
      annotationLayerVisible = !annotationLayerVisible;
      syncAnnotations();
      syncInspectableState();
    });
    dom.outlineToggle.addEventListener('click', () => {
      outlineOpen = !outlineOpen;
      syncOutline();
    });
    dom.closeContentButton.addEventListener('click', () => {
      splitOpen = false;
      outlineOpen = false;
      graphWorkbench?.onMessage?.({ type: 'clear-selection' }, graphHost);
      sync();
      scheduleEmbeddedGraphFit([260, 520]);
    });
    dom.saveButton.addEventListener('click', requestSave);
    root.querySelector('[data-action="revert"]').addEventListener('click', () => {
      state.content = state.savedContent;
      state.dirty = false;
      sync({ replaceEditorValue: true });
    });
    window.addEventListener('resize', () => {
      syncAnnotations();
      syncInspectableState();
    });
    sync({ replaceEditorValue: true });
    return root;
  }

  function onMessage(message = {}) {
    const type = message.type || message.payload?.type;
    if (type === 'markdown_document.open') {
      openMarkdownDocument(state, message);
      splitOpen = true;
      sync({ replaceEditorValue: true });
      void loadWikiGraph({ revealCurrent: true });
    } else if (type === WIKI_SUBJECT_SELECTION_TYPE) {
      const selection = Object.prototype.hasOwnProperty.call(message, 'payload')
        ? message.payload
        : message;
      void openWikiSubjectSelection(selection);
    } else if (type === 'markdown_document.text.patch') {
      applyMarkdownTextPatch(state, message);
      sync({ replaceEditorValue: true });
    } else if (type === 'markdown_workbench.annotations.replace' || type === 'markdown_workbench.annotations.load') {
      applyMarkdownAnnotations(state, message);
      sync();
    } else if (type === 'markdown_workbench.annotations.clear') {
      clearMarkdownAnnotations(state);
      expandedAnnotationIds.clear();
      sync();
    } else if (type === 'markdown_workbench.annotations.hide') {
      annotationLayerVisible = false;
      syncAnnotations();
      syncInspectableState();
    } else if (type === 'markdown_workbench.annotations.show') {
      annotationLayerVisible = true;
      syncAnnotations();
      syncInspectableState();
    } else if (type === 'markdown_workbench.annotations.toggle') {
      annotationLayerVisible = !annotationLayerVisible;
      syncAnnotations();
      syncInspectableState();
    } else if (type === 'markdown_document.save.result') {
      applyMarkdownSaveResult(state, message);
      sync();
    } else if (type === 'wiki_page_changed') {
      scheduleGraphReload();
    } else if (type === 'set-view') {
      const nextMode = message?.payload?.view || message?.payload?.mode || message?.view || message?.mode;
      if (nextMode === 'source' || nextMode === 'preview') {
        viewMode = nextMode;
        syncViewMode();
      }
    } else {
      const graphMessage = type.startsWith('wiki-kb/')
        ? { ...message, type: type.slice('wiki-kb/'.length) }
        : message;
      graphWorkbench?.onMessage?.(graphMessage, graphHost);
    }
  }

  return {
    manifest: {
      name: 'markdown-workbench',
      title: 'Markdown Workbench',
    accepts: [WIKI_SUBJECT_SELECTION_TYPE, 'markdown_document.open', 'markdown_document.text.patch', 'markdown_document.save.result', 'markdown_workbench.annotations.replace', 'markdown_workbench.annotations.load', 'markdown_workbench.annotations.clear', 'markdown_workbench.annotations.show', 'markdown_workbench.annotations.hide', 'markdown_workbench.annotations.toggle'],
      emits: ['markdown-workbench/save.requested', 'markdown-workbench/save.result', WIKI_SUBJECT_OPEN_REQUEST_TYPE],
      channelPrefix: 'markdown-workbench',
      defaultSize: { w: 1120, h: 720 },
      requires: ['wiki_page_changed'],
    },

    render(host_) {
      host = host_;
      host.contentEl.style.overflow = 'hidden';
      const root = render();
      void openInitialWikiFromUrl();
      if (options.loadGraphOnStart) void loadWikiGraph();
      return root;
    },

    onMessage,

    serialize() {
      return markdownWorkbenchSnapshot(state);
    },
  };
}
