import fs from 'node:fs';
import path from 'node:path';
import {
  WORK_RECORD_REPAIR_BUNDLE_LIFECYCLE_STATUS_SCHEMA_VERSION,
  WORK_RECORD_REPAIR_BUNDLE_LIFECYCLE_STATUS_TYPE,
  WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS,
} from './work-record-repair-bundle-policy.js';
import { inspectWorkRecordRepairBundle } from './work-record-repair-bundle-inspector.js';
import { buildStatusRowRecoverySummary } from './work-record-recovery-summary.js';

export {
  WORK_RECORD_REPAIR_BUNDLE_LIFECYCLE_STATUS_SCHEMA_VERSION,
  WORK_RECORD_REPAIR_BUNDLE_LIFECYCLE_STATUS_TYPE,
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

function diagnostic(code, message, extra = {}) {
  return { severity: 'error', code, message, ...extra };
}

function canonicalPath(candidate) {
  const resolved = path.resolve(rawText(candidate));
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function directoryExists(candidate) {
  try {
    return fs.lstatSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function collectCandidates(bundleRoots = [], bundleParents = []) {
  const diagnostics = [];
  const candidates = bundleRoots.map((root) => rawText(root)).filter(Boolean).map((root) => ({
    bundle_root: path.resolve(root),
    discovery: 'bundle_root',
  }));
  for (const parent of bundleParents.map((root) => rawText(root)).filter(Boolean)) {
    const parentRoot = path.resolve(parent);
    if (!directoryExists(parentRoot)) {
      diagnostics.push(diagnostic('WORK_RECORD_REPAIR_BUNDLE_STATUS_PARENT_NOT_DIRECTORY', 'Bundle parent must exist and be a directory.', { bundle_parent: parentRoot }));
      continue;
    }
    for (const name of fs.readdirSync(parentRoot).sort()) {
      const child = path.join(parentRoot, name);
      if (directoryExists(child) && fs.existsSync(path.join(child, 'bundle-manifest.json'))) {
        candidates.push({ bundle_root: child, discovery: 'bundle_parent_immediate_child', bundle_parent: parentRoot });
      }
    }
  }
  const byCanonical = new Map();
  const duplicates = [];
  for (const candidate of candidates) {
    const canonical = canonicalPath(candidate.bundle_root);
    if (byCanonical.has(canonical)) {
      duplicates.push({ ...candidate, canonical_bundle_root: canonical });
    } else {
      byCanonical.set(canonical, { ...candidate, canonical_bundle_root: canonical });
    }
  }
  return {
    candidates: [...byCanonical.values()].sort((a, b) => a.canonical_bundle_root.localeCompare(b.canonical_bundle_root)),
    duplicates,
    diagnostics,
  };
}

function bundleSummary(candidate) {
  const inspection = inspectWorkRecordRepairBundle({ bundleRoot: candidate.bundle_root });
  const next = inspection.lifecycle_status === 'ready' ? inspection.safe_next_command : null;
  const row = {
    bundle_root: candidate.bundle_root,
    canonical_bundle_root: rawText(inspection.canonical_bundle_root, candidate.canonical_bundle_root),
    inspection_status: text(inspection.status, 'unknown'),
    lifecycle_status: text(inspection.lifecycle_status, 'unknown'),
    source_work_record: inspection.manifest?.source_work_record || {},
    guide_stage: text(inspection.guide_report?.current_stage),
    guide_stage_status: text(inspection.guide_report?.stage_status),
    next_command: next,
    missing_inputs: arrayValue(inspection.missing_inputs),
    missing_saved_outputs: arrayValue(inspection.missing_artifact_paths),
    diagnostics: arrayValue(inspection.diagnostics),
  };
  return { ...row, recovery_summary: buildStatusRowRecoverySummary({ ...row, status: row.lifecycle_status }) };
}

const ATTENTION_PRIORITY = Object.freeze({ ready: 1, blocked: 2, missing: 3, invalid: 4, unsupported: 5, unknown: 6 });

function attentionQueue(bundles) {
  return bundles
    .map((row) => {
      const state = text(row.lifecycle_status, 'unknown');
      const next = state === 'ready' ? row.next_command : null;
      return {
        bundle_root: row.bundle_root,
        canonical_bundle_root: row.canonical_bundle_root,
        state,
        attention: state === 'ready' ? 'next_mechanical_step' : state === 'blocked' ? 'provide_input' : 'inspect_integrity',
        next_command: next,
        missing_inputs: row.missing_inputs,
        missing_saved_outputs: row.missing_saved_outputs,
        diagnostic_codes: row.diagnostics.map((item) => text(item?.code)).filter(Boolean),
      };
    })
    .sort((a, b) => (ATTENTION_PRIORITY[a.state] || 99) - (ATTENTION_PRIORITY[b.state] || 99) || a.canonical_bundle_root.localeCompare(b.canonical_bundle_root))
    .map((item, index) => ({ rank: index + 1, ...item }));
}

export function statusWorkRecordRepairBundles({ bundleRoots = [], bundleParents = [] } = {}) {
  const suppliedBundleRoots = bundleRoots.map((root) => rawText(root)).filter(Boolean).map((root) => path.resolve(root));
  const suppliedBundleParents = bundleParents.map((root) => rawText(root)).filter(Boolean).map((root) => path.resolve(root));
  const missingInput = suppliedBundleRoots.length === 0 && suppliedBundleParents.length === 0;
  const collected = collectCandidates(suppliedBundleRoots, suppliedBundleParents);
  const diagnostics = [...collected.diagnostics];
  if (missingInput) diagnostics.push(diagnostic('WORK_RECORD_REPAIR_BUNDLE_STATUS_INPUT_REQUIRED', 'Status requires at least one --bundle-root or --bundle-parent.'));
  const bundles = collected.candidates.map(bundleSummary);
  const queue = attentionQueue(bundles);
  const count = (state) => bundles.filter((bundle) => bundle.lifecycle_status === state).length;
  return {
    type: WORK_RECORD_REPAIR_BUNDLE_LIFECYCLE_STATUS_TYPE,
    schema_version: WORK_RECORD_REPAIR_BUNDLE_LIFECYCLE_STATUS_SCHEMA_VERSION,
    status: missingInput ? 'failed' : 'success',
    bundle_count: bundles.length,
    ready_count: count('ready'),
    blocked_count: count('blocked'),
    invalid_count: count('invalid'),
    missing_count: count('missing'),
    unsupported_count: count('unsupported'),
    roots: {
      supplied_bundle_roots: suppliedBundleRoots,
      supplied_bundle_parents: suppliedBundleParents,
      duplicate_bundle_roots: collected.duplicates,
      discovery: { global_search: false, recursive_parent_scan: false, parent_scan_depth: 1 },
    },
    attention_queue: queue,
    attention_summary: {
      next_bundle_root: rawText(queue[0]?.bundle_root),
      next_state: text(queue[0]?.state),
      ready: count('ready'),
      blocked: count('blocked'),
      invalid: count('invalid'),
      missing: count('missing'),
      unsupported: count('unsupported'),
    },
    bundles,
    diagnostics,
    non_execution_flags: { ...WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS },
  };
}
