import { renderMarkdown } from '../../markdown/render.js';
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
  applyMarkdownTextPatch,
  buildMarkdownSaveRequest,
  createMarkdownWorkbenchState,
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
      ? `${diagnostics.mermaid_blocks.length} Mermaid fence${diagnostics.mermaid_blocks.length === 1 ? '' : 's'} detected`
      : 'No Mermaid fences';
  }

  function syncPreview() {
    dom.preview.innerHTML = renderMarkdown(state.content);
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
    syncViewMode();
    syncOutline();
    syncSplit();
    window.__markdownWorkbenchState = markdownWorkbenchSnapshot(state);
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
    root.innerHTML = `
      <main class="aos-workbench-main markdown-workbench-main">
        <section class="aos-workbench-preview-pane markdown-workbench-graph-pane" aria-label="Wiki graph" data-aos-ref="markdown-workbench:wiki-graph" data-aos-surface="markdown-workbench" data-semantic-target-id="wiki-graph">
          <div class="markdown-workbench-graph" data-role="graph" data-aos-ref="markdown-workbench:graph-host" data-aos-surface="markdown-workbench" data-semantic-target-id="graph-host"></div>
        </section>
        <section class="aos-workbench-controls-pane markdown-workbench-document-pane" aria-label="Wiki page content" data-aos-ref="markdown-workbench:content-pane" data-aos-surface="markdown-workbench" data-semantic-target-id="content-pane">
          <header class="aos-workbench-toolbar markdown-workbench-document-toolbar" data-density="compact" role="toolbar" aria-label="Document tools">
            <div class="markdown-workbench-file" title="Current document">
              <strong data-role="path" data-aos-ref="markdown-workbench:current-path" data-aos-surface="markdown-workbench" data-semantic-target-id="current-path"></strong>
            </div>
            <div class="markdown-workbench-view-toggle" role="group" aria-label="Document view">
              <button type="button" class="active" data-view-mode="preview" aria-label="Preview" title="Preview" aria-pressed="true" data-aos-ref="markdown-workbench:view-preview" data-aos-action="set_preview" data-aos-surface="markdown-workbench" data-semantic-target-id="view-preview">
                <svg class="markdown-workbench-mode-icon" aria-hidden="true" viewBox="0 0 20 20">
                  <path d="M2.5 10s2.7-4.8 7.5-4.8S17.5 10 17.5 10 14.8 14.8 10 14.8 2.5 10 2.5 10Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
                  <circle cx="10" cy="10" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/>
                </svg>
              </button>
              <button type="button" data-view-mode="source" aria-label="Edit" title="Edit" aria-pressed="false" data-aos-ref="markdown-workbench:view-source" data-aos-action="set_source" data-aos-surface="markdown-workbench" data-semantic-target-id="view-source">
                <span class="markdown-workbench-code-icon" aria-hidden="true">&lt;/&gt;</span>
              </button>
            </div>
            <div class="markdown-workbench-actions">
              <button type="button" class="markdown-workbench-icon-button" data-action="toggle-outline" aria-label="Index" title="Index" aria-expanded="false" data-aos-ref="markdown-workbench:outline-toggle" data-aos-action="toggle_outline" data-aos-surface="markdown-workbench" data-semantic-target-id="outline-toggle">
                <svg aria-hidden="true" viewBox="0 0 20 20">
                  <path d="M5 5.5h10M5 10h10M5 14.5h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                  <circle cx="2.8" cy="5.5" r="0.9" fill="currentColor"/>
                  <circle cx="2.8" cy="10" r="0.9" fill="currentColor"/>
                  <circle cx="2.8" cy="14.5" r="0.9" fill="currentColor"/>
                </svg>
              </button>
              <button type="button" data-action="revert" data-aos-ref="markdown-workbench:revert" data-aos-action="revert_markdown" data-aos-surface="markdown-workbench" data-semantic-target-id="revert">Revert</button>
              <button type="button" data-action="save" data-aos-ref="markdown-workbench:save" data-aos-action="save_markdown" data-aos-surface="markdown-workbench" data-semantic-target-id="save">Save</button>
            </div>
            <button type="button" class="aos-window-button aos-window-close markdown-workbench-close-content" data-action="close-content" aria-label="Close content view" title="Close content view" data-aos-ref="markdown-workbench:content-close" data-aos-action="close_content" data-aos-surface="markdown-workbench" data-semantic-target-id="content-close">x</button>
          </header>
          <div class="markdown-workbench-document-body">
            <section class="markdown-workbench-source" aria-label="Markdown source">
              <textarea spellcheck="true" aria-label="Markdown source editor" data-aos-ref="markdown-workbench:source-editor" data-aos-action="edit_markdown" data-aos-surface="markdown-workbench" data-semantic-target-id="source-editor"></textarea>
            </section>
            <section class="markdown-workbench-preview-pane" aria-label="Rendered Markdown preview" data-aos-ref="markdown-workbench:preview-pane" data-aos-surface="markdown-workbench" data-semantic-target-id="preview-pane">
              <div class="markdown-workbench-preview" data-aos-ref="markdown-workbench:preview" data-aos-surface="markdown-workbench" data-semantic-target-id="preview"></div>
            </section>
            <aside class="markdown-workbench-outline-panel" aria-label="Document index" hidden>
              <div class="markdown-workbench-outline-title">Index</div>
              <ol data-role="outline"></ol>
            </aside>
            <footer class="markdown-workbench-document-status" aria-label="Document status">
              <span data-role="stats"></span>
              <span data-role="mermaid"></span>
              <span class="markdown-workbench-warning" data-role="warning" hidden>Unclosed fenced code block</span>
            </footer>
          </div>
        </section>
      </main>
    `;
    dom.path = root.querySelector('[data-role="path"]');
    dom.editor = root.querySelector('textarea');
    dom.sourcePane = root.querySelector('.markdown-workbench-source');
    dom.previewPane = root.querySelector('.markdown-workbench-preview-pane');
    dom.preview = root.querySelector('.markdown-workbench-preview');
    dom.stats = root.querySelector('[data-role="stats"]');
    dom.mermaid = root.querySelector('[data-role="mermaid"]');
    dom.warning = root.querySelector('[data-role="warning"]');
    dom.outline = root.querySelector('[data-role="outline"]');
    dom.outlinePanel = root.querySelector('.markdown-workbench-outline-panel');
    dom.outlineToggle = root.querySelector('[data-action="toggle-outline"]');
    dom.documentPane = root.querySelector('.markdown-workbench-document-pane');
    dom.closeContentButton = root.querySelector('[data-action="close-content"]');
    dom.saveButton = root.querySelector('[data-action="save"]');
    dom.graph = root.querySelector('[data-role="graph"]');
    dom.graphStatus = root.querySelector('[data-role="graph-status"]');

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
    for (const button of root.querySelectorAll('[data-view-mode]')) {
      button.addEventListener('click', () => {
        viewMode = button.dataset.viewMode === 'source' ? 'source' : 'preview';
        syncViewMode();
        if (viewMode === 'source') dom.editor.focus();
      });
    }
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
      accepts: [WIKI_SUBJECT_SELECTION_TYPE, 'markdown_document.open', 'markdown_document.text.patch', 'markdown_document.save.result'],
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
