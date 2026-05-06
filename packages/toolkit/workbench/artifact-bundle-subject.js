import { createWorkbenchSubject } from './subject.js';

export const ARTIFACT_BUNDLE_SUBJECT_TYPE = 'aos.artifact_bundle';
export const ARTIFACT_BUNDLE_OWNER = 'aos-artifact-workbench';
export const ARTIFACT_BUNDLE_WORKBENCH_URL = 'aos://toolkit/components/artifact-bundle-workbench/index.html';

const ARTIFACT_BUNDLE_CONTRACTS = Object.freeze([
  'artifact_bundle.gallery.view',
  'artifact_bundle.preview.view',
  'artifact_bundle.source.view',
  'artifact_bundle.exports.view',
  'artifact_bundle.provenance.view',
  'artifact_bundle.validation.view',
  'work_record.evidence.view',
]);

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function textList(values = []) {
  return arrayValue(values).map((value) => text(value)).filter(Boolean);
}

function uniqueTextList(values = []) {
  return [...new Set(textList(values))];
}

function artifactWorkbenchHost(facet = '', preferred = false) {
  return {
    kind: 'canvas',
    target_dialect: 'canvas',
    entry: {
      kind: 'aos-url',
      value: ARTIFACT_BUNDLE_WORKBENCH_URL,
      ...(facet ? { facet } : {}),
    },
    ...(preferred ? { preferred: true } : {}),
  };
}

function rendererId(artifact = {}) {
  return text(artifact.renderer_id || artifact.renderer?.id || artifact.renderer);
}

function artifactKind(artifact = {}) {
  return text(artifact.kind, 'artifact');
}

function artifactValidationState(artifact = {}) {
  return text(artifact.validation?.state || artifact.validation_state);
}

function normalizeArtifact(artifact = {}) {
  const value = objectValue(artifact);
  const id = text(value.id || value.entry || value.path);
  if (!id) return null;
  return {
    ...cloneJson(value),
    id,
    kind: artifactKind(value),
    label: text(value.label || value.title, id),
    entry: text(value.entry || value.path),
    files: arrayValue(value.files).map((file) => cloneJson(objectValue(file))),
    exports: arrayValue(value.exports).map((item) => cloneJson(objectValue(item))),
    validation: objectValue(value.validation),
  };
}

function normalizeArtifacts(artifacts = []) {
  return arrayValue(artifacts).map(normalizeArtifact).filter(Boolean);
}

function validationStateForArtifacts(artifacts = []) {
  const states = uniqueTextList(artifacts.map(artifactValidationState));
  if (states.length === 0) return 'unknown';
  if (states.includes('failed')) return 'failed';
  if (states.includes('blocked')) return 'blocked';
  if (states.includes('unchecked')) return 'unchecked';
  if (states.every((state) => state === 'valid')) return 'valid';
  return states[0];
}

function defaultArtifactBundleFacets() {
  return [
    {
      key: 'artifact_bundle.gallery',
      layer: 'artifacts',
      label: 'Artifact Gallery',
      capabilities: ['inspectable', 'exportable'],
      contracts: ['artifact_bundle.gallery.view'],
      hosts: [artifactWorkbenchHost('artifact_bundle.gallery', true)],
    },
    {
      key: 'artifact_bundle.preview',
      layer: 'artifacts',
      label: 'Preview',
      capabilities: ['inspectable'],
      contracts: ['artifact_bundle.preview.view'],
      hosts: [artifactWorkbenchHost('artifact_bundle.preview')],
    },
    {
      key: 'artifact_bundle.source',
      layer: 'descriptor',
      label: 'Source Files',
      capabilities: ['inspectable'],
      contracts: ['artifact_bundle.source.view', 'artifact_bundle.exports.view'],
      hosts: [artifactWorkbenchHost('artifact_bundle.source')],
    },
    {
      key: 'artifact_bundle.provenance',
      layer: 'descriptor',
      label: 'Provenance',
      source_ref: 'origin-work-record',
      capabilities: ['inspectable'],
      contracts: ['artifact_bundle.provenance.view', 'work_record.evidence.view'],
      hosts: [artifactWorkbenchHost('artifact_bundle.provenance')],
    },
    {
      key: 'artifact_bundle.validation',
      layer: 'health',
      label: 'Validation',
      capabilities: ['inspectable', 'verifier-target'],
      contracts: ['artifact_bundle.validation.view'],
      hosts: [artifactWorkbenchHost('artifact_bundle.validation')],
    },
  ];
}

function defaultArtifactBundleReferences(bundle = {}) {
  const references = arrayValue(bundle.subject_references);
  if (references.length > 0) return references;
  const workRecordId = text(bundle.work_record_id || bundle.provenance?.work_record_id);
  if (!workRecordId) return [];
  return [{
    id: 'origin-work-record',
    relationship: 'generated_by',
    handle: workRecordId,
    subject_id: workRecordId,
    subject_type: 'aos.work_record',
    facet_key: 'work_record.evidence',
    layer: 'artifacts',
    role: 'provenance',
  }];
}

function sourceForBundle(bundle = {}) {
  const source = objectValue(bundle.source);
  if (text(source.kind)) return source;
  return {
    kind: 'repo_folder',
    path: text(bundle.source_path || bundle.path),
    entry: text(bundle.source_entry || 'subject.json'),
  };
}

export function artifactBundleArtifacts(subject = {}) {
  return normalizeArtifacts(subject.artifacts);
}

export function artifactBundleSummary(subject = {}) {
  const artifacts = artifactBundleArtifacts(subject);
  return {
    artifact_count: artifacts.length,
    artifact_kinds: uniqueTextList(artifacts.map((artifact) => artifact.kind)),
    renderer_ids: uniqueTextList(artifacts.map(rendererId)),
    export_count: artifacts.reduce((count, artifact) => count + arrayValue(artifact.exports).length, 0),
    validation_state: validationStateForArtifacts(artifacts),
  };
}

export function createArtifactBundleSubject(bundle = {}) {
  const value = objectValue(bundle);
  const id = text(value.id, 'artifact-bundle:untitled');
  const artifacts = normalizeArtifacts(value.artifacts);
  const summary = artifactBundleSummary({ artifacts });

  return createWorkbenchSubject({
    id,
    type: ARTIFACT_BUNDLE_SUBJECT_TYPE,
    label: text(value.label || value.title, id),
    owner: text(value.owner, ARTIFACT_BUNDLE_OWNER),
    source: sourceForBundle(value),
    capabilities: uniqueTextList([
      'inspectable',
      'exportable',
      ...(summary.validation_state && summary.validation_state !== 'unknown' ? ['verifier-target'] : []),
      ...arrayValue(value.capabilities),
    ]),
    contracts: uniqueTextList([
      ...ARTIFACT_BUNDLE_CONTRACTS,
      ...arrayValue(value.contracts),
    ]),
    subject_references: defaultArtifactBundleReferences(value),
    facets: arrayValue(value.facets).length > 0 ? arrayValue(value.facets) : defaultArtifactBundleFacets(),
    persistence: null,
    artifacts,
    state: {
      ...objectValue(value.state),
      ...summary,
      read_only: true,
    },
    metadata: {
      ...objectValue(value.metadata),
      scope: text(value.metadata?.scope, 'artifact_bundle_subject_v0'),
    },
  });
}
