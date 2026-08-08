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
  digestJsonValue,
  rawPathHasTraversal,
  readRecordIdentity,
  text,
  addDiagnostic,
} from './work-record-supersession-plan.js';
import {
  workRecordReadRecommendation,
} from './work-record-command-recommendation.js';
import {
  publishTextFileIfAbsent,
  readTextFileNoFollow,
} from './work-record-atomic-publish.js';

export {
  WORK_RECORD_SOURCE_SUPERSESSION_ENTRY_TYPE,
  WORK_RECORD_SOURCE_SUPERSESSION_INDEX_SCHEMA_VERSION,
  WORK_RECORD_SOURCE_SUPERSESSION_INDEX_STATUSES,
  validateWorkRecordSourceSupersessionEntry,
} from './work-record-supersession-plan.js';

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function rawText(value, fallback = '') {
  const raw = String(value ?? '');
  return raw || fallback;
}

function containedPath(child, root) {
  const relative = path.relative(root, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolvedRootContainsPath(root = '', file = '') {
  const rootValue = rawText(root);
  const fileValue = rawText(file);
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
  return arrayValue(roots).map(rawText).find((root) => resolvedRootContainsPath(root, file)) || '';
}

function replacementReadRecommendation(identity = {}, resolvedRoot = '') {
  const id = text(identity.id);
  const root = rawText(resolvedRoot || (identity.path ? path.dirname(identity.path) : ''));
  if (!id || !root) return { argv: [], command_hint: '' };
  return workRecordReadRecommendation(id, root);
}

function identityAfterPublication(planned = {}, {
  roots = [],
  repoRoot = process.cwd(),
  diagnosticPrefix = 'SOURCE',
  invalidStatus = 'blocked_invalid_source',
} = {}) {
  const read = readRecordIdentity(rawText(planned.path), {
    roots,
    repoRoot,
    diagnosticPrefix,
    invalidStatus,
  });
  const diagnostics = [];
  if (read.status !== 'success') {
    return {
      status: 'failed',
      identity: {},
      diagnostics: arrayValue(read.diagnostics),
    };
  }
  const actual = read.identity;
  for (const [field, expected, observed] of [
    ['id', text(planned.id), text(actual.id)],
    ['path', rawText(planned.path), rawText(actual.path)],
    ['schema_version', text(planned.schema_version), text(actual.schema_version)],
    ['digest', text(planned.digest), text(actual.digest)],
  ]) {
    if (expected === observed) continue;
    addDiagnostic(
      diagnostics,
      `SUPERSESSION_INDEX_${diagnosticPrefix}_CHANGED_AFTER_PUBLICATION`,
      `${diagnosticPrefix === 'SOURCE' ? 'Source' : 'Replacement'} Work Record identity changed during Source Supersession Index publication.`,
      `${diagnosticPrefix.toLowerCase()}_work_record.${field}`,
      { field, expected, actual: observed },
    );
  }
  return {
    status: diagnostics.length === 0 ? 'passed' : 'failed',
    identity: actual,
    diagnostics,
  };
}

function indexDigestReadback(indexPath = '', indexRoot = '', expectedIdentity = null) {
  const readback = readTextFileNoFollow(indexPath, {
    boundaryRoot: indexRoot || path.dirname(indexPath),
    expectedIdentity,
  });
  if (readback.status !== 'readable') {
    return {
      status: 'failed',
      digest: '',
      diagnostics: [{
        severity: 'error',
        code: 'SUPERSESSION_INDEX_PUBLISHED_READBACK_FAILED',
        message: `Published Source Supersession Index entry could not be read back: ${readback.error?.message || readback.status}`,
        path: 'index_path',
      }],
    };
  }
  return {
    status: 'passed',
    digest: readback.existing_digest,
    identity: cloneJson(readback.identity),
    diagnostics: [],
  };
}

function resolveReplacementReadback(entry = {}, replacementRoots = [], repoRoot = process.cwd()) {
  const indexed = entry && typeof entry === 'object' ? entry.replacement_work_record || {} : {};
  const roots = arrayValue(replacementRoots).map(rawText).filter(Boolean);
  if (roots.length === 0) {
    return {
      status: 'index_only',
      readable: false,
      read_proven: false,
      identity: cloneJson(indexed),
      resolved_root: '',
      diagnostics: [],
      recommended_read: { argv: [], command_hint: '' },
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
      recommended_read: { argv: [], command_hint: '' },
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
  if (rawText(indexed.path) && !rootContainingPath(roots, indexed.path)) {
    addDiagnostic(
      diagnostics,
      'SUPERSESSION_LOOKUP_INDEXED_REPLACEMENT_PATH_OUTSIDE_ROOT',
      'Indexed replacement path is not under any supplied replacement root.',
      'entry.replacement_work_record.path',
      { indexed_replacement_path: rawText(indexed.path), replacement_roots: roots },
    );
  }
  if (rawText(indexed.path) && rawText(indexed.path) !== rawText(read.identity.path)) {
    addDiagnostic(
      diagnostics,
      'SUPERSESSION_LOOKUP_REPLACEMENT_PATH_MISMATCH',
      'Resolved replacement Work Record path does not match the exact physical path committed by the Source Supersession Index entry.',
      'replacement_work_record.path',
      { expected: rawText(indexed.path), actual: rawText(read.identity.path) },
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
  const indexedProposal = objectValue(entry.replacement_proposal);
  const embeddedProposal = objectValue(objectValue(objectValue(read.record).metadata).replacement_writer).replacement_proposal;
  const indexedProposalIdentity = {
    id: text(indexedProposal.id),
    digest: text(indexedProposal.digest),
    schema_version: text(indexedProposal.schema_version),
  };
  const embeddedProposalIdentity = {
    id: text(embeddedProposal.id),
    digest: text(embeddedProposal.digest),
    schema_version: text(embeddedProposal.schema_version),
  };
  if (digestJsonValue(indexedProposalIdentity) !== digestJsonValue(embeddedProposalIdentity)) {
    addDiagnostic(
      diagnostics,
      'SUPERSESSION_LOOKUP_REPLACEMENT_PROPOSAL_MISMATCH',
      'Indexed replacement Proposal identity does not match the replacement Work Record embedded Writer provenance.',
      'entry.replacement_proposal',
      { expected: embeddedProposalIdentity, actual: indexedProposalIdentity },
    );
  }
  const status = diagnostics.some((diagnostic) => diagnostic.code === 'SUPERSESSION_LOOKUP_REPLACEMENT_PROPOSAL_MISMATCH')
    ? 'provenance_mismatch'
    : diagnostics.some((diagnostic) => diagnostic.code === 'SUPERSESSION_LOOKUP_REPLACEMENT_DIGEST_MISMATCH')
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
    recommended_read: status === 'readable'
      ? replacementReadRecommendation(read.identity, resolvedRoot)
      : { argv: [], command_hint: '' },
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
    const existingIndexReadback = indexDigestReadback(index.index_path, index.index_root);
    if (existingIndexReadback.status !== 'passed') {
      return baseWriteResult({
        status: 'blocked_write_failed',
        mode,
        entry,
        source,
        replacement,
        index,
        idempotency,
        atomicWrite: {
          planned: false,
          temp_file: '',
          create_if_absent: false,
        },
        diagnostics: existingIndexReadback.diagnostics,
      });
    }
    return baseWriteResult({
      status: 'already_exists',
      mode,
      entry,
      source,
      replacement,
      index: { ...index, digest: existingIndexReadback.digest },
      idempotency,
      atomicWrite: {
        planned: false,
        temp_file: '',
        create_if_absent: false,
        destination_identity: cloneJson(existingIndexReadback.identity),
      },
    });
  }

  const publication = publishTextFileIfAbsent(index.index_path, content, { boundaryRoot: index.index_root });
  const publishedIndexReadback = publication.published === true
    ? publication.status === 'cleanup_failed' && publication.existing_digest
      ? {
        status: 'passed',
        digest: publication.existing_digest,
        identity: cloneJson(publication.identity),
        diagnostics: [],
      }
      : indexDigestReadback(index.index_path, index.index_root, publication.identity)
    : null;
  const postPublicationSource = publication.published === true
    ? identityAfterPublication(source, {
      roots: sourceRoots,
      repoRoot,
      diagnosticPrefix: 'SOURCE',
      invalidStatus: 'blocked_invalid_source',
    })
    : null;
  const postPublicationReplacement = publication.published === true
    ? identityAfterPublication(replacement, {
      roots: replacementRoots,
      repoRoot,
      diagnosticPrefix: 'REPLACEMENT',
      invalidStatus: 'blocked_invalid_replacement',
    })
    : null;
  const postPublicationDiagnostics = [
    ...arrayValue(postPublicationSource?.diagnostics),
    ...arrayValue(postPublicationReplacement?.diagnostics),
    ...arrayValue(publishedIndexReadback?.diagnostics),
  ];
  if (publication.published === true && postPublicationDiagnostics.length > 0) {
    const cleanupFailed = publication.status === 'cleanup_failed';
    const identityChanged = postPublicationSource?.status === 'failed'
      || postPublicationReplacement?.status === 'failed';
    return baseWriteResult({
      status: identityChanged ? 'blocked_source_changed' : 'blocked_write_failed',
      mode,
      entry,
      source,
      replacement,
      index: publishedIndexReadback?.status === 'passed'
        ? { ...index, digest: publishedIndexReadback.digest }
        : index,
      idempotency,
      atomicWrite: {
        temp_file: publication.temp_file,
        create_if_absent: true,
        published: true,
        cleanup_failed: cleanupFailed,
        temp_file_leftover: publication.temp_file_leftover === true,
        destination_identity: cloneJson(publication.identity),
        source_identity_after_publication: cloneJson(postPublicationSource?.identity),
        replacement_identity_after_publication: cloneJson(postPublicationReplacement?.identity),
      },
      diagnostics: [
        ...postPublicationDiagnostics,
        ...(cleanupFailed ? [{
          severity: 'error',
          code: 'SUPERSESSION_INDEX_TEMP_CLEANUP_FAILED',
          message: `Source Supersession Index failed to clean temp file: ${publication.cleanup_error?.message || 'unknown cleanup failure'}`,
          path: 'index_path',
        }] : []),
      ],
    });
  }
  if (publication.status === 'identical_existing') {
    const existingIndexReadback = indexDigestReadback(
      index.index_path,
      index.index_root,
      publication.identity,
    );
    if (existingIndexReadback.status !== 'passed') {
      return baseWriteResult({
        status: 'blocked_write_failed',
        mode,
        entry,
        source,
        replacement,
        index,
        idempotency,
        atomicWrite: { temp_file: publication.temp_file, create_if_absent: true, raced: true, published: false },
        diagnostics: existingIndexReadback.diagnostics,
      });
    }
    return baseWriteResult({
      status: 'already_exists',
      mode,
      entry,
      source,
      replacement,
      index: { ...index, digest: existingIndexReadback.digest },
      idempotency: { ...idempotency, status: 'identical_existing', existing: true },
      atomicWrite: {
        temp_file: publication.temp_file,
        create_if_absent: true,
        raced: true,
        published: false,
        destination_identity: cloneJson(publication.identity),
      },
    });
  }
  if (publication.status !== 'published') {
    const cleanupFailed = publication.status === 'cleanup_failed';
    const conflict = publication.status === 'conflict';
    const error = publication.cleanup_error || publication.error;
    const diagnostics = [{
      severity: 'error',
      code: cleanupFailed
        ? 'SUPERSESSION_INDEX_TEMP_CLEANUP_FAILED'
        : conflict
          ? 'SUPERSESSION_INDEX_CONFLICT'
          : 'SUPERSESSION_INDEX_WRITE_FAILED',
      message: cleanupFailed
        ? `Source Supersession Index failed to clean temp file: ${error?.message || 'unknown cleanup failure'}`
        : conflict
          ? 'Index path was created concurrently with different content; existing bytes were preserved.'
          : `Source Supersession Index failed to publish atomically: ${error?.message || publication.status}`,
      path: 'index_path',
    }];
    return baseWriteResult({
      status: cleanupFailed ? 'blocked_cleanup_failed' : conflict ? 'conflict' : 'blocked_write_failed',
      mode,
      entry,
      source,
      replacement,
      index: publication.published && publishedIndexReadback?.status === 'passed'
        ? { ...index, digest: publishedIndexReadback.digest }
        : index,
      idempotency: conflict ? { ...idempotency, status: 'conflict', existing: true } : idempotency,
      atomicWrite: {
        temp_file: publication.temp_file,
        create_if_absent: true,
        raced: conflict,
        published: publication.published,
        cleanup_failed: cleanupFailed,
        destination_identity: publication.published ? cloneJson(publication.identity) : {},
      },
      diagnostics,
    });
  }
  return baseWriteResult({
    status: 'written',
    mode,
    entry,
    source,
    replacement,
    index: { ...index, digest: publishedIndexReadback.digest },
    idempotency,
    atomicWrite: {
      temp_file: publication.temp_file,
      create_if_absent: true,
      published: true,
      temp_file_leftover: publication.temp_file_leftover === true,
      destination_identity: cloneJson(publication.identity),
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
      diagnostics: [],
    };
  }
  let existing;
  try {
    existing = existingRelationshipsForSource(rootResolved, sourceRead.identity);
  } catch (error) {
    return {
      type: 'work_record.source_supersession_index_lookup_result',
      schema_version: WORK_RECORD_SOURCE_SUPERSESSION_INDEX_SCHEMA_VERSION,
      status: 'malformed_index',
      relationship_status: 'malformed_index',
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
      diagnostics: [{
        severity: 'error',
        code: 'SUPERSESSION_LOOKUP_INDEX_READ_FAILED',
        message: `Source Supersession Index could not be scanned: ${error.message}`,
        path: rootResolved,
      }],
    };
  }
  let entries;
  try {
    entries = existing.matches.map((match) => {
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
          resolved_path: rawText(replacementReadback.identity?.path),
          resolved_digest: text(replacementReadback.identity?.digest),
          diagnostics: replacementReadback.diagnostics,
        },
        recommended_next: {
          action: replacementReadback.status === 'readable'
            ? 'read_replacement_work_record'
            : replacementReadback.status === 'index_only'
              ? 'supply_replacement_root_to_prove_readability'
              : 'inspect_replacement_readback_diagnostics',
          argv: replacementReadback.recommended_read.argv,
          command_hint: replacementReadback.recommended_read.command_hint,
        },
        entry: cloneJson(match.entry),
      };
    });
  } catch (error) {
    return {
      type: 'work_record.source_supersession_index_lookup_result',
      schema_version: WORK_RECORD_SOURCE_SUPERSESSION_INDEX_SCHEMA_VERSION,
      status: 'malformed_index',
      relationship_status: 'malformed_index',
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
      diagnostics: [{
        severity: 'error',
        code: 'SUPERSESSION_LOOKUP_REPLACEMENT_READBACK_FAILED',
        message: `Replacement Work Record containment or readback failed: ${error.message}`,
        path: 'replacement_roots',
      }],
    };
  }
  const replacementKeys = new Set(entries.map((entry) => `${text(entry.replacement_work_record.id)}\0${text(entry.replacement_work_record.digest)}`));
  const readbackDiagnostics = entries.flatMap((entry) => arrayValue(entry.replacement_readback?.diagnostics));
  const hasReplacementRoot = arrayValue(replacementRoots).some((root) => rawText(root));
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
    diagnostics: [
      ...existing.malformed.flatMap((item) => item.diagnostics),
      ...readbackDiagnostics,
    ],
  };
}
