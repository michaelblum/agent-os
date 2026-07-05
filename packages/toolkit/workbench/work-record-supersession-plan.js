import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  isWorkRecordV0,
} from './work-record-adapter.js';
import {
  readWorkRecord,
} from './work-record-consumer.js';
import {
  digestJson as digestJsonValue,
  digestText as digestTextValue,
} from './work-record-replacement-proposal.js';
import {
  WORK_RECORD_REPLACEMENT_WRITER_RESULT_SCHEMA_VERSION,
  WORK_RECORD_REPLACEMENT_WRITER_RESULT_TYPE,
} from './work-record-replacement-writer.js';
import {
  workRecordSupersessionLookupRecommendation,
} from './work-record-command-recommendation.js';

export const WORK_RECORD_SOURCE_SUPERSESSION_INDEX_SCHEMA_VERSION = '2026-07-work-record-source-supersession-index-v0';
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
  return {
    status: 'success',
    record: read.record,
    identity: {
      id: text(read.record?.id || read.summary?.id),
      path: sourcePath,
      requested_ref: rawText(ref),
      schema_version: text(read.record?.schema_version || read.summary?.schema_version),
      digest: sourcePath && fs.existsSync(sourcePath) ? fileDigest(sourcePath) : digestJsonValue(read.record),
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
  if (fs.existsSync(rootResolved) && !fs.statSync(rootResolved).isDirectory()) {
    addDiagnostic(diagnostics, 'SUPERSESSION_INDEX_ROOT_NOT_DIRECTORY', 'index_root must be a directory.', 'index_root');
    return { diagnostics, index_root: rootResolved };
  }
  const rootExistingReal = realExistingPath(rootResolved);
  if (!rootExistingReal) {
    addDiagnostic(diagnostics, 'SUPERSESSION_INDEX_ROOT_UNRESOLVABLE', 'Could not resolve index_root containment.', 'index_root');
    return { diagnostics };
  }
  const sourceDigest = text(source.digest);
  const replacementDigest = text(replacement.digest);
  const sourceStem = safeStem(`${text(source.id)}-${sourceDigest.slice(0, 12)}`);
  const entryStem = safeStem(`${entryId}.json`);
  if (!sourceStem || !entryStem || !sourceDigest || !replacementDigest) {
    addDiagnostic(diagnostics, 'SUPERSESSION_INDEX_IDENTITY_UNSAFE', 'Source Supersession Index identity cannot be mapped to a safe path.', 'index_path');
    return { diagnostics };
  }
  const entryDir = path.join(rootResolved, 'source-supersession', 'v0', sourceStem);
  const indexPath = path.join(entryDir, entryStem);
  const parentExistingReal = realExistingPath(entryDir);
  const outputExistingReal = fs.existsSync(indexPath) ? realExistingPath(indexPath) : '';
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
    deterministic_filename: `${entryId}.json`,
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
    replacement_writer_result: {
      id: text(writerResult?.id || writerResult?.replacement_proposal?.id),
      digest: text(writerResult?.output?.digest || (writerResult && Object.keys(writerResult).length > 0 ? digestJsonValue(writerResult) : '')),
      schema_version: text(writerResult?.schema_version),
    },
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
    replacement_writer_result: writerResult && Object.keys(writerResult).length > 0 ? {
      type: text(writerResult.type),
      schema_version: text(writerResult.schema_version),
      status: text(writerResult.status),
      id: text(writerResult.id || writerResult.replacement_proposal?.id),
      digest: digestJsonValue(writerResult),
      written_replacement_work_record: cloneJson(objectValue(writerResult.written_replacement_work_record)),
      output: cloneJson(objectValue(writerResult.output)),
    } : {},
    replacement_proposal: writerResult && Object.keys(writerResult).length > 0 ? cloneJson(objectValue(writerResult.replacement_proposal)) : {},
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
    automatic_replay_allowed: false,
    diagnostics: [],
  };
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
  const lookupRecommendation = wrote
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
    },
    idempotency,
    atomic_write: atomicWrite,
    side_effects: status === 'written' ? ['write_source_supersession_index_entry'] : [],
    writes_index_entry: status === 'written' || status === 'already_exists',
    would_write_index_entry: status === 'dry_run',
    mutates_source_record: false,
    mutates_replacement_record: false,
    executes_repair: false,
    executes_actions: false,
    applies_patches: false,
    automatic_replay_allowed: false,
    diagnostics,
    recommended_next: wrote
      ? {
        action: 'lookup_source_supersession_entry',
        argv: lookupRecommendation.argv,
        command_hint: lookupRecommendation.command_hint,
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
  if (!WORK_RECORD_SOURCE_SUPERSESSION_INDEX_STATUSES.includes(text(value.status))) {
    add('SUPERSESSION_ENTRY_STATUS_INVALID', 'Supersession entry status is unsupported.', 'status');
  }
  if (text(value.relationship) !== 'superseded_by') {
    add('SUPERSESSION_ENTRY_RELATIONSHIP_INVALID', 'Supersession entry relationship must be superseded_by.', 'relationship');
  }
  const source = objectValue(value.source_work_record);
  const replacement = objectValue(value.replacement_work_record);
  if (!text(source.id) || !text(source.digest)) add('SUPERSESSION_ENTRY_SOURCE_IDENTITY_INCOMPLETE', 'source_work_record requires id and digest.', 'source_work_record');
  if (!text(replacement.id) || !text(replacement.digest)) add('SUPERSESSION_ENTRY_REPLACEMENT_IDENTITY_INCOMPLETE', 'replacement_work_record requires id and digest.', 'replacement_work_record');
  for (const field of [
    'mutates_source_record',
    'mutates_replacement_record',
    'executes_repair',
    'executes_actions',
    'applies_patches',
    'automatic_replay_allowed',
  ]) {
    if (value[field] !== false) add('SUPERSESSION_ENTRY_NON_EXECUTION_FLAG_INVALID', `${field} must be false.`, field);
  }
  const identity = objectValue(value.supersession_entry_identity);
  const identityCore = objectValue(identity.identity_core);
  if (!text(identity.id) || !text(identity.digest)) {
    add('SUPERSESSION_ENTRY_IDENTITY_INCOMPLETE', 'supersession_entry_identity requires id and digest.', 'supersession_entry_identity');
  } else if (Object.keys(identityCore).length > 0 && digestJsonValue(identityCore) !== text(identity.digest)) {
    add('SUPERSESSION_ENTRY_IDENTITY_DIGEST_MISMATCH', 'supersession_entry_identity digest does not match identity_core.', 'supersession_entry_identity.digest');
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
    automatic_replay_allowed: false,
    diagnostics,
  };
}

function validateEntryFile(file) {
  const loaded = readJsonFile(file);
  if (loaded.error) {
    return {
      path: file,
      status: 'malformed_index',
      diagnostics: [{
        severity: 'error',
        code: 'SUPERSESSION_INDEX_ENTRY_JSON_INVALID',
        message: `Supersession index entry JSON is invalid: ${loaded.error.message}`,
        path: file,
      }],
    };
  }
  const validation = validateWorkRecordSourceSupersessionEntry(loaded.value);
  return {
    path: file,
    status: validation.status === 'passed' ? 'active' : 'malformed_index',
    entry: validation.status === 'passed' ? loaded.value : undefined,
    diagnostics: validation.diagnostics,
  };
}

function indexFiles(indexRoot = '') {
  const root = path.resolve(indexRoot);
  const base = path.join(root, 'source-supersession', 'v0');
  if (!fs.existsSync(base)) return [];
  const files = [];
  const stack = [base];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const name of fs.readdirSync(dir).sort()) {
      const next = path.join(dir, name);
      const stat = fs.lstatSync(next);
      if (stat.isDirectory()) stack.push(next);
      else if (stat.isFile() && name.endsWith('.json')) files.push(next);
    }
  }
  return files.sort();
}

export function existingRelationshipsForSource(indexRoot, source = {}) {
  const matches = [];
  const malformed = [];
  for (const file of indexFiles(indexRoot)) {
    const checked = validateEntryFile(file);
    if (checked.status === 'malformed_index') {
      malformed.push(checked);
      continue;
    }
    const entry = checked.entry;
    if (text(entry.source_work_record?.id) === text(source.id)
      || text(entry.source_work_record?.digest) === text(source.digest)) {
      matches.push({ path: file, entry });
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
  if (!isWorkRecordV0(sourceRead.record)) {
    return {
      result: baseWriteResult({
        status: 'blocked_invalid_source',
        mode,
        source: sourceRead.identity,
        replacement: replacementRead.identity,
        diagnostics: [{
          severity: 'error',
          code: 'SUPERSESSION_INDEX_SOURCE_SCHEMA_INVALID',
          message: 'Source Work Record must be a valid Work Record V0 shape.',
          path: 'source_work_record',
        }],
      }),
    };
  }
  if (!isWorkRecordV0(replacementRead.record)) {
    return {
      result: baseWriteResult({
        status: 'blocked_invalid_replacement',
        mode,
        source: sourceRead.identity,
        replacement: replacementRead.identity,
        diagnostics: [{
          severity: 'error',
          code: 'SUPERSESSION_INDEX_REPLACEMENT_SCHEMA_INVALID',
          message: 'Replacement Work Record must be a valid Work Record V0 shape.',
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
  if (text(writerSource.id) && text(writerSource.id) !== sourceRead.identity.id) {
    addDiagnostic(relationshipDiagnostics, 'SUPERSESSION_INDEX_WRITER_RESULT_SOURCE_ID_MISMATCH', 'Replacement Writer Result source id does not match source Work Record.', 'writer_result.source_work_record.id');
  }
  if (text(writerSource.digest) && text(writerSource.digest) !== sourceRead.identity.digest) {
    addDiagnostic(relationshipDiagnostics, 'SUPERSESSION_INDEX_WRITER_RESULT_SOURCE_DIGEST_MISMATCH', 'Replacement Writer Result source digest does not match source Work Record digest.', 'writer_result.source_work_record.digest');
  }
  const writerReplacement = objectValue(writer.writerResult.written_replacement_work_record);
  if (text(writerReplacement.id) && text(writerReplacement.id) !== replacementRead.identity.id) {
    addDiagnostic(relationshipDiagnostics, 'SUPERSESSION_INDEX_WRITER_RESULT_REPLACEMENT_ID_MISMATCH', 'Replacement Writer Result replacement id does not match replacement Work Record.', 'writer_result.written_replacement_work_record.id');
  }
  const writerReplacementDigests = [
    text(writerReplacement.digest),
    text(writer.writerResult.output?.digest),
  ].filter(Boolean);
  if (writerReplacementDigests.length > 0 && !writerReplacementDigests.some((digest) => [digestJsonValue(replacementRead.record), replacementRead.identity.digest].includes(digest))) {
    addDiagnostic(relationshipDiagnostics, 'SUPERSESSION_INDEX_WRITER_RESULT_REPLACEMENT_DIGEST_MISMATCH', 'Replacement Writer Result replacement digest does not match replacement Work Record digest.', 'writer_result.written_replacement_work_record.digest');
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
        status: 'blocked_index_escape',
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
  const existing = getExistingRelationships(index.index_root, sourceRead.identity);
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
  const idempotency = {
    status: exactExisting || existingFile ? 'identical_existing' : 'new',
    existing: Boolean(exactExisting || existingFile),
    expected_digest: contentDigest,
    existing_digest: existingFile ? fileDigest(index.index_path) : '',
  };
  if (existingFile && !exactExisting && idempotency.existing_digest !== contentDigest) {
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
      rename: !idempotency.existing,
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
