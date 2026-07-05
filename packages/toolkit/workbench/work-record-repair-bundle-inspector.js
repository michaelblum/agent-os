import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  WORK_RECORD_REPAIR_BUNDLE_FORBIDDEN_EXACT_OUTPUTS,
  WORK_RECORD_REPAIR_BUNDLE_FORBIDDEN_OUTPUT_DIRS,
  WORK_RECORD_REPAIR_BUNDLE_INSPECTION_SCHEMA_VERSION,
  WORK_RECORD_REPAIR_BUNDLE_INSPECTION_TYPE,
  WORK_RECORD_REPAIR_BUNDLE_MANIFEST_TYPE,
  WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS,
  WORK_RECORD_REPAIR_BUNDLE_REQUIRED_MANIFEST_NON_EXECUTION_FLAGS,
  WORK_RECORD_REPAIR_BUNDLE_SCHEMA_VERSION,
} from './work-record-repair-bundle-policy.js';

export {
  WORK_RECORD_REPAIR_BUNDLE_INSPECTION_SCHEMA_VERSION,
  WORK_RECORD_REPAIR_BUNDLE_INSPECTION_TYPE,
};

const GUIDE_TYPE = 'work_record.repair_guided_recovery';
const GUIDE_SCHEMA_VERSION = '2026-07-work-record-repair-guided-recovery-v0';

const STATUS_RANK = Object.freeze({
  valid: 0,
  degraded: 1,
  unsupported_schema: 2,
  blocked_descriptor_mismatch: 3,
  blocked_missing_artifact: 4,
  blocked_digest_mismatch: 5,
  blocked_invalid_manifest: 6,
  blocked_missing_manifest: 7,
  blocked_forbidden_artifact: 8,
  blocked_path_escape: 9,
});

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

function diagnostic(code, message, extra = {}) {
  return {
    severity: 'error',
    code,
    message,
    ...extra,
  };
}

function sha256(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function digestFile(file) {
  return sha256(fs.readFileSync(file));
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function nearestExistingPath(absolutePath) {
  let current = absolutePath;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function symlinkAncestorViolation(absolutePath) {
  const parsed = path.parse(absolutePath);
  const parts = path.relative(parsed.root, absolutePath).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    current = path.join(current, parts[index]);
    if (!fs.existsSync(current)) break;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      if (index > 0) return { path: current, reason: 'symlink_ancestor' };
      continue;
    }
    if (!stat.isDirectory()) return { path: current, reason: 'parent_not_directory' };
  }
  return null;
}

function relativePathStatus(relativePath = '') {
  const relative = text(relativePath);
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]+/).includes('..')) {
    return { ok: false, relative, code: 'WORK_RECORD_REPAIR_BUNDLE_INSPECT_PATH_TRAVERSAL' };
  }
  return { ok: true, relative };
}

function resolveBundleReadPath(root, canonicalRoot, relativePath) {
  const relativeStatus = relativePathStatus(relativePath);
  if (!relativeStatus.ok) {
    return {
      ok: false,
      status: 'blocked_path_escape',
      diagnostics: [diagnostic(relativeStatus.code, 'Bundle paths must be relative paths under the explicit bundle root.', { relative_path: relativeStatus.relative })],
    };
  }
  const absolutePath = path.resolve(root, relativeStatus.relative);
  if (!isWithin(root, absolutePath)) {
    return {
      ok: false,
      status: 'blocked_path_escape',
      diagnostics: [diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_PATH_ESCAPE', 'Bundle path escaped the explicit bundle root.', { relative_path: relativeStatus.relative, path: absolutePath })],
    };
  }

  let current = root;
  const parts = path.relative(root, absolutePath).split(path.sep).filter(Boolean);
  for (const part of parts) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) break;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      return {
        ok: false,
        status: 'blocked_path_escape',
        diagnostics: [diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_SYMLINK', 'Inspector refuses to read bundle paths that are symlinks or pass through symlinks.', { relative_path: relativeStatus.relative, path: current })],
      };
    }
  }

  const nearest = nearestExistingPath(absolutePath);
  if (fs.existsSync(nearest)) {
    const real = fs.realpathSync(nearest);
    if (!isWithin(canonicalRoot, real)) {
      return {
        ok: false,
        status: 'blocked_path_escape',
        diagnostics: [diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_REALPATH_ESCAPE', 'Bundle path realpath escaped the canonical bundle root.', { relative_path: relativeStatus.relative, path: nearest, realpath: real })],
      };
    }
  }
  return { ok: true, relativePath: relativeStatus.relative, absolutePath, diagnostics: [] };
}

function resolveManifestArtifactPath(root, canonicalRoot, artifactPath, expectedPath, relativePath) {
  const manifestPath = text(artifactPath);
  if (!manifestPath) {
    return {
      ok: false,
      status: 'blocked_invalid_manifest',
      diagnostics: [diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_MANIFEST_PATH_REQUIRED', 'Manifest artifact path is required.', { relative_path: relativePath })],
    };
  }
  const absolutePath = path.isAbsolute(manifestPath)
    ? path.resolve(manifestPath)
    : path.resolve(root, manifestPath);
  const contained = fs.existsSync(absolutePath)
    ? isWithin(canonicalRoot, fs.realpathSync(absolutePath))
    : isWithin(root, absolutePath);
  if (!contained) {
    return {
      ok: false,
      status: 'blocked_path_escape',
      diagnostics: [diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_MANIFEST_PATH_ESCAPE', 'Manifest artifact path must stay under the canonical bundle root.', { relative_path: relativePath, path: manifestPath, resolved_path: absolutePath })],
    };
  }
  if (path.normalize(absolutePath) !== path.normalize(expectedPath)) {
    return {
      ok: false,
      status: 'blocked_path_escape',
      diagnostics: [diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_MANIFEST_PATH_MISMATCH', 'Manifest artifact path must match the writer-owned path resolved from relative_path.', { relative_path: relativePath, manifest_path: manifestPath, resolved_manifest_path: absolutePath, expected_path: expectedPath })],
    };
  }
  return { ok: true, absolutePath, diagnostics: [] };
}

function validateManifestNonExecutionFlags(envelope, manifest = {}) {
  const flags = manifest.non_execution_flags;
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) {
    addDiagnostics(envelope, 'blocked_invalid_manifest', [
      diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_MANIFEST_EXECUTION_FLAG_MISSING', 'Manifest non_execution_flags object is required.', { flag: 'non_execution_flags', value: flags ?? null }),
    ]);
    return;
  }
  const diagnostics = [];
  for (const flag of WORK_RECORD_REPAIR_BUNDLE_REQUIRED_MANIFEST_NON_EXECUTION_FLAGS) {
    if (!Object.hasOwn(flags, flag)) {
      diagnostics.push(diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_MANIFEST_EXECUTION_FLAG_MISSING', 'Manifest non-execution flag is required and must be boolean false.', { flag }));
    } else if (flags[flag] !== false) {
      diagnostics.push(diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_MANIFEST_EXECUTION_FLAG', 'Manifest non-execution flag must be boolean false.', { flag, value: flags[flag] }));
    }
  }
  for (const [flag, value] of Object.entries(flags)) {
    if (WORK_RECORD_REPAIR_BUNDLE_REQUIRED_MANIFEST_NON_EXECUTION_FLAGS.includes(flag)) continue;
    if (value === true || typeof value !== 'boolean') {
      diagnostics.push(diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_MANIFEST_EXECUTION_FLAG_UNKNOWN', 'Unknown manifest non-execution flag must not make execution, write, live, or replay claims.', { flag, value }));
    }
  }
  if (diagnostics.length > 0) addDiagnostics(envelope, 'blocked_invalid_manifest', diagnostics);
}

function readJsonReadOnly(file, code) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [diagnostic(code, `Invalid JSON: ${error.message}`, { path: file })],
    };
  }
}

function initialEnvelope(bundleRoot, canonicalBundleRoot = '') {
  return {
    type: WORK_RECORD_REPAIR_BUNDLE_INSPECTION_TYPE,
    schema_version: WORK_RECORD_REPAIR_BUNDLE_INSPECTION_SCHEMA_VERSION,
    status: 'valid',
    bundle_root: path.resolve(text(bundleRoot)),
    canonical_bundle_root: canonicalBundleRoot,
    manifest: null,
    guide_report: null,
    artifacts: [],
    descriptors: [],
    continuation: {
      current_guide_stage: '',
      stage_status: '',
      safe_next_descriptor_id: '',
      argv: [],
      command: '',
      required_saved_outputs_present: false,
      missing_artifact_paths: [],
      requires_human_approval: false,
      would_mutate_state: false,
      inspector_ran_command: false,
      reminder: 'Inspector did not run the command.',
    },
    diagnostics: [],
    non_execution_flags: { ...WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS },
  };
}

function mergeStatus(current, next) {
  return (STATUS_RANK[next] ?? 0) > (STATUS_RANK[current] ?? 0) ? next : current;
}

function addDiagnostics(envelope, status, diagnostics = []) {
  envelope.status = mergeStatus(envelope.status, status);
  envelope.diagnostics.push(...diagnostics);
}

function rootEnvelope(bundleRoot) {
  const resolved = path.resolve(text(bundleRoot));
  const envelope = initialEnvelope(resolved);
  if (!bundleRoot) {
    addDiagnostics(envelope, 'blocked_missing_manifest', [
      diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_ROOT_REQUIRED', 'inspect requires <bundle-root>.', { path: 'bundle_root' }),
    ]);
    return { envelope, ok: false };
  }
  const ancestor = symlinkAncestorViolation(resolved);
  if (ancestor?.reason === 'symlink_ancestor') {
    addDiagnostics(envelope, 'blocked_path_escape', [
      diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_ROOT_SYMLINK_ANCESTOR', 'Bundle root must not be reached through a symlinked ancestor.', { path: ancestor.path }),
    ]);
    return { envelope, ok: false };
  }
  if (ancestor?.reason === 'parent_not_directory') {
    addDiagnostics(envelope, 'blocked_path_escape', [
      diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_ROOT_PARENT_NOT_DIRECTORY', 'Bundle root parent path must be a directory.', { path: ancestor.path }),
    ]);
    return { envelope, ok: false };
  }
  if (!fs.existsSync(resolved)) {
    addDiagnostics(envelope, 'blocked_missing_manifest', [
      diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_ROOT_NOT_FOUND', 'Bundle root does not exist.', { path: resolved }),
    ]);
    return { envelope, ok: false };
  }
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink()) {
    addDiagnostics(envelope, 'blocked_path_escape', [
      diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_ROOT_SYMLINK', 'Bundle root must not be a symlink.', { path: resolved }),
    ]);
    return { envelope, ok: false };
  }
  if (!stat.isDirectory()) {
    addDiagnostics(envelope, 'blocked_missing_manifest', [
      diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_ROOT_NOT_DIRECTORY', 'Bundle root must be a directory.', { path: resolved }),
    ]);
    return { envelope, ok: false };
  }
  envelope.canonical_bundle_root = fs.realpathSync(resolved);
  return { envelope, ok: true, root: resolved, canonicalRoot: envelope.canonical_bundle_root };
}

function artifactSummary(artifact = {}, relativePath = '') {
  return {
    relative_path: relativePath || text(artifact.relative_path),
    artifact_kind: text(artifact.artifact_kind),
    digest: text(artifact.digest),
    exists: false,
    digest_matches: false,
    status: 'missing',
  };
}

function validateArtifact({ envelope, root, canonicalRoot, artifact, plannedOnlyPaths }) {
  const summary = artifactSummary(artifact);
  const resolved = resolveBundleReadPath(root, canonicalRoot, artifact.relative_path);
  if (!resolved.ok) {
    summary.status = 'blocked_path_escape';
    envelope.artifacts.push(summary);
    addDiagnostics(envelope, resolved.status, resolved.diagnostics);
    return null;
  }
  summary.relative_path = resolved.relativePath;
  const manifestPath = resolveManifestArtifactPath(root, canonicalRoot, artifact.path, resolved.absolutePath, resolved.relativePath);
  if (!manifestPath.ok) addDiagnostics(envelope, manifestPath.status, manifestPath.diagnostics);
  const plannedOnly = plannedOnlyPaths.has(resolved.relativePath);
  const exists = fs.existsSync(resolved.absolutePath);
  summary.exists = exists;
  if (!exists) {
    summary.status = plannedOnly ? 'planned_only_missing' : 'missing';
    envelope.artifacts.push(summary);
    if (!plannedOnly) {
      addDiagnostics(envelope, 'blocked_missing_artifact', [
        diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_MISSING_ARTIFACT', 'Manifest artifact file is missing.', { relative_path: resolved.relativePath }),
      ]);
    }
    return { summary, resolved, plannedOnly };
  }
  const stat = fs.lstatSync(resolved.absolutePath);
  if (!stat.isFile()) {
    summary.status = 'not_file';
    envelope.artifacts.push(summary);
    addDiagnostics(envelope, 'blocked_path_escape', [
      diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_ARTIFACT_NOT_FILE', 'Manifest artifact path must be a regular file.', { relative_path: resolved.relativePath, path: resolved.absolutePath }),
    ]);
    return { summary, resolved, plannedOnly };
  }
  summary.actual_digest = digestFile(resolved.absolutePath);
  summary.digest_matches = summary.actual_digest === text(artifact.digest);
  summary.status = summary.digest_matches ? (plannedOnly ? 'planned_only_present' : 'materialized') : 'digest_mismatch';
  envelope.artifacts.push(summary);
  if (!summary.digest_matches) {
    addDiagnostics(envelope, 'blocked_digest_mismatch', [
      diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_DIGEST_MISMATCH', 'Artifact digest does not match the manifest.', { relative_path: resolved.relativePath, expected_digest: text(artifact.digest), actual_digest: summary.actual_digest }),
    ]);
  }
  return { summary, resolved, plannedOnly };
}

function guideDescriptorIds(report = {}) {
  return [
    objectValue(report.next_explicit_command),
    ...arrayValue(report.alternative_explicit_commands).map(objectValue),
  ].map((descriptor) => text(descriptor.id)).filter(Boolean);
}

function expectedDescriptorPath(id = '') {
  const safe = text(id, 'descriptor').replace(/[^A-Za-z0-9._-]+/g, '-');
  return `commands/${safe || 'descriptor'}.json`;
}

function validateDescriptor(envelope, descriptor, descriptorPath, artifactByPath) {
  const summary = {
    id: text(descriptor.id),
    relative_path: descriptorPath,
    status: 'valid',
    argv: arrayValue(descriptor.argv),
    command: text(descriptor.command),
    mutates_state: descriptor.mutates_state === true,
    requires_approval: descriptor.requires_approval === true,
    bundle_artifact_status: text(descriptor.bundle_artifact_status),
    save_stdout_to: text(descriptor.save_stdout_to),
    required_saved_outputs_present: true,
    missing_saved_outputs: [],
  };
  const errors = [];
  if (!summary.id) errors.push(diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_DESCRIPTOR_ID_REQUIRED', 'Descriptor requires id.', { relative_path: descriptorPath }));
  if (summary.argv.length === 0 || !summary.argv.every((item) => typeof item === 'string')) {
    errors.push(diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_DESCRIPTOR_ARGV_REQUIRED', 'Descriptor requires string argv array.', { descriptor_id: summary.id, relative_path: descriptorPath }));
  }
  if (!summary.command) errors.push(diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_DESCRIPTOR_COMMAND_REQUIRED', 'Descriptor requires command string.', { descriptor_id: summary.id, relative_path: descriptorPath }));
  if (descriptor.not_run_by_guide !== true) errors.push(diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_DESCRIPTOR_NOT_RUN_BY_GUIDE_REQUIRED', 'Descriptor must preserve not_run_by_guide:true.', { descriptor_id: summary.id, relative_path: descriptorPath }));
  if (descriptor.not_run_by_bundle !== true) errors.push(diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_DESCRIPTOR_NOT_RUN_BY_BUNDLE_REQUIRED', 'Descriptor must preserve not_run_by_bundle:true.', { descriptor_id: summary.id, relative_path: descriptorPath }));

  const stdoutPath = text(descriptor.stdout_artifact?.path);
  if (stdoutPath && text(descriptor.save_stdout_to) !== stdoutPath) {
    errors.push(diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_DESCRIPTOR_STDOUT_MISMATCH', 'Descriptor stdout_artifact.path and save_stdout_to must match.', { descriptor_id: summary.id, stdout_path: stdoutPath, save_stdout_to: text(descriptor.save_stdout_to) }));
  }
  const status = text(descriptor.bundle_artifact_status);
  if (stdoutPath && status === 'materialized') {
    const artifact = artifactByPath.get(stdoutPath);
    if (!artifact?.exists || artifact?.digest_matches !== true) {
      errors.push(diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_DESCRIPTOR_MATERIALIZED_MISSING', 'Descriptor says materialized but artifact is missing or digest-mismatched.', { descriptor_id: summary.id, relative_path: stdoutPath }));
    }
  }
  if (stdoutPath && status === 'planned_only') {
    const artifact = artifactByPath.get(stdoutPath);
    if (artifact?.exists === true) {
      errors.push(diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_DESCRIPTOR_PLANNED_ONLY_PRESENT', 'Descriptor says planned_only but artifact file exists.', { descriptor_id: summary.id, relative_path: stdoutPath }));
    }
  }

  for (const requirement of arrayValue(descriptor.requires_saved_output_from).map(objectValue)) {
    const requiredPath = text(requirement.path);
    const artifact = artifactByPath.get(requiredPath);
    if (!requiredPath || !artifact?.exists || artifact?.digest_matches !== true) {
      summary.required_saved_outputs_present = false;
      summary.missing_saved_outputs.push(requiredPath);
    }
  }

  if (errors.length > 0) {
    summary.status = 'blocked_descriptor_mismatch';
    addDiagnostics(envelope, 'blocked_descriptor_mismatch', errors);
  }
  envelope.descriptors.push(summary);
  return summary;
}

function forbiddenArtifacts(root, canonicalRoot) {
  const found = [];
  const diagnostics = [];
  for (const relative of WORK_RECORD_REPAIR_BUNDLE_FORBIDDEN_EXACT_OUTPUTS) {
    const resolved = resolveBundleReadPath(root, canonicalRoot, relative);
    if (!resolved.ok) diagnostics.push(...resolved.diagnostics);
    if (resolved.ok && fs.existsSync(resolved.absolutePath)) found.push(relative);
  }
  for (const relative of WORK_RECORD_REPAIR_BUNDLE_FORBIDDEN_OUTPUT_DIRS) {
    const resolved = resolveBundleReadPath(root, canonicalRoot, relative);
    if (!resolved.ok) diagnostics.push(...resolved.diagnostics);
    if (resolved.ok && fs.existsSync(resolved.absolutePath)) found.push(`${relative}/**`);
  }
  for (const name of fs.readdirSync(root)) {
    if (/^gate-(record|response).*\.json$/.test(name)) found.push(name);
  }
  return { found, diagnostics };
}

function plannedOnlyArtifactPathsFromDescriptors(descriptors = []) {
  return new Set(descriptors
    .filter((descriptor) => text(descriptor.bundle_artifact_status) === 'planned_only')
    .map((descriptor) => text(descriptor.stdout_artifact?.path))
    .filter(Boolean));
}

function deriveContinuation(envelope, guide, descriptorById) {
  const next = objectValue(guide.next_explicit_command);
  const descriptor = descriptorById.get(text(next.id)) || next;
  const summary = envelope.descriptors.find((item) => item.id === text(descriptor.id)) || null;
  const missing = summary?.missing_saved_outputs || [];
  envelope.continuation = {
    current_guide_stage: text(guide.current_stage),
    stage_status: text(guide.stage_status),
    safe_next_descriptor_id: text(descriptor.id),
    argv: arrayValue(descriptor.argv),
    command: text(descriptor.command),
    required_saved_outputs_present: missing.length === 0,
    missing_artifact_paths: missing,
    requires_human_approval: descriptor.requires_approval === true,
    would_mutate_state: descriptor.mutates_state === true,
    inspector_ran_command: false,
    reminder: 'Inspector did not run the command.',
  };
}

export function inspectWorkRecordRepairBundle({ bundleRoot = '' } = {}) {
  const rootResult = rootEnvelope(bundleRoot);
  const { envelope } = rootResult;
  if (!rootResult.ok) return envelope;
  const { root, canonicalRoot } = rootResult;

  const manifestResolved = resolveBundleReadPath(root, canonicalRoot, 'bundle-manifest.json');
  if (!manifestResolved.ok) {
    addDiagnostics(envelope, manifestResolved.status, manifestResolved.diagnostics);
    return envelope;
  }
  if (!fs.existsSync(manifestResolved.absolutePath)) {
    addDiagnostics(envelope, 'blocked_missing_manifest', [
      diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_MISSING_MANIFEST', 'bundle-manifest.json is required.', { relative_path: 'bundle-manifest.json' }),
    ]);
    return envelope;
  }
  const manifestRead = readJsonReadOnly(manifestResolved.absolutePath, 'WORK_RECORD_REPAIR_BUNDLE_INSPECT_INVALID_MANIFEST_JSON');
  if (!manifestRead.ok) {
    addDiagnostics(envelope, 'blocked_invalid_manifest', manifestRead.diagnostics);
    return envelope;
  }
  const manifest = objectValue(manifestRead.value);
  envelope.manifest = {
    type: text(manifest.type),
    schema_version: text(manifest.schema_version),
    artifact_count: arrayValue(manifest.artifacts).length,
  };
  if (manifest.type !== WORK_RECORD_REPAIR_BUNDLE_MANIFEST_TYPE || manifest.schema_version !== WORK_RECORD_REPAIR_BUNDLE_SCHEMA_VERSION) {
    addDiagnostics(envelope, 'unsupported_schema', [
      diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_UNSUPPORTED_MANIFEST_SCHEMA', 'Bundle manifest type/schema is not recognized.', { type: text(manifest.type), schema_version: text(manifest.schema_version) }),
    ]);
  }
  validateManifestNonExecutionFlags(envelope, manifest);

  const forbidden = forbiddenArtifacts(root, canonicalRoot);
  if (forbidden.diagnostics.length > 0) addDiagnostics(envelope, 'blocked_path_escape', forbidden.diagnostics);
  if (forbidden.found.length > 0) {
    addDiagnostics(envelope, 'blocked_forbidden_artifact', [
      diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_FORBIDDEN_ARTIFACT', 'Bundle contains forbidden bundle-owned outputs.', { relative_paths: forbidden.found }),
    ]);
  }

  const guideResolved = resolveBundleReadPath(root, canonicalRoot, 'guide-report.json');
  if (!guideResolved.ok) addDiagnostics(envelope, guideResolved.status, guideResolved.diagnostics);
  if (!guideResolved.ok || !fs.existsSync(guideResolved.absolutePath)) {
    addDiagnostics(envelope, 'blocked_missing_artifact', [
      diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_MISSING_GUIDE_REPORT', 'guide-report.json is required.', { relative_path: 'guide-report.json' }),
    ]);
    return envelope;
  }
  const guideRead = readJsonReadOnly(guideResolved.absolutePath, 'WORK_RECORD_REPAIR_BUNDLE_INSPECT_INVALID_GUIDE_JSON');
  if (!guideRead.ok) {
    addDiagnostics(envelope, 'blocked_invalid_manifest', guideRead.diagnostics);
    return envelope;
  }
  const guide = objectValue(guideRead.value);
  envelope.guide_report = {
    type: text(guide.type),
    schema_version: text(guide.schema_version),
    status: text(guide.status),
    current_stage: text(guide.current_stage),
    stage_status: text(guide.stage_status),
  };
  if (guide.type !== GUIDE_TYPE || guide.schema_version !== GUIDE_SCHEMA_VERSION) {
    addDiagnostics(envelope, 'unsupported_schema', [
      diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_UNSUPPORTED_GUIDE_SCHEMA', 'Guide report type/schema is not recognized.', { type: text(guide.type), schema_version: text(guide.schema_version) }),
    ]);
  }
  for (const [key, value] of Object.entries(objectValue(guide.non_execution_flags))) {
    if (WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS[key] === false && value !== false) {
      addDiagnostics(envelope, 'blocked_invalid_manifest', [
        diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_GUIDE_EXECUTION_FLAG', 'Guide report non-execution flag must remain false.', { flag: key, value }),
      ]);
    }
  }

  const descriptorPaths = new Set(guideDescriptorIds(guide).map(expectedDescriptorPath));
  for (const artifact of arrayValue(manifest.artifacts).map(objectValue)) {
    if (text(artifact.artifact_kind) === 'command_descriptor') descriptorPaths.add(text(artifact.relative_path));
  }
  if (descriptorPaths.size === 0) {
    addDiagnostics(envelope, 'blocked_descriptor_mismatch', [
      diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_NO_DESCRIPTORS', 'At least one command descriptor is required under commands/*.json.'),
    ]);
  }

  const descriptorObjects = [];
  const manifestDescriptorArtifacts = new Set();
  for (const relative of descriptorPaths) {
    if (!relative.startsWith('commands/') || !relative.endsWith('.json')) {
      addDiagnostics(envelope, 'blocked_descriptor_mismatch', [
        diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_DESCRIPTOR_PATH', 'Descriptor files must live under commands/*.json.', { relative_path: relative }),
      ]);
      continue;
    }
    const resolved = resolveBundleReadPath(root, canonicalRoot, relative);
    if (!resolved.ok) {
      addDiagnostics(envelope, resolved.status, resolved.diagnostics);
      continue;
    }
    if (!fs.existsSync(resolved.absolutePath)) {
      addDiagnostics(envelope, 'blocked_missing_artifact', [
        diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_MISSING_DESCRIPTOR', 'Command descriptor file is missing.', { relative_path: relative }),
      ]);
      continue;
    }
    const read = readJsonReadOnly(resolved.absolutePath, 'WORK_RECORD_REPAIR_BUNDLE_INSPECT_INVALID_DESCRIPTOR_JSON');
    if (!read.ok) {
      addDiagnostics(envelope, 'blocked_descriptor_mismatch', read.diagnostics);
      continue;
    }
    descriptorObjects.push({ relative, descriptor: objectValue(read.value) });
    manifestDescriptorArtifacts.add(relative);
  }

  const plannedOnlyPaths = plannedOnlyArtifactPathsFromDescriptors(descriptorObjects.map((item) => item.descriptor));
  const artifactByPath = new Map();
  const manifestArtifacts = arrayValue(manifest.artifacts).map(objectValue);
  for (const artifact of manifestArtifacts) {
    const result = validateArtifact({ envelope, root, canonicalRoot, artifact, plannedOnlyPaths });
    if (result?.summary) artifactByPath.set(result.summary.relative_path, result.summary);
  }
  for (const relative of manifestDescriptorArtifacts) {
    if (!artifactByPath.has(relative)) {
      addDiagnostics(envelope, 'blocked_descriptor_mismatch', [
        diagnostic('WORK_RECORD_REPAIR_BUNDLE_INSPECT_DESCRIPTOR_NOT_IN_MANIFEST', 'Descriptor file is not listed in manifest artifacts.', { relative_path: relative }),
      ]);
    }
  }

  const descriptorById = new Map();
  for (const { relative, descriptor } of descriptorObjects) {
    const summary = validateDescriptor(envelope, descriptor, relative, artifactByPath);
    if (summary.id) descriptorById.set(summary.id, descriptor);
  }
  deriveContinuation(envelope, guide, descriptorById);

  if (envelope.status === 'valid' && envelope.diagnostics.length > 0) envelope.status = 'degraded';
  return envelope;
}
