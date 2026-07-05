import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  WORK_RECORD_V0_SCHEMA_VERSION,
  isWorkRecordV0,
} from './work-record-adapter.js';
import {
  runWorkRecordVerifierProfile,
} from './work-record-verifier.js';
import {
  validateWorkRecordReplacementProposal,
  digestJson,
  digestText,
  WORK_RECORD_REPLACEMENT_PROPOSAL_SCHEMA_VERSION,
  WORK_RECORD_REPLACEMENT_PROPOSAL_TYPE,
} from './work-record-replacement-proposal.js';
import {
  workRecordReadRecommendation,
} from './work-record-command-recommendation.js';

export const WORK_RECORD_REPLACEMENT_WRITER_RESULT_SCHEMA_VERSION = '2026-07-work-record-replacement-writer-result-v0';
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
  const readRecommendation = successfulWrite
    ? workRecordReadRecommendation(text(replacementRecord?.id), text(output.output_root))
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
      path: text(proposal.source_work_record?.path),
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
    side_effects: successfulWrite ? ['write_replacement_work_record'] : [],
    writes_replacement_record: successfulWrite,
    would_write_replacement_record: status === 'dry_run',
    mutates_source_record: false,
    rewrites_historical_evidence: false,
    executes_repair: false,
    executes_actions: false,
    applies_patches: false,
    automatic_replay_allowed: false,
    diagnostics,
    recommended_next: successfulWrite
      ? {
        action: 'read_written_replacement_work_record',
        argv: readRecommendation.argv,
        command_hint: readRecommendation.command_hint,
      }
      : {
        action: status === 'dry_run' ? 'rerun_without_dry_run_to_write' : 'inspect_writer_diagnostics',
      },
  };
}

function loadSourceRecord(sourcePath = '') {
  const value = text(sourcePath);
  if (!value || !fs.existsSync(value)) return null;
  try {
    const record = JSON.parse(fs.readFileSync(value, 'utf8'));
    return objectValue(record);
  } catch {
    return null;
  }
}

function evidenceFromSource(record = {}, carriedForward = []) {
  const byId = new Map(arrayValue(record.evidence).map((item) => [text(objectValue(item).id), objectValue(item)]));
  return carriedForward.map((item) => {
    const policy = objectValue(item);
    const id = text(policy.source_evidence_id);
    const sourceEvidence = byId.get(id);
    if (sourceEvidence) {
      return {
        ...cloneJson(sourceEvidence),
        metadata: {
          ...objectValue(sourceEvidence.metadata),
          carried_forward_by: 'replacement_writer',
          carry_reason: text(policy.carry_reason),
        },
      };
    }
    return {
      id,
      kind: 'carried_forward_source_evidence_ref',
      created_at: CREATED_AT,
      uri: text(policy.source_path, `source-work-record:evidence/${id}`),
      digest: text(policy.digest),
      immutable: true,
      summary: `Carried forward source evidence ${id}.`,
      metadata: {
        source_evidence_id: id,
        carry_reason: text(policy.carry_reason),
        source_path: text(policy.source_path),
        source_work_record_evidence_ref_only: true,
      },
    };
  });
}

function semanticTargetsFromPostconditions(postconditions = []) {
  return arrayValue(postconditions).map((postcondition) => {
    const value = objectValue(postcondition);
    const check = objectValue(value.check);
    if (!text(check.kind).startsWith('semantic_')) return null;
    const expected = objectValue(check.expected);
    const target = text(check.target || expected.target || value.target);
    const ref = text(check.ref || expected.ref || (target.includes('/') ? target.slice(target.lastIndexOf('/') + 1) : target));
    return {
      ref,
      target,
      role: text(check.role || check.expected_role || expected.role),
      name: text(check.name || check.expected_name || expected.name),
      value: text(expected.value ?? check.value ?? (typeof check.expected === 'string' ? check.expected : '')),
      text: text(expected.text ?? check.text),
      enabled: typeof expected.enabled === 'boolean' ? expected.enabled : undefined,
    };
  }).filter((target) => target && (target.ref || target.target));
}

function postconditionEvidenceMap(proposal = {}) {
  const mapped = new Map();
  for (const item of arrayValue(proposal.postcondition_evidence_map)) {
    mapped.set(text(objectValue(item).postcondition_id), arrayValue(objectValue(item).evidence_refs).map(text).filter(Boolean));
  }
  return mapped;
}

function semanticTargetsByEvidence(proposal = {}, postconditions = []) {
  const targetsByPostcondition = new Map(arrayValue(postconditions).map((postcondition) => [
    text(objectValue(postcondition).id),
    semanticTargetsFromPostconditions([postcondition]),
  ]));
  const byEvidence = new Map();
  for (const [postconditionId, evidenceRefs] of postconditionEvidenceMap(proposal)) {
    const targets = targetsByPostcondition.get(postconditionId) || [];
    for (const evidenceRef of evidenceRefs) {
      byEvidence.set(evidenceRef, [
        ...arrayValue(byEvidence.get(evidenceRef)),
        ...targets,
      ]);
    }
  }
  return byEvidence;
}

function evidenceFromArtifact(proposal = {}, postconditions = []) {
  const scopedTargets = semanticTargetsByEvidence(proposal, postconditions);
  const newEvidence = arrayValue(proposal.new_evidence);
  return newEvidence.map((item) => {
    const value = objectValue(item);
    const id = text(value.new_record_evidence_id);
    return {
      id,
      kind: 'repair_attempt_artifact_evidence',
      created_at: CREATED_AT,
      uri: text(value.artifact_path, `repair-attempt-artifact:evidence/${text(value.artifact_evidence_id)}`),
      digest: text(value.digest),
      immutable: true,
      summary: `Replacement evidence from Repair Attempt Artifact evidence ${text(value.artifact_evidence_id)}.`,
      metadata: {
        artifact_evidence_id: text(value.artifact_evidence_id),
        artifact_path: text(value.artifact_path),
        source: 'work_record.repair_attempt_artifact',
        phase: text(value.phase),
        phase_range: text(value.phase_range),
        postcondition_refs: arrayValue(value.postcondition_refs).map(text).filter(Boolean),
        semantic_targets: arrayValue(scopedTargets.get(id)).filter((target, index, values) => (
          values.findIndex((other) => JSON.stringify(other) === JSON.stringify(target)) === index
        )),
      },
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

function claimResultsForPostconditions({ claims = [], postconditions = [], finalHealth = 'valid' } = {}) {
  const status = finalHealth === 'valid' ? 'verified' : 'unverified';
  const confidence = finalHealth === 'valid' ? 0.9 : 0.5;
  const byId = new Map(arrayValue(postconditions).map((item) => [text(objectValue(item).id), objectValue(item)]));
  return arrayValue(claims).map((claim) => {
    const claimValue = objectValue(claim);
    const evidenceRefs = evidenceRefsForClaim(claimValue, postconditions);
    return {
      id: `claim-result:${text(claimValue.id).replace(/^claim:/, '')}:replacement-writer`,
      claim_id: text(claimValue.id),
      status,
      confidence,
      reason: 'Replacement Writer materialized this result from the validated Replacement Proposal without executing repair.',
      evidence_refs: evidenceRefs,
      postcondition_results: arrayValue(claimValue.postcondition_refs).map((postconditionId) => ({
        postcondition_id: text(postconditionId),
        status: finalHealth === 'valid' ? 'passed' : 'unchecked',
        evidence_refs: arrayValue(byId.get(text(postconditionId))?.evidence_refs).map(text).filter(Boolean),
        reason: 'Result is derived from Replacement Proposal provenance and Repair Attempt Artifact evidence.',
      })),
    };
  });
}

export function materializeReplacementWorkRecord(proposal = {}) {
  const proposed = objectValue(proposal.proposed_replacement_work_record);
  const sourceRecord = loadSourceRecord(proposal.source_work_record?.path);
  const carriedEvidence = evidenceFromSource(sourceRecord || {}, proposal.carried_forward_evidence);
  const newEvidence = evidenceFromArtifact(proposal, proposed.execution_map?.postconditions);
  const evidence = [...carriedEvidence, ...newEvidence].filter((item) => text(item.id));
  const evidenceIds = uniqueStrings(evidence.map((item) => item.id));
  const finalHealth = text(proposal.final_proposed_health?.classification || proposed.health?.verdict, 'valid');
  const verifierReportId = `verifier-report:${text(proposed.id).replace(/^work-record:/, '')}:replacement-writer`;
  const claims = cloneJson(arrayValue(proposed.claims));
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
  const claimResults = arrayValue(proposed.claim_results).length > 0
    ? cloneJson(arrayValue(proposed.claim_results))
    : claimResultsForPostconditions({ claims, postconditions: executionMap.postconditions, finalHealth });

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
    type: 'aos.work_record',
    schema_version: WORK_RECORD_V0_SCHEMA_VERSION,
    id: text(proposed.id),
    label: text(proposed.label, `Replacement Work Record for ${text(proposal.source_work_record?.id)}`),
    created_at: CREATED_AT,
    origin: cloneJson(objectValue(proposed.origin)),
    references: [
      ...arrayValue(proposed.references).map(cloneJson),
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
    intent: cloneJson(objectValue(proposed.intent)),
    execution_map: executionMap,
    evidence,
    claims,
    claim_results: claimResults,
    verifier_report: {
      id: verifierReportId,
      generated_at: CREATED_AT,
      verifier: {
        id: 'aos.verifier.work-record.v0.report-only',
        kind: 'work_record_v0_report_only',
        version: '2026-05-report-only',
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
      repair_gate_refs: [],
      replay_gate_refs: [],
    },
    metadata: {
      ...objectValue(proposed.metadata),
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
        executes_repair: false,
        executes_actions: false,
        applies_patches: false,
        automatic_replay_allowed: false,
      },
    },
  };
}

function resolveOutput({ outputRoot = '', outputPath = '', replacementId = '' } = {}) {
  const diagnostics = [];
  if (!text(outputRoot)) {
    addDiagnostic(diagnostics, 'REPLACEMENT_WRITER_OUTPUT_ROOT_REQUIRED', 'Replacement Writer requires an explicit output_root.', 'output_root');
    return { diagnostics };
  }
  const rootResolved = path.resolve(outputRoot);
  const rootExistingReal = realExistingPath(rootResolved);
  if (!rootExistingReal) {
    addDiagnostic(diagnostics, 'REPLACEMENT_WRITER_OUTPUT_ROOT_UNRESOLVABLE', 'Replacement Writer could not resolve output_root containment.', 'output_root');
    return { diagnostics };
  }
  const stem = safeFileStem(replacementId);
  if (!stem) {
    addDiagnostic(diagnostics, 'REPLACEMENT_WRITER_OUTPUT_ID_UNSAFE', 'Replacement Work Record id cannot round-trip to a safe output filename.', 'written_replacement_work_record.id');
    return { diagnostics };
  }
  const requestedOutput = text(outputPath) ? path.resolve(outputPath) : path.join(rootResolved, `${stem}.json`);
  const outputExistingReal = realExistingPath(requestedOutput);
  const outputParent = path.dirname(requestedOutput);
  const outputParentExistingReal = realExistingPath(outputParent);
  if (!containedPath(path.resolve(outputParent), rootResolved) || !containedPath(outputParentExistingReal, rootExistingReal)) {
    addDiagnostic(diagnostics, 'REPLACEMENT_WRITER_OUTPUT_ESCAPE', 'Replacement Writer output path must stay inside output_root.', 'output_path');
  }
  if (outputExistingReal && !containedPath(outputExistingReal, rootExistingReal)) {
    addDiagnostic(diagnostics, 'REPLACEMENT_WRITER_OUTPUT_SYMLINK_ESCAPE', 'Replacement Writer output path resolves outside output_root.', 'output_path');
  }
  if (text(outputPath) && path.basename(requestedOutput) !== `${stem}.json`) {
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
  const sourcePath = text(proposal.source_work_record?.path);
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
  const actual = fileDigest(sourcePath);
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

  const replacementRecord = materializeReplacementWorkRecord(proposal);
  const output = resolveOutput({
    outputRoot,
    outputPath,
    replacementId: replacementRecord.id,
  });
  if (output.diagnostics.length > 0) {
    return baseResult({
      status: 'blocked_output_escape',
      mode,
      proposal,
      replacementRecord,
      output,
      diagnostics: output.diagnostics,
    });
  }

  const verifier = runWorkRecordVerifierProfile(replacementRecord);
  if (!isWorkRecordV0(replacementRecord) || verifier.status !== 'passed') {
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
  const exists = fs.existsSync(output.output_path);
  const existingDigest = exists ? fileDigest(output.output_path) : '';
  const idempotency = {
    status: exists && existingDigest === contentDigest ? 'identical_existing' : exists ? 'conflict' : 'new',
    existing: exists,
    expected_digest: contentDigest,
    existing_digest: existingDigest,
  };
  if (exists && existingDigest !== contentDigest) {
    return baseResult({
      status: 'blocked_conflict',
      mode,
      proposal,
      replacementRecord,
      output,
      idempotency,
      sourceCheck,
      diagnostics: [{
        severity: 'error',
        code: 'REPLACEMENT_WRITER_OUTPUT_CONFLICT',
        message: 'Output path already exists with different content.',
        path: 'output_path',
      }],
    });
  }
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
        rename: !exists,
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
        rename: false,
      },
    });
  }

  const parent = path.dirname(output.output_path);
  const tempFile = path.join(parent, `.${path.basename(output.output_path)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.mkdirSync(parent, { recursive: true });
    fs.writeFileSync(tempFile, content, { flag: 'wx' });
    fs.renameSync(tempFile, output.output_path);
  } catch (error) {
    const diagnostics = [{
      severity: 'error',
      code: 'REPLACEMENT_WRITER_WRITE_FAILED',
      message: `Replacement Writer failed to write atomically: ${error.message}`,
      path: 'output_path',
    }];
    try {
      if (fs.existsSync(tempFile)) fs.rmSync(tempFile, { force: true });
    } catch (cleanupError) {
      diagnostics.push({
        severity: 'error',
        code: 'REPLACEMENT_WRITER_TEMP_CLEANUP_FAILED',
        message: `Replacement Writer failed to clean temp file: ${cleanupError.message}`,
        path: tempFile,
      });
      return baseResult({
        status: 'blocked_cleanup_failed',
        mode,
        proposal,
        replacementRecord,
        output,
        idempotency,
        sourceCheck,
        atomicWrite: { temp_file: tempFile, rename: false, cleanup_failed: true },
        diagnostics,
      });
    }
    return baseResult({
      status: 'blocked_write_failed',
      mode,
      proposal,
      replacementRecord,
      output,
      idempotency,
      sourceCheck,
      atomicWrite: { temp_file: tempFile, rename: false },
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
      temp_file_leftover: fs.existsSync(tempFile),
    },
    idempotency,
    sourceCheck,
    atomicWrite: {
      temp_file: tempFile,
      rename: true,
      temp_file_leftover: fs.existsSync(tempFile),
    },
  });
}
