import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  WORK_RECORD_REPAIR_BUNDLE_FORBIDDEN_EXACT_OUTPUTS,
  WORK_RECORD_REPAIR_BUNDLE_FORBIDDEN_OUTPUT_DIRS,
  WORK_RECORD_REPAIR_BUNDLE_INSPECTION_SCHEMA_VERSION,
  WORK_RECORD_REPAIR_BUNDLE_INSPECTION_TYPE,
  WORK_RECORD_REPAIR_BUNDLE_MANIFEST_TYPE,
  WORK_RECORD_REPAIR_BUNDLE_REQUIRED_MANIFEST_NON_EXECUTION_FLAGS,
  WORK_RECORD_REPAIR_BUNDLE_SCHEMA_VERSION,
} from './work-record-repair-bundle-policy.js';
import {
  WORK_RECORD_REPAIR_GUIDE_SCHEMA_VERSION,
  WORK_RECORD_REPAIR_GUIDE_TYPE,
} from './work-record-repair-guide.js';
import { buildInspectionRecoverySummary } from './work-record-recovery-summary.js';

export {
  WORK_RECORD_REPAIR_BUNDLE_INSPECTION_SCHEMA_VERSION,
  WORK_RECORD_REPAIR_BUNDLE_INSPECTION_TYPE,
};

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function rawText(value, fallback = '') {
  const raw = String(value ?? '');
  return raw || fallback;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function diagnostic(code, message, extra = {}) {
  return { severity: 'error', code, message, ...extra };
}

function digestFile(file) {
  return `sha256:${crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeRelativePath(value = '') {
  const relative = text(value);
  return !!relative && !path.isAbsolute(relative) && !relative.split(/[\\/]+/).includes('..');
}

function resolveReadPath(root, canonicalRoot, relativePath) {
  if (!safeRelativePath(relativePath)) {
    return { ok: false, diagnostic: diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_PATH_ESCAPE', 'Bundle paths must be relative and remain under the explicit bundle root.', { relative_path: text(relativePath) }) };
  }
  const absolutePath = path.resolve(root, relativePath);
  if (!isWithin(root, absolutePath)) {
    return { ok: false, diagnostic: diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_PATH_ESCAPE', 'Bundle path escaped the explicit bundle root.', { relative_path: relativePath, path: absolutePath }) };
  }
  let current = root;
  for (const part of path.relative(root, absolutePath).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) break;
    if (fs.lstatSync(current).isSymbolicLink()) {
      return { ok: false, diagnostic: diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_SYMLINK', 'Bundle inspection refuses symlinked paths.', { relative_path: relativePath, path: current }) };
    }
  }
  if (fs.existsSync(absolutePath) && !isWithin(canonicalRoot, fs.realpathSync(absolutePath))) {
    return { ok: false, diagnostic: diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_REALPATH_ESCAPE', 'Bundle path realpath escaped the canonical bundle root.', { relative_path: relativePath, path: absolutePath }) };
  }
  return { ok: true, absolutePath };
}

function readJson(file, code) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (error) {
    return { ok: false, diagnostic: diagnostic(code, `Could not read JSON: ${error.message}`, { path: file }) };
  }
}

function emptyEnvelope(bundleRoot = '') {
  return {
    type: WORK_RECORD_REPAIR_BUNDLE_INSPECTION_TYPE,
    schema_version: WORK_RECORD_REPAIR_BUNDLE_INSPECTION_SCHEMA_VERSION,
    status: 'blocked_missing_bundle',
    lifecycle_status: 'missing',
    bundle_root: rawText(bundleRoot),
    canonical_bundle_root: '',
    manifest: null,
    guide_report: null,
    artifacts: [],
    descriptors: [],
    safe_next_command: null,
    missing_inputs: [],
    missing_artifact_paths: [],
    diagnostics: [],
    inspector_ran_commands: false,
    inspector_mutated_bundle: false,
  };
}

const STATUS_RANK = Object.freeze({
  valid: 0,
  unsupported_schema: 2,
  blocked_descriptor_mismatch: 3,
  blocked_invalid_guide: 3,
  blocked_missing_artifact: 4,
  blocked_digest_mismatch: 5,
  blocked_invalid_manifest: 6,
  blocked_missing_manifest: 7,
  blocked_missing_bundle: 7,
  blocked_forbidden_artifact: 8,
  blocked_path_escape: 9,
});

function finish(envelope) {
  return { ...envelope, recovery_summary: buildInspectionRecoverySummary(envelope) };
}

function block(envelope, status, lifecycleStatus, item) {
  if ((STATUS_RANK[status] || 1) >= (STATUS_RANK[envelope.status] || 0)) {
    envelope.status = status;
    envelope.lifecycle_status = lifecycleStatus;
  }
  if (item) envelope.diagnostics.push(item);
}

function inspectDescriptor(descriptor, artifactByPath) {
  const diagnostics = [];
  const id = text(descriptor.id);
  if (!id) diagnostics.push(diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_DESCRIPTOR_ID_REQUIRED', 'Command descriptor requires an id.'));
  if (arrayValue(descriptor.argv).length === 0) diagnostics.push(diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_DESCRIPTOR_ARGV_REQUIRED', 'Command descriptor requires a non-empty argv.', { descriptor_id: id }));
  if (descriptor.executes_in_guide !== false || descriptor.not_run_by_bundle !== true) {
    diagnostics.push(diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_DESCRIPTOR_NON_EXECUTION_REQUIRED', 'Command descriptors must prove the guide and bundle did not execute them.', { descriptor_id: id }));
  }
  const missing = arrayValue(descriptor.requires_saved_output_from)
    .map(text)
    .filter((requiredPath) => !artifactByPath.get(requiredPath)?.digest_matches);
  return {
    id,
    status: diagnostics.length === 0 ? 'valid' : 'invalid',
    argv: arrayValue(descriptor.argv).map(String),
    mutates_state: descriptor.mutates_state === true,
    stdout_artifact: text(descriptor.stdout_artifact),
    save_stdout_to: text(descriptor.save_stdout_to),
    required_saved_outputs_present: missing.length === 0,
    missing_saved_outputs: missing,
    descriptor: cloneJson(descriptor),
    diagnostics,
  };
}

export function inspectWorkRecordRepairBundle({ bundleRoot = '' } = {}) {
  const root = path.resolve(rawText(bundleRoot));
  const envelope = emptyEnvelope(root);
  if (!bundleRoot || !fs.existsSync(root) || !fs.lstatSync(root).isDirectory()) {
    block(envelope, 'blocked_missing_bundle', 'missing', diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_ROOT_REQUIRED', 'Bundle root must exist and be a directory.', { bundle_root: root }));
    return finish(envelope);
  }
  if (fs.lstatSync(root).isSymbolicLink()) {
    block(envelope, 'blocked_path_escape', 'invalid', diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_ROOT_SYMLINK', 'Bundle root must not be a symlink.', { bundle_root: root }));
    return finish(envelope);
  }
  const canonicalRoot = fs.realpathSync(root);
  envelope.canonical_bundle_root = canonicalRoot;
  envelope.status = 'valid';
  envelope.lifecycle_status = 'ready';

  const manifestPath = resolveReadPath(root, canonicalRoot, 'bundle-manifest.json');
  if (!manifestPath.ok || !fs.existsSync(manifestPath.absolutePath)) {
    block(envelope, 'blocked_missing_manifest', 'missing', manifestPath.diagnostic || diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_MISSING_MANIFEST', 'bundle-manifest.json is required.'));
    return finish(envelope);
  }
  const manifestRead = readJson(manifestPath.absolutePath, 'WORK_RECORD_REPAIR_BUNDLE_INSPECT_INVALID_MANIFEST_JSON');
  if (!manifestRead.ok) {
    block(envelope, 'blocked_invalid_manifest', 'invalid', manifestRead.diagnostic);
    return finish(envelope);
  }
  const manifest = objectValue(manifestRead.value);
  envelope.manifest = {
    type: text(manifest.type),
    schema_version: text(manifest.schema_version),
    source_work_record: objectValue(manifest.bundle?.source_work_record),
    artifact_count: arrayValue(manifest.artifacts).length,
  };
  if (manifest.type !== WORK_RECORD_REPAIR_BUNDLE_MANIFEST_TYPE || manifest.schema_version !== WORK_RECORD_REPAIR_BUNDLE_SCHEMA_VERSION) {
    block(envelope, 'unsupported_schema', 'unsupported', diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_UNSUPPORTED_MANIFEST_SCHEMA', 'Bundle manifest type/schema is not active.', { type: text(manifest.type), schema_version: text(manifest.schema_version) }));
    return finish(envelope);
  }
  for (const flag of WORK_RECORD_REPAIR_BUNDLE_REQUIRED_MANIFEST_NON_EXECUTION_FLAGS) {
    if (manifest.non_execution_flags?.[flag] !== false) {
      block(envelope, 'blocked_invalid_manifest', 'invalid', diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_NON_EXECUTION_FLAG', 'Manifest non-execution flags must all be false.', { flag }));
    }
  }

  const artifactByPath = new Map();
  for (const entry of arrayValue(manifest.artifacts)) {
    const relativePath = rawText(entry.relative_path);
    const declaredPath = rawText(entry.path);
    if (artifactByPath.has(relativePath)) {
      block(envelope, 'blocked_invalid_manifest', 'invalid', diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_DUPLICATE_ARTIFACT', 'Manifest artifact paths must be unique.', { relative_path: relativePath }));
      continue;
    }
    const resolved = resolveReadPath(root, canonicalRoot, relativePath);
    const artifact = {
      relative_path: relativePath,
      path: declaredPath,
      artifact_kind: text(entry.artifact_kind),
      expected_digest: text(entry.digest),
      exists: resolved.ok && fs.existsSync(resolved.absolutePath),
      digest: '',
      digest_matches: false,
    };
    if (!resolved.ok) {
      block(envelope, 'blocked_path_escape', 'invalid', resolved.diagnostic);
    } else if (!declaredPath || !path.isAbsolute(declaredPath)) {
      block(envelope, 'blocked_invalid_manifest', 'invalid', diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_PATH_REQUIRED', 'Manifest artifact path must be the writer-emitted absolute path.', { relative_path: relativePath, path: declaredPath }));
    } else if (!isWithin(root, path.resolve(declaredPath))) {
      block(envelope, 'blocked_path_escape', 'invalid', diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_MANIFEST_PATH_ESCAPE', 'Manifest artifact path escaped the explicit bundle root.', { relative_path: relativePath, path: declaredPath }));
    } else if (declaredPath !== resolved.absolutePath) {
      block(envelope, 'blocked_invalid_manifest', 'invalid', diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_PATH_MISMATCH', 'Manifest artifact path must exactly match bundle_root plus relative_path.', { relative_path: relativePath, path: declaredPath, expected_path: resolved.absolutePath }));
    } else if (!artifact.exists || !fs.lstatSync(resolved.absolutePath).isFile()) {
      block(envelope, 'blocked_missing_artifact', 'missing', diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_MISSING_ARTIFACT', 'Manifest artifact is missing.', { relative_path: relativePath }));
    } else {
      artifact.digest = digestFile(resolved.absolutePath);
      artifact.digest_matches = artifact.digest === artifact.expected_digest;
      if (!artifact.digest_matches) {
        block(envelope, 'blocked_digest_mismatch', 'invalid', diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_DIGEST_MISMATCH', 'Manifest artifact digest does not match the file.', { relative_path: relativePath, expected_digest: artifact.expected_digest, actual_digest: artifact.digest }));
      }
    }
    artifactByPath.set(relativePath, artifact);
    envelope.artifacts.push(artifact);
  }

  for (const relativePath of WORK_RECORD_REPAIR_BUNDLE_FORBIDDEN_EXACT_OUTPUTS) {
    const resolved = resolveReadPath(root, canonicalRoot, relativePath);
    if (resolved.ok && fs.existsSync(resolved.absolutePath)) block(envelope, 'blocked_forbidden_artifact', 'invalid', diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_FORBIDDEN_ARTIFACT', 'Bundle contains an output this non-executing writer must not create.', { relative_path: relativePath }));
  }
  for (const relativePath of WORK_RECORD_REPAIR_BUNDLE_FORBIDDEN_OUTPUT_DIRS) {
    const resolved = resolveReadPath(root, canonicalRoot, relativePath);
    if (resolved.ok && fs.existsSync(resolved.absolutePath)) block(envelope, 'blocked_forbidden_artifact', 'invalid', diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_FORBIDDEN_ARTIFACT', 'Bundle contains an output directory this non-executing writer must not create.', { relative_path: `${relativePath}/**` }));
  }

  const guideArtifact = artifactByPath.get('guide-report.json');
  if (!guideArtifact?.digest_matches) {
    block(envelope, 'blocked_missing_artifact', 'missing', diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_GUIDE_REQUIRED', 'A verified guide-report.json is required.'));
    return finish(envelope);
  }
  const guideRead = readJson(path.join(root, 'guide-report.json'), 'WORK_RECORD_REPAIR_BUNDLE_INSPECT_INVALID_GUIDE_JSON');
  if (!guideRead.ok) {
    block(envelope, 'blocked_invalid_guide', 'invalid', guideRead.diagnostic);
    return finish(envelope);
  }
  const guide = objectValue(guideRead.value);
  envelope.guide_report = {
    type: text(guide.type),
    schema_version: text(guide.schema_version),
    current_stage: text(guide.current_stage),
    stage_status: text(guide.stage_status),
    why: text(guide.why),
    missing_inputs: arrayValue(guide.missing_inputs).map(text).filter(Boolean),
  };
  envelope.missing_inputs = [...envelope.guide_report.missing_inputs];
  if (guide.type !== WORK_RECORD_REPAIR_GUIDE_TYPE || guide.schema_version !== WORK_RECORD_REPAIR_GUIDE_SCHEMA_VERSION) {
    block(envelope, 'unsupported_schema', 'unsupported', diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_UNSUPPORTED_GUIDE_SCHEMA', 'Guide report type/schema is not active.', { type: text(guide.type), schema_version: text(guide.schema_version) }));
    return finish(envelope);
  }

  for (const artifact of envelope.artifacts.filter((item) => item.artifact_kind === 'command_descriptor' && item.digest_matches)) {
    const descriptorRead = readJson(path.join(root, artifact.relative_path), 'WORK_RECORD_REPAIR_BUNDLE_INSPECT_INVALID_DESCRIPTOR_JSON');
    if (!descriptorRead.ok) {
      block(envelope, 'blocked_descriptor_mismatch', 'invalid', descriptorRead.diagnostic);
      continue;
    }
    const summary = inspectDescriptor(objectValue(descriptorRead.value), artifactByPath);
    envelope.descriptors.push(summary);
    for (const item of summary.diagnostics) block(envelope, 'blocked_descriptor_mismatch', 'invalid', item);
  }

  const nextId = text(guide.safe_next_command?.id);
  const nextDescriptor = envelope.descriptors.find((item) => item.id === nextId);
  if (nextId && !nextDescriptor) {
    block(envelope, 'blocked_descriptor_mismatch', 'invalid', diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_NEXT_DESCRIPTOR_MISSING', 'Guide safe_next_command must match a verified command descriptor.', { descriptor_id: nextId }));
  } else if (nextDescriptor && canonicalJson(guide.safe_next_command) !== canonicalJson(nextDescriptor.descriptor)) {
    block(envelope, 'blocked_descriptor_mismatch', 'invalid', diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_NEXT_DESCRIPTOR_MISMATCH', 'Guide safe_next_command must exactly match the verified command descriptor artifact.', { descriptor_id: nextId }));
  }
  if (envelope.diagnostics.length === 0) {
    envelope.status = 'valid';
    envelope.lifecycle_status = envelope.missing_inputs.length > 0 || (nextDescriptor && !nextDescriptor.required_saved_outputs_present) ? 'blocked' : 'ready';
    envelope.safe_next_command = nextDescriptor ? cloneJson(nextDescriptor.descriptor) : null;
    envelope.missing_artifact_paths = nextDescriptor?.missing_saved_outputs || [];
  }
  return finish(envelope);
}
