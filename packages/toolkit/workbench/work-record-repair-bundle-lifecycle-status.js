import fs from 'node:fs';
import path from 'node:path';
import {
  WORK_RECORD_REPAIR_BUNDLE_LIFECYCLE_STATUS_SCHEMA_VERSION,
  WORK_RECORD_REPAIR_BUNDLE_LIFECYCLE_STATUS_TYPE,
  WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS,
} from './work-record-repair-bundle-policy.js';
import { inspectWorkRecordRepairBundle } from './work-record-repair-bundle-inspector.js';

export {
  WORK_RECORD_REPAIR_BUNDLE_LIFECYCLE_STATUS_SCHEMA_VERSION,
  WORK_RECORD_REPAIR_BUNDLE_LIFECYCLE_STATUS_TYPE,
};

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
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

function canonicalPath(candidate) {
  const resolved = path.resolve(text(candidate));
  if (!resolved) return '';
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function rootExistsDirectory(root) {
  try {
    return fs.lstatSync(root).isDirectory();
  } catch {
    return false;
  }
}

function deriveParentRoots(bundleParents = []) {
  const derived = [];
  const diagnostics = [];
  for (const supplied of bundleParents.map(text).filter(Boolean)) {
    const parentRoot = path.resolve(supplied);
    if (!rootExistsDirectory(parentRoot)) {
      diagnostics.push(diagnostic(
        'WORK_RECORD_REPAIR_BUNDLE_STATUS_PARENT_NOT_DIRECTORY',
        'Bundle parent must exist and be a directory for bounded one-level scanning.',
        { bundle_parent: parentRoot },
      ));
      continue;
    }
    for (const name of fs.readdirSync(parentRoot).sort()) {
      const child = path.join(parentRoot, name);
      if (!rootExistsDirectory(child)) continue;
      const manifest = path.join(child, 'bundle-manifest.json');
      if (!fs.existsSync(manifest)) continue;
      derived.push({
        bundle_parent: parentRoot,
        bundle_root: child,
        canonical_bundle_root: canonicalPath(child),
        discovery: 'bundle_parent_immediate_child',
      });
    }
  }
  return { derived, diagnostics };
}

function candidateKey(candidate) {
  return canonicalPath(candidate.bundle_root);
}

function candidateRecords(bundleRoots = [], bundleParents = []) {
  const explicit = bundleRoots.map(text).filter(Boolean).map((root) => {
    const bundleRoot = path.resolve(root);
    return {
      bundle_root: bundleRoot,
      canonical_bundle_root: canonicalPath(bundleRoot),
      discovery: 'bundle_root',
    };
  });
  const parentResult = deriveParentRoots(bundleParents);
  const byKey = new Map();
  const duplicates = [];
  for (const candidate of [...explicit, ...parentResult.derived]) {
    const key = candidateKey(candidate);
    if (!key) continue;
    if (byKey.has(key)) {
      duplicates.push({ bundle_root: candidate.bundle_root, canonical_bundle_root: key, discovery: candidate.discovery });
      continue;
    }
    byKey.set(key, candidate);
  }
  return {
    candidates: [...byKey.values()].sort((a, b) => a.canonical_bundle_root.localeCompare(b.canonical_bundle_root)),
    derived: parentResult.derived.sort((a, b) => a.canonical_bundle_root.localeCompare(b.canonical_bundle_root)),
    diagnostics: parentResult.diagnostics,
    duplicates,
  };
}

function lifecycleStatus(inspection) {
  const status = text(inspection.status);
  const diagnostics = arrayValue(inspection.diagnostics);
  if (diagnostics.some((item) => item.code === 'WORK_RECORD_REPAIR_BUNDLE_INSPECT_ROOT_NOT_FOUND')) return 'missing';
  if (status === 'unsupported_schema') return 'unsupported';
  if (status === 'valid' || status === 'degraded') {
    const guide = inspection.guide_report || {};
    const stageText = `${text(guide.status)} ${text(guide.current_stage)} ${text(guide.stage_status)}`.toLowerCase();
    if (/\b(finalized|complete|completed)\b/.test(stageText)) return 'finalized';
    const continuation = inspection.continuation || {};
    if (text(continuation.safe_next_descriptor_id) && continuation.required_saved_outputs_present === true) return 'ready';
    return 'blocked';
  }
  if (status.startsWith('blocked_missing')) return 'blocked';
  if (status.startsWith('blocked_invalid') || status === 'blocked_path_escape' || status === 'blocked_forbidden_artifact') return 'invalid';
  if (status.startsWith('blocked_')) return 'blocked';
  return 'unknown';
}

function bundleSummary(candidate, inspection) {
  const continuation = inspection.continuation || {};
  const descriptorId = text(continuation.safe_next_descriptor_id);
  return {
    bundle_root: candidate.bundle_root,
    canonical_bundle_root: text(inspection.canonical_bundle_root, candidate.canonical_bundle_root),
    inspection_status: text(inspection.status, 'unknown'),
    lifecycle_status: lifecycleStatus(inspection),
    source_work_record: inspection.manifest?.source_work_record || {},
    guide_stage: text(inspection.guide_report?.current_stage || continuation.current_guide_stage),
    guide_stage_status: text(inspection.guide_report?.stage_status || continuation.stage_status),
    continuation_ready: descriptorId !== '' && continuation.required_saved_outputs_present === true,
    next_command_id: descriptorId,
    next_argv: arrayValue(continuation.argv),
    next_command_mutates_state: continuation.would_mutate_state === true,
    requires_user_approval: continuation.requires_human_approval === true,
    missing_inputs: arrayValue(inspection.guide_report?.missing_inputs),
    required_saved_outputs_present: continuation.required_saved_outputs_present === true,
    missing_saved_outputs: arrayValue(continuation.missing_artifact_paths),
    diagnostics: arrayValue(inspection.diagnostics),
  };
}

function countByStatus(bundles, lifecycleStatusValue) {
  return bundles.filter((bundle) => bundle.lifecycle_status === lifecycleStatusValue).length;
}

export function statusWorkRecordRepairBundles({ bundleRoots = [], bundleParents = [] } = {}) {
  const suppliedBundleRoots = bundleRoots.map(text).filter(Boolean).map((root) => path.resolve(root));
  const suppliedBundleParents = bundleParents.map(text).filter(Boolean).map((root) => path.resolve(root));
  const rootResult = candidateRecords(suppliedBundleRoots, suppliedBundleParents);
  const missingInput = suppliedBundleRoots.length === 0 && suppliedBundleParents.length === 0;
  const diagnostics = [...rootResult.diagnostics];
  if (missingInput) {
    diagnostics.push(diagnostic(
      'WORK_RECORD_REPAIR_BUNDLE_STATUS_INPUT_REQUIRED',
      'status requires at least one --bundle-root or --bundle-parent.',
      { required: ['bundle_root', 'bundle_parent'] },
    ));
  }

  const bundles = rootResult.candidates.map((candidate) => (
    bundleSummary(candidate, inspectWorkRecordRepairBundle({ bundleRoot: candidate.bundle_root }))
  ));

  const envelope = {
    type: WORK_RECORD_REPAIR_BUNDLE_LIFECYCLE_STATUS_TYPE,
    schema_version: WORK_RECORD_REPAIR_BUNDLE_LIFECYCLE_STATUS_SCHEMA_VERSION,
    status: missingInput ? 'failed' : 'success',
    bundle_count: bundles.length,
    valid_count: bundles.filter((bundle) => bundle.inspection_status === 'valid' || bundle.inspection_status === 'degraded').length,
    ready_count: countByStatus(bundles, 'ready'),
    blocked_count: countByStatus(bundles, 'blocked'),
    invalid_count: countByStatus(bundles, 'invalid'),
    missing_count: countByStatus(bundles, 'missing'),
    unsupported_count: countByStatus(bundles, 'unsupported'),
    finalized_count: countByStatus(bundles, 'finalized'),
    unknown_count: countByStatus(bundles, 'unknown'),
    roots: {
      supplied_bundle_roots: suppliedBundleRoots,
      supplied_bundle_parents: suppliedBundleParents,
      derived_bundle_roots: rootResult.derived,
      duplicate_bundle_roots: rootResult.duplicates,
      discovery: {
        global_search: false,
        recursive_parent_scan: false,
        parent_scan_depth: 1,
      },
    },
    bundles,
    diagnostics,
    non_execution_flags: { ...WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS },
  };
  return envelope;
}
