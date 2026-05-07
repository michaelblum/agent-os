import { esc } from '../../runtime/bridge.js';
import { renderMarkdown } from '../../markdown/render.js';
import {
  ARTIFACT_BUNDLE_WORK_RECORD_CANVAS_ID,
  ARTIFACT_BUNDLE_OPEN_TYPE,
  ARTIFACT_BUNDLE_SELECT_TYPE,
  ARTIFACT_BUNDLE_WORKBENCH_SURFACE,
  artifactBundleWorkbenchSnapshot,
  createArtifactBundleWorkbenchState,
  openArtifactBundle,
  openArtifactBundleLinkedWorkRecord,
  rejectArtifactBundleLinkedWorkRecordOpen,
  selectArtifactBundleArtifact,
} from './model.js';

function el(tag, className, textContent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function messageType(message = {}) {
  return message.type || message.payload?.type || '';
}

function aosRef(...parts) {
  return [ARTIFACT_BUNDLE_WORKBENCH_SURFACE, ...parts].map((part) => text(part, 'unknown')).join(':');
}

function artifactMetaText(entry = {}) {
  const bits = [
    text(entry.kind, 'artifact'),
    text(entry.renderer_id),
    text(entry.validation_state) ? `validation ${entry.validation_state}` : '',
  ].filter(Boolean);
  return bits.join(' - ');
}

function renderExportList(artifact = {}) {
  const exports = arrayValue(artifact.exports);
  if (exports.length === 0) return '<p class="artifact-bundle-muted">No exports recorded.</p>';
  return (
    '<ol class="artifact-bundle-list">'
      + exports.map((item) => (
        '<li>'
          + `<strong>${esc(text(item.id || item.kind, 'export'))}</strong>`
          + `<span>${esc(text(item.kind, 'export'))} - ${esc(text(item.status, 'unknown'))}</span>`
          + `<code>${esc(text(item.path, 'no path'))}</code>`
        + '</li>'
      )).join('')
    + '</ol>'
  );
}

function renderFileList(artifact = {}) {
  const files = arrayValue(artifact.files);
  if (files.length === 0) return '<p class="artifact-bundle-muted">No files recorded.</p>';
  return (
    '<ol class="artifact-bundle-list">'
      + files.map((item) => (
        '<li>'
          + `<strong>${esc(text(item.role, 'file'))}</strong>`
          + `<span>${esc(text(item.media_type, 'unknown media'))}</span>`
          + `<code>${esc(text(item.path, 'no path'))}</code>`
        + '</li>'
      )).join('')
    + '</ol>'
  );
}

function renderProvenance(artifact = {}) {
  const provenance = objectValue(artifact.provenance);
  const workRecord = objectValue(artifact.work_record);
  const rows = [
    ['Source', provenance.source_subject_id || 'none'],
    ['Work record', workRecord.subject_id || provenance.work_record_id || 'none'],
    ['Evidence refs', arrayValue(workRecord.evidence_refs).join(', ') || 'none'],
    ['Guidance', arrayValue(provenance.guided_by).join(', ') || 'none'],
  ];
  return rows.map(([label, value]) => (
    `<div class="artifact-bundle-row"><span>${esc(label)}</span><strong>${esc(String(value))}</strong></div>`
  )).join('');
}

function renderWorkRecordLink(link = null) {
  if (!link) {
    return '<p class="artifact-bundle-muted">No linked Work Record evidence recorded.</p>';
  }
  const evidenceRefs = arrayValue(link.evidence_refs);
  return (
    `<div class="artifact-bundle-row"><span>Record</span><strong>${esc(text(link.record_id, 'unknown'))}</strong></div>`
    + `<div class="artifact-bundle-row"><span>Source</span><strong>${esc(text(link.record_path || link.record_url, 'embedded'))}</strong></div>`
    + '<div class="artifact-bundle-action-row">'
      + `<button type="button" class="artifact-bundle-action" data-action="open-work-record" data-aos-ref="${esc(link.open_ref)}"${link.can_open ? '' : ' disabled'}>`
        + 'Open Work Record Evidence'
      + '</button>'
    + '</div>'
    + (evidenceRefs.length === 0 ? '<p class="artifact-bundle-muted">No evidence refs recorded.</p>' : (
      '<ol class="artifact-bundle-list artifact-bundle-evidence-list">'
        + evidenceRefs.map((item) => (
          `<li><code>${esc(item)}</code></li>`
        )).join('')
      + '</ol>'
    ))
  );
}

function renderValidation(artifact = {}) {
  const validation = objectValue(artifact.validation);
  const checks = arrayValue(validation.checks);
  return (
    `<div class="artifact-bundle-row"><span>State</span><strong>${esc(text(validation.state, 'unknown'))}</strong></div>`
    + `<div class="artifact-bundle-row"><span>Last checked</span><strong>${esc(text(validation.last_checked_at, 'never'))}</strong></div>`
    + (checks.length === 0 ? '<p class="artifact-bundle-muted">No validation checks recorded.</p>' : (
      '<ol class="artifact-bundle-list">'
        + checks.map((check) => (
          '<li>'
            + `<strong>${esc(text(check.id, 'check'))}</strong>`
            + `<span>${esc(text(check.kind, 'check'))} - ${esc(text(check.status, 'unknown'))}</span>`
            + `<code>${esc(text(check.target, 'no target'))}</code>`
          + '</li>'
        )).join('')
      + '</ol>'
    ))
  );
}

function renderPreview(preview = {}) {
  const artifact = objectValue(preview.artifact);
  const kind = text(preview.artifact_kind);
  if (!artifact.id) {
    return '<p class="artifact-bundle-muted">No artifact selected.</p>';
  }
  if (preview.render_mode === 'iframe' && preview.url) {
    return `<iframe title="${esc(text(artifact.label, 'HTML artifact'))}" src="${esc(preview.url)}"></iframe>`;
  }
  if (preview.render_mode === 'markdown' && preview.url) {
    return (
      `<article class="aos-markdown-preview artifact-bundle-markdown-preview" aria-label="${esc(text(artifact.label, 'Markdown artifact'))}" data-role="markdown-preview">`
        + '<p class="artifact-bundle-muted">Loading Markdown preview...</p>'
      + '</article>'
    );
  }
  return (
    '<div class="artifact-bundle-preview-fallback">'
      + `<strong>${esc(text(artifact.label || artifact.id, 'Artifact'))}</strong>`
      + `<span>${esc(text(kind, 'artifact'))} - ${esc(text(preview.renderer_id, 'no renderer'))}</span>`
      + `<code>${esc(text(preview.url || preview.entry, 'no entry'))}</code>`
    + '</div>'
  );
}

async function fetchText(url = '') {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`preview fetch failed: ${response.status}`);
  return response.text();
}

async function fetchJson(url = '') {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`record fetch failed: ${response.status}`);
  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function siblingWorkRecordWorkbenchUrl() {
  try {
    return new URL('../work-record-workbench/index.html', window.location.href).href;
  } catch {
    return 'aos://toolkit/components/work-record-workbench/index.html';
  }
}

async function postWorkRecordOpenToChild(host, childId, openMessage) {
  if (!host?.evalCanvas) return false;
  const encoded = btoa(JSON.stringify(openMessage));
  const expectedRecordId = text(openMessage?.record?.id);
  const script = `
(function () {
  if (!window.headsup || typeof window.headsup.receive !== "function") return "";
  if (!window.__workRecordWorkbenchState || !document.querySelector("[data-role='record-id']")) return "";
  window.headsup.receive(${JSON.stringify(encoded)});
  return window.__workRecordWorkbenchState?.record?.id === ${JSON.stringify(expectedRecordId)}
    ? ${JSON.stringify(expectedRecordId)}
    : "";
})()
`;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const result = await host.evalCanvas(childId, script, { timeoutMs: 3000 });
      if (result === expectedRecordId) return true;
    } catch {}
    await sleep(150);
  }
  return false;
}

export default function ArtifactBundleWorkbench(options = {}) {
  let host = null;
  let previewToken = 0;
  const state = createArtifactBundleWorkbenchState({
    subject: options.subject || null,
    source: options.source || null,
    contentRoot: options.contentRoot || null,
  });
  const dom = {};

  function emit(type, payload) {
    host?.emit?.(type, payload);
  }

  function syncTitle(snapshot) {
    host?.setTitle?.(`Artifact Bundle - ${snapshot.subject.label}`);
  }

  function syncDebugState(snapshot) {
    window.__artifactBundleWorkbenchState = snapshot;
  }

  async function loadMarkdownPreview(preview, token) {
    try {
      const source = await fetchText(preview.url);
      if (token !== previewToken) return;
      const target = dom.preview.querySelector('[data-role="markdown-preview"]');
      if (!target) return;
      target.innerHTML = renderMarkdown(source);
    } catch (error) {
      if (token !== previewToken) return;
      const target = dom.preview.querySelector('[data-role="markdown-preview"]');
      if (!target) return;
      target.innerHTML = (
        '<div class="artifact-bundle-preview-fallback">'
          + '<strong>Markdown preview unavailable</strong>'
          + `<span>${esc(String(error?.message || error))}</span>`
          + `<code>${esc(text(preview.url, 'no entry'))}</code>`
        + '</div>'
      );
    }
  }

  async function openLinkedWorkRecord() {
    const snapshot = artifactBundleWorkbenchSnapshot(state);
    const link = snapshot.selected_work_record_link;
    if (!link?.can_open) {
      const result = rejectArtifactBundleLinkedWorkRecordOpen(state, {
        artifactId: snapshot.selected_artifact_id,
        recordId: link?.record_id,
      });
      emit(result.type, result);
      sync();
      return result;
    }

    let record = link.work_record?.record || null;
    if (!record && link.record_url) {
      record = await fetchJson(link.record_url);
    }
    const result = openArtifactBundleLinkedWorkRecord(state, {
      record,
      canvasId: ARTIFACT_BUNDLE_WORK_RECORD_CANVAS_ID,
    });
    sync();
    emit(result.type, result);

    if (!host?.spawnChild || !state.linked_work_record_open?.open_message) {
      return result;
    }

    const childId = state.linked_work_record_open.work_record_canvas_id || ARTIFACT_BUNDLE_WORK_RECORD_CANVAS_ID;
    try {
      await host.spawnChild({
        id: childId,
        url: siblingWorkRecordWorkbenchUrl(),
        frame: [80, 92, 1180, 720],
        interactive: true,
      });
    } catch (error) {
      const message = String(error?.message || error);
      if (!/ID_COLLISION|DUPLICATE/i.test(message)) {
        state.linked_work_record_open.child_error = message;
      }
    }
    const posted = await postWorkRecordOpenToChild(host, childId, state.linked_work_record_open.open_message);
    state.linked_work_record_open.child_posted = posted;
    state.last_result = {
      ...result,
      child_posted: posted,
    };
    sync();
    emit(result.type, state.last_result);
    return state.last_result;
  }

  function sync() {
    const snapshot = artifactBundleWorkbenchSnapshot(state);
    const token = previewToken + 1;
    previewToken = token;
    const subject = snapshot.subject;
    dom.subjectId.textContent = subject.id;
    dom.subjectType.textContent = subject.subject_type;
    dom.summary.textContent = `${snapshot.diagnostics.artifact_count} artifacts - ${snapshot.diagnostics.export_count} exports - ${snapshot.diagnostics.validation_state}`;
    dom.gallery.replaceChildren();
    for (const entry of snapshot.gallery_entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'artifact-bundle-gallery-entry';
      button.dataset.artifactId = entry.id;
      button.dataset.selected = String(entry.selected);
      button.dataset.aosRef = entry.select_ref;
      button.innerHTML = '<strong></strong><span></span><code></code>';
      button.querySelector('strong').textContent = entry.label;
      button.querySelector('span').textContent = artifactMetaText(entry);
      button.querySelector('code').textContent = entry.entry || entry.id;
      button.addEventListener('click', () => {
        const result = selectArtifactBundleArtifact(state, entry.id);
        emit(result.type, result);
        sync();
      });
      dom.gallery.appendChild(button);
    }

    const selected = objectValue(snapshot.selected_artifact);
    dom.preview.innerHTML = renderPreview(snapshot.preview);
    if (snapshot.preview.render_mode === 'markdown' && snapshot.preview.url) {
      void loadMarkdownPreview(snapshot.preview, token);
    }
    dom.files.innerHTML = renderFileList(selected);
    dom.exports.innerHTML = renderExportList(selected);
    dom.provenance.innerHTML = renderProvenance(selected);
    dom.workRecord.innerHTML = renderWorkRecordLink(snapshot.selected_work_record_link);
    const openWorkRecord = dom.workRecord.querySelector('[data-action="open-work-record"]');
    if (openWorkRecord) {
      openWorkRecord.addEventListener('click', () => {
        openWorkRecord.disabled = true;
        openLinkedWorkRecord().catch((error) => {
          const result = rejectArtifactBundleLinkedWorkRecordOpen(state, {
            artifactId: snapshot.selected_artifact_id,
            recordId: snapshot.selected_work_record_link?.record_id,
            reason: 'linked_work_record_open_failed',
            message: String(error?.message || error),
          });
          emit(result.type, result);
          sync();
        });
      });
    }
    dom.validation.innerHTML = renderValidation(selected);
    dom.subjectJson.textContent = snapshot.subject_json;
    dom.status.textContent = snapshot.last_result
      ? `${snapshot.last_result.status}: ${snapshot.last_result.selected_artifact_id || snapshot.last_result.artifact_id || snapshot.last_result.subject_id || snapshot.last_result.reason}`
      : 'Opened read-only';

    syncTitle(snapshot);
    syncDebugState(snapshot);
  }

  function render() {
    const root = el('div', 'artifact-bundle-root');
    root.dataset.aosRef = aosRef('root');
    root.innerHTML = `
      <header class="artifact-bundle-toolbar">
        <div>
          <strong data-role="subject-id"></strong>
          <span data-role="subject-type"></span>
        </div>
        <em data-role="summary"></em>
      </header>
      <main class="artifact-bundle-main">
        <aside class="artifact-bundle-gallery" aria-label="Artifact gallery">
          <header>
            <strong>Artifacts</strong>
          </header>
          <div data-role="gallery-list"></div>
        </aside>
        <section class="artifact-bundle-preview" aria-label="Artifact preview">
          <header>
            <strong>Preview</strong>
            <span data-role="status"></span>
          </header>
          <div class="artifact-bundle-preview-stage" data-role="preview"></div>
        </section>
        <aside class="artifact-bundle-inspector" aria-label="Artifact inspector">
          <section>
            <strong>Files</strong>
            <div data-role="files"></div>
          </section>
          <section>
            <strong>Exports</strong>
            <div data-role="exports"></div>
          </section>
          <section>
            <strong>Provenance</strong>
            <div data-role="provenance"></div>
          </section>
          <section>
            <strong>Work Record Evidence</strong>
            <div data-role="work-record"></div>
          </section>
          <section>
            <strong>Validation</strong>
            <div data-role="validation"></div>
          </section>
          <section>
            <strong>Subject JSON</strong>
            <pre data-role="subject-json"></pre>
          </section>
        </aside>
      </main>
    `;

    dom.subjectId = root.querySelector('[data-role="subject-id"]');
    dom.subjectType = root.querySelector('[data-role="subject-type"]');
    dom.summary = root.querySelector('[data-role="summary"]');
    dom.gallery = root.querySelector('[data-role="gallery-list"]');
    dom.preview = root.querySelector('[data-role="preview"]');
    dom.files = root.querySelector('[data-role="files"]');
    dom.exports = root.querySelector('[data-role="exports"]');
    dom.provenance = root.querySelector('[data-role="provenance"]');
    dom.workRecord = root.querySelector('[data-role="work-record"]');
    dom.validation = root.querySelector('[data-role="validation"]');
    dom.subjectJson = root.querySelector('[data-role="subject-json"]');
    dom.status = root.querySelector('[data-role="status"]');

    dom.gallery.dataset.aosRef = aosRef('gallery');
    dom.preview.dataset.aosRef = aosRef('preview');
    dom.status.dataset.aosRef = aosRef('status');
    dom.subjectJson.dataset.aosRef = aosRef('subject-json');
    sync();
    return root;
  }

  function onMessage(message = {}) {
    const type = messageType(message);
    if (type === ARTIFACT_BUNDLE_OPEN_TYPE) {
      const result = openArtifactBundle(state, message);
      emit(result.type, result);
      sync();
    } else if (type === ARTIFACT_BUNDLE_SELECT_TYPE) {
      const payload = message.payload || message;
      const result = selectArtifactBundleArtifact(state, payload.artifact_id || payload.artifactId);
      emit(result.type, result);
      sync();
    }
  }

  return {
    manifest: {
      name: ARTIFACT_BUNDLE_WORKBENCH_SURFACE,
      title: 'Artifact Bundle Workbench',
      accepts: [ARTIFACT_BUNDLE_OPEN_TYPE, ARTIFACT_BUNDLE_SELECT_TYPE],
      emits: [
        'artifact_bundle.open.result',
        'artifact_bundle.select.result',
        'artifact_bundle.work_record.open.result',
      ],
      channelPrefix: ARTIFACT_BUNDLE_WORKBENCH_SURFACE,
      defaultSize: { w: 1220, h: 760 },
    },

    render(host_) {
      host = host_;
      host.contentEl.style.overflow = 'hidden';
      return render();
    },

    onMessage,

    serialize() {
      return artifactBundleWorkbenchSnapshot(state);
    },
  };
}
