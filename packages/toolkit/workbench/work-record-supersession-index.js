import fs from 'node:fs';
import path from 'node:path';
import {
  WORK_RECORD_SOURCE_SUPERSESSION_ENTRY_TYPE,
  WORK_RECORD_SOURCE_SUPERSESSION_INDEX_SCHEMA_VERSION,
  WORK_RECORD_SOURCE_SUPERSESSION_INDEX_STATUSES,
  baseWriteResult,
  buildSourceSupersessionPlan,
  cloneJson,
  existingRelationshipsForSource,
  fileDigest,
  rawPathHasTraversal,
  readRecordIdentity,
  text,
  addDiagnostic,
} from './work-record-supersession-plan.js';

export {
  WORK_RECORD_SOURCE_SUPERSESSION_ENTRY_TYPE,
  WORK_RECORD_SOURCE_SUPERSESSION_INDEX_SCHEMA_VERSION,
  WORK_RECORD_SOURCE_SUPERSESSION_INDEX_STATUSES,
  validateWorkRecordSourceSupersessionEntry,
} from './work-record-supersession-plan.js';

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function containedPath(child, root) {
  const relative = path.relative(root, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolvedRootContainsPath(root = '', file = '') {
  const rootValue = text(root);
  const fileValue = text(file);
  if (!rootValue || !fileValue || rawPathHasTraversal(rootValue) || rawPathHasTraversal(fileValue)) return false;
  const rootResolved = path.resolve(rootValue);
  const fileResolved = path.resolve(fileValue);
  if (!fs.existsSync(rootResolved) || !fs.existsSync(fileResolved)) return false;
  const rootStat = fs.statSync(rootResolved);
  const rootReal = fs.realpathSync(rootResolved);
  const fileReal = fs.realpathSync(fileResolved);
  if (rootStat.isFile()) return rootReal === fileReal;
  if (!rootStat.isDirectory()) return false;
  return containedPath(fileReal, rootReal);
}

function rootContainingPath(roots = [], file = '') {
  return arrayValue(roots).map(text).find((root) => resolvedRootContainsPath(root, file)) || '';
}

function replacementReadCommand(identity = {}, resolvedRoot = '') {
  const id = text(identity.id);
  const root = text(resolvedRoot || (identity.path ? path.dirname(identity.path) : ''));
  if (!id || !root) return '';
  return `./aos work-record read ${id} --root ${root} --json`;
}

function resolveReplacementReadback(entry = {}, replacementRoots = [], repoRoot = process.cwd()) {
  const indexed = entry && typeof entry === 'object' ? entry.replacement_work_record || {} : {};
  const roots = arrayValue(replacementRoots).map(text).filter(Boolean);
  if (roots.length === 0) {
    return {
      status: 'index_only',
      readable: false,
      read_proven: false,
      identity: cloneJson(indexed),
      resolved_root: '',
      diagnostics: [],
      recommended_command_hint: '',
    };
  }

  const read = readRecordIdentity(text(indexed.id), {
    roots,
    repoRoot,
    invalidStatus: 'blocked_invalid_replacement',
    diagnosticPrefix: 'REPLACEMENT',
  });
  if (read.status !== 'success') {
    return {
      status: 'not_found',
      readable: false,
      read_proven: false,
      identity: cloneJson(indexed),
      resolved_root: '',
      diagnostics: read.diagnostics,
      recommended_command_hint: '',
    };
  }

  const resolvedRoot = rootContainingPath(roots, read.identity.path);
  const diagnostics = [];
  if (!resolvedRoot) {
    addDiagnostic(
      diagnostics,
      'SUPERSESSION_LOOKUP_REPLACEMENT_PATH_OUTSIDE_ROOT',
      'Replacement Work Record resolved outside the supplied replacement roots.',
      'replacement_work_record.path',
      { replacement_path: read.identity.path, replacement_roots: roots },
    );
  }
  if (text(indexed.path) && !rootContainingPath(roots, indexed.path)) {
    addDiagnostic(
      diagnostics,
      'SUPERSESSION_LOOKUP_INDEXED_REPLACEMENT_PATH_OUTSIDE_ROOT',
      'Indexed replacement path is not under any supplied replacement root.',
      'entry.replacement_work_record.path',
      { indexed_replacement_path: text(indexed.path), replacement_roots: roots },
    );
  }
  if (text(indexed.id) && text(indexed.id) !== read.identity.id) {
    addDiagnostic(
      diagnostics,
      'SUPERSESSION_LOOKUP_REPLACEMENT_ID_MISMATCH',
      'Resolved replacement Work Record id does not match the Source Supersession Index entry.',
      'replacement_work_record.id',
      { expected: text(indexed.id), actual: read.identity.id },
    );
  }
  if (text(indexed.digest) && text(indexed.digest) !== read.identity.digest) {
    addDiagnostic(
      diagnostics,
      'SUPERSESSION_LOOKUP_REPLACEMENT_DIGEST_MISMATCH',
      'Resolved replacement Work Record digest does not match the Source Supersession Index entry.',
      'replacement_work_record.digest',
      { expected: text(indexed.digest), actual: read.identity.digest },
    );
  }
  const status = diagnostics.some((diagnostic) => diagnostic.code === 'SUPERSESSION_LOOKUP_REPLACEMENT_DIGEST_MISMATCH')
    ? 'digest_mismatch'
    : diagnostics.some((diagnostic) => diagnostic.code === 'SUPERSESSION_LOOKUP_REPLACEMENT_ID_MISMATCH')
      ? 'id_mismatch'
      : diagnostics.length > 0
        ? 'path_mismatch'
        : 'readable';
  return {
    status,
    readable: status === 'readable',
    read_proven: status === 'readable',
    identity: read.identity,
    resolved_root: status === 'readable' ? resolvedRoot : '',
    diagnostics,
    recommended_command_hint: status === 'readable' ? replacementReadCommand(read.identity, resolvedRoot) : '',
  };
}

export function planWorkRecordSourceSupersession({
  sourceRef = '',
  replacementRef = '',
  indexRoot = '',
  sourceRoots = [],
  replacementRoots = [],
  writerResult = null,
  writerResultPath = '',
  repoRoot = process.cwd(),
} = {}) {
  return buildSourceSupersessionPlan({
    sourceRef,
    replacementRef,
    indexRoot,
    sourceRoots,
    replacementRoots,
    writerResult,
    writerResultPath,
    getExistingRelationships: existingRelationshipsForSource,
    repoRoot,
  }).result;
}

export function writeWorkRecordSourceSupersessionIndex({
  sourceRef = '',
  replacementRef = '',
  indexRoot = '',
  sourceRoots = [],
  replacementRoots = [],
  writerResult = null,
  writerResultPath = '',
  dryRun = false,
  repoRoot = process.cwd(),
} = {}) {
  const mode = dryRun ? 'dry_run' : 'write';
  const plan = buildSourceSupersessionPlan({
    sourceRef,
    replacementRef,
    indexRoot,
    sourceRoots,
    replacementRoots,
    writerResult,
    writerResultPath,
    getExistingRelationships: existingRelationshipsForSource,
    repoRoot,
  });
  if (plan.result.status !== 'dry_run') {
    return {
      ...plan.result,
      mode,
      index_writer_result: {
        ...plan.result.index_writer_result,
        status: plan.result.status,
      },
    };
  }
  if (dryRun) {
    return plan.result;
  }
  const { entry, content, source, replacement, index, idempotency } = plan;
  if (idempotency.existing) {
    return baseWriteResult({
      status: 'already_exists',
      mode,
      entry,
      source,
      replacement,
      index,
      idempotency,
      atomicWrite: {
        planned: false,
        temp_file: '',
        rename: false,
      },
    });
  }

  const parent = path.dirname(index.index_path);
  const tempFile = path.join(parent, `.${path.basename(index.index_path)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.mkdirSync(parent, { recursive: true });
    fs.writeFileSync(tempFile, content, { flag: 'wx' });
    fs.renameSync(tempFile, index.index_path);
  } catch (error) {
    const diagnostics = [{
      severity: 'error',
      code: 'SUPERSESSION_INDEX_WRITE_FAILED',
      message: `Source Supersession Index failed to write atomically: ${error.message}`,
      path: 'index_path',
    }];
    try {
      if (fs.existsSync(tempFile)) fs.rmSync(tempFile, { force: true });
    } catch (cleanupError) {
      diagnostics.push({
        severity: 'error',
        code: 'SUPERSESSION_INDEX_TEMP_CLEANUP_FAILED',
        message: `Source Supersession Index failed to clean temp file: ${cleanupError.message}`,
        path: tempFile,
      });
      return baseWriteResult({
        status: 'blocked_cleanup_failed',
        mode,
        entry,
        source,
        replacement,
        index,
        idempotency,
        atomicWrite: { temp_file: tempFile, rename: false, cleanup_failed: true },
        diagnostics,
      });
    }
    return baseWriteResult({
      status: 'blocked_write_failed',
      mode,
      entry,
      source,
      replacement,
      index,
      idempotency,
      atomicWrite: { temp_file: tempFile, rename: false },
      diagnostics,
    });
  }
  return baseWriteResult({
    status: 'written',
    mode,
    entry,
    source,
    replacement,
    index,
    idempotency,
    atomicWrite: {
      temp_file: tempFile,
      rename: true,
      temp_file_leftover: fs.existsSync(tempFile),
    },
  });
}

export function lookupWorkRecordSourceSupersession({
  sourceRef = '',
  indexRoot = '',
  sourceRoots = [],
  replacementRoots = [],
  repoRoot = process.cwd(),
} = {}) {
  const diagnostics = [];
  if (!text(indexRoot) || rawPathHasTraversal(indexRoot)) {
    addDiagnostic(diagnostics, 'SUPERSESSION_INDEX_ROOT_REQUIRED', 'lookup requires an explicit safe index_root.', 'index_root');
    return {
      type: 'work_record.source_supersession_index_lookup_result',
      schema_version: WORK_RECORD_SOURCE_SUPERSESSION_INDEX_SCHEMA_VERSION,
      status: 'blocked_index_escape',
      relationship_status: 'blocked_index_escape',
      entries: [],
      malformed_entries: [],
      read_only: true,
      mutates_state: false,
      mutates_source_record: false,
      mutates_replacement_record: false,
      executes_repair: false,
      executes_actions: false,
      applies_patches: false,
      automatic_replay_allowed: false,
      diagnostics,
    };
  }
  const sourceRead = readRecordIdentity(sourceRef, {
    roots: sourceRoots,
    repoRoot,
    invalidStatus: 'blocked_invalid_source',
    diagnosticPrefix: 'SOURCE',
  });
  if (sourceRead.status !== 'success') {
    return {
      type: 'work_record.source_supersession_index_lookup_result',
      schema_version: WORK_RECORD_SOURCE_SUPERSESSION_INDEX_SCHEMA_VERSION,
      status: 'blocked_invalid_source',
      relationship_status: 'blocked_invalid_source',
      source_work_record: {},
      entries: [],
      malformed_entries: [],
      read_only: true,
      mutates_state: false,
      mutates_source_record: false,
      mutates_replacement_record: false,
      executes_repair: false,
      executes_actions: false,
      applies_patches: false,
      automatic_replay_allowed: false,
      diagnostics: sourceRead.diagnostics,
    };
  }
  const rootResolved = path.resolve(indexRoot);
  if (!fs.existsSync(rootResolved)) {
    return {
      type: 'work_record.source_supersession_index_lookup_result',
      schema_version: WORK_RECORD_SOURCE_SUPERSESSION_INDEX_SCHEMA_VERSION,
      status: 'not_found',
      relationship_status: 'not_found',
      index_root: rootResolved,
      source_work_record: sourceRead.identity,
      entries: [],
      malformed_entries: [],
      read_only: true,
      mutates_state: false,
      mutates_source_record: false,
      mutates_replacement_record: false,
      executes_repair: false,
      executes_actions: false,
      applies_patches: false,
      automatic_replay_allowed: false,
      diagnostics: [],
    };
  }
  const existing = existingRelationshipsForSource(rootResolved, sourceRead.identity);
  const entries = existing.matches.map((match) => {
    const replacementReadback = resolveReplacementReadback(match.entry, replacementRoots, repoRoot);
    return {
      index_path: match.path,
      source_work_record: cloneJson(match.entry.source_work_record),
      replacement_work_record: cloneJson(match.entry.replacement_work_record),
      relationship_status: text(match.entry.relationship_status, 'active'),
      replacement_readback: {
        status: replacementReadback.status,
        readable: replacementReadback.readable,
        read_proven: replacementReadback.read_proven,
        resolved_root: replacementReadback.resolved_root,
        resolved_path: text(replacementReadback.identity?.path),
        resolved_digest: text(replacementReadback.identity?.digest),
        diagnostics: replacementReadback.diagnostics,
      },
      recommended_next: {
        action: replacementReadback.status === 'readable'
          ? 'read_replacement_work_record'
          : replacementReadback.status === 'index_only'
            ? 'supply_replacement_root_to_prove_readability'
            : 'inspect_replacement_readback_diagnostics',
        command_hint: replacementReadback.recommended_command_hint,
      },
      entry: cloneJson(match.entry),
    };
  });
  const replacementKeys = new Set(entries.map((entry) => `${text(entry.replacement_work_record.id)}\0${text(entry.replacement_work_record.digest)}`));
  const readbackDiagnostics = entries.flatMap((entry) => arrayValue(entry.replacement_readback?.diagnostics));
  const hasReplacementRoot = arrayValue(replacementRoots).some((root) => text(root));
  const readbackFailed = hasReplacementRoot && entries.some((entry) => text(entry.replacement_readback?.status) !== 'readable');
  const relationshipStatus = existing.malformed.length > 0
    ? 'malformed_index'
    : entries.length === 0
      ? 'not_found'
      : replacementKeys.size > 1
        ? 'conflict'
        : readbackFailed
          ? 'blocked_invalid_replacement'
          : 'active';
  return {
    type: 'work_record.source_supersession_index_lookup_result',
    schema_version: WORK_RECORD_SOURCE_SUPERSESSION_INDEX_SCHEMA_VERSION,
    status: relationshipStatus,
    relationship_status: relationshipStatus,
    index_root: rootResolved,
    roots: {
      source_roots: cloneJson(sourceRoots),
      replacement_roots: cloneJson(replacementRoots),
    },
    source_work_record: sourceRead.identity,
    entries,
    malformed_entries: existing.malformed.map((item) => ({
      index_path: item.path,
      relationship_status: 'malformed_index',
      diagnostics: item.diagnostics,
    })),
    read_only: true,
    mutates_state: false,
    mutates_source_record: false,
    mutates_replacement_record: false,
    executes_repair: false,
    executes_actions: false,
    applies_patches: false,
    automatic_replay_allowed: false,
    diagnostics: [
      ...existing.malformed.flatMap((item) => item.diagnostics),
      ...readbackDiagnostics,
    ],
  };
}
