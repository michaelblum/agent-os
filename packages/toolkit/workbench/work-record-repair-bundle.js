import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  guideWorkRecordRepair,
} from './work-record-repair-guide.js';
import {
  planWorkRecordRepair,
} from './work-record-repair-plan.js';
import {
  planWorkRecordRepairAttempt,
} from './work-record-repair-attempt-plan.js';
import {
  WORK_RECORD_REPAIR_BUNDLE_IMPLEMENTATION_VERSION,
  WORK_RECORD_REPAIR_BUNDLE_MANIFEST_TYPE,
  WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS,
  WORK_RECORD_REPAIR_BUNDLE_SCHEMA_VERSION,
  WORK_RECORD_REPAIR_BUNDLE_TYPE,
} from './work-record-repair-bundle-policy.js';
import {
  commandHintFromArgv,
  shellQuoteArg,
} from './work-record-command-recommendation.js';
import {
  buildBundleRecoverySummary,
} from './work-record-recovery-summary.js';
import {
  inspectTextFileDestination,
  publishTextFileIfAbsent,
} from './work-record-atomic-publish.js';

export {
  WORK_RECORD_REPAIR_BUNDLE_IMPLEMENTATION_VERSION,
  WORK_RECORD_REPAIR_BUNDLE_SCHEMA_VERSION,
  WORK_RECORD_REPAIR_BUNDLE_TYPE,
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

function stableJsonBytes(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function nativeFileDigest(result = {}) {
  return result.existing_digest ? `sha256:${result.existing_digest}` : '';
}

function diagnostic(code, message, extra = {}) {
  return {
    severity: 'error',
    code,
    message,
    ...extra,
  };
}

function allDescriptors(report = {}) {
  const descriptors = [
    objectValue(report.safe_next_command),
    ...arrayValue(report.alternatives).map(objectValue),
  ].filter((item) => text(item.id));
  const seen = new Set();
  return descriptors.filter((item) => {
    const id = text(item.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function artifactRelativePathForKind(kind = '') {
  if (kind === 'repair_attempt_plan') return 'artifacts/repair-attempt-plan.json';
  if (kind === 'repair_plan') return 'artifacts/repair-plan.json';
  if (kind === 'repair_attempt_artifact') return 'artifacts/repair-attempt-artifact.json';
  return '';
}

function descriptorRelativePath(id = '') {
  const safe = text(id, 'descriptor').replace(/[^A-Za-z0-9._-]+/g, '-');
  return `commands/${safe || 'descriptor'}.json`;
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
    if (!stat.isDirectory()) {
      return { path: current, reason: 'parent_not_directory' };
    }
  }
  return null;
}

function resolveOutputRoot(outputRoot = '') {
  if (!outputRoot) {
    return {
      ok: false,
      diagnostics: [diagnostic('WORK_RECORD_REPAIR_BUNDLE_OUTPUT_ROOT_REQUIRED', 'repair bundle requires --output-root <dir>.', { path: 'output_root' })],
    };
  }
  const resolved = path.resolve(outputRoot);
  const existing = fs.existsSync(resolved);
  const nearestExisting = nearestExistingPath(resolved);
  const ancestorViolation = symlinkAncestorViolation(resolved);
  if (ancestorViolation?.reason === 'symlink_ancestor') {
    return {
      ok: false,
      outputRoot: resolved,
      diagnostics: [diagnostic('WORK_RECORD_REPAIR_BUNDLE_OUTPUT_ROOT_SYMLINK_ANCESTOR', '--output-root must not be reached through a symlinked ancestor.', { path: ancestorViolation.path })],
    };
  }
  if (ancestorViolation?.reason === 'parent_not_directory') {
    return {
      ok: false,
      outputRoot: resolved,
      diagnostics: [diagnostic('WORK_RECORD_REPAIR_BUNDLE_OUTPUT_ROOT_PARENT_NOT_DIRECTORY', '--output-root parent path must be a directory.', { path: ancestorViolation.path })],
    };
  }
  if (existing) {
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink()) {
      return {
        ok: false,
        outputRoot: resolved,
        diagnostics: [diagnostic('WORK_RECORD_REPAIR_BUNDLE_OUTPUT_ROOT_SYMLINK', '--output-root must not be a symlink.', { path: resolved })],
      };
    }
    if (!stat.isDirectory()) {
      return {
        ok: false,
        outputRoot: resolved,
        diagnostics: [diagnostic('WORK_RECORD_REPAIR_BUNDLE_OUTPUT_ROOT_NOT_DIRECTORY', '--output-root must be a directory when it already exists.', { path: resolved })],
      };
    }
  } else if (nearestExisting && fs.lstatSync(nearestExisting).isSymbolicLink()) {
    return {
      ok: false,
      outputRoot: resolved,
      diagnostics: [diagnostic('WORK_RECORD_REPAIR_BUNDLE_OUTPUT_ROOT_SYMLINK_ANCESTOR', '--output-root must not be created through a symlinked ancestor.', { path: nearestExisting })],
    };
  } else if (nearestExisting) {
    const stat = fs.lstatSync(nearestExisting);
    if (!stat.isDirectory()) {
      return {
        ok: false,
        outputRoot: resolved,
        diagnostics: [diagnostic('WORK_RECORD_REPAIR_BUNDLE_OUTPUT_ROOT_PARENT_NOT_DIRECTORY', '--output-root parent path must be a directory.', { path: nearestExisting })],
      };
    }
  }
  const canonicalRoot = existing
    ? fs.realpathSync(resolved)
    : path.join(fs.realpathSync(nearestExisting), path.relative(nearestExisting, resolved));
  return { ok: true, outputRoot: resolved, canonicalRoot, exists: existing, diagnostics: [] };
}

export function resolveWorkRecordRepairBundlePath(root, relativePath) {
  const relative = text(relativePath);
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]+/).includes('..')) {
    return {
      ok: false,
      diagnostics: [diagnostic('WORK_RECORD_REPAIR_BUNDLE_PATH_TRAVERSAL', 'Bundle artifact paths must be relative paths under --output-root.', { relative_path: relative })],
    };
  }
  const absolute = path.resolve(root, relative);
  if (!isWithin(root, absolute)) {
    return {
      ok: false,
      diagnostics: [diagnostic('WORK_RECORD_REPAIR_BUNDLE_PATH_ESCAPE', 'Bundle artifact path escaped --output-root.', { relative_path: relative, path: absolute })],
    };
  }
  return { ok: true, relativePath: relative, absolutePath: absolute, diagnostics: [] };
}

function artifactPathViolation(root, canonicalRoot, absolutePath) {
  if (!isWithin(root, absolutePath)) {
    return { escaped: true, path: absolutePath, reason: 'path_escape' };
  }
  let current = root;
  const relativeParts = path.relative(root, absolutePath).split(path.sep).filter(Boolean);
  for (const part of relativeParts.slice(0, -1)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) continue;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      return { escaped: true, path: current, reason: 'symlink_escape' };
    }
    if (!stat.isDirectory()) {
      return { escaped: true, path: current, reason: 'parent_not_directory' };
    }
  }
  if (fs.existsSync(absolutePath) && fs.lstatSync(absolutePath).isSymbolicLink()) {
    return { escaped: true, path: absolutePath, reason: 'symlink_escape' };
  }
  const existingParent = nearestExistingPath(path.dirname(absolutePath));
  if (existingParent && fs.existsSync(existingParent) && isWithin(root, existingParent)) {
    const parentRealpath = fs.realpathSync(existingParent);
    if (!isWithin(canonicalRoot, parentRealpath)) {
      return { escaped: true, path: existingParent, realpath: parentRealpath, reason: 'realpath_escape' };
    }
  }
  return { escaped: false };
}

function rebindArtifactPath(value, pathMap) {
  if (Array.isArray(value)) return value.map((item) => rebindArtifactPath(item, pathMap));
  if (!value || typeof value !== 'object') return value;
  const next = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key === 'path' && typeof raw === 'string' && pathMap.has(raw)) next[key] = pathMap.get(raw);
    else next[key] = rebindArtifactPath(raw, pathMap);
  }
  return next;
}

function descriptorStatus(descriptor = {}, materializedKinds = new Set()) {
  const kind = text(descriptor.stdout_artifact);
  if (!kind) return 'not_applicable';
  if (materializedKinds.has(kind)) return 'materialized';
  if (descriptor.mutates_state === true) return 'not_applicable';
  return 'planned_only';
}

function rebindDescriptor(descriptor = {}, pathMap, materializedKinds) {
  const rebound = rebindArtifactPath(cloneJson(descriptor), pathMap);
  if (pathMap.has(text(rebound.save_stdout_to))) {
    rebound.save_stdout_to = pathMap.get(text(rebound.save_stdout_to));
  }
  rebound.requires_saved_output_from = arrayValue(rebound.requires_saved_output_from)
    .map((requiredPath) => pathMap.get(text(requiredPath)) || text(requiredPath))
    .filter(Boolean);
  if (text(rebound.save_stdout_to)) {
    rebound.persistence_command = `${commandHintFromArgv(rebound.argv)} > ${shellQuoteArg(rebound.save_stdout_to)}`;
  }
  rebound.not_run_by_bundle = true;
  rebound.bundle_artifact_status = descriptorStatus(rebound, materializedKinds);
  return rebound;
}

function plannedArtifact({
  relativePath,
  artifactKind,
  producer,
  downstreamConsumers = [],
  value,
  writeMode = 'create_or_idempotent',
  outputRoot,
} = {}) {
  const resolved = resolveWorkRecordRepairBundlePath(outputRoot, relativePath);
  const bytes = value === undefined ? '' : stableJsonBytes(value);
  const exists = resolved.ok && fs.existsSync(resolved.absolutePath);
  const existingStat = exists ? fs.lstatSync(resolved.absolutePath) : null;
  const existingFile = existingStat?.isFile() === true;
  const existingSymlink = existingStat?.isSymbolicLink() === true;
  const conflict = exists && !existingSymlink && value !== undefined && (!existingFile || fs.readFileSync(resolved.absolutePath, 'utf8') !== bytes);
  return {
    relative_path: relativePath,
    path: resolved.absolutePath || '',
    artifact_kind: artifactKind,
    producer,
    downstream_consumers: downstreamConsumers,
    write_mode: writeMode,
    bytes_known_at_plan_time: value !== undefined,
    digest: value === undefined ? '' : sha256(bytes),
    exists,
    conflict_status: conflict ? 'conflict' : exists ? 'identical_or_directory' : 'none',
    value,
    diagnostics: resolved.diagnostics || [],
  };
}

function commandConsumers(descriptors = [], relativePath = '') {
  return descriptors
    .filter((descriptor) => arrayValue(descriptor.requires_saved_output_from).some((requirement) => text(requirement) === relativePath))
    .map((descriptor) => descriptor.id);
}

function bundleManifestFromEnvelope(envelope, artifacts) {
  return {
    type: WORK_RECORD_REPAIR_BUNDLE_MANIFEST_TYPE,
    schema_version: WORK_RECORD_REPAIR_BUNDLE_SCHEMA_VERSION,
    bundle: {
      type: envelope.type,
      schema_version: envelope.schema_version,
      status: envelope.status,
      mode: envelope.mode,
      source_work_record: cloneJson(envelope.source_work_record),
      output_root: envelope.output_root,
    },
    non_execution_flags: { ...WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS },
    artifacts: artifacts.map((artifact) => ({
      relative_path: artifact.relative_path,
      path: artifact.path,
      artifact_kind: artifact.artifact_kind,
      digest: artifact.digest,
      producer: artifact.producer,
      downstream_consumers: artifact.downstream_consumers,
      write_mode: artifact.write_mode,
      bytes_known_at_plan_time: artifact.bytes_known_at_plan_time,
    })),
  };
}

function failureEnvelope({ status, mode, sourceRef, outputRoot, diagnostics = [] }) {
  const envelope = {
    type: WORK_RECORD_REPAIR_BUNDLE_TYPE,
    schema_version: WORK_RECORD_REPAIR_BUNDLE_SCHEMA_VERSION,
    bundle_implementation_version: WORK_RECORD_REPAIR_BUNDLE_IMPLEMENTATION_VERSION,
    status,
    mode,
    source_work_record: { requested_ref: rawText(sourceRef) },
    output_root: rawText(outputRoot),
    guide_report_path: '',
    manifest_path: '',
    artifact_count: 0,
    written_artifacts: [],
    planned_artifacts: [],
    skipped_artifacts: [],
    conflicts: [],
    diagnostics,
    non_execution_flags: { ...WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS },
    next_recommended_command: null,
  };
  return {
    ...envelope,
    recovery_summary: buildBundleRecoverySummary(envelope),
  };
}

export function planWorkRecordRepairBundle({
  sourceRef = '',
  outputRoot = '',
  roots = [],
  profileId = undefined,
  attemptPlanPath = '',
  attemptArtifactPath = '',
  replacementRoot = '',
  replacementRoots = [],
  indexRoot = '',
  proposedIdSeed = '',
  replacementOutputPath = '',
  repoRoot = process.cwd(),
} = {}) {
  const root = resolveOutputRoot(outputRoot);
  if (!root.ok) {
    return failureEnvelope({
      status: 'blocked_output_root',
      mode: 'dry_run',
      sourceRef,
      outputRoot,
      diagnostics: root.diagnostics,
    });
  }

  const context = { roots, profileId, repoRoot };
  const guide = guideWorkRecordRepair({
    sourceRef,
    ...context,
    attemptPlanPath,
    attemptArtifactPath,
    replacementRoot,
    replacementRoots,
    indexRoot,
    proposedIdSeed,
    replacementOutputPath,
  });
  if (guide.status === 'failed') {
    const diagnostics = arrayValue(guide.diagnostics);
    return failureEnvelope({
      status: 'blocked_invalid_source',
      mode: 'dry_run',
      sourceRef,
      outputRoot: root.outputRoot,
      diagnostics: diagnostics.length > 0 ? diagnostics : [
        diagnostic('WORK_RECORD_REPAIR_BUNDLE_SOURCE_READ_FAILED', 'Could not read the source Work Record for recovery bundle planning.', { path: 'source_work_record' }),
      ],
    });
  }

  const repairPlan = planWorkRecordRepair(sourceRef, context);
  const attemptPlan = planWorkRecordRepairAttempt(sourceRef, { ...context, repairPlan });

  const originalDescriptors = allDescriptors(guide);
  const originalToBundlePath = new Map();
  for (const descriptor of originalDescriptors) {
    const kind = text(descriptor.stdout_artifact);
    const bundlePath = artifactRelativePathForKind(kind);
    if (descriptor.save_stdout_to && bundlePath) originalToBundlePath.set(descriptor.save_stdout_to, bundlePath);
  }
  if (attemptPlanPath) originalToBundlePath.set(attemptPlanPath, 'artifacts/repair-attempt-plan.json');

  const descriptorStdoutKinds = new Set(originalDescriptors.map((descriptor) => text(descriptor.stdout_artifact)).filter(Boolean));
  const materializedKinds = new Set();
  if (descriptorStdoutKinds.has('repair_plan') && repairPlan?.type === 'work_record.repair_plan') materializedKinds.add('repair_plan');
  if (descriptorStdoutKinds.has('repair_attempt_plan') && attemptPlan?.status === 'ready') materializedKinds.add('repair_attempt_plan');

  const reboundDescriptors = originalDescriptors.map((descriptor) => rebindDescriptor(descriptor, originalToBundlePath, materializedKinds));
  const reboundGuide = rebindArtifactPath(cloneJson(guide), originalToBundlePath);
  reboundGuide.safe_next_command = reboundDescriptors[0] || null;
  reboundGuide.alternatives = reboundDescriptors.slice(1);
  reboundGuide.not_run_by_bundle = true;

  const artifacts = [];
  artifacts.push(plannedArtifact({
    relativePath: 'guide-report.json',
    artifactKind: 'guide_report',
    producer: 'work-record-repair-bundle',
    downstreamConsumers: ['operator', 'future_session'],
    value: reboundGuide,
    outputRoot: root.outputRoot,
  }));
  for (const descriptor of reboundDescriptors) {
    artifacts.push(plannedArtifact({
      relativePath: descriptorRelativePath(descriptor.id),
      artifactKind: 'command_descriptor',
      producer: 'repair_guide_descriptor_rebinding',
      downstreamConsumers: ['operator', ...arrayValue(descriptor.requires_saved_output_from).map((item) => text(item.descriptor_id)).filter(Boolean)],
      value: descriptor,
      outputRoot: root.outputRoot,
    }));
  }
  if (materializedKinds.has('repair_plan')) {
    artifacts.push(plannedArtifact({
      relativePath: 'artifacts/repair-plan.json',
      artifactKind: 'repair_plan',
      producer: 'planWorkRecordRepair',
      downstreamConsumers: commandConsumers(reboundDescriptors, 'artifacts/repair-plan.json'),
      value: repairPlan,
      outputRoot: root.outputRoot,
    }));
  }
  if (materializedKinds.has('repair_attempt_plan')) {
    artifacts.push(plannedArtifact({
      relativePath: 'artifacts/repair-attempt-plan.json',
      artifactKind: 'repair_attempt_plan',
      producer: 'planWorkRecordRepairAttempt',
      downstreamConsumers: commandConsumers(reboundDescriptors, 'artifacts/repair-attempt-plan.json'),
      value: attemptPlan,
      outputRoot: root.outputRoot,
    }));
  }
  const envelope = {
    type: WORK_RECORD_REPAIR_BUNDLE_TYPE,
    schema_version: WORK_RECORD_REPAIR_BUNDLE_SCHEMA_VERSION,
    bundle_implementation_version: WORK_RECORD_REPAIR_BUNDLE_IMPLEMENTATION_VERSION,
    status: 'planned',
    mode: 'dry_run',
    source_work_record: cloneJson(guide.source_work_record || {}),
    output_root: root.outputRoot,
    canonical_output_root: root.canonicalRoot,
    guide_report_path: path.join(root.outputRoot, 'guide-report.json'),
    manifest_path: path.join(root.outputRoot, 'bundle-manifest.json'),
    artifact_count: 0,
    written_artifacts: [],
    planned_artifacts: [],
    skipped_artifacts: [],
    conflicts: [],
    diagnostics: [],
    non_execution_flags: { ...WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS },
    guide_report: reboundGuide,
    next_recommended_command: reboundGuide.safe_next_command,
  };
  const manifest = plannedArtifact({
    relativePath: 'bundle-manifest.json',
    artifactKind: 'bundle_manifest',
    producer: 'work-record-repair-bundle',
    downstreamConsumers: ['operator', 'future_session'],
    value: bundleManifestFromEnvelope(envelope, artifacts),
    outputRoot: root.outputRoot,
  });
  const planned = [manifest, ...artifacts];
  envelope.artifact_count = planned.length;
  envelope.planned_artifacts = planned.map((artifact) => ({
    relative_path: artifact.relative_path,
    path: artifact.path,
    artifact_kind: artifact.artifact_kind,
    digest: artifact.digest,
    producer: artifact.producer,
    downstream_consumers: artifact.downstream_consumers,
    write_mode: artifact.write_mode,
    bytes_known_at_plan_time: artifact.bytes_known_at_plan_time,
    exists: artifact.exists,
    conflict_status: artifact.conflict_status,
  }));
  envelope.conflicts = envelope.planned_artifacts.filter((artifact) => artifact.conflict_status === 'conflict');
  envelope.diagnostics = planned.flatMap((artifact) => arrayValue(artifact.diagnostics));
  if (envelope.conflicts.length > 0) {
    envelope.status = 'blocked_conflict';
    envelope.diagnostics.push(diagnostic('WORK_RECORD_REPAIR_BUNDLE_CONFLICT', 'One or more bundle artifact paths already exist with different bytes.'));
  }
  return {
    ...envelope,
    recovery_summary: buildBundleRecoverySummary({ ...envelope, guide_report: reboundGuide }),
    _artifacts: planned,
  };
}

export function writeWorkRecordRepairBundle(options = {}) {
  const plan = planWorkRecordRepairBundle(options);
  const dryRun = options.dryRun === true;
  const artifacts = arrayValue(plan._artifacts);
  const publicPlan = cloneJson(plan);
  delete publicPlan._artifacts;
  publicPlan.mode = dryRun ? 'dry_run' : 'write';
  publicPlan.recovery_summary = buildBundleRecoverySummary(publicPlan);
  if (plan.status !== 'planned') return publicPlan;
  if (dryRun) {
    publicPlan.status = 'dry_run';
    publicPlan.recovery_summary = buildBundleRecoverySummary(publicPlan);
    return publicPlan;
  }

  const outputRoot = rawText(plan.output_root);
  const canonicalRoot = rawText(plan.canonical_output_root || outputRoot);
  const escape = artifacts
    .map((artifact) => artifactPathViolation(outputRoot, canonicalRoot, artifact.path))
    .find((item) => item.escaped);
  if (escape) {
    const envelope = {
      ...publicPlan,
      status: 'blocked_path_escape',
      diagnostics: [
        ...arrayValue(publicPlan.diagnostics),
        diagnostic('WORK_RECORD_REPAIR_BUNDLE_SYMLINK_ESCAPE', 'A bundle artifact path would traverse or write through a symlink escape.', escape),
      ],
    };
    return {
      ...envelope,
      recovery_summary: buildBundleRecoverySummary(envelope),
    };
  }

  const written = [];
  const writtenArtifactReceipts = () => written.map((item) => ({
    relative_path: item.relative_path,
    path: item.path,
    artifact_kind: item.artifact_kind,
    digest: item.digest,
    producer: item.producer,
    downstream_consumers: item.downstream_consumers,
    write_mode: item.write_mode,
    write_status: item.write_status,
  }));
  let currentArtifact = null;
  let currentPublication = null;
  try {
    for (const artifact of artifacts) {
      currentArtifact = artifact;
      currentPublication = null;
      const bytes = stableJsonBytes(artifact.value);
      const existingInspection = inspectTextFileDestination(artifact.path, bytes, { boundaryRoot: outputRoot });
      if (existingInspection.status === 'inspection_failed') {
        const envelope = {
          ...publicPlan,
          status: 'blocked_write_failed',
          written_artifacts: writtenArtifactReceipts(),
          diagnostics: [
            ...arrayValue(publicPlan.diagnostics),
            diagnostic('WORK_RECORD_REPAIR_BUNDLE_EXISTING_INSPECTION_FAILED', 'Bundle artifact could not be inspected through a pinned no-follow descriptor.', { path: artifact.path, reason: existingInspection.error?.message || existingInspection.status }),
          ],
        };
        return {
          ...envelope,
          recovery_summary: buildBundleRecoverySummary(envelope),
        };
      }
      if (existingInspection.status === 'identical_existing') {
        written.push({ ...artifact, write_status: 'already_exists', digest: nativeFileDigest(existingInspection) });
        continue;
      }
      if (existingInspection.status !== 'missing') {
        const pathIdentityConflict = ['symlink', 'non_file', 'multiple_links', 'replaced', 'different_file'].includes(existingInspection.existing_kind);
        const envelope = {
          ...publicPlan,
          status: pathIdentityConflict ? 'blocked_path_escape' : 'blocked_conflict',
          conflicts: [artifact],
          written_artifacts: writtenArtifactReceipts(),
          diagnostics: [
            ...arrayValue(publicPlan.diagnostics),
            diagnostic(
              pathIdentityConflict ? 'WORK_RECORD_REPAIR_BUNDLE_SYMLINK_ESCAPE' : 'WORK_RECORD_REPAIR_BUNDLE_CONFLICT',
              pathIdentityConflict ? 'Bundle artifact path identity changed or traverses a symlink.' : 'Bundle artifact path already exists with different bytes.',
              { path: artifact.path, reason: existingInspection.existing_kind },
            ),
          ],
        };
        return {
          ...envelope,
          recovery_summary: buildBundleRecoverySummary(envelope),
        };
      }
      const publication = publishTextFileIfAbsent(artifact.path, bytes, { boundaryRoot: outputRoot });
      currentPublication = publication;
      if (publication.status === 'published' || publication.status === 'identical_existing') {
        written.push({
          ...artifact,
          write_status: publication.status === 'published' ? 'written' : 'already_exists',
          digest: nativeFileDigest(publication),
        });
        continue;
      }
      const conflict = publication.status === 'conflict';
      const cleanupFailed = publication.status === 'cleanup_failed';
      const publishedFailureReceipt = publication.published && publication.existing_digest
        ? {
          ...artifact,
          write_status: cleanupFailed ? 'published_cleanup_failed' : 'published_readback_failed',
          digest: nativeFileDigest(publication),
        }
        : null;
      const envelope = {
        ...publicPlan,
        status: conflict ? 'blocked_conflict' : cleanupFailed ? 'blocked_cleanup_failed' : 'blocked_write_failed',
        conflicts: conflict ? [artifact] : [],
        written_artifacts: [
          ...writtenArtifactReceipts(),
          ...(publishedFailureReceipt ? [{
            relative_path: publishedFailureReceipt.relative_path,
            path: publishedFailureReceipt.path,
            artifact_kind: publishedFailureReceipt.artifact_kind,
            digest: publishedFailureReceipt.digest,
            producer: publishedFailureReceipt.producer,
            downstream_consumers: publishedFailureReceipt.downstream_consumers,
            write_mode: publishedFailureReceipt.write_mode,
            write_status: publishedFailureReceipt.write_status,
          }] : []),
        ],
        failed_artifact: {
          relative_path: artifact.relative_path,
          path: artifact.path,
          artifact_kind: artifact.artifact_kind,
          publication_status: publication.status,
          destination_published: publication.published,
          temp_file: publication.temp_file,
          digest: publishedFailureReceipt?.digest || '',
        },
        diagnostics: [
          ...arrayValue(publicPlan.diagnostics),
          diagnostic(
            conflict
              ? 'WORK_RECORD_REPAIR_BUNDLE_CONFLICT'
              : cleanupFailed
                ? 'WORK_RECORD_REPAIR_BUNDLE_TEMP_CLEANUP_FAILED'
                : 'WORK_RECORD_REPAIR_BUNDLE_WRITE_FAILED',
            conflict
              ? 'Bundle artifact path was created concurrently with different bytes; existing bytes were preserved.'
              : cleanupFailed
                ? `Bundle artifact temp cleanup failed: ${publication.cleanup_error?.message || 'unknown cleanup failure'}`
                : `Bundle artifact publication failed: ${publication.error?.message || publication.status}`,
            { path: artifact.path },
          ),
        ],
      };
      return {
        ...envelope,
        recovery_summary: buildBundleRecoverySummary(envelope),
      };
    }
  } catch (error) {
    const destinationPublished = currentPublication?.published === true;
    const currentReceipt = destinationPublished ? {
      relative_path: currentArtifact.relative_path,
      path: currentArtifact.path,
      artifact_kind: currentArtifact.artifact_kind,
      digest: '',
      producer: currentArtifact.producer,
      downstream_consumers: currentArtifact.downstream_consumers,
      write_mode: currentArtifact.write_mode,
      write_status: 'published_readback_failed',
    } : null;
    const envelope = {
      ...publicPlan,
      status: 'blocked_write_failed',
      written_artifacts: [
        ...writtenArtifactReceipts(),
        ...(currentReceipt ? [currentReceipt] : []),
      ],
      failed_artifact: currentArtifact ? {
        relative_path: currentArtifact.relative_path,
        path: currentArtifact.path,
        artifact_kind: currentArtifact.artifact_kind,
        publication_status: 'io_failed',
        destination_published: destinationPublished,
        temp_file: currentPublication?.temp_file || '',
        digest: '',
      } : {
        relative_path: '',
        path: outputRoot,
        artifact_kind: 'bundle_root',
        publication_status: 'io_failed',
        destination_published: false,
        temp_file: '',
        digest: '',
      },
      diagnostics: [
        ...arrayValue(publicPlan.diagnostics),
        diagnostic('WORK_RECORD_REPAIR_BUNDLE_IO_FAILED', `Bundle artifact filesystem operation failed: ${error.message}`, {
          path: currentArtifact?.path || outputRoot,
        }),
      ],
    };
    return {
      ...envelope,
      recovery_summary: buildBundleRecoverySummary(envelope),
    };
  }

  const envelope = {
    ...publicPlan,
    status: 'written',
    written_artifacts: writtenArtifactReceipts(),
    planned_artifacts: publicPlan.planned_artifacts.map((artifact) => {
      const match = written.find((item) => item.relative_path === artifact.relative_path);
      return match ? { ...artifact, digest: match.digest } : artifact;
    }),
  };
  return {
    ...envelope,
    recovery_summary: buildBundleRecoverySummary(envelope),
  };
}
