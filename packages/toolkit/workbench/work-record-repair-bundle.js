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
  buildWorkRecordGateRequestFromRepairPlan,
} from './work-record-workflow-gate.js';
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

export {
  WORK_RECORD_REPAIR_BUNDLE_IMPLEMENTATION_VERSION,
  WORK_RECORD_REPAIR_BUNDLE_SCHEMA_VERSION,
  WORK_RECORD_REPAIR_BUNDLE_TYPE,
};

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

function fileDigest(file) {
  return sha256(fs.readFileSync(file));
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
    objectValue(report.next_explicit_command),
    ...arrayValue(report.alternative_explicit_commands).map(objectValue),
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
  if (kind === 'workflow_gate_request') return 'artifacts/gate-request.json';
  if (kind === 'repair_attempt_plan') return 'artifacts/repair-attempt-plan.json';
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
  const stdout = objectValue(descriptor.stdout_artifact);
  if (!stdout.kind) return 'not_applicable';
  if (materializedKinds.has(text(stdout.kind))) return 'materialized';
  if (descriptor.mutates_state === true || descriptor.requires_approval === true) return 'not_applicable';
  return 'planned_only';
}

function rebindDescriptor(descriptor = {}, pathMap, materializedKinds) {
  const rebound = rebindArtifactPath(cloneJson(descriptor), pathMap);
  if (rebound.stdout_artifact?.path) {
    rebound.save_stdout_to = rebound.stdout_artifact.path;
    if (rebound.persistence_command) {
      rebound.persistence_command = `${commandHintFromArgv(rebound.argv)} > ${shellQuoteArg(rebound.stdout_artifact.path)}`;
    }
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
    .filter((descriptor) => arrayValue(descriptor.requires_saved_output_from).some((requirement) => text(requirement.path) === relativePath))
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
    source_work_record: { requested_ref: text(sourceRef) },
    output_root: text(outputRoot),
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
  authorization = null,
  gateOutcome = null,
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
    authorization,
    gateOutcome,
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
  const gateRequest = buildWorkRecordGateRequestFromRepairPlan(repairPlan);
  const authorizationInput = authorization || gateOutcome || null;
  const attemptPlan = authorizationInput
    ? planWorkRecordRepairAttempt(sourceRef, {
      ...context,
      repairPlan,
      ...(authorization ? { authorization } : {}),
      ...(!authorization && gateOutcome ? { gateOutcome } : {}),
    })
    : null;

  const originalDescriptors = allDescriptors(guide);
  const originalToBundlePath = new Map();
  for (const descriptor of originalDescriptors) {
    const kind = text(descriptor.stdout_artifact?.kind);
    const bundlePath = artifactRelativePathForKind(kind);
    if (descriptor.stdout_artifact?.path && bundlePath) originalToBundlePath.set(descriptor.stdout_artifact.path, bundlePath);
  }
  if (attemptPlanPath) originalToBundlePath.set(attemptPlanPath, 'artifacts/repair-attempt-plan.json');

  const descriptorStdoutKinds = new Set(originalDescriptors.map((descriptor) => text(descriptor.stdout_artifact?.kind)).filter(Boolean));
  const materializedKinds = new Set();
  if (descriptorStdoutKinds.has('workflow_gate_request') && gateRequest?.status && gateRequest.status !== 'unsupported' && gateRequest.status !== 'not_required') {
    materializedKinds.add('workflow_gate_request');
  }
  if (descriptorStdoutKinds.has('repair_attempt_plan') && attemptPlan?.status === 'ready') materializedKinds.add('repair_attempt_plan');

  const reboundDescriptors = originalDescriptors.map((descriptor) => rebindDescriptor(descriptor, originalToBundlePath, materializedKinds));
  const reboundGuide = rebindArtifactPath(cloneJson(guide), originalToBundlePath);
  reboundGuide.next_explicit_command = reboundDescriptors[0] || null;
  reboundGuide.alternative_explicit_commands = reboundDescriptors.slice(1);
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
  if (materializedKinds.has('workflow_gate_request')) {
    artifacts.push(plannedArtifact({
      relativePath: 'artifacts/gate-request.json',
      artifactKind: 'workflow_gate_request',
      producer: 'buildWorkRecordGateRequestFromRepairPlan',
      downstreamConsumers: commandConsumers(reboundDescriptors, 'artifacts/gate-request.json'),
      value: gateRequest,
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
    next_recommended_command: reboundGuide.next_explicit_command,
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

  const outputRoot = text(plan.output_root);
  const canonicalRoot = text(plan.canonical_output_root || outputRoot);
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
  fs.mkdirSync(outputRoot, { recursive: true });
  for (const artifact of artifacts) {
    const bytes = stableJsonBytes(artifact.value);
    if (fs.existsSync(artifact.path)) {
      if (fs.lstatSync(artifact.path).isSymbolicLink()) {
        const envelope = {
          ...publicPlan,
          status: 'blocked_path_escape',
          diagnostics: [
            ...arrayValue(publicPlan.diagnostics),
            diagnostic('WORK_RECORD_REPAIR_BUNDLE_SYMLINK_ESCAPE', 'A bundle artifact path would write through an existing symlink.', { path: artifact.path, reason: 'symlink_escape' }),
          ],
        };
        return {
          ...envelope,
          recovery_summary: buildBundleRecoverySummary(envelope),
        };
      }
      if (!fs.lstatSync(artifact.path).isFile() || fs.readFileSync(artifact.path, 'utf8') !== bytes) {
        const envelope = {
          ...publicPlan,
          status: 'blocked_conflict',
          conflicts: [artifact],
          diagnostics: [
            ...arrayValue(publicPlan.diagnostics),
            diagnostic('WORK_RECORD_REPAIR_BUNDLE_CONFLICT', 'Bundle artifact path already exists with different bytes.', { path: artifact.path }),
          ],
        };
        return {
          ...envelope,
          recovery_summary: buildBundleRecoverySummary(envelope),
        };
      }
      written.push({ ...artifact, write_status: 'already_exists', digest: fileDigest(artifact.path) });
      continue;
    }
    fs.mkdirSync(path.dirname(artifact.path), { recursive: true });
    const parentRealpath = fs.realpathSync(path.dirname(artifact.path));
    if (!isWithin(canonicalRoot, parentRealpath)) {
      const envelope = {
        ...publicPlan,
        status: 'blocked_path_escape',
        diagnostics: [
          ...arrayValue(publicPlan.diagnostics),
          diagnostic('WORK_RECORD_REPAIR_BUNDLE_SYMLINK_ESCAPE', 'A bundle artifact parent resolved outside --output-root.', { path: path.dirname(artifact.path), realpath: parentRealpath, reason: 'realpath_escape' }),
        ],
      };
      return {
        ...envelope,
        recovery_summary: buildBundleRecoverySummary(envelope),
      };
    }
    fs.writeFileSync(artifact.path, bytes);
    written.push({ ...artifact, write_status: 'written', digest: fileDigest(artifact.path) });
  }

  const envelope = {
    ...publicPlan,
    status: 'written',
    written_artifacts: written.map((artifact) => ({
      relative_path: artifact.relative_path,
      path: artifact.path,
      artifact_kind: artifact.artifact_kind,
      digest: artifact.digest,
      producer: artifact.producer,
      downstream_consumers: artifact.downstream_consumers,
      write_mode: artifact.write_mode,
      write_status: artifact.write_status,
    })),
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
