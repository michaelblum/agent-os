import fs from 'node:fs';
import path from 'node:path';
import {
  WORK_RECORD_REPAIR_BUNDLE_LIFECYCLE_STATUS_SCHEMA_VERSION,
  WORK_RECORD_REPAIR_BUNDLE_LIFECYCLE_STATUS_TYPE,
  WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS,
} from './work-record-repair-bundle-policy.js';
import { inspectWorkRecordRepairBundle } from './work-record-repair-bundle-inspector.js';
import {
  buildStatusRowRecoverySummary,
  classifyInspectionRecovery,
  projectDescriptorPersistence,
} from './work-record-recovery-summary.js';

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

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
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

function bundleSummary(candidate, inspection) {
  const continuation = inspection.continuation || {};
  const classification = classifyInspectionRecovery(inspection);
  const descriptorId = classification.continuable === true ? text(continuation.safe_next_descriptor_id) : '';
  const row = {
    bundle_root: candidate.bundle_root,
    canonical_bundle_root: text(inspection.canonical_bundle_root, candidate.canonical_bundle_root),
    inspection_status: text(inspection.status, 'unknown'),
    lifecycle_status: classification.state,
    source_work_record: inspection.manifest?.source_work_record || {},
    guide_stage: text(inspection.guide_report?.current_stage || continuation.current_guide_stage),
    guide_stage_status: text(inspection.guide_report?.stage_status || continuation.stage_status),
    continuation_ready: classification.continuable === true,
    next_command_id: descriptorId,
    next_argv: classification.continuable === true ? arrayValue(continuation.argv) : [],
    next_persistence: classification.continuable === true ? objectValue(continuation.persistence) : projectDescriptorPersistence({}, false),
    next_command_mutates_state: classification.continuable === true && continuation.would_mutate_state === true,
    requires_user_approval: classification.continuable === true && continuation.requires_human_approval === true,
    missing_inputs: arrayValue(inspection.guide_report?.missing_inputs),
    required_saved_outputs_present: classification.continuable === true && continuation.required_saved_outputs_present === true,
    missing_saved_outputs: classification.continuable === true ? arrayValue(continuation.missing_artifact_paths) : [],
    diagnostics: arrayValue(inspection.diagnostics),
  };
  return {
    ...row,
    recovery_summary: buildStatusRowRecoverySummary(row),
  };
}

function countByStatus(bundles, lifecycleStatusValue) {
  return bundles.filter((bundle) => bundle.lifecycle_status === lifecycleStatusValue).length;
}

const ATTENTION_PRIORITY = {
  ready: 1,
  blocked: 2,
  missing: 3,
  invalid: 4,
  unsupported: 5,
  unknown: 6,
  finalized: 7,
};

function diagnosticCodes(row = {}) {
  return arrayValue(row.diagnostics)
    .map((item) => text(item?.code))
    .filter(Boolean);
}

function attentionForState(row = {}, argv = []) {
  const state = text(row.lifecycle_status, 'unknown');
  if (state === 'ready' && argv.length > 0) return 'continue';
  if (state === 'blocked') return 'provide_input';
  if (state === 'missing') return 'restore_bundle';
  if (state === 'invalid') return 'inspect_integrity';
  if (state === 'unsupported') return 'unsupported_schema';
  if (state === 'finalized') return 'closed';
  return 'inspect_status';
}

function whyForState(row = {}, argv = []) {
  const state = text(row.lifecycle_status, 'unknown');
  if (state === 'ready' && argv.length > 0) {
    return 'Validated bundle has a safe next argv and required saved outputs are present.';
  }
  if (state === 'blocked') {
    if (arrayValue(row.missing_inputs).length > 0) return 'Bundle is waiting for operator inputs before it can continue.';
    if (arrayValue(row.missing_saved_outputs).length > 0) return 'Bundle is waiting for required saved outputs before it can continue.';
    return 'Bundle is blocked without a safe continuation argv.';
  }
  if (state === 'missing') return 'Bundle root or a bundle-owned artifact is missing.';
  if (state === 'invalid') return 'Bundle inspection found integrity or contract failures.';
  if (state === 'unsupported') return 'Bundle schema or lifecycle shape is unsupported.';
  if (state === 'finalized') return 'Bundle is finalized and is visible for audit, not next work.';
  return 'Bundle status is unknown; inspect row diagnostics before continuing.';
}

function safeAttentionArgv(row = {}) {
  const state = text(row.lifecycle_status, 'unknown');
  const argv = arrayValue(row.next_argv);
  if (
    state === 'ready'
    && row.continuation_ready === true
    && row.required_saved_outputs_present === true
    && argv.length > 0
  ) {
    return [...argv];
  }
  return [];
}

function attentionSummary(queue = []) {
  const states = ['ready', 'blocked', 'missing', 'invalid', 'unsupported', 'unknown', 'finalized'];
  const counts = Object.fromEntries(states.map((state) => [state, queue.filter((item) => item.state === state).length]));
  const next = queue[0] || {};
  return {
    next_bundle_root: text(next.bundle_root),
    next_state: text(next.state),
    next_attention: text(next.attention),
    ...counts,
  };
}

function buildWorkRecordRepairBundleAttentionQueue(bundles = []) {
  const items = arrayValue(bundles).map((row) => {
    const state = text(row.lifecycle_status, 'unknown');
    const argv = safeAttentionArgv(row);
    return {
      bundle_root: text(row.bundle_root),
      canonical_bundle_root: text(row.canonical_bundle_root, text(row.bundle_root)),
      state,
      attention: attentionForState(row, argv),
      why: whyForState(row, argv),
      source_work_record: row.source_work_record || {},
      guide_stage: text(row.guide_stage),
      guide_stage_status: text(row.guide_stage_status),
      next: {
        command_id: argv.length > 0 ? text(row.next_command_id) : '',
        argv,
        mutates_state: argv.length > 0 && row.next_command_mutates_state === true,
        requires_user_approval: argv.length > 0 && row.requires_user_approval === true,
        missing_inputs: arrayValue(row.missing_inputs),
        missing_saved_outputs: arrayValue(row.missing_saved_outputs),
        persistence: argv.length > 0 ? objectValue(row.recovery_summary?.next?.persistence) : projectDescriptorPersistence({}, false),
      },
      diagnostic_codes: diagnosticCodes(row),
    };
  });
  const ordered = items.sort((a, b) => {
    const priority = (ATTENTION_PRIORITY[a.state] || ATTENTION_PRIORITY.unknown)
      - (ATTENTION_PRIORITY[b.state] || ATTENTION_PRIORITY.unknown);
    if (priority !== 0) return priority;
    return a.canonical_bundle_root.localeCompare(b.canonical_bundle_root);
  });
  return ordered.map((item, index) => ({ rank: index + 1, ...item }));
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
  const attentionQueue = buildWorkRecordRepairBundleAttentionQueue(bundles);

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
    attention_queue: attentionQueue,
    attention_summary: attentionSummary(attentionQueue),
    bundles,
    diagnostics,
    non_execution_flags: { ...WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS },
  };
  return envelope;
}
