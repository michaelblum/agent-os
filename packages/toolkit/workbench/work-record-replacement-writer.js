import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  WORK_RECORD_V1_SCHEMA_VERSION,
  isWorkRecordV1,
} from './work-record-adapter.js';
import {
  runWorkRecordVerifierProfile,
} from './work-record-verifier.js';
import {
  validateWorkRecordReplacementProposal,
  digestJson,
  digestText,
  replacementProposalReferences,
  workRecordImmutableSourceFields,
  WORK_RECORD_REPLACEMENT_PROPOSAL_SCHEMA_VERSION,
  WORK_RECORD_REPLACEMENT_PROPOSAL_TYPE,
} from './work-record-replacement-proposal.js';
import {
  workRecordReadRecommendation,
} from './work-record-command-recommendation.js';
import {
  inspectTextFileDestination,
  publishTextFileIfAbsent,
} from './work-record-atomic-publish.js';

export const WORK_RECORD_REPLACEMENT_WRITER_RESULT_SCHEMA_VERSION = '2026-08-work-record-replacement-writer-result-v1';
export const WORK_RECORD_REPLACEMENT_WRITER_RESULT_TYPE = 'work_record.replacement_writer_result';

export const WORK_RECORD_REPLACEMENT_WRITER_STATUSES = [
  'dry_run',
  'written',
  'already_exists',
  'blocked_invalid_proposal',
  'blocked_invalid_replacement_record',
  'blocked_source_changed',
  'blocked_output_escape',
  'blocked_conflict',
  'blocked_write_failed',
  'blocked_cleanup_failed',
  'unsupported',
];

const CREATED_AT = '2026-07-04T00:00:00.000Z';

function text(value, fallback = '') {
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

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => text(value)).filter(Boolean))].sort();
}

function fileDigest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function safeFileStem(id = '') {
  const value = text(id);
  if (!value || path.isAbsolute(value) || value.includes('/') || value.includes('\\') || value.includes('\0')) return '';
  const stem = value.replace(/[^A-Za-z0-9._:-]/g, '_');
  if (!stem || stem === '.' || stem === '..' || stem.includes('..')) return '';
  return stem;
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

function addDiagnostic(diagnostics, code, message, diagnosticPath, extra = {}) {
  diagnostics.push({
    severity: 'error',
    code,
    message,
    path: diagnosticPath,
    ...extra,
  });
}

function baseResult({
  status = 'unsupported',
  mode = 'write',
  proposal = {},
  output = {},
  idempotency = {},
  sourceCheck = {},
  atomicWrite = {},
  diagnostics = [],
  replacementRecord = null,
} = {}) {
  const successfulWrite = status === 'written' || status === 'already_exists';
  const destinationPublished = successfulWrite || atomicWrite.published === true;
  const readRecommendation = destinationPublished
    ? workRecordReadRecommendation(text(replacementRecord?.id), rawText(output.output_root))
    : { argv: [], command_hint: '' };
  return {
    type: WORK_RECORD_REPLACEMENT_WRITER_RESULT_TYPE,
    schema_version: WORK_RECORD_REPLACEMENT_WRITER_RESULT_SCHEMA_VERSION,
    status,
    mode,
    replacement_proposal: {
      type: text(proposal.type),
      schema_version: text(proposal.schema_version),
      id: text(proposal.replacement_proposal_identity?.id),
      digest: text(proposal.replacement_proposal_identity?.digest, proposal ? digestJson(proposal) : ''),
      status: text(proposal.status),
    },
    source_work_record: {
      id: text(proposal.source_work_record?.id),
      path: rawText(proposal.source_work_record?.path),
      digest: text(proposal.source_work_record?.digest),
    },
    written_replacement_work_record: replacementRecord ? {
      id: text(replacementRecord.id),
      digest: digestJson(replacementRecord),
      schema_version: text(replacementRecord.schema_version),
      health_verdict: text(replacementRecord.health?.verdict),
    } : {},
    output,
    idempotency,
    source_immutability_check: sourceCheck,
    atomic_write: atomicWrite,
    side_effects: destinationPublished ? ['write_replacement_work_record'] : [],
    writes_replacement_record: destinationPublished,
    would_write_replacement_record: status === 'dry_run',
    mutates_source_record: false,
    rewrites_historical_evidence: false,
    executes_repair: false,
    executes_actions: false,
    applies_patches: false,
    diagnostics,
    recommended_next: successfulWrite
      ? {
        action: 'read_written_replacement_work_record',
        argv: readRecommendation.argv,
        command_hint: readRecommendation.command_hint,
      }
      : destinationPublished
        ? {
          action: 'inspect_published_replacement_and_cleanup_temp',
          argv: readRecommendation.argv,
          command_hint: readRecommendation.command_hint,
          temp_file: rawText(atomicWrite.temp_file),
        }
        : {
        action: status === 'dry_run' ? 'rerun_without_dry_run_to_write' : 'inspect_writer_diagnostics',
      },
  };
}

function loadSourceRecord(sourcePath = '') {
  const value = rawText(sourcePath);
  if (!value || !fs.existsSync(value)) return null;
  try {
    const record = JSON.parse(fs.readFileSync(value, 'utf8'));
    return objectValue(record);
  } catch {
    return null;
  }
}

function evidenceFromSource(record = {}, carriedForward = []) {
  void carriedForward;
  return arrayValue(record.evidence).map(cloneJson);
}

function postconditionEvidenceMap(proposal = {}) {
  const mapped = new Map();
  for (const item of arrayValue(proposal.postcondition_evidence_map)) {
    mapped.set(text(objectValue(item).postcondition_id), arrayValue(objectValue(item).evidence_refs).map(text).filter(Boolean));
  }
  return mapped;
}

function evidenceFromArtifact(proposal = {}) {
  const newEvidence = arrayValue(proposal.new_evidence);
  return newEvidence.map((item) => {
    const value = objectValue(item);
    const id = text(value.new_record_evidence_id);
    return {
      id,
      kind: rawText(value.kind, 'repair_attempt_artifact_evidence'),
      created_at: rawText(value.created_at),
      uri: rawText(value.artifact_path, `repair-attempt-artifact:evidence/${text(value.artifact_evidence_id)}`),
      digest: text(value.digest),
      immutable: true,
      summary: `Replacement evidence from Repair Attempt Artifact evidence ${text(value.artifact_evidence_id)}.`,
      metadata: cloneJson(objectValue(value.metadata)),
    };
  });
}

function evidenceRefsForClaim(claim = {}, postconditions = []) {
  const refs = new Set();
  const byId = new Map(arrayValue(postconditions).map((item) => [text(objectValue(item).id), objectValue(item)]));
  for (const postconditionId of arrayValue(objectValue(claim).postcondition_refs)) {
    for (const evidenceRef of arrayValue(byId.get(postconditionId)?.evidence_refs)) refs.add(text(evidenceRef));
  }
  return [...refs].filter(Boolean).sort();
}

function claimResultsForPostconditions({ claims = [], postconditions = [], proposal = {} } = {}) {
  const byId = new Map(arrayValue(postconditions).map((item) => [text(objectValue(item).id), objectValue(item)]));
  const exactArtifactPostconditions = new Set(arrayValue(proposal.postcondition_evidence_map)
    .filter((item) => text(objectValue(item).source) === 'repair_attempt_artifact.postcondition_results'
      && arrayValue(objectValue(item).evidence_refs).length > 0)
    .map((item) => text(objectValue(item).postcondition_id))
    .filter(Boolean));
  return arrayValue(claims).map((claim) => {
    const claimValue = objectValue(claim);
    const evidenceRefs = evidenceRefsForClaim(claimValue, postconditions);
    const postconditionResults = arrayValue(claimValue.postcondition_refs).map((postconditionId) => {
      const id = text(postconditionId);
      const exactCallerEvidence = exactArtifactPostconditions.has(id);
      return {
        postcondition_id: id,
        status: exactCallerEvidence ? 'passed' : 'unchecked',
        evidence_refs: arrayValue(byId.get(id)?.evidence_refs).map(text).filter(Boolean),
        reason: exactCallerEvidence
          ? 'Caller-supplied Repair Attempt Artifact evidence exactly maps this replacement postcondition.'
          : 'No exact caller-supplied evidence maps this replacement postcondition; the historical source result remains unchanged.',
      };
    });
    const verified = postconditionResults.length > 0 && postconditionResults.every((result) => result.status === 'passed');
    return {
      id: `claim-result:${text(claimValue.id).replace(/^claim:/, '')}:replacement-writer`,
      claim_id: text(claimValue.id),
      status: verified ? 'verified' : 'unverified',
      confidence: verified ? 0.9 : 0.5,
      reason: verified
        ? 'Replacement Writer materialized this new result only from exact caller-supplied Repair Attempt Artifact evidence.'
        : 'Replacement Writer did not upgrade the historical result because exact caller-supplied postcondition evidence was incomplete.',
      evidence_refs: evidenceRefs,
      postcondition_results: postconditionResults,
    };
  });
}

export function materializeReplacementWorkRecord(proposal = {}) {
  const proposalValidation = validateWorkRecordReplacementProposal(proposal);
  if (proposalValidation.diagnostics.some((diagnostic) => diagnostic.code === 'REPLACEMENT_PROPOSAL_SOURCE_METADATA_COLLISION')) {
    throw new TypeError('Replacement Proposal validation failed: REPLACEMENT_PROPOSAL_SOURCE_METADATA_COLLISION');
  }
  const proposed = objectValue(proposal.proposed_replacement_work_record);
  const sourceRecord = loadSourceRecord(proposal.source_work_record?.path);
  const sourceOwned = workRecordImmutableSourceFields(sourceRecord || {});
  const carriedEvidence = evidenceFromSource(sourceRecord || {}, proposal.carried_forward_evidence);
  const newEvidence = evidenceFromArtifact(proposal);
  const evidence = [...carriedEvidence, ...newEvidence].filter((item) => text(item.id));
  const evidenceIds = uniqueStrings(evidence.map((item) => item.id));
  const finalHealth = text(proposal.final_proposed_health?.classification || proposed.health?.verdict, 'valid');
  const verifierReportId = `verifier-report:${text(proposed.id).replace(/^work-record:/, '')}:replacement-writer`;
  const claims = cloneJson(arrayValue(sourceOwned.claims));
  const executionMap = cloneJson(objectValue(proposed.execution_map));
  const mappedEvidence = postconditionEvidenceMap(proposal);
  executionMap.postconditions = arrayValue(executionMap.postconditions).map((postcondition) => {
    const value = objectValue(postcondition);
    const mappedRefs = mappedEvidence.get(text(value.id));
    return {
      ...cloneJson(value),
      evidence_refs: mappedRefs && mappedRefs.length > 0 ? mappedRefs : arrayValue(value.evidence_refs),
    };
  });
  const claimResults = claimResultsForPostconditions({
    claims,
    postconditions: executionMap.postconditions,
    proposal,
  });

  const derived = { verified: [], failed: [], unverified: [] };
  for (const result of claimResults) {
    const status = text(objectValue(result).status);
    if (Object.hasOwn(derived, status)) derived[status].push(text(objectValue(result).claim_id));
  }
  for (const status of Object.keys(derived)) derived[status] = uniqueStrings(derived[status]);

  executionMap.repair_history = [
    ...arrayValue(executionMap.repair_history).map(cloneJson),
    {
      kind: 'replacement_writer',
      schema_version: WORK_RECORD_REPLACEMENT_WRITER_RESULT_SCHEMA_VERSION,
      replacement_proposal_id: text(proposal.replacement_proposal_identity?.id),
      repair_attempt_plan_id: text(proposal.replacement_proposal_identity?.repair_attempt_plan?.attempt_id || proposal.repair_attempt_plan?.attempt_id),
      repair_attempt_artifact_id: text(proposal.repair_attempt_artifact?.id),
      source_work_record_id: text(proposal.source_work_record?.id),
      executes_repair: false,
      executes_actions: false,
      applies_patches: false,
      mutates_source_record: false,
    },
  ];

  return {
    type: text(sourceOwned.type, 'aos.work_record'),
    schema_version: text(sourceOwned.schema_version, WORK_RECORD_V1_SCHEMA_VERSION),
    id: text(proposed.id),
    label: rawText(sourceOwned.label, `Replacement Work Record for ${text(proposal.source_work_record?.id)}`),
    created_at: CREATED_AT,
    origin: cloneJson(objectValue(sourceOwned.origin)),
    references: [
      ...replacementProposalReferences({
        sourceRecord: sourceOwned,
        sourceId: proposal.source_work_record?.id,
        planAttemptId: proposal.repair_attempt_plan?.attempt_id,
        artifactId: proposal.repair_attempt_artifact?.id,
      }),
      {
        id: 'derived-from-replacement-proposal',
        relationship: 'derived_from',
        ref: text(proposal.replacement_proposal_identity?.id),
        subject_type: WORK_RECORD_REPLACEMENT_PROPOSAL_TYPE,
        metadata: {
          digest: text(proposal.replacement_proposal_identity?.digest, digestJson(proposal)),
        },
      },
    ],
    intent: cloneJson(objectValue(sourceOwned.intent)),
    execution_map: executionMap,
    evidence,
    claims,
    claim_results: claimResults,
    verifier_report: {
      id: verifierReportId,
      generated_at: CREATED_AT,
      verifier: {
        id: 'aos.verifier.work-record.v1.report-only',
        kind: 'work_record_v1_report_only',
        version: '2026-08-report-only-v1',
      },
      claim_results_ref: 'claim_results',
      claims_digest: claims.map((claim) => ({
        claim_id: text(objectValue(claim).id),
        digest: digestJson(claim),
      })),
      derived_indexes: derived,
      evidence_refs: evidenceIds,
      feedback: ['Replacement Writer materialized a validated Replacement Proposal without executing repair, replay, or patches.'],
    },
    health: {
      verdict: ['valid', 'stale', 'repairable', 'blocked', 'impossible', 'superseded', 'retired'].includes(finalHealth) ? finalHealth : 'blocked',
      reason: 'Materialized from a validated Replacement Proposal; source Work Record remains immutable.',
      evaluated_at: CREATED_AT,
      verifier_report_id: verifierReportId,
      confidence: finalHealth === 'valid' ? 0.9 : 0.5,
    },
    metadata: {
      ...cloneJson(objectValue(sourceOwned.metadata)),
      replacement_proposal: false,
      proposal_only: false,
      persisted: true,
      persisted_by_writer: true,
      replacement_writer: {
        schema_version: WORK_RECORD_REPLACEMENT_WRITER_RESULT_SCHEMA_VERSION,
        source_work_record: cloneJson(objectValue(proposal.source_work_record)),
        replacement_proposal: {
          id: text(proposal.replacement_proposal_identity?.id),
          digest: text(proposal.replacement_proposal_identity?.digest, digestJson(proposal)),
          schema_version: WORK_RECORD_REPLACEMENT_PROPOSAL_SCHEMA_VERSION,
        },
        repair_attempt_plan: cloneJson(objectValue(proposal.repair_attempt_plan)),
        repair_attempt_artifact: cloneJson(objectValue(proposal.repair_attempt_artifact)),
        supersedes_source: {
          source_work_record_id: text(proposal.source_work_record?.id),
          relationship: 'supersedes',
          source_record_edited: false,
        },
        carried_forward_evidence_policy: cloneJson(arrayValue(proposal.carried_forward_evidence)),
        historical_source_claim_results: cloneJson(arrayValue(sourceRecord?.claim_results)),
        historical_source_claim_results_digest: digestJson(arrayValue(sourceRecord?.claim_results)),
        historical_source_claim_results_rewritten: false,
        executes_repair: false,
        executes_actions: false,
        applies_patches: false,
      },
    },
  };
}

function sourceFieldSnapshotCheck(proposal = {}) {
  const sourceRecord = loadSourceRecord(proposal.source_work_record?.path);
  if (!sourceRecord) {
    return {
      status: 'failed',
      diagnostics: [{
        severity: 'error',
        code: 'REPLACEMENT_WRITER_SOURCE_FIELDS_UNREADABLE',
        message: 'Replacement Writer could not load source-owned fields.',
        path: 'source_work_record.path',
      }],
    };
  }
  const actual = workRecordImmutableSourceFields(sourceRecord);
  const expected = objectValue(proposal.source_work_record?.immutable_fields);
  const actualDigest = digestJson(actual);
  const expectedDigest = text(proposal.source_work_record?.immutable_fields_digest);
  if (actualDigest !== expectedDigest || digestJson(expected) !== expectedDigest) {
    return {
      status: 'failed',
      diagnostics: [{
        severity: 'error',
        code: 'REPLACEMENT_WRITER_SOURCE_FIELDS_CHANGED',
        message: 'Source-owned fields do not match the Proposal immutable snapshot.',
        path: 'source_work_record.immutable_fields',
      }],
    };
  }
  const actualEvidenceIds = uniqueStrings(arrayValue(sourceRecord.evidence).map((item) => objectValue(item).id));
  const proposedEvidenceIds = uniqueStrings(arrayValue(proposal.source_work_record?.evidence_ids));
  const carriedEvidenceIds = arrayValue(proposal.carried_forward_evidence).map((item) => text(objectValue(item).source_evidence_id)).filter(Boolean);
  if (digestJson(actualEvidenceIds) !== digestJson(proposedEvidenceIds)
    || new Set(carriedEvidenceIds).size !== carriedEvidenceIds.length
    || digestJson(uniqueStrings(carriedEvidenceIds)) !== digestJson(actualEvidenceIds)) {
    return {
      status: 'failed',
      diagnostics: [{
        severity: 'error',
        code: 'REPLACEMENT_WRITER_SOURCE_EVIDENCE_COVERAGE_MISMATCH',
        message: 'Replacement Writer requires exact one-to-one coverage of every source evidence identity.',
        path: 'carried_forward_evidence',
      }],
    };
  }
  return { status: 'passed', diagnostics: [] };
}

function resolveOutput({ outputRoot = '', outputPath = '', replacementId = '' } = {}) {
  const diagnostics = [];
  if (!text(outputRoot)) {
    addDiagnostic(diagnostics, 'REPLACEMENT_WRITER_OUTPUT_ROOT_REQUIRED', 'Replacement Writer requires an explicit output_root.', 'output_root');
    return { diagnostics };
  }
  const rootResolved = path.resolve(outputRoot);
  let rootExistingReal = '';
  try {
    const ancestorViolation = ancestorPathViolation(rootResolved);
    if (ancestorViolation?.reason === 'symlink_ancestor') {
      addDiagnostic(diagnostics, 'REPLACEMENT_WRITER_OUTPUT_ROOT_SYMLINK_ANCESTOR', 'Replacement Writer output_root must not be reached through a symlinked ancestor.', 'output_root', {
        ancestor_path: ancestorViolation.path,
      });
      return { diagnostics, output_root: rootResolved };
    }
    if (ancestorViolation?.reason === 'parent_not_directory') {
      addDiagnostic(diagnostics, 'REPLACEMENT_WRITER_OUTPUT_ROOT_ANCESTOR_NOT_DIRECTORY', 'Replacement Writer output_root must have only directory ancestors.', 'output_root', {
        ancestor_path: ancestorViolation.path,
      });
      return { diagnostics, output_root: rootResolved };
    }
    if (fs.existsSync(rootResolved)) {
      const rootStat = fs.lstatSync(rootResolved);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
        addDiagnostic(diagnostics, 'REPLACEMENT_WRITER_OUTPUT_ROOT_NOT_DIRECTORY', 'Replacement Writer output_root must be a directory.', 'output_root');
        return { diagnostics, output_root: rootResolved };
      }
    }
    rootExistingReal = realExistingPath(rootResolved);
    if (!rootExistingReal) {
      addDiagnostic(diagnostics, 'REPLACEMENT_WRITER_OUTPUT_ROOT_UNRESOLVABLE', 'Replacement Writer could not resolve output_root containment.', 'output_root');
      return { diagnostics };
    }
    if (!fs.statSync(rootExistingReal).isDirectory()) {
      addDiagnostic(diagnostics, 'REPLACEMENT_WRITER_OUTPUT_ROOT_ANCESTOR_NOT_DIRECTORY', 'Replacement Writer output_root must have a directory ancestor.', 'output_root');
      return { diagnostics, output_root: rootResolved };
    }
  } catch (error) {
    addDiagnostic(diagnostics, 'REPLACEMENT_WRITER_OUTPUT_ROOT_UNREADABLE', `Replacement Writer output_root ancestor could not be inspected: ${error.message}`, 'output_root');
    return { diagnostics, output_root: rootResolved, failure_status: 'blocked_write_failed' };
  }
  const stem = safeFileStem(replacementId);
  if (!stem) {
    addDiagnostic(diagnostics, 'REPLACEMENT_WRITER_OUTPUT_ID_UNSAFE', 'Replacement Work Record id cannot round-trip to a safe output filename.', 'written_replacement_work_record.id');
    return { diagnostics };
  }
  const requestedOutput = rawText(outputPath) ? path.resolve(outputPath) : path.join(rootResolved, `${stem}.json`);
  const outputParent = path.dirname(requestedOutput);
  let outputExistingReal = '';
  let outputParentExistingReal = '';
  try {
    outputExistingReal = realExistingPath(requestedOutput);
    outputParentExistingReal = realExistingPath(outputParent);
  } catch (error) {
    addDiagnostic(diagnostics, 'REPLACEMENT_WRITER_OUTPUT_PATH_UNREADABLE', `Replacement Writer output path containment could not be inspected: ${error.message}`, 'output_path');
    return {
      diagnostics,
      output_root: rootResolved,
      output_path: requestedOutput,
      deterministic_filename: `${stem}.json`,
      failure_status: 'blocked_write_failed',
    };
  }
  if (!containedPath(path.resolve(outputParent), rootResolved) || !containedPath(outputParentExistingReal, rootExistingReal)) {
    addDiagnostic(diagnostics, 'REPLACEMENT_WRITER_OUTPUT_ESCAPE', 'Replacement Writer output path must stay inside output_root.', 'output_path');
  }
  if (outputExistingReal && !containedPath(outputExistingReal, rootExistingReal)) {
    addDiagnostic(diagnostics, 'REPLACEMENT_WRITER_OUTPUT_SYMLINK_ESCAPE', 'Replacement Writer output path resolves outside output_root.', 'output_path');
  }
  if (rawText(outputPath) && path.basename(requestedOutput) !== `${stem}.json`) {
    addDiagnostic(diagnostics, 'REPLACEMENT_WRITER_OUTPUT_NAME_MISMATCH', 'Explicit output_path must use the deterministic replacement id filename.', 'output_path', {
      expected_basename: `${stem}.json`,
      actual_basename: path.basename(requestedOutput),
    });
  }
  return {
    diagnostics,
    output_root: rootResolved,
    output_path: requestedOutput,
    deterministic_filename: `${stem}.json`,
  };
}

function sourceImmutabilityCheck(proposal = {}) {
  const sourcePath = rawText(proposal.source_work_record?.path);
  const expected = text(proposal.source_work_record?.digest || proposal.source_work_record?.immutable_readback?.digest);
  if (!sourcePath || !expected) {
    return {
      status: 'not_available',
      source_path: sourcePath,
      expected_digest: expected,
      actual_digest: '',
    };
  }
  if (!fs.existsSync(sourcePath)) {
    return {
      status: 'failed',
      source_path: sourcePath,
      expected_digest: expected,
      actual_digest: '',
      diagnostics: [{
        severity: 'error',
        code: 'REPLACEMENT_WRITER_SOURCE_NOT_FOUND',
        message: 'Source Work Record path from proposal is not readable.',
        path: 'source_work_record.path',
      }],
    };
  }
  let actual;
  try {
    actual = fileDigest(sourcePath);
  } catch (error) {
    return {
      status: 'failed',
      source_path: sourcePath,
      expected_digest: expected,
      actual_digest: '',
      digest_algorithm: 'sha256',
      diagnostics: [{
        severity: 'error',
        code: 'REPLACEMENT_WRITER_SOURCE_DIGEST_READ_FAILED',
        message: `Source Work Record digest could not be read: ${error.message}`,
        path: 'source_work_record.path',
      }],
    };
  }
  return {
    status: actual === expected ? 'passed' : 'failed',
    source_path: sourcePath,
    expected_digest: expected,
    actual_digest: actual,
    digest_algorithm: 'sha256',
    diagnostics: actual === expected ? [] : [{
      severity: 'error',
      code: 'REPLACEMENT_WRITER_SOURCE_DIGEST_CHANGED',
      message: 'Source Work Record digest changed since Replacement Proposal build.',
      path: 'source_work_record.digest',
    }],
  };
}

export function writeReplacementWorkRecord({
  proposal = {},
  outputRoot = '',
  outputPath = '',
  dryRun = false,
} = {}) {
  const mode = dryRun ? 'dry_run' : 'write';
  const proposalValidation = validateWorkRecordReplacementProposal(proposal);
  if (proposalValidation.status !== 'passed' || text(proposal.status) !== 'proposed') {
    return baseResult({
      status: 'blocked_invalid_proposal',
      mode,
      proposal,
      diagnostics: proposalValidation.status !== 'passed'
        ? proposalValidation.diagnostics
        : [{
          severity: 'error',
          code: 'REPLACEMENT_WRITER_PROPOSAL_NOT_PROPOSED',
          message: 'Replacement Writer only writes proposed Replacement Proposals.',
          path: 'status',
        }],
    });
  }

  const sourceFieldsCheck = sourceFieldSnapshotCheck(proposal);
  if (sourceFieldsCheck.status !== 'passed') {
    return baseResult({
      status: 'blocked_source_changed',
      mode,
      proposal,
      diagnostics: sourceFieldsCheck.diagnostics,
    });
  }

  const replacementRecord = materializeReplacementWorkRecord(proposal);
  const output = resolveOutput({
    outputRoot,
    outputPath,
    replacementId: replacementRecord.id,
  });
  if (output.diagnostics.length > 0) {
    return baseResult({
      status: text(output.failure_status, 'blocked_output_escape'),
      mode,
      proposal,
      replacementRecord,
      output,
      diagnostics: output.diagnostics,
    });
  }

  const verifier = runWorkRecordVerifierProfile(replacementRecord);
  if (!isWorkRecordV1(replacementRecord) || verifier.status !== 'passed') {
    return baseResult({
      status: 'blocked_invalid_replacement_record',
      mode,
      proposal,
      replacementRecord,
      output,
      diagnostics: verifier.diagnostics || [{
        severity: 'error',
        code: 'REPLACEMENT_WRITER_WORK_RECORD_INVALID',
        message: 'Materialized replacement Work Record did not validate.',
        path: 'proposed_replacement_work_record',
      }],
    });
  }

  const sourceCheck = sourceImmutabilityCheck(proposal);
  if (sourceCheck.status === 'failed') {
    return baseResult({
      status: 'blocked_source_changed',
      mode,
      proposal,
      replacementRecord,
      output,
      sourceCheck,
      diagnostics: sourceCheck.diagnostics,
    });
  }

  const content = stableJson(replacementRecord);
  const contentDigest = digestText(content);
  const existingInspection = inspectTextFileDestination(output.output_path, content, { boundaryRoot: output.output_root });
  const exists = existingInspection.status !== 'missing';
  if (existingInspection.status === 'inspection_failed') {
    return baseResult({
      status: 'blocked_write_failed',
      mode,
      proposal,
      replacementRecord,
      output,
      idempotency: {
        status: 'unreadable_existing',
        existing: true,
        expected_digest: contentDigest,
        existing_digest: '',
      },
      sourceCheck,
      diagnostics: [{
        severity: 'error',
        code: 'REPLACEMENT_WRITER_EXISTING_OUTPUT_INSPECTION_FAILED',
        message: `Existing replacement output could not be inspected through a no-follow file descriptor: ${existingInspection.error?.message || 'unknown inspection failure'}`,
        path: 'output_path',
      }],
    });
  }
  if (existingInspection.status === 'conflict') {
    return baseResult({
      status: 'blocked_conflict',
      mode,
      proposal,
      replacementRecord,
      output,
      idempotency: {
        status: 'conflict',
        existing: true,
        existing_kind: existingInspection.existing_kind,
        expected_digest: contentDigest,
        existing_digest: existingInspection.existing_digest || '',
      },
      sourceCheck,
      diagnostics: [{
        severity: 'error',
        code: existingInspection.existing_kind === 'file'
          ? 'REPLACEMENT_WRITER_OUTPUT_CONFLICT'
          : 'REPLACEMENT_WRITER_OUTPUT_NOT_REGULAR_FILE',
        message: existingInspection.existing_kind === 'file'
          ? 'Output path already exists with different content.'
          : 'Replacement output path must remain absent or identify one regular non-symlink file throughout inspection.',
        path: 'output_path',
        existing_kind: existingInspection.existing_kind,
      }],
    });
  }
  const existingDigest = existingInspection.existing_digest || '';
  const idempotency = {
    status: exists ? 'identical_existing' : 'new',
    existing: exists,
    expected_digest: contentDigest,
    existing_digest: existingDigest,
  };
  if (dryRun) {
    return baseResult({
      status: 'dry_run',
      mode,
      proposal,
      replacementRecord,
      output: {
        ...output,
        digest: contentDigest,
      },
      idempotency,
      sourceCheck,
      atomicWrite: {
        planned: !exists,
        temp_file: path.join(path.dirname(output.output_path), `.${path.basename(output.output_path)}.${process.pid}.tmp`),
        create_if_absent: !exists,
      },
    });
  }
  if (exists) {
    return baseResult({
      status: 'already_exists',
      mode,
      proposal,
      replacementRecord,
      output: {
        ...output,
        digest: contentDigest,
      },
      idempotency,
      sourceCheck,
      atomicWrite: {
        planned: false,
        temp_file: '',
        create_if_absent: false,
        destination_identity: { ...objectValue(existingInspection.identity) },
      },
    });
  }

  const publication = publishTextFileIfAbsent(output.output_path, content, { boundaryRoot: output.output_root });
  const sourceCheckAfterPublication = publication.published === true
    ? sourceImmutabilityCheck(proposal)
    : sourceCheck;
  if (publication.published === true && sourceCheckAfterPublication.status !== 'passed') {
    const cleanupFailed = publication.status === 'cleanup_failed';
    return baseResult({
      status: 'blocked_source_changed',
      mode,
      proposal,
      replacementRecord,
      output: { ...output, digest: contentDigest },
      idempotency,
      sourceCheck: sourceCheckAfterPublication,
      atomicWrite: {
        temp_file: publication.temp_file,
        create_if_absent: true,
        published: true,
        cleanup_failed: cleanupFailed,
        temp_file_leftover: publication.temp_file_leftover === true,
        destination_identity: { ...objectValue(publication.identity) },
      },
      diagnostics: [
        ...arrayValue(sourceCheckAfterPublication.diagnostics),
        ...(cleanupFailed ? [{
          severity: 'error',
          code: 'REPLACEMENT_WRITER_TEMP_CLEANUP_FAILED',
          message: `Replacement Writer failed to clean temp file: ${publication.cleanup_error?.message || 'unknown cleanup failure'}`,
          path: 'output_path',
        }] : []),
      ],
    });
  }
  if (publication.status === 'identical_existing') {
    return baseResult({
      status: 'already_exists',
      mode,
      proposal,
      replacementRecord,
      output: { ...output, digest: contentDigest },
      idempotency: { ...idempotency, status: 'identical_existing', existing: true, existing_digest: contentDigest },
      sourceCheck: sourceCheckAfterPublication,
      atomicWrite: {
        temp_file: publication.temp_file,
        create_if_absent: true,
        raced: true,
        published: false,
        destination_identity: { ...objectValue(publication.identity) },
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
        ? 'REPLACEMENT_WRITER_TEMP_CLEANUP_FAILED'
        : conflict
          ? 'REPLACEMENT_WRITER_OUTPUT_CONFLICT'
          : 'REPLACEMENT_WRITER_WRITE_FAILED',
      message: cleanupFailed
        ? `Replacement Writer failed to clean temp file: ${error?.message || 'unknown cleanup failure'}`
        : conflict
          ? 'Output path was created concurrently with different content; existing bytes were preserved.'
          : `Replacement Writer failed to publish atomically: ${error?.message || publication.status}`,
      path: 'output_path',
    }];
    return baseResult({
      status: cleanupFailed ? 'blocked_cleanup_failed' : conflict ? 'blocked_conflict' : 'blocked_write_failed',
      mode,
      proposal,
      replacementRecord,
      output: publication.published ? { ...output, digest: contentDigest } : output,
      idempotency: conflict ? { ...idempotency, status: 'conflict', existing: true } : idempotency,
      sourceCheck: sourceCheckAfterPublication,
      atomicWrite: {
        temp_file: publication.temp_file,
        create_if_absent: true,
        raced: conflict,
        published: publication.published,
        cleanup_failed: cleanupFailed,
        destination_identity: publication.published
          ? { ...objectValue(publication.identity) }
          : {},
      },
      diagnostics,
    });
  }

  return baseResult({
    status: 'written',
    mode,
    proposal,
    replacementRecord,
    output: {
      ...output,
      digest: contentDigest,
      temp_file_leftover: publication.temp_file_leftover === true,
    },
    idempotency,
    sourceCheck: sourceCheckAfterPublication,
    atomicWrite: {
      temp_file: publication.temp_file,
      create_if_absent: true,
      published: true,
      temp_file_leftover: publication.temp_file_leftover === true,
      destination_identity: { ...objectValue(publication.identity) },
    },
  });
}
