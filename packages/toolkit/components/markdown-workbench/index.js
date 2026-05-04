import { renderMarkdown } from '../../markdown/render.js';
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

  function setContent(content) {
    state.content = String(content ?? '');
    state.dirty = state.content !== state.savedContent;
    sync();
  }

  function requestSave() {
    const request = buildMarkdownSaveRequest(state);
    state.lastResult = request;
    emit('save.requested', request);
    sync();
    return request;
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
      emits: ['markdown-workbench/save.requested'],
      channelPrefix: 'markdown-workbench',
      defaultSize: { w: 1120, h: 720 },
    },

    render(host_) {
      host = host_;
      host.contentEl.style.overflow = 'hidden';
      return render();
    },

    onMessage,

    serialize() {
      return markdownWorkbenchSnapshot(state);
    },
  };
}
