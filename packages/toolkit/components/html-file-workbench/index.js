import { renderButtonHtml } from '../../controls/button.js';
import { createTextarea } from '../../controls/textarea.js';
import {
  applyHtmlFileSaveResult,
  applyHtmlFileTextPatch,
  buildHtmlFileSaveRequest,
  createHtmlFileWorkbenchState,
  HTML_FILE_OPEN_TYPE,
  HTML_FILE_SAVE_RESULT_TYPE,
  HTML_FILE_TEXT_PATCH_TYPE,
  htmlFileWorkbenchSnapshot,
  openHtmlFile,
  reloadHtmlFilePreview,
  revertHtmlFile,
  setHtmlFileContent,
  sha256Hex,
} from './model.js';

function el(tag, className, textContent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

function lineCount(value = '') {
  return String(value).length ? String(value).split(/\r\n|\r|\n/).length : 0;
}

function hasHtmlShape(content = '') {
  return /<!doctype html|<html[\s>]|<body[\s>]|<script[\s>]|<style[\s>]/i.test(String(content));
}

export default function HtmlFileWorkbench(options = {}) {
  let host = null;
  const state = createHtmlFileWorkbenchState(options.document || {});
  const dom = {};

  function emit(type, payload) {
    if (host?.emit) host.emit(type, payload);
  }

  function syncTitle() {
    host?.setTitle?.(`HTML File / Workbench${state.dirty ? ' *' : ''}`);
  }

  function syncStats() {
    dom.stats.textContent = `${lineCount(state.content)} lines · ${state.content.length} chars`;
    dom.previewStatus.textContent = state.previewMode === 'srcdoc'
      ? `Preview revision ${state.previewRevision}`
      : 'Preview blocked';
    dom.warning.hidden = hasHtmlShape(state.content);
  }

  function syncPreview() {
    dom.previewFrame.removeAttribute('src');
    dom.previewFrame.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-pointer-lock allow-popups');
    dom.previewFrame.srcdoc = state.previewContent;
  }

  function syncInspectableState() {
    window.__htmlFileWorkbenchState = htmlFileWorkbenchSnapshot(state);
  }

  function refreshHash() {
    void sha256Hex(state.content).then((hash) => {
      state.contentHash = hash;
      syncInspectableState();
    });
  }

  function sync({ replaceEditorValue = false, refreshPreview = false } = {}) {
    dom.path.textContent = state.path;
    dom.root.dataset.dirty = String(state.dirty);
    dom.dirty.textContent = state.dirty ? 'Unsaved changes' : 'Saved';
    dom.saveButton.disabled = !state.dirty;
    dom.saveButton.setAttribute('aria-disabled', String(!state.dirty));
    if (replaceEditorValue && dom.editor.value !== state.content) {
      dom.editor.value = state.content;
    }
    syncTitle();
    syncStats();
    if (refreshPreview) syncPreview();
    syncInspectableState();
    refreshHash();
  }

  function requestSave() {
    const request = buildHtmlFileSaveRequest(state);
    emit('save.requested', request);
    sync();
    return request;
  }

  function setContent(content) {
    setHtmlFileContent(state, content);
    sync();
  }

  function handleEditorKeydown(event) {
    const key = String(event.key || '').toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === 's') {
      event.preventDefault();
      requestSave();
    }
  }

  function render() {
    const root = el('div', 'html-file-workbench-root');
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'HTML File Workbench');
    root.dataset.aosRef = 'html-file-workbench:root';
    root.dataset.aosSurface = 'html-file-workbench';
    root.dataset.semanticTargetId = 'root';
    dom.root = root;

    root.innerHTML = `
      <header class="html-file-workbench-toolbar" role="toolbar" aria-label="HTML file tools">
        <div class="html-file-workbench-file" title="Current HTML file">
          <strong data-role="path" data-aos-ref="html-file-workbench:current-path" data-aos-surface="html-file-workbench" data-semantic-target-id="current-path"></strong>
          <span data-role="dirty" data-aos-ref="html-file-workbench:dirty-state" data-aos-surface="html-file-workbench" data-semantic-target-id="dirty-state"></span>
        </div>
        <div class="html-file-workbench-actions">
          ${renderButtonHtml({ label: 'Reload Preview', rawAttributes: 'data-action="reload-preview" data-aos-ref="html-file-workbench:reload-preview" data-aos-action="reload_preview" data-aos-surface="html-file-workbench" data-semantic-target-id="reload-preview"' })}
          ${renderButtonHtml({ label: 'Revert', rawAttributes: 'data-action="revert" data-aos-ref="html-file-workbench:revert" data-aos-action="revert_html_file" data-aos-surface="html-file-workbench" data-semantic-target-id="revert"' })}
          ${renderButtonHtml({ label: 'Save', rawAttributes: 'data-action="save" data-aos-ref="html-file-workbench:save" data-aos-action="save_html_file" data-aos-surface="html-file-workbench" data-semantic-target-id="save"' })}
          ${renderButtonHtml({ label: 'Close', rawAttributes: 'data-action="close" data-aos-ref="html-file-workbench:close" data-aos-action="close_html_file" data-aos-surface="html-file-workbench" data-semantic-target-id="close"' })}
        </div>
      </header>
      <main class="html-file-workbench-main">
        <section class="html-file-workbench-source" aria-label="HTML source" data-aos-ref="html-file-workbench:source-pane" data-aos-surface="html-file-workbench" data-semantic-target-id="source-pane"></section>
        <section class="html-file-workbench-preview" aria-label="Live HTML preview" data-aos-ref="html-file-workbench:preview-pane" data-aos-surface="html-file-workbench" data-semantic-target-id="preview-pane">
          <iframe class="html-file-workbench-preview-frame" title="HTML preview" data-role="preview-frame" data-aos-ref="html-file-workbench:preview-frame" data-aos-surface="html-file-workbench" data-semantic-target-id="preview-frame"></iframe>
          <div class="html-file-workbench-preview-empty" data-role="preview-empty">Preview will render after an HTML file opens.</div>
        </section>
      </main>
      <footer class="html-file-workbench-status" aria-label="HTML file status">
        <span data-role="stats"></span>
        <span data-role="preview-status"></span>
        <span class="html-file-workbench-warning" data-role="warning" hidden>Source does not look like a standalone HTML document.</span>
      </footer>
    `;

    const editorControl = createTextarea({
      document,
      spellcheck: false,
      ariaLabel: 'HTML source editor',
      dataset: {
        aosRef: 'html-file-workbench:source-editor',
        aosAction: 'edit_html_file',
        aosSurface: 'html-file-workbench',
        semanticTargetId: 'source-editor',
      },
    });
    root.querySelector('.html-file-workbench-source')?.appendChild(editorControl.el);

    dom.path = root.querySelector('[data-role="path"]');
    dom.dirty = root.querySelector('[data-role="dirty"]');
    dom.editor = editorControl.el;
    dom.saveButton = root.querySelector('[data-action="save"]');
    dom.stats = root.querySelector('[data-role="stats"]');
    dom.previewStatus = root.querySelector('[data-role="preview-status"]');
    dom.warning = root.querySelector('[data-role="warning"]');
    dom.previewFrame = root.querySelector('[data-role="preview-frame"]');
    dom.previewEmpty = root.querySelector('[data-role="preview-empty"]');

    dom.editor.addEventListener('input', () => setContent(dom.editor.value));
    dom.editor.addEventListener('keydown', handleEditorKeydown);
    dom.previewFrame.addEventListener('load', () => {
      dom.previewEmpty.hidden = true;
      state.lastResult = {
        type: 'html_file.preview.load.result',
        status: 'loaded',
        path: state.path,
        preview_revision: state.previewRevision,
      };
      syncStats();
      syncInspectableState();
    });
    dom.previewFrame.addEventListener('error', () => {
      dom.previewEmpty.hidden = false;
      dom.previewEmpty.textContent = 'Preview failed to load.';
      state.lastResult = {
        type: 'html_file.preview.load.result',
        status: 'rejected',
        path: state.path,
        preview_revision: state.previewRevision,
      };
      syncStats();
      syncInspectableState();
    });
    root.querySelector('[data-action="reload-preview"]').addEventListener('click', () => {
      reloadHtmlFilePreview(state);
      sync({ refreshPreview: true });
    });
    root.querySelector('[data-action="revert"]').addEventListener('click', () => {
      revertHtmlFile(state);
      sync({ replaceEditorValue: true, refreshPreview: true });
    });
    dom.saveButton.addEventListener('click', requestSave);
    root.querySelector('[data-action="close"]').addEventListener('click', () => {
      emit('close.requested', { type: 'html_file.close.request', path: state.path, dirty: state.dirty });
    });

    sync({ replaceEditorValue: true, refreshPreview: true });
    return root;
  }

  function onMessage(message = {}) {
    const type = message.type || message.payload?.type;
    if (type === HTML_FILE_OPEN_TYPE) {
      openHtmlFile(state, message);
      sync({ replaceEditorValue: true, refreshPreview: true });
    } else if (type === HTML_FILE_TEXT_PATCH_TYPE) {
      applyHtmlFileTextPatch(state, message);
      sync({ replaceEditorValue: true });
    } else if (type === HTML_FILE_SAVE_RESULT_TYPE) {
      applyHtmlFileSaveResult(state, message);
      sync({ replaceEditorValue: true });
    } else if (type === 'html_file.preview.reload') {
      reloadHtmlFilePreview(state);
      sync({ refreshPreview: true });
    } else if (type === 'html_file.revert') {
      revertHtmlFile(state);
      sync({ replaceEditorValue: true, refreshPreview: true });
    }
  }

  return {
    manifest: {
      name: 'html-file-workbench',
      title: 'HTML File Workbench',
      accepts: [HTML_FILE_OPEN_TYPE, HTML_FILE_TEXT_PATCH_TYPE, HTML_FILE_SAVE_RESULT_TYPE, 'html_file.preview.reload', 'html_file.revert'],
      emits: ['html-file-workbench/save.requested', 'html-file-workbench/close.requested'],
      channelPrefix: 'html-file-workbench',
      defaultSize: { w: 1180, h: 760 },
    },

    render(host_) {
      host = host_;
      host.contentEl.style.overflow = 'hidden';
      return render();
    },

    onMessage,

    serialize() {
      return htmlFileWorkbenchSnapshot(state);
    },
  };
}
