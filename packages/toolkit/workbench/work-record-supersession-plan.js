import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  isWorkRecordV1,
} from './work-record-adapter.js';
import {
  readWorkRecord,
} from './work-record-consumer.js';
import {
  digestJson as digestJsonValue,
  digestText as digestTextValue,
  WORK_RECORD_REPLACEMENT_PROPOSAL_SCHEMA_VERSION,
  WORK_RECORD_REPLACEMENT_PROPOSAL_TYPE,
} from './work-record-replacement-proposal.js';
import {
  WORK_RECORD_REPLACEMENT_WRITER_RESULT_SCHEMA_VERSION,
  WORK_RECORD_REPLACEMENT_WRITER_RESULT_TYPE,
} from './work-record-replacement-writer.js';
import {
  workRecordSupersessionLookupRecommendation,
} from './work-record-command-recommendation.js';
import {
  readTextFileNoFollow,
} from './work-record-atomic-publish.js';

export const WORK_RECORD_SOURCE_SUPERSESSION_INDEX_SCHEMA_VERSION = '2026-08-work-record-source-supersession-index-v1';
export const WORK_RECORD_SOURCE_SUPERSESSION_ENTRY_TYPE = 'work_record.source_supersession_entry';

export const WORK_RECORD_SOURCE_SUPERSESSION_INDEX_STATUSES = [
  'dry_run',
  'written',
  'active',
  'not_found',
  'already_exists',
  'conflict',
  'blocked_invalid_source',
  'blocked_invalid_replacement',
  'blocked_source_changed',
  'blocked_relationship_mismatch',
  'blocked_index_escape',
  'blocked_write_failed',
  'blocked_cleanup_failed',
  'malformed_index',
  'unsupported',
];

const CREATED_AT = '2026-07-04T00:00:00.000Z';

export { digestJsonValue };

export function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function rawText(value, fallback = '') {
  const raw = String(value ?? '');
  return raw || fallback;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

export function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function fileDigest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function addDiagnostic(diagnostics, code, message, diagnosticPath, extra = {}) {
  diagnostics.push({
    severity: 'error',
    code,
    message,
    path: diagnosticPath,
    ...extra,
  });
}

export function rawPathHasTraversal(value = '') {
  return String(value).split(/[\\/]+/).includes('..') || String(value).includes('\0');
}

function realExistingPath(target) {
  let current = path.resolve(target);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return '';
    current = parent;
  }
  return fs.realpathSync(current);
}

function ancestorPathViolation(absolutePath) {
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

function containedPath(child, root) {
  const relative = path.relative(root, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeStem(value = '') {
  const input = text(value);
  if (!input || path.isAbsolute(input) || input.includes('/') || input.includes('\\') || input.includes('\0')) return '';
  const stem = input.replace(/[^A-Za-z0-9._:-]/g, '_');
  if (!stem || stem === '.' || stem === '..' || stem.includes('..')) return '';
  return stem;
}

function readJsonFile(file) {
  try {
    return { value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (error) {
    return { error };
  }
}

export function readRecordIdentity(ref, {
  roots = [],
  repoRoot = process.cwd(),
  invalidStatus = 'blocked_invalid_source',
  diagnosticPrefix = 'SOURCE',
} = {}) {
  const read = readWorkRecord(ref, { roots, repoRoot });
  if (read.status !== 'success') {
    return {
      status: invalidStatus,
      diagnostics: read.diagnostics && read.diagnostics.length > 0
        ? read.diagnostics
        : [{
          severity: 'error',
          code: `SUPERSESSION_INDEX_${diagnosticPrefix}_READ_FAILED`,
          message: read.error || `Could not read ${diagnosticPrefix.toLowerCase()} Work Record.`,
          path: ref,
        }],
    };
  }
  const sourcePath = rawText(read.source?.path);
  const ancestorViolation = sourcePath ? ancestorPathViolation(sourcePath) : null;
  const pinnedRead = sourcePath ? readTextFileNoFollow(sourcePath) : { status: 'missing' };
  if (ancestorViolation?.reason === 'symlink_ancestor' || pinnedRead.status !== 'readable') {
    const error = pinnedRead.error || new Error(ancestorViolation?.reason === 'symlink_ancestor'
      ? 'Work Record path traverses a symlinked ancestor.'
      : `Work Record path identity is not safely readable (${pinnedRead.status}).`);
    return {
      status: invalidStatus,
      diagnostics: [{
        severity: 'error',
        code: `SUPERSESSION_INDEX_${diagnosticPrefix}_DIGEST_READ_FAILED`,
        message: `${diagnosticPrefix === 'SOURCE' ? 'Source' : 'Replacement'} Work Record digest could not be read without following path indirection: ${error.message}`,
        path: sourcePath || rawText(ref),
      }],
    };
  }
  let pinnedRecord;
  try {
    pinnedRecord = JSON.parse(pinnedRead.bytes);
  } catch (error) {
    return {
      status: invalidStatus,
      diagnostics: [{
        severity: 'error',
        code: `SUPERSESSION_INDEX_${diagnosticPrefix}_DIGEST_READ_FAILED`,
        message: `${diagnosticPrefix === 'SOURCE' ? 'Source' : 'Replacement'} Work Record pinned bytes could not be parsed: ${error.message}`,
        path: sourcePath || rawText(ref),
      }],
    };
  }
  if (digestJsonValue(pinnedRecord) !== digestJsonValue(read.record)) {
    return {
      status: invalidStatus,
      diagnostics: [{
        severity: 'error',
        code: `SUPERSESSION_INDEX_${diagnosticPrefix}_DIGEST_READ_FAILED`,
        message: `${diagnosticPrefix === 'SOURCE' ? 'Source' : 'Replacement'} Work Record changed between validation and pinned identity readback.`,
        path: sourcePath || rawText(ref),
      }],
    };
  }
  return {
    status: 'success',
    record: pinnedRecord,
    identity: {
      id: text(read.record?.id || read.summary?.id),
      path: sourcePath,
      requested_ref: rawText(ref),
      schema_version: text(read.record?.schema_version || read.summary?.schema_version),
      digest: pinnedRead.existing_digest,
      digest_algorithm: 'sha256',
    },
  };
}

function replacementSupersession(record = {}) {
  const metadata = objectValue(objectValue(record.metadata).replacement_writer);
  const supersedes = objectValue(metadata.supersedes_source);
  const reference = arrayValue(record.references)
    .map(objectValue)
    .find((item) => text(item.relationship) === 'supersedes');
  return {
    source_work_record_id: text(supersedes.source_work_record_id || reference?.ref),
    relationship: text(supersedes.relationship || reference?.relationship),
    source_record_edited: supersedes.source_record_edited,
    provenance_source: objectValue(metadata.source_work_record),
    replacement_writer: metadata,
  };
}

function validateWriterResultObject(value = {}, { allowDryRun = false } = {}) {
  const diagnostics = [];
  if (text(value.type) !== WORK_RECORD_REPLACEMENT_WRITER_RESULT_TYPE) {
    addDiagnostic(diagnostics, 'SUPERSESSION_INDEX_WRITER_RESULT_TYPE_INVALID', 'writer_result type is not work_record.replacement_writer_result.', 'writer_result.type');
  }
  if (text(value.schema_version) !== WORK_RECORD_REPLACEMENT_WRITER_RESULT_SCHEMA_VERSION) {
    addDiagnostic(diagnostics, 'SUPERSESSION_INDEX_WRITER_RESULT_SCHEMA_INVALID', 'writer_result schema_version is unsupported.', 'writer_result.schema_version');
  }
  const allowedStatuses = allowDryRun ? ['dry_run', 'written', 'already_exists'] : ['written', 'already_exists'];
  if (!allowedStatuses.includes(text(value.status))) {
    addDiagnostic(
      diagnostics,
      'SUPERSESSION_INDEX_WRITER_RESULT_STATUS_INVALID',
      allowDryRun ? 'writer_result must be dry_run, written, or already_exists.' : 'writer_result must be written or already_exists.',
      'writer_result.status',
    );
  }
  const replacementProposal = objectValue(value.replacement_proposal);
  if (text(replacementProposal.type) !== WORK_RECORD_REPLACEMENT_PROPOSAL_TYPE) {
    addDiagnostic(diagnostics, 'SUPERSESSION_INDEX_WRITER_RESULT_PROPOSAL_TYPE_INVALID', 'writer_result replacement_proposal type is unsupported.', 'writer_result.replacement_proposal.type');
  }
  if (text(replacementProposal.schema_version) !== WORK_RECORD_REPLACEMENT_PROPOSAL_SCHEMA_VERSION) {
    addDiagnostic(diagnostics, 'SUPERSESSION_INDEX_WRITER_RESULT_PROPOSAL_SCHEMA_INVALID', 'writer_result replacement_proposal schema_version is unsupported.', 'writer_result.replacement_proposal.schema_version');
  }
  if (text(replacementProposal.status) !== 'proposed') {
    addDiagnostic(diagnostics, 'SUPERSESSION_INDEX_WRITER_RESULT_PROPOSAL_STATUS_INVALID', 'writer_result replacement_proposal status must be proposed.', 'writer_result.replacement_proposal.status');
  }
  for (const [field, candidate] of [
    ['replacement_proposal.id', value.replacement_proposal?.id],
    ['replacement_proposal.digest', value.replacement_proposal?.digest],
    ['replacement_proposal.schema_version', value.replacement_proposal?.schema_version],
    ['source_work_record.id', value.source_work_record?.id],
    ['source_work_record.path', value.source_work_record?.path],
    ['source_work_record.digest', value.source_work_record?.digest],
    ['written_replacement_work_record.id', value.written_replacement_work_record?.id],
    ['written_replacement_work_record.digest', value.written_replacement_work_record?.digest],
    ['written_replacement_work_record.schema_version', value.written_replacement_work_record?.schema_version],
    ['output.output_path', value.output?.output_path],
    ['output.digest', value.output?.digest],
  ]) {
    if (!rawText(candidate)) addDiagnostic(diagnostics, 'SUPERSESSION_INDEX_WRITER_RESULT_INCOMPLETE', `writer_result ${field} is required.`, `writer_result.${field}`);
  }
  const immutability = objectValue(value.source_immutability_check);
  if (text(immutability.status) !== 'passed'
    || !text(immutability.expected_digest)
    || text(immutability.expected_digest) !== text(immutability.actual_digest)) {
    addDiagnostic(diagnostics, 'SUPERSESSION_INDEX_WRITER_RESULT_SOURCE_CHECK_INVALID', 'writer_result requires a passed exact source immutability check.', 'writer_result.source_immutability_check');
  }
  const successful = ['written', 'already_exists'].includes(text(value.status));
  if (value.writes_replacement_record !== successful
    || value.would_write_replacement_record !== (text(value.status) === 'dry_run')
    || value.mutates_source_record !== false
    || value.executes_repair !== false
    || value.executes_actions !== false
    || value.applies_patches !== false) {
    addDiagnostic(diagnostics, 'SUPERSESSION_INDEX_WRITER_RESULT_FLAGS_INVALID', 'writer_result write and non-execution flags must exactly match its status.', 'writer_result');
  }
  return diagnostics;
}

function loadWriterResult(file = '', { allowDryRun = false } = {}) {
  const writerResultPath = rawText(file);
  if (!writerResultPath) return { writerResult: {}, diagnostics: [] };
  if (!fs.existsSync(writerResultPath)) {
    return {
      writerResult: {},
      diagnostics: [{
        severity: 'error',
        code: 'SUPERSESSION_INDEX_WRITER_RESULT_NOT_FOUND',
        message: 'Replacement Writer Result path is not readable.',
        path: 'writer_result',
      }],
    };
  }
  const loaded = readJsonFile(writerResultPath);
  if (loaded.error) {
    return {
      writerResult: {},
      diagnostics: [{
        severity: 'error',
        code: 'SUPERSESSION_INDEX_WRITER_RESULT_INVALID_JSON',
        message: `Replacement Writer Result JSON is invalid: ${loaded.error.message}`,
        path: 'writer_result',
      }],
    };
  }
  const value = objectValue(loaded.value);
  const diagnostics = validateWriterResultObject(value, { allowDryRun });
  return {
    writerResult: value,
    diagnostics,
  };
}

function normalizeWriterResult({
  writerResult = null,
  writerResultPath = '',
  allowDryRunWriterResult = false,
} = {}) {
  if (writerResult && typeof writerResult === 'object' && Object.keys(writerResult).length > 0) {
    const value = objectValue(writerResult);
    return {
      writerResult: value,
      diagnostics: validateWriterResultObject(value, { allowDryRun: allowDryRunWriterResult }),
    };
  }
  return loadWriterResult(writerResultPath, { allowDryRun: allowDryRunWriterResult });
}

function identityFromRecord(ref, record = {}, { recordPath = '', requestedRef = '' } = {}) {
  const resolvedPath = rawText(recordPath || ref);
  return {
    id: text(record?.id),
    path: resolvedPath,
    requested_ref: rawText(requestedRef || ref || resolvedPath),
    schema_version: text(record?.schema_version),
    digest: resolvedPath && fs.existsSync(resolvedPath) ? fileDigest(resolvedPath) : digestTextValue(stableJson(record)),
    digest_algorithm: 'sha256',
  };
}

function resolveIndexPath({ indexRoot = '', source = {}, replacement = {}, entryId = '' } = {}) {
  const diagnostics = [];
  if (!text(indexRoot)) {
    addDiagnostic(diagnostics, 'SUPERSESSION_INDEX_ROOT_REQUIRED', 'Source Supersession Index requires an explicit index_root.', 'index_root');
    return { diagnostics };
  }
  if (rawPathHasTraversal(indexRoot)) {
    addDiagnostic(diagnostics, 'SUPERSESSION_INDEX_ROOT_TRAVERSAL', 'index_root must not contain path traversal.', 'index_root');
    return { diagnostics };
  }
  const rootResolved = path.resolve(indexRoot);
  let rootExistingReal = '';
  try {
    const ancestorViolation = ancestorPathViolation(rootResolved);
    if (ancestorViolation?.reason === 'symlink_ancestor') {
      addDiagnostic(diagnostics, 'SUPERSESSION_INDEX_ROOT_SYMLINK_ANCESTOR', 'index_root must not be reached through a symlinked ancestor.', 'index_root', {
        ancestor_path: ancestorViolation.path,
      });
      return { diagnostics, index_root: rootResolved };
    }
    if (ancestorViolation?.reason === 'parent_not_directory') {
      addDiagnostic(diagnostics, 'SUPERSESSION_INDEX_ROOT_ANCESTOR_NOT_DIRECTORY', 'index_root must have only directory ancestors.', 'index_root', {
        ancestor_path: ancestorViolation.path,
      });
      return { diagnostics, index_root: rootResolved };
    }
    if (fs.existsSync(rootResolved)) {
      const rootStat = fs.lstatSync(rootResolved);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        addDiagnostic(diagnostics, 'SUPERSESSION_INDEX_ROOT_NOT_DIRECTORY', 'index_root must be a real directory.', 'index_root');
        return { diagnostics, index_root: rootResolved };
      }
    }
    rootExistingReal = realExistingPath(rootResolved);
    if (!rootExistingReal) {
      addDiagnostic(diagnostics, 'SUPERSESSION_INDEX_ROOT_UNRESOLVABLE', 'Could not resolve index_root containment.', 'index_root');
      return { diagnostics };
    }
    if (!fs.statSync(rootExistingReal).isDirectory()) {
      addDiagnostic(diagnostics, 'SUPERSESSION_INDEX_ROOT_ANCESTOR_NOT_DIRECTORY', 'index_root must have a directory ancestor.', 'index_root');
      return { diagnostics, index_root: rootResolved };
    }
  } catch (error) {
    addDiagnostic(diagnostics, 'SUPERSESSION_INDEX_ROOT_UNREADABLE', `index_root containment could not be inspected: ${error.message}`, 'index_root');
    return { diagnostics, index_root: rootResolved, failure_status: 'blocked_write_failed' };
  }
  const sourceDigest = text(source.digest);
  const replacementDigest = text(replacement.digest);
  const sourceIdentityDigest = digestJsonValue({
    id: text(source.id),
    path: rawText(source.path),
    schema_version: text(source.schema_version),
    digest: sourceDigest,
  });
  const sourceStem = safeStem(`${text(source.id)}-${sourceIdentityDigest.slice(0, 24)}`);
  const entryStem = safeStem(entryId);
  if (!sourceStem || !entryStem || !sourceDigest || !replacementDigest) {
    addDiagnostic(diagnostics, 'SUPERSESSION_INDEX_IDENTITY_UNSAFE', 'Source Supersession Index identity cannot be mapped to a safe path.', 'index_path');
    return { diagnostics };
  }
  const entryDir = path.join(rootResolved, 'source-supersession', 'v1', sourceStem);
  const indexPath = path.join(entryDir, 'active.json');
  let parentExistingReal = '';
  let outputExistingReal = '';
  try {
    parentExistingReal = realExistingPath(entryDir);
    outputExistingReal = fs.existsSync(indexPath) ? realExistingPath(indexPath) : '';
  } catch (error) {
    addDiagnostic(diagnostics, 'SUPERSESSION_INDEX_PATH_UNREADABLE', `Index path containment could not be inspected: ${error.message}`, 'index_path');
    return {
      diagnostics,
      index_root: rootResolved,
      index_path: indexPath,
      deterministic_filename: 'active.json',
      failure_status: 'blocked_write_failed',
    };
  }
  if (!containedPath(path.resolve(entryDir), rootResolved) || !containedPath(parentExistingReal, rootExistingReal)) {
    addDiagnostic(diagnostics, 'SUPERSESSION_INDEX_PATH_ESCAPE', 'Index path must stay inside index_root.', 'index_path');
  }
  if (outputExistingReal && !containedPath(outputExistingReal, rootExistingReal)) {
    addDiagnostic(diagnostics, 'SUPERSESSION_INDEX_SYMLINK_ESCAPE', 'Index path resolves outside index_root.', 'index_path');
  }
  return {
    diagnostics,
    index_root: rootResolved,
    index_path: indexPath,
    deterministic_filename: 'active.json',
  };
}

function persistedWriterResult(writerResult = {}) {
  return writerResultIdentityProjection(writerResult);
}

function proposalIdentityProjection(proposal = {}) {
  const value = objectValue(proposal);
  return {
    id: text(value.id),
    digest: text(value.digest),
    schema_version: text(value.schema_version),
  };
}

function writerResultIdentityProjection(writerResult = {}) {
  const value = objectValue(writerResult);
  const output = objectValue(value.output);
  return {
    type: text(value.type),
    schema_version: text(value.schema_version),
    id: text(value.id || value.replacement_proposal?.id),
    replacement_proposal: proposalIdentityProjection(value.replacement_proposal),
    written_replacement_work_record: cloneJson(objectValue(value.written_replacement_work_record)),
    output: {
      output_root: rawText(output.output_root),
      output_path: rawText(output.output_path),
      deterministic_filename: text(output.deterministic_filename),
      digest: text(output.digest),
    },
  };
}

function relationshipIdentity({ source = {}, replacement = {}, writerResult = {} } = {}) {
  const core = {
    schema_version: WORK_RECORD_SOURCE_SUPERSESSION_INDEX_SCHEMA_VERSION,
    relationship: 'superseded_by',
    source_work_record: {
      id: text(source.id),
      path: rawText(source.path),
      digest: text(source.digest),
      schema_version: text(source.schema_version),
    },
    replacement_work_record: {
      id: text(replacement.id),
      path: rawText(replacement.path),
      digest: text(replacement.digest),
      schema_version: text(replacement.schema_version),
    },
    replacement_writer_result: writerResultIdentityProjection(writerResult),
    replacement_proposal: proposalIdentityProjection(writerResult.replacement_proposal),
  };
  const digest = digestJsonValue(core);
  return {
    id: `source-supersession-entry:${digest.slice(0, 24)}`,
    digest,
    core,
  };
}

function entryFromInputs({
  source = {},
  replacement = {},
  writerResult = {},
  identity = {},
  index = {},
} = {}) {
  return {
    type: WORK_RECORD_SOURCE_SUPERSESSION_ENTRY_TYPE,
    schema_version: WORK_RECORD_SOURCE_SUPERSESSION_INDEX_SCHEMA_VERSION,
    status: 'active',
    id: identity.id,
    source_work_record: {
      id: text(source.id),
      path: rawText(source.path),
      requested_ref: rawText(source.requested_ref),
      schema_version: text(source.schema_version),
      digest: text(source.digest),
      digest_algorithm: 'sha256',
    },
    replacement_work_record: {
      id: text(replacement.id),
      path: rawText(replacement.path),
      requested_ref: rawText(replacement.requested_ref),
      schema_version: text(replacement.schema_version),
      digest: text(replacement.digest),
      digest_algorithm: 'sha256',
    },
    relationship: 'superseded_by',
    relationship_status: 'active',
    supersession_entry_identity: {
      id: identity.id,
      digest: identity.digest,
      digest_algorithm: 'sha256',
      identity_core: cloneJson(identity.core),
    },
    replacement_writer_result: writerResult && Object.keys(writerResult).length > 0
      ? persistedWriterResult(writerResult)
      : {},
    replacement_proposal: writerResult && Object.keys(writerResult).length > 0
      ? proposalIdentityProjection(writerResult.replacement_proposal)
      : {},
    source_immutability_check: {
      status: 'passed',
      source_path: rawText(source.path),
      expected_digest: text(source.digest),
      actual_digest: text(source.digest),
      digest_algorithm: 'sha256',
    },
    index_root: rawText(index.index_root),
    index_path: rawText(index.index_path),
    created_at: CREATED_AT,
    metadata: {},
    mutates_source_record: false,
    mutates_replacement_record: false,
    executes_repair: false,
    executes_actions: false,
    applies_patches: false,
    diagnostics: [],
  };
}

function canonicalIndexPathForEntry(indexRoot = '', entry = {}) {
  const root = path.resolve(indexRoot);
  const source = objectValue(entry.source_work_record);
  const sourceIdentityDigest = digestJsonValue({
    id: text(source.id),
    path: rawText(source.path),
    schema_version: text(source.schema_version),
    digest: text(source.digest),
  });
  const sourceStem = safeStem(`${text(source.id)}-${sourceIdentityDigest.slice(0, 24)}`);
  const entryStem = safeStem(entry.id);
  if (!sourceStem || !entryStem) return '';
  return path.join(root, 'source-supersession', 'v1', sourceStem, 'active.json');
}

export function baseWriteResult({
  status = 'unsupported',
  mode = 'write',
  entry = null,
  source = {},
  replacement = {},
  index = {},
  idempotency = {},
  atomicWrite = {},
  diagnostics = [],
} = {}) {
  const wrote = status === 'written' || status === 'already_exists';
  const destinationPublished = wrote || atomicWrite.published === true;
  const lookupRecommendation = destinationPublished
    ? workRecordSupersessionLookupRecommendation(text(source.id), rawText(index.index_root))
    : null;
  return {
    type: 'work_record.source_supersession_index_writer_result',
    schema_version: WORK_RECORD_SOURCE_SUPERSESSION_INDEX_SCHEMA_VERSION,
    status,
    mode,
    index_writer_result: {
      status,
      index_root: rawText(index.index_root),
      index_path: rawText(index.index_path),
      relationship: 'superseded_by',
    },
    supersession_entry: entry ? {
      id: text(entry.id),
      digest: text(entry.supersession_entry_identity?.digest),
      path: rawText(index.index_path),
      status: text(entry.status),
    } : {},
    source_work_record: {
      id: text(source.id),
      path: rawText(source.path),
      digest: text(source.digest),
    },
    replacement_work_record: {
      id: text(replacement.id),
      path: rawText(replacement.path),
      digest: text(replacement.digest),
    },
    output: {
      index_root: rawText(index.index_root),
      index_path: rawText(index.index_path),
      deterministic_filename: text(index.deterministic_filename),
      digest: text(index.digest),
    },
    idempotency,
    atomic_write: atomicWrite,
    side_effects: destinationPublished ? ['write_source_supersession_index_entry'] : [],
    writes_index_entry: destinationPublished,
    would_write_index_entry: status === 'dry_run',
    mutates_source_record: false,
    mutates_replacement_record: false,
    executes_repair: false,
    executes_actions: false,
    applies_patches: false,
    diagnostics,
    recommended_next: wrote
      ? {
        action: 'lookup_source_supersession_entry',
        argv: lookupRecommendation.argv,
        command_hint: lookupRecommendation.command_hint,
      }
      : destinationPublished
        ? {
          action: 'inspect_published_index_and_cleanup_temp',
          argv: lookupRecommendation.argv,
          command_hint: lookupRecommendation.command_hint,
          temp_file: rawText(atomicWrite.temp_file),
        }
        : {
        action: status === 'dry_run' ? 'rerun_without_dry_run_to_write_index' : 'inspect_index_writer_diagnostics',
      },
  };
}

export function validateWorkRecordSourceSupersessionEntry(entry = {}) {
  const value = objectValue(entry);
  const diagnostics = [];
  function add(code, message, diagnosticPath, extra = {}) {
    addDiagnostic(diagnostics, code, message, diagnosticPath, extra);
  }
  if (text(value.type) !== WORK_RECORD_SOURCE_SUPERSESSION_ENTRY_TYPE) {
    add('SUPERSESSION_ENTRY_TYPE_INVALID', 'Supersession entry type must be work_record.source_supersession_entry.', 'type');
  }
  if (text(value.schema_version) !== WORK_RECORD_SOURCE_SUPERSESSION_INDEX_SCHEMA_VERSION) {
    add('SUPERSESSION_ENTRY_SCHEMA_INVALID', 'Supersession entry schema_version is unsupported.', 'schema_version');
  }
  if (text(value.status) !== 'active') {
    add('SUPERSESSION_ENTRY_STATUS_INVALID', 'Persisted supersession entries must have status active.', 'status');
  }
  if (text(value.relationship_status) !== 'active') {
    add('SUPERSESSION_ENTRY_RELATIONSHIP_STATUS_INVALID', 'Persisted supersession entries must have relationship_status active.', 'relationship_status');
  }
  if (text(value.relationship) !== 'superseded_by') {
    add('SUPERSESSION_ENTRY_RELATIONSHIP_INVALID', 'Supersession entry relationship must be superseded_by.', 'relationship');
  }
  const source = objectValue(value.source_work_record);
  const replacement = objectValue(value.replacement_work_record);
  if (!text(source.id) || !text(source.digest)) add('SUPERSESSION_ENTRY_SOURCE_IDENTITY_INCOMPLETE', 'source_work_record requires id and digest.', 'source_work_record');
  if (!text(replacement.id) || !text(replacement.digest)) add('SUPERSESSION_ENTRY_REPLACEMENT_IDENTITY_INCOMPLETE', 'replacement_work_record requires id and digest.', 'replacement_work_record');
  const claimedIndexRoot = rawText(value.index_root);
  const claimedIndexPath = rawText(value.index_path);
  if (!claimedIndexRoot || claimedIndexRoot !== path.resolve(claimedIndexRoot)) {
    add('SUPERSESSION_ENTRY_INDEX_ROOT_NONCANONICAL', 'Persisted index_root must be an exact absolute path.', 'index_root');
  }
  const expectedIndexPath = claimedIndexRoot
    ? canonicalIndexPathForEntry(claimedIndexRoot, value)
    : '';
  if (!claimedIndexPath || claimedIndexPath !== expectedIndexPath) {
    add('SUPERSESSION_ENTRY_INDEX_PATH_NONCANONICAL', 'Persisted index_path must be the deterministic active.json path for this exact source and entry identity.', 'index_path', {
      expected_index_path: expectedIndexPath,
      actual_index_path: claimedIndexPath,
    });
  }
  for (const field of [
    'mutates_source_record',
    'mutates_replacement_record',
    'executes_repair',
    'executes_actions',
    'applies_patches',
  ]) {
    if (value[field] !== false) add('SUPERSESSION_ENTRY_NON_EXECUTION_FLAG_INVALID', `${field} must be false.`, field);
  }
  const identity = objectValue(value.supersession_entry_identity);
  const identityCore = objectValue(identity.identity_core);
  const storedWriterResult = objectValue(value.replacement_writer_result);
  const storedProposal = objectValue(value.replacement_proposal);
  if (digestJsonValue(storedProposal) !== digestJsonValue(proposalIdentityProjection(storedProposal))) {
    add('SUPERSESSION_ENTRY_REPLACEMENT_PROPOSAL_PROJECTION_MISMATCH', 'Persisted replacement_proposal must contain exactly the closed identity projection.', 'replacement_proposal');
  }
  const expectedStoredWriterResult = persistedWriterResult(storedWriterResult);
  if (digestJsonValue(storedWriterResult) !== digestJsonValue(expectedStoredWriterResult)) {
    add('SUPERSESSION_ENTRY_WRITER_RESULT_PROJECTION_MISMATCH', 'Persisted replacement_writer_result must contain exactly the identity-bound stable Writer projection with no unbound receipt fields.', 'replacement_writer_result');
  }
  if (!text(storedProposal.id) || !text(storedProposal.digest) || !text(storedProposal.schema_version)) {
    add('SUPERSESSION_ENTRY_REPLACEMENT_PROPOSAL_INCOMPLETE', 'replacement_proposal requires exact id, digest, and schema_version provenance.', 'replacement_proposal');
  }
  if (digestJsonValue(storedProposal) !== digestJsonValue(storedWriterResult.replacement_proposal)) {
    add('SUPERSESSION_ENTRY_REPLACEMENT_PROPOSAL_MISMATCH', 'Top-level replacement_proposal must exactly match the persisted Writer Result mirror.', 'replacement_proposal');
  }
  const expectedIdentityCore = {
    schema_version: text(value.schema_version),
    relationship: text(value.relationship),
    source_work_record: {
      id: text(source.id),
      path: rawText(source.path),
      digest: text(source.digest),
      schema_version: text(source.schema_version),
    },
    replacement_work_record: {
      id: text(replacement.id),
      path: rawText(replacement.path),
      digest: text(replacement.digest),
      schema_version: text(replacement.schema_version),
    },
    replacement_writer_result: writerResultIdentityProjection(storedWriterResult),
    replacement_proposal: cloneJson(storedProposal),
  };
  if (Object.hasOwn(objectValue(value.replacement_writer_result), 'digest')) {
    add('SUPERSESSION_ENTRY_WRITER_RESULT_DIGEST_UNSUPPORTED', 'Supersession entries do not store an unverifiable full Writer-result digest; output.digest is the bound provenance digest.', 'replacement_writer_result.digest');
  }
  const expectedIdentityDigest = digestJsonValue(expectedIdentityCore);
  const expectedIdentityId = `source-supersession-entry:${expectedIdentityDigest.slice(0, 24)}`;
  if (!text(identity.id) || !text(identity.digest)) {
    add('SUPERSESSION_ENTRY_IDENTITY_INCOMPLETE', 'supersession_entry_identity requires id and digest.', 'supersession_entry_identity');
  } else {
    if (Object.keys(identityCore).length === 0 || digestJsonValue(identityCore) !== expectedIdentityDigest) {
      add('SUPERSESSION_ENTRY_IDENTITY_CORE_MISMATCH', 'supersession_entry_identity identity_core must exactly match the top-level relationship and record identities.', 'supersession_entry_identity.identity_core');
    }
    if (text(identity.digest) !== expectedIdentityDigest) {
      add('SUPERSESSION_ENTRY_IDENTITY_DIGEST_MISMATCH', 'supersession_entry_identity digest does not match the exact entry identity core.', 'supersession_entry_identity.digest');
    }
    if (text(identity.id) !== expectedIdentityId || text(value.id) !== expectedIdentityId) {
      add('SUPERSESSION_ENTRY_IDENTITY_ID_MISMATCH', 'Entry id and supersession_entry_identity.id must match the exact identity digest.', 'supersession_entry_identity.id');
    }
  }
  const immutability = objectValue(value.source_immutability_check);
  if (text(immutability.status) !== 'passed'
    || text(immutability.expected_digest) !== text(source.digest)
    || text(immutability.actual_digest) !== text(source.digest)) {
    add('SUPERSESSION_ENTRY_SOURCE_IMMUTABILITY_MISMATCH', 'Source immutability receipt must bind the exact source digest.', 'source_immutability_check');
  }
  return {
    type: 'work_record.source_supersession_entry.validation',
    schema_version: WORK_RECORD_SOURCE_SUPERSESSION_INDEX_SCHEMA_VERSION,
    status: diagnostics.length > 0 ? 'failed' : 'passed',
    relationship_status: diagnostics.length > 0 ? 'malformed_index' : 'active',
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

function validateEntryFile(scannedFile, indexRoot) {
  const file = scannedFile.path;
  const readback = readTextFileNoFollow(file, {
    boundaryRoot: indexRoot,
    expectedIdentity: scannedFile.identity,
  });
  let value;
  try {
    if (readback.status !== 'readable') throw readback.error || new Error(`descriptor-relative read failed (${readback.status})`);
    value = JSON.parse(readback.bytes);
  } catch (error) {
    return {
      path: file,
      status: 'malformed_index',
      diagnostics: [{
        severity: 'error',
        code: 'SUPERSESSION_INDEX_ENTRY_JSON_INVALID',
        message: `Supersession index entry JSON is invalid or changed after enumeration: ${error.message}`,
        path: file,
      }],
    };
  }
  const validation = validateWorkRecordSourceSupersessionEntry(value);
  const diagnostics = [...validation.diagnostics];
  const physicalPath = path.resolve(file);
  const scannedRoot = path.resolve(indexRoot);
  if (rawText(value.index_root) !== scannedRoot) {
    addDiagnostic(
      diagnostics,
      'SUPERSESSION_INDEX_ENTRY_ROOT_MISMATCH',
      'Persisted index_root does not match the explicit root being scanned.',
      file,
      { expected_index_root: scannedRoot, actual_index_root: rawText(value.index_root) },
    );
  }
  if (rawText(value.index_path) !== physicalPath) {
    addDiagnostic(
      diagnostics,
      'SUPERSESSION_INDEX_ENTRY_PHYSICAL_PATH_MISMATCH',
      'Persisted index_path does not match the exact file being scanned.',
      file,
      { expected_index_path: physicalPath, actual_index_path: rawText(value.index_path) },
    );
  }
  return {
    path: file,
    status: diagnostics.length === 0 ? 'active' : 'malformed_index',
    entry: diagnostics.length === 0 ? value : undefined,
    diagnostics,
  };
}

function indexFiles(indexRoot = '') {
  const root = path.resolve(indexRoot);
  const base = path.join(root, 'source-supersession', 'v1');
  const ancestorViolation = ancestorPathViolation(root);
  if (ancestorViolation) {
    const error = new Error(ancestorViolation.reason === 'symlink_ancestor'
      ? 'Source Supersession Index root may not traverse a symlinked ancestor.'
      : 'Source Supersession Index root must have only directory ancestors.');
    error.code = 'SUPERSESSION_INDEX_TREE_ESCAPE';
    throw error;
  }
  if (!fs.existsSync(root)) return [];
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    const error = new Error('Source Supersession Index root must be a real directory.');
    error.code = 'SUPERSESSION_INDEX_TREE_ESCAPE';
    throw error;
  }
  const rootReal = fs.realpathSync(root);
  if (!fs.existsSync(base)) return [];
  const baseStat = fs.lstatSync(base);
  const baseReal = fs.realpathSync(base);
  if (!baseStat.isDirectory() || baseStat.isSymbolicLink() || !containedPath(baseReal, rootReal)) {
    const error = new Error('Source Supersession Index tree must be a real directory contained by index_root.');
    error.code = 'SUPERSESSION_INDEX_TREE_ESCAPE';
    throw error;
  }
  const files = [];
  const stack = [base];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const name of fs.readdirSync(dir).sort()) {
      const next = path.join(dir, name);
      const stat = fs.lstatSync(next);
      if (stat.isSymbolicLink()) {
        const error = new Error('Source Supersession Index entries may not traverse symlinks.');
        error.code = 'SUPERSESSION_INDEX_TREE_ESCAPE';
        throw error;
      }
      const nextReal = fs.realpathSync(next);
      if (!containedPath(nextReal, rootReal)) {
        const error = new Error('Source Supersession Index entry resolves outside index_root.');
        error.code = 'SUPERSESSION_INDEX_TREE_ESCAPE';
        throw error;
      }
      if (stat.isDirectory()) stack.push(next);
      else if (stat.isFile() && name.endsWith('.json')) {
        files.push({
          path: next,
          identity: {
            dev: String(stat.dev),
            ino: String(stat.ino),
          },
        });
      }
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function existingRelationshipsForSource(indexRoot, source = {}) {
  const matches = [];
  const malformed = [];
  for (const file of indexFiles(indexRoot)) {
    const checked = validateEntryFile(file, indexRoot);
    if (checked.status === 'malformed_index') {
      malformed.push(checked);
      continue;
    }
    const entry = checked.entry;
    const entrySource = {
      id: text(entry.source_work_record?.id),
      path: rawText(entry.source_work_record?.path),
      schema_version: text(entry.source_work_record?.schema_version),
      digest: text(entry.source_work_record?.digest),
    };
    const requestedSource = {
      id: text(source.id),
      path: rawText(source.path),
      schema_version: text(source.schema_version),
      digest: text(source.digest),
    };
    if (digestJsonValue(entrySource) === digestJsonValue(requestedSource)) {
      matches.push({ path: file.path, entry });
    }
  }
  return { matches, malformed };
}

export function buildSourceSupersessionPlan({
  sourceRef = '',
  replacementRef = '',
  sourceRecord = null,
  replacementRecord = null,
  sourcePath = '',
  replacementPath = '',
  indexRoot = '',
  sourceRoots = [],
  replacementRoots = [],
  writerResult = null,
  writerResultPath = '',
  allowDryRunWriterResult = false,
  getExistingRelationships = existingRelationshipsForSource,
  repoRoot = process.cwd(),
} = {}) {
  const mode = 'dry_run';
  const sourceRead = sourceRecord
    ? {
      status: 'success',
      record: sourceRecord,
      identity: identityFromRecord(sourceRef, sourceRecord, { recordPath: sourcePath, requestedRef: sourceRef }),
    }
    : readRecordIdentity(sourceRef, {
      roots: sourceRoots,
      repoRoot,
      invalidStatus: 'blocked_invalid_source',
      diagnosticPrefix: 'SOURCE',
    });
  if (sourceRead.status !== 'success') {
    return { result: baseWriteResult({ status: 'blocked_invalid_source', mode, diagnostics: sourceRead.diagnostics }) };
  }

  const replacementRead = replacementRecord
    ? {
      status: 'success',
      record: replacementRecord,
      identity: identityFromRecord(replacementRef, replacementRecord, { recordPath: replacementPath, requestedRef: replacementRef }),
    }
    : readRecordIdentity(replacementRef, {
      roots: replacementRoots,
      repoRoot,
      invalidStatus: 'blocked_invalid_replacement',
      diagnosticPrefix: 'REPLACEMENT',
    });
  if (replacementRead.status !== 'success') {
    return {
      result: baseWriteResult({
        status: 'blocked_invalid_replacement',
        mode,
        source: sourceRead.identity,
        diagnostics: replacementRead.diagnostics,
      }),
    };
  }
  if (!isWorkRecordV1(sourceRead.record)) {
    return {
      result: baseWriteResult({
        status: 'blocked_invalid_source',
        mode,
        source: sourceRead.identity,
        replacement: replacementRead.identity,
        diagnostics: [{
          severity: 'error',
          code: 'SUPERSESSION_INDEX_SOURCE_SCHEMA_INVALID',
          message: 'Source Work Record must be a valid active Work Record v1 shape.',
          path: 'source_work_record',
        }],
      }),
    };
  }
  if (!isWorkRecordV1(replacementRead.record)) {
    return {
      result: baseWriteResult({
        status: 'blocked_invalid_replacement',
        mode,
        source: sourceRead.identity,
        replacement: replacementRead.identity,
        diagnostics: [{
          severity: 'error',
          code: 'SUPERSESSION_INDEX_REPLACEMENT_SCHEMA_INVALID',
          message: 'Replacement Work Record must be a valid active Work Record v1 shape.',
          path: 'replacement_work_record',
        }],
      }),
    };
  }

  const writer = normalizeWriterResult({ writerResult, writerResultPath, allowDryRunWriterResult });
  if (writer.diagnostics.length > 0) {
    return {
      result: baseWriteResult({
        status: 'blocked_invalid_replacement',
        mode,
        source: sourceRead.identity,
        replacement: replacementRead.identity,
        diagnostics: writer.diagnostics,
      }),
    };
  }

  const relationship = replacementSupersession(replacementRead.record);
  const relationshipDiagnostics = [];
  if (relationship.source_work_record_id !== sourceRead.identity.id || relationship.relationship !== 'supersedes') {
    addDiagnostic(relationshipDiagnostics, 'SUPERSESSION_INDEX_RELATIONSHIP_MISMATCH', 'Replacement Work Record does not declare that it supersedes the source Work Record.', 'replacement_work_record.metadata.replacement_writer.supersedes_source', {
      expected_source_work_record_id: sourceRead.identity.id,
      actual_source_work_record_id: relationship.source_work_record_id,
    });
  }
  if (relationship.source_record_edited !== false) {
    addDiagnostic(relationshipDiagnostics, 'SUPERSESSION_INDEX_SOURCE_EDIT_CLAIM_UNSUPPORTED', 'Replacement Work Record supersession provenance must report source_record_edited:false.', 'replacement_work_record.metadata.replacement_writer.supersedes_source.source_record_edited');
  }
  const provenanceSource = objectValue(relationship.provenance_source);
  const provenanceDigest = text(provenanceSource.digest || provenanceSource.immutable_readback?.digest);
  if (text(provenanceSource.id) && text(provenanceSource.id) !== sourceRead.identity.id) {
    addDiagnostic(relationshipDiagnostics, 'SUPERSESSION_INDEX_SOURCE_PROVENANCE_ID_MISMATCH', 'Replacement Writer provenance source id does not match source Work Record.', 'replacement_work_record.metadata.replacement_writer.source_work_record.id');
  }
  if (provenanceDigest && provenanceDigest !== sourceRead.identity.digest) {
    addDiagnostic(relationshipDiagnostics, 'SUPERSESSION_INDEX_SOURCE_PROVENANCE_DIGEST_MISMATCH', 'Replacement Writer provenance source digest does not match source Work Record digest.', 'replacement_work_record.metadata.replacement_writer.source_work_record.digest', {
      expected_digest: provenanceDigest,
      actual_digest: sourceRead.identity.digest,
    });
  }
  const writerSource = objectValue(writer.writerResult.source_work_record);
  const writerProposal = objectValue(writer.writerResult.replacement_proposal);
  const provenanceProposal = objectValue(relationship.replacement_writer.replacement_proposal);
  if (text(writerProposal.id) !== text(provenanceProposal.id)
    || text(writerProposal.digest) !== text(provenanceProposal.digest)
    || text(writerProposal.schema_version) !== text(provenanceProposal.schema_version)) {
    addDiagnostic(
      relationshipDiagnostics,
      'SUPERSESSION_INDEX_WRITER_RESULT_PROPOSAL_MISMATCH',
      'Replacement Writer Result proposal identity must exactly match the replacement Work Record embedded writer provenance.',
      'writer_result.replacement_proposal',
      {
        expected_replacement_proposal: cloneJson(provenanceProposal),
        actual_replacement_proposal: cloneJson(writerProposal),
      },
    );
  }
  if (text(writerSource.id) && text(writerSource.id) !== sourceRead.identity.id) {
    addDiagnostic(relationshipDiagnostics, 'SUPERSESSION_INDEX_WRITER_RESULT_SOURCE_ID_MISMATCH', 'Replacement Writer Result source id does not match source Work Record.', 'writer_result.source_work_record.id');
  }
  if (text(writerSource.digest) && text(writerSource.digest) !== sourceRead.identity.digest) {
    addDiagnostic(relationshipDiagnostics, 'SUPERSESSION_INDEX_WRITER_RESULT_SOURCE_DIGEST_MISMATCH', 'Replacement Writer Result source digest does not match source Work Record digest.', 'writer_result.source_work_record.digest');
  }
  if (rawText(writerSource.path) && rawText(writerSource.path) !== rawText(sourceRead.identity.path)) {
    addDiagnostic(relationshipDiagnostics, 'SUPERSESSION_INDEX_WRITER_RESULT_SOURCE_PATH_MISMATCH', 'Replacement Writer Result source path does not match source Work Record.', 'writer_result.source_work_record.path');
  }
  const writerSourceCheck = objectValue(writer.writerResult.source_immutability_check);
  if (rawText(writerSourceCheck.source_path) !== rawText(sourceRead.identity.path)
    || text(writerSourceCheck.expected_digest) !== sourceRead.identity.digest
    || text(writerSourceCheck.actual_digest) !== sourceRead.identity.digest) {
    addDiagnostic(relationshipDiagnostics, 'SUPERSESSION_INDEX_WRITER_RESULT_SOURCE_CHECK_MISMATCH', 'Replacement Writer Result source immutability check must bind the exact source path and digest.', 'writer_result.source_immutability_check');
  }
  const writerReplacement = objectValue(writer.writerResult.written_replacement_work_record);
  if (text(writerReplacement.id) && text(writerReplacement.id) !== replacementRead.identity.id) {
    addDiagnostic(relationshipDiagnostics, 'SUPERSESSION_INDEX_WRITER_RESULT_REPLACEMENT_ID_MISMATCH', 'Replacement Writer Result replacement id does not match replacement Work Record.', 'writer_result.written_replacement_work_record.id');
  }
  if (text(writerReplacement.schema_version) !== replacementRead.identity.schema_version) {
    addDiagnostic(relationshipDiagnostics, 'SUPERSESSION_INDEX_WRITER_RESULT_REPLACEMENT_SCHEMA_MISMATCH', 'Replacement Writer Result replacement schema does not match the replacement Work Record.', 'writer_result.written_replacement_work_record.schema_version');
  }
  if (rawText(writer.writerResult.output?.output_path) !== rawText(replacementRead.identity.path)) {
    addDiagnostic(relationshipDiagnostics, 'SUPERSESSION_INDEX_WRITER_RESULT_OUTPUT_PATH_MISMATCH', 'Replacement Writer Result output path does not match the replacement Work Record path.', 'writer_result.output.output_path');
  }
  const expectedReplacementRecordDigest = digestJsonValue(replacementRead.record);
  const expectedReplacementOutputDigest = replacementRead.identity.digest;
  if (text(writerReplacement.digest) !== expectedReplacementRecordDigest) {
    addDiagnostic(relationshipDiagnostics, 'SUPERSESSION_INDEX_WRITER_RESULT_RECORD_DIGEST_MISMATCH', 'Replacement Writer Result structured-record digest does not match the exact replacement Work Record payload.', 'writer_result.written_replacement_work_record.digest', {
      expected_digest: expectedReplacementRecordDigest,
      actual_digest: text(writerReplacement.digest),
    });
  }
  if (text(writer.writerResult.output?.digest) !== expectedReplacementOutputDigest) {
    addDiagnostic(relationshipDiagnostics, 'SUPERSESSION_INDEX_WRITER_RESULT_OUTPUT_DIGEST_MISMATCH', 'Replacement Writer Result serialized-output digest does not match the exact replacement Work Record bytes.', 'writer_result.output.digest', {
      expected_digest: expectedReplacementOutputDigest,
      actual_digest: text(writer.writerResult.output?.digest),
    });
  }
  if (relationshipDiagnostics.length > 0) {
    const status = relationshipDiagnostics.some((diagnostic) => diagnostic.code.includes('DIGEST'))
      ? 'blocked_source_changed'
      : 'blocked_relationship_mismatch';
    return {
      result: baseWriteResult({
        status,
        mode,
        source: sourceRead.identity,
        replacement: replacementRead.identity,
        diagnostics: relationshipDiagnostics,
      }),
    };
  }

  const identity = relationshipIdentity({
    source: sourceRead.identity,
    replacement: replacementRead.identity,
    writerResult: writer.writerResult,
  });
  const index = resolveIndexPath({
    indexRoot,
    source: sourceRead.identity,
    replacement: replacementRead.identity,
    entryId: identity.id,
  });
  if (index.diagnostics.length > 0) {
    return {
      result: baseWriteResult({
        status: text(index.failure_status, 'blocked_index_escape'),
        mode,
        source: sourceRead.identity,
        replacement: replacementRead.identity,
        index,
        diagnostics: index.diagnostics,
      }),
    };
  }
  const entry = entryFromInputs({
    source: sourceRead.identity,
    replacement: replacementRead.identity,
    writerResult: writer.writerResult,
    identity,
    index,
  });
  const content = stableJson(entry);
  const contentDigest = digestTextValue(content);
  let existing;
  try {
    existing = getExistingRelationships(index.index_root, sourceRead.identity);
  } catch (error) {
    return {
      result: baseWriteResult({
        status: 'blocked_write_failed',
        mode,
        entry,
        source: sourceRead.identity,
        replacement: replacementRead.identity,
        index,
        diagnostics: [{
          severity: 'error',
          code: 'SUPERSESSION_INDEX_SCAN_FAILED',
          message: `Source Supersession Index could not be scanned: ${error.message}`,
          path: index.index_root,
        }],
      }),
    };
  }
  const exactExisting = existing.matches.find((match) => text(match.entry.supersession_entry_identity?.digest) === identity.digest);
  const conflicting = existing.matches.find((match) => text(match.entry.replacement_work_record?.id) !== replacementRead.identity.id
    || text(match.entry.replacement_work_record?.digest) !== replacementRead.identity.digest
    || text(match.entry.supersession_entry_identity?.digest) !== identity.digest);
  if (conflicting && !exactExisting) {
    const sameReplacement = text(conflicting.entry.replacement_work_record?.id) === replacementRead.identity.id
      && text(conflicting.entry.replacement_work_record?.digest) === replacementRead.identity.digest;
    return {
      result: baseWriteResult({
        status: 'conflict',
        mode,
        entry,
        source: sourceRead.identity,
        replacement: replacementRead.identity,
        index,
        idempotency: {
          status: 'conflict',
          existing: true,
          conflicting_index_path: conflicting.path,
        },
        diagnostics: [{
          severity: 'error',
          code: sameReplacement ? 'SUPERSESSION_INDEX_RELATIONSHIP_IDENTITY_CONFLICT' : 'SUPERSESSION_INDEX_CONFLICT',
          message: sameReplacement
            ? 'Source Work Record already has this replacement with a different supersession relationship identity.'
            : 'Source Work Record already has a different active replacement entry.',
          path: conflicting.path,
        }],
      }),
    };
  }
  const existingFile = fs.existsSync(index.index_path);
  let existingDigest = '';
  if (existingFile) {
    try {
      existingDigest = fileDigest(index.index_path);
    } catch (error) {
      return {
        result: baseWriteResult({
          status: 'blocked_write_failed',
          mode,
          entry,
          source: sourceRead.identity,
          replacement: replacementRead.identity,
          index,
          diagnostics: [{
            severity: 'error',
            code: 'SUPERSESSION_INDEX_EXISTING_DIGEST_READ_FAILED',
            message: `Existing Source Supersession Index entry digest could not be read: ${error.message}`,
            path: index.index_path,
          }],
        }),
      };
    }
  }
  const existingContentMatches = Boolean(existingFile) && existingDigest === contentDigest;
  const idempotency = {
    status: existingContentMatches || (exactExisting && !existingFile)
      ? 'identical_existing'
      : existingFile ? 'conflict' : 'new',
    existing: Boolean(exactExisting || existingFile),
    expected_digest: contentDigest,
    existing_digest: existingDigest,
  };
  if (existingFile && !existingContentMatches) {
    return {
      result: baseWriteResult({
        status: 'conflict',
        mode,
        entry,
        source: sourceRead.identity,
        replacement: replacementRead.identity,
        index,
        idempotency: {
          ...idempotency,
          status: 'conflict',
        },
        diagnostics: [{
          severity: 'error',
          code: 'SUPERSESSION_INDEX_ENTRY_PATH_CONFLICT',
          message: 'Index path already exists with different content.',
          path: index.index_path,
        }],
      }),
    };
  }

  const result = baseWriteResult({
    status: 'dry_run',
    mode,
    entry,
    source: sourceRead.identity,
    replacement: replacementRead.identity,
    index,
    idempotency,
    atomicWrite: {
      planned: !idempotency.existing,
      temp_file: path.join(path.dirname(index.index_path), `.${path.basename(index.index_path)}.${process.pid}.tmp`),
      create_if_absent: !idempotency.existing,
    },
  });
  return {
    result,
    entry,
    content,
    source: sourceRead.identity,
    replacement: replacementRead.identity,
    index,
    idempotency,
  };
}

export function planWorkRecordSourceSupersessionFromRecords(options = {}) {
  return buildSourceSupersessionPlan({
    ...options,
    allowDryRunWriterResult: options.allowDryRunWriterResult === true,
  }).result;
}
