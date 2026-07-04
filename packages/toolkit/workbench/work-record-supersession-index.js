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
  const entries = existing.matches.map((match) => ({
    index_path: match.path,
    source_work_record: cloneJson(match.entry.source_work_record),
    replacement_work_record: cloneJson(match.entry.replacement_work_record),
    relationship_status: text(match.entry.relationship_status, 'active'),
    recommended_next: {
      action: 'read_replacement_work_record',
      command_hint: `./aos work-record read ${text(match.entry.replacement_work_record?.id)} --root ${text(match.entry.replacement_work_record?.path ? path.dirname(match.entry.replacement_work_record.path) : '')} --json`,
    },
    entry: cloneJson(match.entry),
  }));
  const replacementKeys = new Set(entries.map((entry) => `${text(entry.replacement_work_record.id)}\0${text(entry.replacement_work_record.digest)}`));
  const relationshipStatus = existing.malformed.length > 0
    ? 'malformed_index'
    : entries.length === 0
      ? 'not_found'
      : replacementKeys.size > 1
        ? 'conflict'
        : 'active';
  return {
    type: 'work_record.source_supersession_index_lookup_result',
    schema_version: WORK_RECORD_SOURCE_SUPERSESSION_INDEX_SCHEMA_VERSION,
    status: relationshipStatus,
    relationship_status: relationshipStatus,
    index_root: rootResolved,
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
    diagnostics: existing.malformed.flatMap((item) => item.diagnostics),
  };
}
