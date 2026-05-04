import { renderMarkdown } from '../../markdown/render.js';
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
  const state = createMarkdownWorkbenchState(options.document || {});
  const dom = {};

  function emit(type, payload) {
    if (host?.emit) host.emit(type, payload);
  }

  function syncTitle() {
    host?.setTitle?.(`Markdown - ${state.path}${state.dirty ? ' *' : ''}`);
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

  function sync({ replaceEditorValue = false } = {}) {
    dom.path.textContent = state.path;
    // Reassigning textarea.value during native input clears WKWebView/browser
    // undo history. Only replace it for external document loads or explicit
    // commands such as Revert.
    if (replaceEditorValue && dom.editor.value !== state.content) {
      dom.editor.value = state.content;
    }
    dom.dirty.textContent = state.dirty ? 'Unsaved changes' : 'Saved';
    dom.dirty.dataset.dirty = state.dirty ? 'true' : 'false';
    syncTitle();
    syncDiagnostics();
    syncPreview();
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

  async function openInitialWikiFromUrl() {
    if (initialUrlOpenStarted || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search || '');
    const wikiPath = String(params.get('wiki') || '').replace(/^\/+/, '').trim();
    if (!wikiPath) return;
    initialUrlOpenStarted = true;
    try {
      const response = await fetch(`/wiki/${wikiPath}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`wiki fetch failed for ${wikiPath}: ${response.status}`);
      const content = await response.text();
      openMarkdownDocument(state, {
        type: 'markdown_document.open',
        path: wikiPath,
        source: {
          kind: 'wiki',
          path: wikiPath,
          page: {
            path: wikiPath,
            frontmatter: parseWikiFrontmatter(content),
          },
        },
        content,
      });
      sync({ replaceEditorValue: true });
    } catch (error) {
      state.lastResult = {
        type: 'markdown_document.open.result',
        status: 'rejected',
        path: wikiPath,
        message: String(error?.message || error),
      };
      sync();
      console.warn('[markdown-workbench] initial wiki open failed:', error);
    }
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
    root.innerHTML = `
      <header class="markdown-workbench-toolbar">
        <div class="markdown-workbench-file">
          <strong data-role="path"></strong>
          <span data-role="dirty"></span>
        </div>
        <div class="markdown-workbench-actions">
          <button type="button" data-action="revert">Revert</button>
          <button type="button" data-action="save">Save</button>
        </div>
      </header>
      <main class="markdown-workbench-main">
        <section class="markdown-workbench-source" aria-label="Markdown source">
          <textarea spellcheck="true" aria-label="Markdown source editor"></textarea>
        </section>
        <section class="markdown-workbench-preview-pane" aria-label="Rendered Markdown preview">
          <div class="markdown-workbench-preview"></div>
        </section>
        <aside class="markdown-workbench-inspector" aria-label="Markdown diagnostics">
          <strong>Diagnostics</strong>
          <p data-role="stats"></p>
          <p data-role="mermaid"></p>
          <p class="markdown-workbench-warning" data-role="warning" hidden>Unclosed fenced code block</p>
          <strong>Outline</strong>
          <ol data-role="outline"></ol>
        </aside>
      </main>
    `;
    dom.path = root.querySelector('[data-role="path"]');
    dom.dirty = root.querySelector('[data-role="dirty"]');
    dom.editor = root.querySelector('textarea');
    dom.preview = root.querySelector('.markdown-workbench-preview');
    dom.stats = root.querySelector('[data-role="stats"]');
    dom.mermaid = root.querySelector('[data-role="mermaid"]');
    dom.warning = root.querySelector('[data-role="warning"]');
    dom.outline = root.querySelector('[data-role="outline"]');

    dom.editor.addEventListener('input', () => setContent(dom.editor.value));
    dom.editor.addEventListener('keydown', handleEditorKeydown);
    root.querySelector('[data-action="save"]').addEventListener('click', requestSave);
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
      sync({ replaceEditorValue: true });
    } else if (type === 'markdown_document.text.patch') {
      applyMarkdownTextPatch(state, message);
      sync({ replaceEditorValue: true });
    } else if (type === 'markdown_document.save.result') {
      applyMarkdownSaveResult(state, message);
      sync();
    }
  }

  return {
    manifest: {
      name: 'markdown-workbench',
      title: 'Markdown Workbench',
      accepts: ['markdown_document.open', 'markdown_document.text.patch', 'markdown_document.save.result'],
      emits: ['markdown-workbench/save.requested', 'markdown-workbench/save.result'],
      channelPrefix: 'markdown-workbench',
      defaultSize: { w: 1120, h: 720 },
    },

    render(host_) {
      host = host_;
      host.contentEl.style.overflow = 'hidden';
      const root = render();
      void openInitialWikiFromUrl();
      return root;
    },

    onMessage,

    serialize() {
      return markdownWorkbenchSnapshot(state);
    },
  };
}
