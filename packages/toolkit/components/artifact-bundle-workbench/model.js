import {
  artifactBundleArtifacts,
  artifactBundleSummary,
  createArtifactBundleSubject,
} from '../../workbench/artifact-bundle-subject.js';

export const ARTIFACT_BUNDLE_WORKBENCH_SCHEMA_VERSION = '2026-05-06-artifact-bundle-v0';
export const ARTIFACT_BUNDLE_WORKBENCH_SURFACE = 'artifact-bundle-workbench';
export const ARTIFACT_BUNDLE_OPEN_TYPE = 'artifact_bundle.open';
export const ARTIFACT_BUNDLE_SELECT_TYPE = 'artifact_bundle.select';

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

function ref(...parts) {
  return [ARTIFACT_BUNDLE_WORKBENCH_SURFACE, ...parts].map((part) => text(part, 'unknown')).join(':');
}

function normalizeSubject(subject = null) {
  if (subject && typeof subject === 'object') return createArtifactBundleSubject(subject);
  return createArtifactBundleSubject({
    id: 'artifact-bundle:empty',
    label: 'No artifact bundle',
    source: {
      kind: 'none',
      path: '',
    },
    artifacts: [],
  });
}

function unwrapMessage(message = {}) {
  if (message?.payload && typeof message.payload === 'object') {
    return { ...message.payload, type: message.payload.type || message.type };
  }
  return message || {};
}

function subjectFromMessage(message = {}) {
  const payload = unwrapMessage(message);
  return payload.subject && typeof payload.subject === 'object' ? payload.subject : payload;
}

function normalizeSource(source = null) {
  if (!source || typeof source !== 'object') return null;
  const kind = text(source.kind);
  if (!kind) return null;
  return {
    ...cloneJson(source),
    kind,
    path: text(source.path) || null,
  };
}

function normalizeContentRoot(root = null) {
  if (!root || typeof root !== 'object') return null;
  const name = text(root.name || root.key || root.root);
  const url = text(root.url || root.url_prefix || root.prefix);
  if (!name && !url) return null;
  return {
    ...cloneJson(root),
    name: name || null,
    url: url || (name ? `aos://${name}/` : null),
    path: text(root.path) || null,
  };
}

function rendererId(artifact = {}) {
  return text(artifact.renderer_id || artifact.renderer?.id || artifact.renderer);
}

function artifactLabel(artifact = {}) {
  return text(artifact.label || artifact.title || artifact.id || artifact.entry, 'artifact');
}

function artifactById(subject = {}, id = '') {
  const artifacts = artifactBundleArtifacts(subject);
  const artifactId = text(id);
  return artifacts.find((artifact) => artifact.id === artifactId)
    || artifacts.find((artifact) => artifact.entry === artifactId)
    || artifacts[0]
    || null;
}

function previewRenderMode(artifact = {}) {
  const kind = text(artifact.kind).toLowerCase();
  const renderer = rendererId(artifact).toLowerCase();
  const entry = text(artifact.entry || artifact.path).toLowerCase();
  const mediaTypes = arrayValue(artifact.files).map((file) => text(file?.media_type).toLowerCase());
  if (kind === 'html' || renderer.includes('html') || entry.endsWith('.html')) return 'iframe';
  if (
    kind === 'markdown'
      || renderer.includes('markdown')
      || entry.endsWith('.md')
      || entry.endsWith('.markdown')
      || mediaTypes.includes('text/markdown')
  ) {
    return 'markdown';
  }
  return 'metadata';
}

function joinUrl(...parts) {
  return parts
    .map((part, index) => {
      const value = text(part);
      if (!value) return '';
      if (index === 0) return value.replace(/\/+$/, '');
      return value.replace(/^\/+|\/+$/g, '');
    })
    .filter(Boolean)
    .join('/');
}

function artifactEntryUrl(subject = {}, artifact = {}, contentRoot = null) {
  const entry = text(artifact.entry || artifact.path);
  if (!entry) return null;
  if (/^(https?:|aos:|file:)/i.test(entry)) return entry;
  const root = normalizeContentRoot(contentRoot);
  if (!root?.url) return null;
  const sourcePath = text(subject.source?.path);
  return joinUrl(root.url, sourcePath, entry);
}

function galleryEntry(artifact = {}, selectedId = '') {
  const id = text(artifact.id);
  const selected = id === selectedId;
  return {
    type: 'aos.artifact_bundle.gallery_entry',
    schema_version: ARTIFACT_BUNDLE_WORKBENCH_SCHEMA_VERSION,
    id,
    label: artifactLabel(artifact),
    kind: text(artifact.kind, 'artifact'),
    entry: text(artifact.entry || artifact.path),
    renderer_id: rendererId(artifact),
    export_count: arrayValue(artifact.exports).length,
    file_count: arrayValue(artifact.files).length,
    validation_state: text(artifact.validation?.state || artifact.validation_state, 'unknown'),
    selected,
    semantic_ref: ref('gallery', 'entry', id || 'artifact'),
    select_ref: ref('gallery', 'select', id || 'artifact'),
  };
}

function createPreview(subject = {}, artifact = null, contentRoot = null) {
  if (!artifact) {
    return {
      type: 'aos.artifact_bundle.preview',
      schema_version: ARTIFACT_BUNDLE_WORKBENCH_SCHEMA_VERSION,
      artifact_id: null,
      status: 'empty',
      url: null,
      artifact: null,
    };
  }
  return {
    type: 'aos.artifact_bundle.preview',
    schema_version: ARTIFACT_BUNDLE_WORKBENCH_SCHEMA_VERSION,
    artifact_id: text(artifact.id),
    artifact_kind: text(artifact.kind),
    renderer_id: rendererId(artifact),
    entry: text(artifact.entry || artifact.path),
    render_mode: previewRenderMode(artifact),
    status: 'ready',
    url: artifactEntryUrl(subject, artifact, contentRoot),
    files: cloneJson(arrayValue(artifact.files)),
    exports: cloneJson(arrayValue(artifact.exports)),
    validation: cloneJson(objectValue(artifact.validation)),
    provenance: cloneJson(objectValue(artifact.provenance)),
    work_record: cloneJson(objectValue(artifact.work_record)),
    artifact: cloneJson(artifact),
  };
}

export function artifactBundleDiagnostics(subject = {}) {
  const artifacts = artifactBundleArtifacts(subject);
  const summary = artifactBundleSummary(subject);
  return {
    subject_id: text(subject.id),
    subject_type: text(subject.subject_type),
    read_only: true,
    artifact_count: summary.artifact_count,
    artifact_kinds: summary.artifact_kinds,
    renderer_ids: summary.renderer_ids,
    export_count: summary.export_count,
    validation_state: summary.validation_state,
    has_legacy_views: Array.isArray(subject.views) && subject.views.length > 0,
    has_legacy_controls: Array.isArray(subject.controls) && subject.controls.length > 0,
    artifacts_with_entry: artifacts.filter((artifact) => text(artifact.entry || artifact.path)).length,
    artifacts_with_renderer: artifacts.filter((artifact) => rendererId(artifact)).length,
    artifacts_with_work_record: artifacts.filter((artifact) => text(artifact.work_record?.subject_id || artifact.provenance?.work_record_id)).length,
  };
}

export function createArtifactBundleWorkbenchState({
  subject = null,
  source = null,
  contentRoot = null,
  content_root = contentRoot,
  selectedArtifactId = '',
  selected_artifact_id = selectedArtifactId,
} = {}) {
  const normalizedSubject = normalizeSubject(subject);
  const selectedArtifact = artifactById(normalizedSubject, selected_artifact_id);
  return {
    subject: normalizedSubject,
    source: normalizeSource(source),
    content_root: normalizeContentRoot(content_root),
    selected_artifact_id: text(selectedArtifact?.id),
    last_result: null,
  };
}

export function openArtifactBundle(state, message = {}) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('artifact bundle workbench state is required');
  }
  const payload = unwrapMessage(message);
  const subject = normalizeSubject(subjectFromMessage(message));
  state.subject = subject;
  state.source = normalizeSource(payload.source) || state.source || null;
  state.content_root = normalizeContentRoot(payload.content_root || payload.contentRoot) || state.content_root || null;
  state.selected_artifact_id = text(artifactById(subject, payload.selected_artifact_id || payload.selectedArtifactId)?.id);
  state.last_result = {
    type: 'artifact_bundle.open.result',
    schema_version: ARTIFACT_BUNDLE_WORKBENCH_SCHEMA_VERSION,
    status: 'opened',
    subject_id: subject.id,
    artifact_count: artifactBundleArtifacts(subject).length,
    selected_artifact_id: state.selected_artifact_id || null,
  };
  return state.last_result;
}

export function selectArtifactBundleArtifact(state, artifactId = '') {
  if (!state || typeof state !== 'object') {
    throw new TypeError('artifact bundle workbench state is required');
  }
  const artifact = artifactById(state.subject, artifactId);
  if (!artifact) {
    state.last_result = {
      type: 'artifact_bundle.select.result',
      schema_version: ARTIFACT_BUNDLE_WORKBENCH_SCHEMA_VERSION,
      status: 'rejected',
      reason: 'artifact_not_found',
      artifact_id: text(artifactId),
    };
    return state.last_result;
  }
  state.selected_artifact_id = artifact.id;
  state.last_result = {
    type: 'artifact_bundle.select.result',
    schema_version: ARTIFACT_BUNDLE_WORKBENCH_SCHEMA_VERSION,
    status: 'selected',
    subject_id: state.subject.id,
    artifact_id: artifact.id,
  };
  return state.last_result;
}

export function artifactBundleWorkbenchSnapshot(state = {}) {
  const subject = normalizeSubject(state.subject);
  const artifacts = artifactBundleArtifacts(subject);
  const selectedArtifact = artifactById(subject, state.selected_artifact_id);
  const selectedId = text(selectedArtifact?.id);
  return {
    type: 'artifact_bundle.snapshot',
    schema_version: ARTIFACT_BUNDLE_WORKBENCH_SCHEMA_VERSION,
    surface: ARTIFACT_BUNDLE_WORKBENCH_SURFACE,
    read_only: true,
    subject,
    source: normalizeSource(state.source),
    content_root: normalizeContentRoot(state.content_root),
    artifacts: cloneJson(artifacts),
    gallery_entries: artifacts.map((artifact) => galleryEntry(artifact, selectedId)),
    selected_artifact_id: selectedId || null,
    selected_artifact: selectedArtifact ? cloneJson(selectedArtifact) : null,
    preview: createPreview(subject, selectedArtifact, state.content_root),
    diagnostics: artifactBundleDiagnostics(subject),
    subject_json: stableJson(subject),
    last_result: state.last_result ? cloneJson(state.last_result) : null,
  };
}
