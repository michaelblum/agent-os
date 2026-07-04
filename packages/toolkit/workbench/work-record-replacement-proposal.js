import crypto from 'node:crypto';
import {
  validateWorkRecordRepairAttemptArtifact,
} from './work-record-repair-attempt-artifact.js';

export const WORK_RECORD_REPLACEMENT_PROPOSAL_SCHEMA_VERSION = '2026-07-work-record-replacement-proposal-v0';
export const WORK_RECORD_REPLACEMENT_PROPOSAL_TYPE = 'work_record.replacement_proposal';

export const WORK_RECORD_REPLACEMENT_PROPOSAL_STATUSES = [
  'proposed',
  'not_required',
  'blocked_attempt_failed',
  'blocked_attempt_partial',
  'blocked_missing_evidence',
  'blocked_source_mutated',
  'blocked_health_mismatch',
  'stale',
  'mismatch',
  'unsupported',
];

const BLOCKED_ATTEMPT_STATUSES = new Set(['failed', 'cleanup_failed', 'rollback_failed']);
const PARTIAL_ATTEMPT_STATUSES = new Set(['partial']);
const UNSUPPORTED_ATTEMPT_STATUSES = new Set([
  'aborted_precondition',
  'blocked_authorization',
  'blocked_plan_mismatch',
  'invalid_artifact',
  'unsupported',
]);

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

function canonicalize(value, seen = new WeakSet()) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, seen));
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  return Object.keys(value).sort().reduce((next, key) => {
    next[key] = canonicalize(value[key], seen);
    return next;
  }, {});
}

export function digestJson(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

export function digestText(value = '') {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => text(value)).filter(Boolean))].sort();
}

function sourceIdentity(source = {}) {
  const value = objectValue(source);
  return {
    id: text(value.id),
    path: text(value.path),
    requested_ref: text(value.requested_ref),
    schema_version: text(value.schema_version),
    digest: text(value.digest),
  };
}

function recordEvidenceIds(record = {}) {
  return uniqueStrings(arrayValue(record.evidence).map((item) => objectValue(item).id));
}

function refId(ref = {}) {
  if (typeof ref === 'string') return ref;
  return text(objectValue(ref).id || objectValue(ref).ref || objectValue(ref).uri);
}

function artifactEvidenceRefs(artifact = {}) {
  return arrayValue(artifact.evidence_refs)
    .map((ref) => (typeof ref === 'string' ? { id: ref } : cloneJson(objectValue(ref))))
    .filter((ref) => refId(ref))
    .sort((left, right) => refId(left).localeCompare(refId(right)));
}

function verifierHealth(report = {}) {
  const value = objectValue(report);
  return text(value.health_verdict
    || value.report?.health_verdict
    || value.report?.summary?.health_verdict
    || value.status);
}

function proposalStatus({ source = {}, plan = {}, artifact = {}, validation = {} } = {}) {
  const sourceId = text(source.record?.id);
  const artifactSourceId = text(artifact.source_work_record?.id);
  const planSourceId = text(plan.source_work_record?.id);
  if (!source.record || !sourceId) return 'unsupported';
  if (plan.type !== 'work_record.repair_attempt_plan') return 'unsupported';
  if (planSourceId && planSourceId !== sourceId) return 'mismatch';
  if (artifactSourceId && artifactSourceId !== sourceId) return 'mismatch';
  if (text(artifact.repair_attempt_plan?.digest) && text(artifact.repair_attempt_plan.digest) !== digestJson(plan)) return 'stale';
  if (text(plan.status) === 'not_required') return 'not_required';
  if (artifact.source_work_record_mutated === true) return 'blocked_source_mutated';
  const mutationCheck = objectValue(artifact.source_work_record_mutation_check);
  if (text(mutationCheck.status) && text(mutationCheck.status) !== 'passed') return 'blocked_source_mutated';
  if (validation.status !== 'passed') {
    const codes = arrayValue(validation.diagnostics).map((diagnostic) => text(objectValue(diagnostic).code));
    if (codes.some((code) => code.includes('SOURCE_WORK_RECORD_MUTATED'))) return 'blocked_source_mutated';
    if (codes.some((code) => code.includes('EVIDENCE') || code.includes('MISSING'))) return 'blocked_missing_evidence';
    if (codes.some((code) => code.includes('HEALTH') || code.includes('VERIFIER'))) return 'blocked_health_mismatch';
    if (codes.some((code) => code.includes('CLEANUP') || code.includes('ROLLBACK') || code.includes('FAILED'))) return 'blocked_attempt_failed';
    return 'unsupported';
  }
  if (BLOCKED_ATTEMPT_STATUSES.has(text(artifact.status))) return 'blocked_attempt_failed';
  if (PARTIAL_ATTEMPT_STATUSES.has(text(artifact.status))) return 'blocked_attempt_partial';
  if (UNSUPPORTED_ATTEMPT_STATUSES.has(text(artifact.status))) return 'unsupported';
  const afterHealth = verifierHealth(artifact.verifier_after);
  const finalHealth = text(artifact.final_health?.classification);
  if (afterHealth && finalHealth && afterHealth !== finalHealth) return 'blocked_health_mismatch';
  const requiredEvidence = uniqueStrings(arrayValue(plan.evidence_requirements)
    .filter((requirement) => objectValue(requirement).required === true)
    .map((requirement) => objectValue(requirement).id));
  const artifactEvidence = new Set(artifactEvidenceRefs(artifact).map(refId));
  if (requiredEvidence.some((id) => !artifactEvidence.has(id))) return 'blocked_missing_evidence';
  if (text(artifact.status) === 'succeeded') return 'proposed';
  return 'unsupported';
}

function buildCarriedForwardEvidence(record = {}, evidencePolicy = {}) {
  const policy = objectValue(evidencePolicy);
  const explicit = arrayValue(policy.carried_forward_evidence);
  const evidenceIds = recordEvidenceIds(record);
  const carryIds = explicit.length > 0
    ? uniqueStrings(explicit.map((item) => text(objectValue(item).source_evidence_id || objectValue(item).id || item)))
    : evidenceIds;
  return carryIds.map((id) => ({
    source_evidence_id: id,
    source_path: text(policy.source_path, 'source_work_record.evidence'),
    carry_reason: text(policy.carry_reason, 'preserve_source_work_record_evidence'),
    claim_refs: uniqueStrings(arrayValue(record.claims)
      .filter((claim) => arrayValue(objectValue(claim).evidence_refs).includes(id))
      .map((claim) => objectValue(claim).id)),
    digest: text(objectValue(arrayValue(record.evidence).find((item) => objectValue(item).id === id)).digest),
  }));
}

function buildNewEvidence(artifact = {}) {
  const postconditionRefsByEvidence = new Map();
  for (const result of arrayValue(artifact.postcondition_results)) {
    const item = objectValue(result);
    const postconditionId = text(item.postcondition_id);
    if (!postconditionId) continue;
    for (const evidenceRef of arrayValue(item.evidence_ref_ids).map(text).filter(Boolean)) {
      const refs = postconditionRefsByEvidence.get(evidenceRef) || [];
      refs.push(postconditionId);
      postconditionRefsByEvidence.set(evidenceRef, refs);
    }
  }
  return artifactEvidenceRefs(artifact).map((ref) => {
    const id = refId(ref);
    return {
      artifact_evidence_id: id,
      artifact_path: text(ref.uri || ref.path || ref.artifact_path, `artifact:${id}`),
      new_record_evidence_id: `replacement:${id}`,
      claim_refs: [],
      postcondition_refs: uniqueStrings(postconditionRefsByEvidence.get(id) || []),
      digest: text(ref.digest),
      phase: text(ref.phase),
      phase_range: text(ref.phase_range),
    };
  });
}

function buildPostconditionEvidenceMap({ record = {}, newEvidence = [] } = {}) {
  const artifactToReplacement = new Map(newEvidence.map((item) => [text(item.artifact_evidence_id), text(item.new_record_evidence_id)]));
  const defaultRepairEvidence = text(newEvidence.find((item) => text(item.artifact_evidence_id).includes('new-work-record-or-patch-artifact'))?.new_record_evidence_id
    || newEvidence.find((item) => text(item.artifact_evidence_id).includes('patch:'))?.new_record_evidence_id
    || newEvidence[0]?.new_record_evidence_id);
  return arrayValue(record.execution_map?.postconditions).map((postcondition) => {
    const value = objectValue(postcondition);
    const mappedEvidence = uniqueStrings(arrayValue(newEvidence)
      .filter((item) => arrayValue(item.postcondition_refs).map(text).includes(text(value.id)))
      .map((item) => text(item.new_record_evidence_id)));
    const semanticRepairEvidence = text(value.check?.kind).startsWith('semantic_') && defaultRepairEvidence
      ? [defaultRepairEvidence]
      : [];
    const legacyEvidence = uniqueStrings(arrayValue(value.evidence_refs)
      .map((id) => artifactToReplacement.get(text(id)) || text(id)));
    return {
      postcondition_id: text(value.id),
      evidence_refs: mappedEvidence.length > 0 ? mappedEvidence : semanticRepairEvidence.length > 0 ? semanticRepairEvidence : legacyEvidence,
      source: mappedEvidence.length > 0
        ? 'repair_attempt_artifact.postcondition_results'
        : semanticRepairEvidence.length > 0
          ? 'repair_attempt_artifact.default_semantic_repair_evidence'
        : 'source_work_record.execution_map.postconditions',
    };
  }).filter((item) => item.postcondition_id);
}

function buildClaimProvenance(record = {}, artifact = {}) {
  return arrayValue(record.claims).map((claim) => {
    const item = objectValue(claim);
    return {
      claim_id: text(item.id),
      proposed_claim_id: text(item.id),
      source: 'source_work_record.claims',
      historical_claim_results_rewritten: false,
      verifier_after_health: verifierHealth(artifact.verifier_after),
    };
  });
}

function proposedRecordShape({
  record = {},
  source = {},
  plan = {},
  artifact = {},
  proposedIdSeed = '',
  carriedForwardEvidence = [],
  newEvidence = [],
  claimProvenance = [],
  postconditionEvidenceMap = [],
} = {}) {
  const proposedId = text(proposedIdSeed, `${text(record.id)}:replacement:${digestJson({
    source: sourceIdentity(source),
    plan_digest: digestJson(plan),
    artifact_digest: digestJson(artifact),
  }).slice(0, 16)}`);
  return {
    type: text(record.type, 'aos.work_record'),
    schema_version: text(record.schema_version),
    id: proposedId,
    label: text(record.label, `Replacement proposal for ${text(record.id)}`),
    proposal_only: true,
    persisted: false,
    source_work_record_id: text(record.id),
    supersedes: {
      relationship: 'supersedes',
      source_work_record_id: text(record.id),
      proposed_replacement_work_record_id: proposedId,
      repair_attempt_artifact_id: text(artifact.attempt_artifact_identity?.id),
    },
    origin: cloneJson(record.origin || {}),
    references: [
      ...arrayValue(record.references).map(cloneJson),
      {
        id: 'supersedes-source-work-record',
        relationship: 'supersedes',
        ref: text(record.id),
        subject_type: 'aos.work_record',
      },
      {
        id: 'derived-from-repair-attempt-plan',
        relationship: 'derived_from',
        ref: text(plan.attempt_identity?.attempt_id),
        subject_type: 'work_record.repair_attempt_plan',
      },
      {
        id: 'derived-from-repair-attempt-artifact',
        relationship: 'derived_from',
        ref: text(artifact.attempt_artifact_identity?.id),
        subject_type: 'work_record.repair_attempt_artifact',
      },
    ],
    intent: cloneJson(record.intent || {}),
    execution_map: {
      ...cloneJson(record.execution_map || {}),
      postconditions: arrayValue(record.execution_map?.postconditions).map((postcondition) => {
        const value = objectValue(postcondition);
        const mapping = postconditionEvidenceMap.find((item) => text(item.postcondition_id) === text(value.id));
        return {
          ...cloneJson(value),
          evidence_refs: mapping ? cloneJson(mapping.evidence_refs) : cloneJson(arrayValue(value.evidence_refs)),
        };
      }),
    },
    evidence_refs: [
      ...carriedForwardEvidence.map((item) => item.source_evidence_id),
      ...newEvidence.map((item) => item.new_record_evidence_id),
    ],
    claims: cloneJson(arrayValue(record.claims)),
    claim_result_provenance: claimProvenance,
    verifier_report: cloneJson(artifact.verifier_after || {}),
    health: {
      verdict: text(artifact.final_health?.classification || verifierHealth(artifact.verifier_after), 'blocked'),
      derived_from: 'repair_attempt_artifact.verifier_after',
      source_work_record_id: text(record.id),
      repair_attempt_artifact_id: text(artifact.attempt_artifact_identity?.id),
    },
    metadata: {
      replacement_proposal: true,
      writes_replacement_record: false,
      persisted_by_writer: false,
    },
  };
}

export function buildWorkRecordReplacementProposal(input = {}) {
  const source = objectValue(input.source_work_record);
  const record = objectValue(source.record || source);
  const plan = objectValue(input.repair_attempt_plan);
  const artifact = objectValue(input.repair_attempt_artifact);
  const validation = validateWorkRecordRepairAttemptArtifact(artifact);
  const sourceDigestBefore = text(source.digest || input.source_work_record_digest || digestJson(record));
  const sourceDigestAfter = text(input.source_work_record_digest_after || sourceDigestBefore);
  const sourcePath = text(source.path);
  const sourceIdentityValue = {
    id: text(record.id || source.id),
    path: sourcePath,
    requested_ref: text(source.requested_ref || input.requested_ref),
    schema_version: text(record.schema_version || source.schema_version),
    digest: sourceDigestBefore,
  };
  const status = proposalStatus({
    source: { record, ...sourceIdentityValue },
    plan,
    artifact,
    validation,
  });
  const carriedForwardEvidence = buildCarriedForwardEvidence(record, input.evidence_policy);
  const newEvidence = buildNewEvidence(artifact);
  const postconditionEvidenceMap = buildPostconditionEvidenceMap({ record, newEvidence });
  const claimProvenance = buildClaimProvenance(record, artifact);
  const proposedReplacement = proposedRecordShape({
    record,
    source: sourceIdentityValue,
    plan,
    artifact,
    proposedIdSeed: input.proposed_id_seed,
    carriedForwardEvidence,
    newEvidence,
    claimProvenance,
    postconditionEvidenceMap,
  });
  const identityCore = {
    source_work_record: sourceIdentityValue,
    repair_attempt_plan: {
      schema_version: text(plan.schema_version),
      digest: digestJson(plan),
      attempt_id: text(plan.attempt_identity?.attempt_id),
    },
    repair_attempt_artifact: {
      schema_version: text(artifact.schema_version),
      digest: digestJson(artifact),
      id: text(artifact.attempt_artifact_identity?.id),
    },
    proposed_replacement_work_record_id: proposedReplacement.id,
    carried_forward_evidence_ids: carriedForwardEvidence.map((item) => item.source_evidence_id),
    new_evidence_ids: newEvidence.map((item) => item.new_record_evidence_id),
    postcondition_evidence_map: postconditionEvidenceMap,
    final_proposed_health: text(proposedReplacement.health.verdict),
  };
  const identityDigest = digestJson(identityCore);
  const proposal = {
    type: WORK_RECORD_REPLACEMENT_PROPOSAL_TYPE,
    schema_version: WORK_RECORD_REPLACEMENT_PROPOSAL_SCHEMA_VERSION,
    status,
    source_work_record: {
      ...sourceIdentityValue,
      evidence_ids: recordEvidenceIds(record),
      match: text(source.match),
      immutable_readback: {
        digest: sourceDigestBefore,
        digest_algorithm: 'sha256',
      },
    },
    repair_attempt_plan: identityCore.repair_attempt_plan,
    repair_attempt_artifact: {
      ...identityCore.repair_attempt_artifact,
      status: text(artifact.status),
      validation_status: validation.status,
      evidence_ids: artifactEvidenceRefs(artifact).map(refId),
    },
    replacement_proposal_identity: {
      id: `work-record-replacement-proposal:${identityDigest.slice(0, 24)}`,
      digest: identityDigest,
      ...identityCore,
    },
    proposed_replacement_work_record: proposedReplacement,
    supersedes: {
      source_work_record_id: text(record.id),
      proposed_replacement_work_record_id: proposedReplacement.id,
      relationship: 'supersedes',
      repair_attempt_artifact_id: text(artifact.attempt_artifact_identity?.id),
      verifier_before_health: verifierHealth(artifact.verifier_before),
      verifier_after_health: verifierHealth(artifact.verifier_after),
      summary: `Proposes ${proposedReplacement.id} as a replacement for ${text(record.id)} without writing it.`,
      persisted: false,
    },
    carried_forward_evidence: carriedForwardEvidence,
    new_evidence: newEvidence,
    postcondition_evidence_map: postconditionEvidenceMap,
    omitted_evidence: arrayValue(objectValue(input.evidence_policy).omitted_evidence).map((item) => ({
      source_evidence_id: text(objectValue(item).source_evidence_id),
      artifact_evidence_id: text(objectValue(item).artifact_evidence_id),
      omit_reason: text(objectValue(item).omit_reason),
      replacement_impact: text(objectValue(item).replacement_impact),
    })),
    claim_provenance: claimProvenance,
    verifier_before: cloneJson(artifact.verifier_before || {}),
    verifier_after: cloneJson(artifact.verifier_after || {}),
    final_proposed_health: {
      classification: text(artifact.final_health?.classification || proposedReplacement.health.verdict),
      derived_from: 'repair_attempt_artifact.final_health',
      verifier_after_health: verifierHealth(artifact.verifier_after),
    },
    source_work_record_mutation_check: {
      status: sourceDigestBefore === sourceDigestAfter && artifact.source_work_record_mutated !== true ? 'passed' : 'failed',
      before_digest: sourceDigestBefore,
      after_digest: sourceDigestAfter,
      artifact_check: cloneJson(artifact.source_work_record_mutation_check || {}),
    },
    writes_replacement_record: false,
    mutates_source_record: false,
    rewrites_historical_evidence: false,
    executes_repair: false,
    executes_actions: false,
    applies_patches: false,
    automatic_replay_allowed: false,
    diagnostics: validation.status === 'passed' ? [] : validation.diagnostics,
    recommended_next: status === 'proposed'
      ? {
        action: 'review_proposal_then_use_future_writer',
        note: 'This proposal is not persisted. A separate writer would be required to create a replacement Work Record.',
      }
      : {
        action: 'inspect_blocked_replacement_proposal',
        note: `Replacement Proposal status is ${status}; do not write a replacement Work Record.`,
      },
    metadata: cloneJson(objectValue(input.metadata)),
  };
  const checked = validateWorkRecordReplacementProposal(proposal);
  if (proposal.status === 'proposed' && checked.status !== 'passed') {
    return {
      ...proposal,
      status: checked.diagnostics.some((diagnostic) => diagnostic.code.includes('HEALTH')) ? 'blocked_health_mismatch' : 'blocked_missing_evidence',
      diagnostics: checked.diagnostics,
    };
  }
  return proposal;
}

export function validateWorkRecordReplacementProposal(proposal = {}) {
  const value = objectValue(proposal);
  const diagnostics = [];
  function add(code, message, path, extra = {}) {
    diagnostics.push({
      severity: 'error',
      code,
      message,
      path,
      ...extra,
    });
  }

  if (text(value.type) !== WORK_RECORD_REPLACEMENT_PROPOSAL_TYPE) {
    add('INVALID_REPLACEMENT_PROPOSAL_TYPE', 'Replacement Proposal type must be work_record.replacement_proposal.', 'type');
  }
  if (text(value.schema_version) !== WORK_RECORD_REPLACEMENT_PROPOSAL_SCHEMA_VERSION) {
    add('INVALID_REPLACEMENT_PROPOSAL_SCHEMA_VERSION', 'Replacement Proposal schema_version is not supported.', 'schema_version');
  }
  if (!WORK_RECORD_REPLACEMENT_PROPOSAL_STATUSES.includes(text(value.status))) {
    add('INVALID_REPLACEMENT_PROPOSAL_STATUS', 'Replacement Proposal status is not supported.', 'status');
  }
  for (const field of [
    'writes_replacement_record',
    'mutates_source_record',
    'rewrites_historical_evidence',
    'executes_repair',
    'executes_actions',
    'applies_patches',
    'automatic_replay_allowed',
  ]) {
    if (value[field] !== false) add('REPLACEMENT_PROPOSAL_NON_WRITING_FLAG_NOT_FALSE', `${field} must be false.`, field);
  }

  const source = sourceIdentity(value.source_work_record);
  if (!source.id || !source.schema_version || !source.digest) {
    add('REPLACEMENT_PROPOSAL_SOURCE_IDENTITY_INCOMPLETE', 'source_work_record must include id, schema_version, and digest.', 'source_work_record');
  }
  if (text(value.repair_attempt_plan?.schema_version) !== '2026-07-work-record-repair-attempt-plan-v0') {
    add('REPLACEMENT_PROPOSAL_ATTEMPT_PLAN_SCHEMA_UNSUPPORTED', 'Repair Attempt Plan schema_version is unsupported.', 'repair_attempt_plan.schema_version');
  }
  if (text(value.repair_attempt_artifact?.schema_version) !== '2026-07-work-record-repair-attempt-artifact-v0') {
    add('REPLACEMENT_PROPOSAL_ATTEMPT_ARTIFACT_SCHEMA_UNSUPPORTED', 'Repair Attempt Artifact schema_version is unsupported.', 'repair_attempt_artifact.schema_version');
  }
  if (text(value.repair_attempt_artifact?.validation_status) !== 'passed') {
    add('REPLACEMENT_PROPOSAL_ATTEMPT_ARTIFACT_INVALID', 'Repair Attempt Artifact must validate before proposal build.', 'repair_attempt_artifact.validation_status');
  }
  const mutationCheck = objectValue(value.source_work_record_mutation_check);
  if (text(mutationCheck.status) !== 'passed') {
    add('REPLACEMENT_PROPOSAL_SOURCE_MUTATED', 'Source Work Record mutation check must pass.', 'source_work_record_mutation_check.status');
  }
  if (text(mutationCheck.before_digest) !== text(mutationCheck.after_digest)) {
    add('REPLACEMENT_PROPOSAL_SOURCE_DIGEST_CHANGED', 'Source Work Record digest changed between readbacks.', 'source_work_record_mutation_check');
  }
  const carried = new Set(arrayValue(value.carried_forward_evidence).map((item) => text(objectValue(item).source_evidence_id)).filter(Boolean));
  const proposedEvidence = new Set(arrayValue(value.proposed_replacement_work_record?.evidence_refs));
  const sourceEvidence = new Set(arrayValue(value.source_work_record?.evidence_ids).map(text).filter(Boolean));
  const artifactEvidence = new Set(arrayValue(value.repair_attempt_artifact?.evidence_ids).map(text).filter(Boolean));
  for (const item of arrayValue(value.carried_forward_evidence)) {
    const evidenceId = text(objectValue(item).source_evidence_id);
    if (!evidenceId) add('CARRIED_FORWARD_EVIDENCE_ID_MISSING', 'Carried-forward evidence requires source_evidence_id.', 'carried_forward_evidence');
    if (!text(objectValue(item).carry_reason)) add('CARRIED_FORWARD_EVIDENCE_REASON_MISSING', 'Carried-forward evidence requires carry_reason.', 'carried_forward_evidence');
    if (sourceEvidence.size > 0 && !sourceEvidence.has(evidenceId)) {
      add('CARRIED_FORWARD_EVIDENCE_NOT_IN_SOURCE', 'Carried-forward evidence must trace to the source Work Record.', 'carried_forward_evidence.source_evidence_id', { evidence_ref_id: evidenceId });
    }
    if (!proposedEvidence.has(evidenceId)) add('CARRIED_FORWARD_EVIDENCE_NOT_IN_PROPOSED_RECORD', 'Proposed record must reference carried-forward evidence.', 'proposed_replacement_work_record.evidence_refs', { evidence_ref_id: evidenceId });
  }
  for (const item of arrayValue(value.new_evidence)) {
    const artifactId = text(objectValue(item).artifact_evidence_id);
    const newId = text(objectValue(item).new_record_evidence_id);
    if (!artifactId || !newId) add('NEW_EVIDENCE_ID_MISSING', 'New evidence requires artifact_evidence_id and new_record_evidence_id.', 'new_evidence');
    if (artifactEvidence.size > 0 && !artifactEvidence.has(artifactId)) {
      add('NEW_EVIDENCE_NOT_IN_ARTIFACT', 'New evidence must trace to the Repair Attempt Artifact.', 'new_evidence.artifact_evidence_id', { evidence_ref_id: artifactId });
    }
    if (!proposedEvidence.has(newId)) add('NEW_EVIDENCE_NOT_IN_PROPOSED_RECORD', 'Proposed record must reference new evidence ids.', 'proposed_replacement_work_record.evidence_refs', { evidence_ref_id: newId });
  }
  const postconditionIds = new Set(arrayValue(value.proposed_replacement_work_record?.execution_map?.postconditions)
    .map((item) => text(objectValue(item).id))
    .filter(Boolean));
  for (const item of arrayValue(value.postcondition_evidence_map)) {
    const postconditionId = text(objectValue(item).postcondition_id);
    if (!postconditionId) add('POSTCONDITION_EVIDENCE_MAP_ID_MISSING', 'Postcondition evidence mapping requires postcondition_id.', 'postcondition_evidence_map');
    if (postconditionId && !postconditionIds.has(postconditionId)) {
      add('POSTCONDITION_EVIDENCE_MAP_UNKNOWN_POSTCONDITION', 'Postcondition evidence mapping must reference a proposed postcondition.', 'postcondition_evidence_map.postcondition_id', { postcondition_id: postconditionId });
    }
    for (const evidenceId of arrayValue(objectValue(item).evidence_refs).map(text).filter(Boolean)) {
      if (!proposedEvidence.has(evidenceId)) {
        add('POSTCONDITION_EVIDENCE_MAP_UNKNOWN_EVIDENCE', 'Postcondition evidence mapping must reference proposed evidence.', 'postcondition_evidence_map.evidence_refs', { evidence_ref_id: evidenceId });
      }
    }
  }
  for (const item of arrayValue(value.omitted_evidence)) {
    if (!text(objectValue(item).omit_reason)) add('OMITTED_EVIDENCE_REASON_MISSING', 'Omitted evidence requires omit_reason.', 'omitted_evidence');
    if (!text(objectValue(item).replacement_impact)) add('OMITTED_EVIDENCE_IMPACT_MISSING', 'Omitted evidence requires replacement_impact.', 'omitted_evidence');
  }
  for (const item of arrayValue(value.claim_provenance)) {
    if (objectValue(item).historical_claim_results_rewritten !== false) {
      add('CLAIM_PROVENANCE_REWRITES_HISTORY', 'Claim provenance must not rewrite historical Claim Results.', 'claim_provenance.historical_claim_results_rewritten');
    }
  }
  const finalHealth = text(value.final_proposed_health?.classification);
  const afterHealth = text(value.final_proposed_health?.verifier_after_health);
  if (afterHealth && finalHealth !== afterHealth) {
    add('REPLACEMENT_PROPOSAL_HEALTH_MISMATCH', 'final_proposed_health must match verifier-after health.', 'final_proposed_health.classification', {
      expected: afterHealth,
      actual: finalHealth,
    });
  }
  if (text(value.status) === 'proposed') {
    if (!carried.size) add('PROPOSED_REPLACEMENT_CARRIED_FORWARD_EVIDENCE_REQUIRED', 'Proposed status requires explicit carried-forward evidence policy.', 'carried_forward_evidence');
    if (arrayValue(value.new_evidence).length === 0) add('PROPOSED_REPLACEMENT_NEW_EVIDENCE_REQUIRED', 'Proposed status requires new evidence from the Repair Attempt Artifact.', 'new_evidence');
    if (text(value.repair_attempt_artifact?.status) !== 'succeeded') add('PROPOSED_REPLACEMENT_REQUIRES_SUCCEEDED_ARTIFACT', 'Proposed status requires a succeeded Repair Attempt Artifact.', 'repair_attempt_artifact.status');
    if (text(value.proposed_replacement_work_record?.persisted) !== 'false' && value.proposed_replacement_work_record?.persisted !== false) {
      add('PROPOSED_REPLACEMENT_MARKER_MISSING', 'Proposed replacement shape must be marked persisted:false.', 'proposed_replacement_work_record.persisted');
    }
  }

  return {
    type: 'work_record.replacement_proposal.validation',
    schema_version: WORK_RECORD_REPLACEMENT_PROPOSAL_SCHEMA_VERSION,
    status: diagnostics.length > 0 ? 'failed' : 'passed',
    read_only: true,
    mutates_state: false,
    writes_replacement_record: false,
    mutates_source_record: false,
    executes_repair: false,
    executes_actions: false,
    applies_patches: false,
    automatic_replay_allowed: false,
    diagnostics,
  };
}
