import {
  artifactBundleArtifacts,
  artifactBundleSummary,
  createArtifactBundleSubject,
} from '../../workbench/artifact-bundle-subject.js';
import {
  cloneBrowserEvidenceCoverageSummary,
} from '../../workbench/browser-evidence-coverage.js';
import {
  createWorkRecordWorkbenchState,
  openWorkRecord,
  workRecordWorkbenchSnapshot,
} from '../work-record-workbench/model.js';

export const ARTIFACT_BUNDLE_WORKBENCH_SCHEMA_VERSION = '2026-05-06-artifact-bundle-v0';
export const ARTIFACT_BUNDLE_WORKBENCH_SURFACE = 'artifact-bundle-workbench';
export const ARTIFACT_BUNDLE_OPEN_TYPE = 'artifact_bundle.open';
export const ARTIFACT_BUNDLE_SELECT_TYPE = 'artifact_bundle.select';
export const ARTIFACT_BUNDLE_WORK_RECORD_OPEN_RESULT_TYPE = 'artifact_bundle.work_record.open.result';
export const ARTIFACT_BUNDLE_WORK_RECORD_CANVAS_ID = 'artifact-bundle-workbench-work-record';

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

function refKey(value = '') {
  return text(value, 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'unknown';
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

function workRecordPathUrl(subject = {}, path = '', contentRoot = null) {
  const recordPath = text(path);
  if (!recordPath) return null;
  if (/^(https?:|aos:|file:)/i.test(recordPath)) return recordPath;
  const root = normalizeContentRoot(contentRoot);
  if (!root?.url) return null;
  const sourcePath = text(subject.source?.path);
  const joinedPath = recordPath.startsWith('/') || recordPath.includes('..')
    ? recordPath
    : joinUrl(sourcePath, recordPath);
  return joinUrl(root.url, joinedPath);
}

function linkedWorkRecordForArtifact(subject = {}, artifact = null, contentRoot = null) {
  const workRecord = objectValue(artifact?.work_record);
  const recordId = text(workRecord.subject_id || workRecord.id || artifact?.provenance?.work_record_id);
  const evidenceRefs = arrayValue(workRecord.evidence_refs).map((item) => text(item)).filter(Boolean);
  const recordPath = text(workRecord.path || workRecord.source?.path);
  const hasEmbeddedRecord = Object.keys(objectValue(workRecord.record)).length > 0;
  const hasOpenMessage = Object.keys(objectValue(workRecord.open_message)).length > 0;
  const recordUrl = recordPath ? workRecordPathUrl(subject, recordPath, contentRoot) : null;
  if (!recordId && evidenceRefs.length === 0 && !recordPath && !hasEmbeddedRecord && !hasOpenMessage) return null;
  const artifactId = text(artifact?.id, 'artifact');
  return {
    type: 'aos.artifact_bundle.work_record_link',
    schema_version: ARTIFACT_BUNDLE_WORKBENCH_SCHEMA_VERSION,
    artifact_id: artifactId,
    record_id: recordId || text(workRecord.record?.id || workRecord.open_message?.record?.id),
    record_path: recordPath || null,
    record_url: recordUrl,
    evidence_refs: evidenceRefs,
    can_open: hasOpenMessage || hasEmbeddedRecord || !!recordUrl,
    semantic_ref: ref('work-record', artifactId),
    open_ref: ref('work-record', 'open', artifactId),
    work_record: cloneJson(workRecord),
  };
}

function countVerifierIndex(record = {}, key = '') {
  return arrayValue(objectValue(record.verifier_report?.derived_indexes)[key]).length;
}

function createWorkRecordEvidenceSummary(link = null, openResult = null) {
  if (!link) return null;
  const snapshot = objectValue(openResult?.workbench_snapshot);
  const diagnostics = objectValue(snapshot.diagnostics);
  const record = objectValue(snapshot.record);
  const hasSnapshot = Object.keys(snapshot).length > 0;
  return {
    type: 'aos.artifact_bundle.work_record_evidence_summary',
    schema_version: ARTIFACT_BUNDLE_WORKBENCH_SCHEMA_VERSION,
    artifact_id: text(link.artifact_id),
    record_id: text(diagnostics.record_id || link.record_id, 'unknown'),
    snapshot_available: hasSnapshot,
    read_only: hasSnapshot ? diagnostics.read_only === true : null,
    evidence_ref_count: arrayValue(link.evidence_refs).length,
    evidence_refs: cloneJson(arrayValue(link.evidence_refs)),
    evidence_count: hasSnapshot ? Number(diagnostics.evidence_count || 0) : null,
    claim_count: hasSnapshot ? Number(diagnostics.claim_count || 0) : null,
    claim_result_count: hasSnapshot ? Number(diagnostics.claim_result_count || 0) : null,
    verified_claim_count: hasSnapshot ? countVerifierIndex(record, 'verified') : null,
    failed_claim_count: hasSnapshot ? countVerifierIndex(record, 'failed') : null,
    unverified_claim_count: hasSnapshot ? countVerifierIndex(record, 'unverified') : null,
    verifier_status: hasSnapshot ? text(diagnostics.verifier_status, 'unknown') : null,
    health_state: hasSnapshot ? text(diagnostics.health_state, 'unknown') : null,
    status: hasSnapshot ? text(openResult.status, 'opened') : 'linked',
    semantic_ref: ref('work-record', 'summary', link.artifact_id),
  };
}

function createSourceEvidenceMetadata(artifact = null) {
  if (!artifact) return null;
  const artifactId = text(artifact.id, 'artifact');
  const coverageSummary = browserEvidenceCoverageSummaryForArtifact(artifact, artifactId);
  const entries = arrayValue(artifact.files)
    .map((file) => objectValue(file))
    .filter((file) => {
      const role = text(file.role).toLowerCase();
      const metadata = objectValue(file.metadata);
      return role.includes('source')
        || role.includes('evidence')
        || role.includes('work_record')
        || text(metadata.evidence_ref);
    })
    .map((file) => {
      const role = text(file.role, 'file');
      const metadata = objectValue(file.metadata);
      const provenanceOnly = file.provenance_only === true
        || role.includes('source')
        || role.includes('evidence')
        || role.includes('work_record');
      return {
        type: 'aos.artifact_bundle.source_evidence_file',
        schema_version: ARTIFACT_BUNDLE_WORKBENCH_SCHEMA_VERSION,
        artifact_id: artifactId,
        path: text(file.path),
        role,
        media_type: text(file.media_type, 'unknown'),
        schema: text(file.schema) || null,
        evidence_ref: text(metadata.evidence_ref) || null,
        read_only: true,
        provenance_only: provenanceOnly,
        local_fixture_pages_only: metadata.local_fixture_pages_only === true || metadata.local_fixture_page === true,
        live_websites: metadata.live_websites === false ? false : null,
        inspectable: true,
        semantic_ref: ref('source-evidence', artifactId, refKey(file.path || role)),
      };
    });
  const browserEvidenceEntries = entries.filter((entry) => entry.role.startsWith('browser_evidence'));
  return {
    type: 'aos.artifact_bundle.source_evidence_metadata',
    schema_version: ARTIFACT_BUNDLE_WORKBENCH_SCHEMA_VERSION,
    artifact_id: artifactId,
    read_only: true,
    provenance_only: true,
    semantic_ref: ref('source-evidence', 'summary', artifactId),
    entry_count: entries.length,
    browser_evidence_entry_count: browserEvidenceEntries.length,
    browser_evidence_registry_paths: browserEvidenceEntries
      .filter((entry) => entry.role === 'browser_evidence_registry')
      .map((entry) => entry.path),
    browser_evidence_manifest_paths: browserEvidenceEntries
      .filter((entry) => entry.role === 'browser_evidence_manifest')
      .map((entry) => entry.path),
    browser_evidence_planning_manifest_paths: browserEvidenceEntries
      .filter((entry) => entry.role === 'browser_evidence_planning_manifest')
      .map((entry) => entry.path),
    browser_evidence_coverage_summary: coverageSummary,
    local_fixture_page_count: browserEvidenceEntries
      .filter((entry) => entry.role === 'browser_evidence_fixture_page')
      .length,
    crop_count: browserEvidenceEntries
      .filter((entry) => entry.role === 'browser_evidence_crop')
      .length,
    entries,
  };
}

function browserEvidenceCoverageSummaryForArtifact(artifact = {}, artifactId = '') {
  const provenance = objectValue(artifact.provenance);
  const provenanceSummary = cloneBrowserEvidenceCoverageSummary(
    provenance.browser_evidence_coverage_summary
      || provenance.browser_evidence_planning_coverage_summary,
  );
  if (provenanceSummary) {
    return {
      ...provenanceSummary,
      artifact_id: text(artifactId, 'artifact'),
      semantic_ref: ref('source-evidence', 'browser-evidence-coverage', artifactId),
      read_only: true,
      provenance_only: true,
    };
  }

  for (const file of arrayValue(artifact.files)) {
    const metadata = objectValue(file?.metadata);
    const summary = cloneBrowserEvidenceCoverageSummary(
      metadata.browser_evidence_coverage_summary
        || metadata.browser_evidence_planning_coverage_summary
        || metadata.coverage_summary,
    );
    if (summary) {
      return {
        ...summary,
        artifact_id: text(artifactId, 'artifact'),
        source_file_path: text(file.path) || null,
        semantic_ref: ref('source-evidence', 'browser-evidence-coverage', artifactId),
        read_only: true,
        provenance_only: true,
      };
    }
  }
  return null;
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
    linked_work_record_open: null,
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
  state.linked_work_record_open = null;
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
  state.linked_work_record_open = null;
  state.last_result = {
    type: 'artifact_bundle.select.result',
    schema_version: ARTIFACT_BUNDLE_WORKBENCH_SCHEMA_VERSION,
    status: 'selected',
    subject_id: state.subject.id,
    artifact_id: artifact.id,
  };
  return state.last_result;
}

export function createArtifactBundleWorkRecordOpenMessage(state = {}, {
  record = null,
} = {}) {
  const subject = normalizeSubject(state.subject);
  const artifact = artifactById(subject, state.selected_artifact_id);
  const workRecord = objectValue(artifact?.work_record);
  const openMessage = objectValue(workRecord.open_message);
  if (Object.keys(openMessage).length > 0) return cloneJson(openMessage);

  const embeddedRecord = objectValue(record || workRecord.record);
  if (Object.keys(embeddedRecord).length === 0) {
    throw new TypeError('linked Work Record payload is required before opening');
  }

  return {
    type: 'work_record.open',
    source: {
      kind: 'artifact_bundle_work_record',
      path: text(workRecord.path) || null,
      subject_id: text(subject.id),
      artifact_id: text(artifact?.id),
      read_only: true,
    },
    record: cloneJson(embeddedRecord),
  };
}

export function openArtifactBundleLinkedWorkRecord(state, {
  record = null,
  canvasId = '',
  canvas_id = canvasId,
} = {}) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('artifact bundle workbench state is required');
  }
  const subject = normalizeSubject(state.subject);
  const selectedArtifact = artifactById(subject, state.selected_artifact_id);
  const link = linkedWorkRecordForArtifact(subject, selectedArtifact, state.content_root);
  if (!link?.can_open) {
    state.linked_work_record_open = null;
    state.last_result = {
      type: ARTIFACT_BUNDLE_WORK_RECORD_OPEN_RESULT_TYPE,
      schema_version: ARTIFACT_BUNDLE_WORKBENCH_SCHEMA_VERSION,
      status: 'rejected',
      reason: 'linked_work_record_unavailable',
      artifact_id: text(selectedArtifact?.id) || null,
      record_id: link?.record_id || null,
    };
    return state.last_result;
  }

  const openMessage = createArtifactBundleWorkRecordOpenMessage(state, { record });
  const workbenchState = createWorkRecordWorkbenchState();
  const opened = openWorkRecord(workbenchState, openMessage);
  const snapshot = workRecordWorkbenchSnapshot(workbenchState);
  const childCanvasId = text(canvas_id, ARTIFACT_BUNDLE_WORK_RECORD_CANVAS_ID);
  state.linked_work_record_open = {
    type: ARTIFACT_BUNDLE_WORK_RECORD_OPEN_RESULT_TYPE,
    schema_version: ARTIFACT_BUNDLE_WORKBENCH_SCHEMA_VERSION,
    status: opened.status,
    artifact_id: text(selectedArtifact?.id) || null,
    record_id: text(opened.record_id),
    source: cloneJson(opened.source),
    read_only: snapshot.diagnostics.read_only === true,
    work_record_canvas_id: childCanvasId,
    open_message: cloneJson(openMessage),
    workbench_snapshot: snapshot,
  };
  state.last_result = {
    type: ARTIFACT_BUNDLE_WORK_RECORD_OPEN_RESULT_TYPE,
    schema_version: ARTIFACT_BUNDLE_WORKBENCH_SCHEMA_VERSION,
    status: opened.status,
    artifact_id: text(selectedArtifact?.id) || null,
    record_id: text(opened.record_id),
    read_only: snapshot.diagnostics.read_only === true,
    work_record_canvas_id: childCanvasId,
  };
  return state.last_result;
}

export function rejectArtifactBundleLinkedWorkRecordOpen(state, {
  artifactId = '',
  recordId = '',
  reason = 'linked_work_record_unavailable',
  message = '',
} = {}) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('artifact bundle workbench state is required');
  }
  state.last_result = {
    type: ARTIFACT_BUNDLE_WORK_RECORD_OPEN_RESULT_TYPE,
    schema_version: ARTIFACT_BUNDLE_WORKBENCH_SCHEMA_VERSION,
    status: 'rejected',
    reason: text(reason, 'linked_work_record_unavailable'),
    artifact_id: text(artifactId) || null,
    record_id: text(recordId) || null,
    message: text(message),
  };
  state.linked_work_record_open = null;
  return state.last_result;
}

export function artifactBundleWorkbenchSnapshot(state = {}) {
  const subject = normalizeSubject(state.subject);
  const artifacts = artifactBundleArtifacts(subject);
  const selectedArtifact = artifactById(subject, state.selected_artifact_id);
  const selectedId = text(selectedArtifact?.id);
  const selectedWorkRecordLink = linkedWorkRecordForArtifact(subject, selectedArtifact, state.content_root);
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
    selected_source_evidence_metadata: createSourceEvidenceMetadata(selectedArtifact),
    selected_work_record_link: selectedWorkRecordLink,
    selected_work_record_summary: createWorkRecordEvidenceSummary(selectedWorkRecordLink, state.linked_work_record_open),
    linked_work_record_open: state.linked_work_record_open ? cloneJson(state.linked_work_record_open) : null,
    diagnostics: artifactBundleDiagnostics(subject),
    subject_json: stableJson(subject),
    last_result: state.last_result ? cloneJson(state.last_result) : null,
  };
}
