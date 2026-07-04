import {
  WORK_RECORD_V0_SCHEMA_VERSION,
  workRecordSubjectId,
} from './work-record-adapter.js';
import {
  parseSubjectEntryHandle,
} from './subject-entry-handle.js';
import {
  deriveWorkRecordClaimIndexes,
  WORK_RECORD_REPORT_ONLY_PROFILE,
} from './work-record-verifier.js';

export const WORK_RECORD_COMMAND_CAPTURE_BUILDER_VERSION = '2026-05-command-evidence-v0';
export const WORK_RECORD_AOS_ACTION_CAPTURE_BUILDER_VERSION = '2026-05-aos-action-evidence-v0';
export const WORK_RECORD_STEP_DESCRIPTOR_CAPTURE_BUILDER_VERSION = '2026-05-step-descriptor-evidence-v0';

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function multilineText(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\r\n/g, '\n').trim();
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

function slug(value = '') {
  return text(value, 'command-evidence')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'command-evidence';
}

function workRecordHandleSubjectId(value = '') {
  const normalized = text(value);
  const parsed = parseSubjectEntryHandle(normalized);
  return parsed?.facet_key === 'work-record' ? parsed.subject_id : normalized;
}

function workRecordCaptureBaseId(recordId = '', sourceId = '') {
  return slug(workRecordHandleSubjectId(text(recordId) || sourceId));
}

function workRecordCaptureRecordId(recordId = '', baseId = '') {
  return workRecordSubjectId(text(recordId) || baseId);
}

function fnv1a32(value = '') {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(value[key])}`
  )).join(',')}}`;
}

function evidenceDigest(value) {
  return `fnv1a32:${fnv1a32(stableJson(value))}`;
}

function requireText(value, label) {
  const normalized = text(value);
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}

function commandTarget(command) {
  return `command:${command}`;
}

function evidenceTarget(target, fallback = '') {
  return requireText(target || fallback, 'evidence target');
}

function confidenceFor(passed) {
  return passed ? 0.98 : 0.3;
}

function postconditionResult({ postcondition, passed, evidenceId, reason }) {
  return {
    postcondition_id: postcondition.id,
    status: passed ? 'passed' : 'failed',
    evidence_refs: [evidenceId],
    reason,
  };
}

function claimResult({ claim, passed, evidenceId, postcondition, reason }) {
  return {
    id: `claim-result:${claim.id.replace(/^claim:/, '')}`,
    claim_id: claim.id,
    status: passed ? 'verified' : 'failed',
    confidence: confidenceFor(passed),
    reason,
    evidence_refs: [evidenceId],
    postcondition_results: [
      postconditionResult({ postcondition, passed, evidenceId, reason }),
    ],
  };
}

function claimResultForPostconditions({
  claim,
  passed,
  evidenceRefs,
  postconditionResults,
  reason,
  confidence = confidenceFor(passed),
}) {
  return {
    id: `claim-result:${claim.id.replace(/^claim:/, '')}`,
    claim_id: claim.id,
    status: passed ? 'verified' : 'failed',
    confidence,
    reason,
    evidence_refs: evidenceRefs,
    postcondition_results: postconditionResults,
  };
}

function resultFor(postcondition, { passed, evidenceRefs, reason }) {
  return {
    postcondition_id: postcondition.id,
    status: passed ? 'passed' : 'failed',
    evidence_refs: evidenceRefs,
    reason,
  };
}

function evidenceEventPayload(event, extra = {}) {
  return {
    id: text(event.id),
    command: text(event.command),
    target: text(event.target),
    state_id: text(event.state_id),
    created_at: text(event.captured_at || event.executed_at),
    summary: text(event.summary),
    artifact_uri: text(event.artifact_uri),
    elements: cloneJson(arrayValue(event.elements)),
    semantic_targets: cloneJson(arrayValue(event.semantic_targets)),
    metadata: cloneJson(objectValue(event.metadata)),
    ...extra,
  };
}

function actionStatus(action) {
  return text(action.status || objectValue(action.result).status, 'unknown');
}

function healthVerdictForSource({
  evidenceSource,
  actionPassed,
  postconditionPassed,
  cleanupPassed,
}) {
  const explicit = text(objectValue(evidenceSource.health).verdict);
  if ([
    'valid',
    'stale',
    'repairable',
    'blocked',
    'impossible',
    'superseded',
    'retired',
  ].includes(explicit)) {
    return explicit;
  }
  const validationStatus = text(
    objectValue(evidenceSource.current_validation).status
      || objectValue(objectValue(evidenceSource.action).current_validation).status,
  );
  if (['stale', 'ambiguous', 'missing'].includes(validationStatus)) return 'repairable';
  if (!actionPassed || !postconditionPassed || cleanupPassed === false) return 'blocked';
  return 'valid';
}

function healthReasonForVerdict(verdict, fallback = '') {
  const reasons = {
    valid: 'All run Claims verified against immutable AOS saved-ref action evidence.',
    stale: 'The Work Record requires fresh validation before it can be trusted for replay or repair.',
    repairable: 'Saved-ref validation is stale, ambiguous, or missing, but intent and immutable evidence are sufficient for workflow-gated repair.',
    blocked: 'One or more run Claims failed against the AOS saved-ref action evidence.',
    impossible: 'The recorded intent can no longer be satisfied by the known target class.',
    superseded: 'A newer Work Record explicitly replaces this record.',
    retired: 'This Work Record is intentionally no longer executable.',
  };
  return text(fallback, reasons[verdict] || 'The Work Record verifier classified the record health.');
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values.map((item) => text(item)).filter(Boolean)) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function mergeReferences(...groups) {
  const seen = new Set();
  const result = [];
  for (const group of groups) {
    for (const reference of arrayValue(group)) {
      const copy = cloneJson(objectValue(reference));
      const key = text(copy.id, text(copy.ref));
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(copy);
    }
  }
  return result;
}

function findById(values = [], id = '') {
  return arrayValue(values).find((value) => text(objectValue(value).id) === id);
}

function stepDescriptorRunId(stepDescriptor, evidenceSource) {
  const runSlug = slug(text(stepDescriptor.id || evidenceSource.id).replace(/^step-descriptor:/, ''));
  const timestamp = requireText(
    evidenceSource.completed_at || evidenceSource.created_at,
    'evidence completed_at',
  ).replace(/[:.]/g, '-');
  return `run:${runSlug}:${timestamp}`;
}

function stepDescriptorPostconditionSource(stepDescriptor, evidenceSource) {
  const sourcePostcondition = objectValue(evidenceSource.postcondition);
  const promotion = objectValue(arrayValue(stepDescriptor.claim_promotions)[0]);
  const templatePostcondition = objectValue(
    findById(stepDescriptor.postconditions, text(promotion.postcondition_ref))
      || findById(stepDescriptor.postconditions, text(sourcePostcondition.id)),
  );
  const templateCheck = objectValue(templatePostcondition.check);
  const sourceCheck = objectValue(sourcePostcondition.check);
  const templateRepairPolicy = objectValue(templatePostcondition.repair_policy);
  const sourceRepairPolicy = objectValue(sourcePostcondition.repair_policy);

  return {
    ...cloneJson(sourcePostcondition),
    id: text(templatePostcondition.id, text(sourcePostcondition.id)),
    kind: text(templatePostcondition.kind, text(sourcePostcondition.kind)),
    description: text(templatePostcondition.description, text(sourcePostcondition.description)),
    target: text(sourcePostcondition.target, text(templatePostcondition.target)),
    check: {
      ...cloneJson(templateCheck),
      ...cloneJson(sourceCheck),
    },
    repair_policy: Object.keys(templateRepairPolicy).length > 0
      ? cloneJson(templateRepairPolicy)
      : cloneJson(sourceRepairPolicy),
  };
}

function stepDescriptorEvidenceSource(stepDescriptor, evidenceSource) {
  const stepIntent = objectValue(stepDescriptor.intent);
  const sourceIntent = objectValue(evidenceSource.intent);
  const promotion = objectValue(arrayValue(stepDescriptor.claim_promotions)[0]);

  return {
    ...cloneJson(evidenceSource),
    intent: {
      summary: text(stepIntent.summary, text(sourceIntent.summary)),
      purpose: text(stepIntent.purpose, text(sourceIntent.purpose)),
      acceptance: text(stepIntent.acceptance, text(sourceIntent.acceptance)),
      constraints: uniqueStrings([
        ...arrayValue(stepIntent.constraints),
        ...arrayValue(sourceIntent.constraints),
      ]),
    },
    references: mergeReferences(arrayValue(stepDescriptor.references), arrayValue(evidenceSource.references)),
    postcondition: stepDescriptorPostconditionSource(stepDescriptor, evidenceSource),
    claim_text: text(promotion.claim_text, text(evidenceSource.claim_text)),
    acceptance: text(promotion.acceptance, text(evidenceSource.acceptance)),
  };
}

export function buildWorkRecordV0FromCommandEvidence(source = {}, {
  verifierProfile = WORK_RECORD_REPORT_ONLY_PROFILE,
} = {}) {
  const evidenceSource = objectValue(source);
  const command = requireText(evidenceSource.command, 'command');
  const createdAt = requireText(evidenceSource.created_at, 'created_at');
  const completedAt = text(evidenceSource.completed_at, createdAt);
  const sourceId = requireText(evidenceSource.id, 'id');
  const requestedRecordId = text(evidenceSource.record_id);
  const baseId = workRecordCaptureBaseId(requestedRecordId, sourceId);
  const recordId = workRecordCaptureRecordId(requestedRecordId, baseId);
  const evidenceId = text(evidenceSource.evidence_id, `evidence:${baseId}-command`);
  const target = text(evidenceSource.target, commandTarget(command));
  const stateId = text(evidenceSource.state_id);
  const expectedExitCode = Number.isFinite(evidenceSource.expected_exit_code)
    ? evidenceSource.expected_exit_code
    : 0;
  const exitCode = Number.isFinite(evidenceSource.exit_code) ? evidenceSource.exit_code : null;
  const stdout = multilineText(evidenceSource.stdout || evidenceSource.stdout_excerpt);
  const stderr = multilineText(evidenceSource.stderr || evidenceSource.stderr_excerpt);
  const expectedStdoutIncludes = arrayValue(evidenceSource.expected_stdout_includes)
    .map((value) => text(value))
    .filter(Boolean);
  const outputPassed = expectedStdoutIncludes.length === 0
    || expectedStdoutIncludes.every((expected) => stdout.includes(expected));
  const exitPassed = exitCode === expectedExitCode;
  const evidenceSummary = text(
    evidenceSource.summary,
    `Command completed with exit code ${exitCode}.`,
  );
  const evidencePayload = {
    source_id: sourceId,
    command,
    cwd: text(evidenceSource.cwd),
    exit_code: exitCode,
    expected_exit_code: expectedExitCode,
    stdout_excerpt: stdout,
    stderr_excerpt: stderr,
    completed_at: completedAt,
    metadata: cloneJson(objectValue(evidenceSource.metadata)),
  };

  const exitPostcondition = {
    id: `postcondition:${baseId}-exit-code`,
    kind: 'repo_command_exit',
    description: `The command exits with code ${expectedExitCode}.`,
    target,
    ...(stateId ? { state_id: stateId } : {}),
    check: {
      kind: 'exit_code_equals',
      command,
      expected: expectedExitCode,
    },
    evidence_refs: [evidenceId],
    repair_policy: {
      mode: 'manual_review',
      notes: 'Command failures require code, test, or environment investigation; the Work Record is report-only.',
    },
  };
  const outputPostcondition = {
    id: `postcondition:${baseId}-stdout`,
    kind: 'repo_command_output',
    description: 'The command output contains the expected success markers.',
    target,
    ...(stateId ? { state_id: stateId } : {}),
    check: {
      kind: 'stdout_contains_all',
      command,
      expected: expectedStdoutIncludes,
    },
    evidence_refs: [evidenceId],
    repair_policy: {
      mode: 'manual_review',
      notes: 'Output drift should be reviewed against the command evidence before changing expectations.',
    },
  };
  const claims = [
    {
      id: `claim:${baseId}-command-succeeded`,
      text: `The bounded repo command succeeded: ${command}`,
      scope: 'run',
      acceptance: `Exit code is ${expectedExitCode}.`,
      postcondition_refs: [exitPostcondition.id],
    },
    {
      id: `claim:${baseId}-expected-output-observed`,
      text: 'The bounded repo command evidence includes the expected success output.',
      scope: 'run',
      acceptance: expectedStdoutIncludes.join('; '),
      postcondition_refs: [outputPostcondition.id],
    },
  ];
  const claimResults = [
    claimResult({
      claim: claims[0],
      passed: exitPassed,
      evidenceId,
      postcondition: exitPostcondition,
      reason: exitPassed
        ? `Observed exit code ${expectedExitCode}.`
        : `Observed exit code ${exitCode}; expected ${expectedExitCode}.`,
    }),
    claimResult({
      claim: claims[1],
      passed: outputPassed,
      evidenceId,
      postcondition: outputPostcondition,
      reason: outputPassed
        ? 'All expected output markers were present in the command evidence.'
        : 'One or more expected output markers were missing from the command evidence.',
    }),
  ];
  const allClaimsVerified = claimResults.every((result) => result.status === 'verified');
  const derivedIndexes = deriveWorkRecordClaimIndexes({ claim_results: claimResults });
  const verifierReportId = `verifier-report:${baseId}`;

  return {
    type: 'aos.work_record',
    schema_version: WORK_RECORD_V0_SCHEMA_VERSION,
    id: recordId,
    label: text(evidenceSource.label, `Command evidence: ${command}`),
    created_at: createdAt,
    origin: {
      kind: 'ad_hoc',
      ref: null,
      description: 'Generated from bounded repo command evidence.',
    },
    references: arrayValue(evidenceSource.references).map((reference) => cloneJson(reference)),
    intent: {
      summary: requireText(objectValue(evidenceSource.intent).summary, 'intent.summary'),
      purpose: text(objectValue(evidenceSource.intent).purpose),
      acceptance: text(objectValue(evidenceSource.intent).acceptance),
      constraints: arrayValue(objectValue(evidenceSource.intent).constraints).map((item) => text(item)).filter(Boolean),
      claim_refs: claims.map((claim) => claim.id),
    },
    execution_map: {
      targets: [
        {
          id: `target:${baseId}-repo`,
          target: text(evidenceSource.cwd, 'repo:.'),
          dialect: 'repo',
          description: 'Repository checkout where the command evidence was captured.',
        },
        {
          id: `target:${baseId}-command`,
          target,
          dialect: 'command',
          ...(stateId ? { state_id: stateId } : {}),
          description: 'Bounded repo command used as the AOS-shaped evidence source.',
        },
      ],
      steps: [
        {
          id: `step:${baseId}-run-command`,
          intent: `Run ${command} and capture its result as immutable evidence.`,
          action: {
            verb: 'run_command',
            target,
            ...(stateId ? { state_id: stateId } : {}),
            args: {
              cwd: text(evidenceSource.cwd),
              command,
            },
          },
          postcondition_refs: [exitPostcondition.id, outputPostcondition.id],
          repair_hints: [
            {
              kind: 'rerun_command_manually',
              note: 'Rerun the command under an explicit workflow gate before producing a new Work Record.',
            },
          ],
        },
      ],
      postconditions: [exitPostcondition, outputPostcondition],
      artifact_routes: [
        {
          id: `artifact-route:${baseId}-command-evidence`,
          kind: 'command_evidence',
          destination: text(evidenceSource.artifact_uri, `artifact:artifacts/work-records/${baseId}/command-output.json`),
          evidence_ref: evidenceId,
        },
      ],
      replay_policy: {
        mode: 'report_only',
        replay_requires_workflow_gate: true,
        repair_requires_workflow_gate: true,
        gate_refs: [],
        notes: 'This Work Record records and verifies command evidence only; it does not authorize autonomous replay or repair.',
      },
    },
    evidence: [
      {
        id: evidenceId,
        kind: 'repo_command',
        created_at: completedAt,
        uri: text(evidenceSource.artifact_uri, target),
        digest: evidenceDigest(evidencePayload),
        ...(stateId ? { state_id: stateId } : {}),
        target,
        immutable: true,
        summary: evidenceSummary,
        metadata: {
          builder: WORK_RECORD_COMMAND_CAPTURE_BUILDER_VERSION,
          command,
          cwd: text(evidenceSource.cwd),
          exit_code: exitCode,
          stdout_excerpt: stdout,
          stderr_excerpt: stderr,
          expected_stdout_includes: expectedStdoutIncludes,
          duration_ms: Number.isFinite(evidenceSource.duration_ms) ? evidenceSource.duration_ms : null,
          source: {
            type: text(evidenceSource.type, 'aos.command_evidence'),
            id: sourceId,
          },
          ...cloneJson(objectValue(evidenceSource.metadata)),
        },
      },
    ],
    claims,
    claim_results: claimResults,
    verifier_report: {
      id: verifierReportId,
      generated_at: completedAt,
      verifier: {
        id: verifierProfile.id,
        kind: verifierProfile.kind,
        version: verifierProfile.version,
      },
      claim_results_ref: 'claim_results',
      derived_indexes: derivedIndexes,
      evidence_refs: [evidenceId],
      feedback: allClaimsVerified ? [] : ['Review failed command evidence before relying on this Work Record.'],
    },
    health: {
      verdict: allClaimsVerified ? 'valid' : 'blocked',
      reason: allClaimsVerified
        ? 'All run Claims verified against immutable repo command evidence.'
        : 'One or more run Claims failed against the repo command evidence.',
      evaluated_at: completedAt,
      verifier_report_id: verifierReportId,
      confidence: Math.min(...claimResults.map((result) => result.confidence)),
      repair_gate_refs: [],
      replay_gate_refs: [],
    },
    metadata: {
      generated_by: WORK_RECORD_COMMAND_CAPTURE_BUILDER_VERSION,
      evidence_source_id: sourceId,
      verifier_profile_id: verifierProfile.id,
    },
  };
}

export function buildWorkRecordV0FromAosActionEvidence(source = {}, {
  verifierProfile = WORK_RECORD_REPORT_ONLY_PROFILE,
} = {}) {
  const evidenceSource = objectValue(source);
  const sourceId = requireText(evidenceSource.id, 'id');
  const createdAt = requireText(evidenceSource.created_at, 'created_at');
  const completedAt = text(evidenceSource.completed_at, createdAt);
  const requestedRecordId = text(evidenceSource.record_id);
  const baseId = workRecordCaptureBaseId(requestedRecordId, sourceId);
  const recordId = workRecordCaptureRecordId(requestedRecordId, baseId);
  const targetDialect = requireText(evidenceSource.target_dialect, 'target_dialect');
  const target = evidenceTarget(evidenceSource.target);
  const targetWithRef = evidenceTarget(evidenceSource.target_with_ref || objectValue(evidenceSource.action).target);

  const before = objectValue(evidenceSource.before_perception);
  const dryRun = objectValue(evidenceSource.dry_run);
  const action = objectValue(evidenceSource.action);
  const after = objectValue(evidenceSource.after_perception);
  const cleanup = objectValue(evidenceSource.cleanup);
  const postconditionSource = objectValue(evidenceSource.postcondition);

  const beforeStateId = requireText(before.state_id || evidenceSource.state_id, 'before_perception.state_id');
  const actionStateId = text(action.state_id, beforeStateId);
  const afterStateId = requireText(after.state_id, 'after_perception.state_id');
  const actionVerb = requireText(action.verb, 'action.verb');
  const actionCommand = requireText(action.command, 'action.command');
  const dryRunCommand = text(dryRun.command);
  const dryRunStatusValue = dryRunCommand ? actionStatus(dryRun) : '';
  const dryRunPassed = !dryRunCommand || ['success', 'reacquired', 'resolved', 'direct_ax_ready'].includes(dryRunStatusValue);
  const actionStatusValue = actionStatus(action);
  const actionPassed = actionStatusValue === 'success';
  const cleanupCommand = text(cleanup.command);
  const cleanupStatusValue = cleanupCommand ? actionStatus(cleanup) : '';
  const cleanupPassed = !cleanupCommand || cleanupStatusValue === 'success';
  if (typeof postconditionSource.passed !== 'boolean') {
    throw new TypeError('postcondition.passed is required');
  }
  const postconditionPassed = postconditionSource.passed === true;

  const beforeEvidenceId = text(before.evidence_id, `evidence:${baseId}-before-see`);
  const dryRunEvidenceId = dryRunCommand ? text(dryRun.evidence_id, `evidence:${baseId}-dry-run`) : '';
  const actionEvidenceId = text(action.evidence_id, `evidence:${baseId}-do-${slug(actionVerb)}`);
  const afterEvidenceId = text(after.evidence_id, `evidence:${baseId}-after-see`);
  const cleanupEvidenceId = cleanupCommand ? text(cleanup.evidence_id, `evidence:${baseId}-cleanup`) : '';
  const evidenceIds = [
    beforeEvidenceId,
    dryRunEvidenceId,
    actionEvidenceId,
    afterEvidenceId,
    cleanupEvidenceId,
  ].filter(Boolean);
  const selectedSavedRef = text(evidenceSource.selected_saved_ref || action.saved_ref || dryRun.saved_ref);
  const resolvedTarget = text(
    evidenceSource.resolved_target
      || objectValue(action.target_resolution).target_with_ref
      || objectValue(dryRun.target_resolution).target_with_ref
      || targetWithRef,
  );
  const currentValidation = {
    ...cloneJson(objectValue(evidenceSource.current_validation)),
    ...cloneJson(objectValue(dryRun.current_validation)),
    ...cloneJson(objectValue(action.current_validation)),
  };
  const recommendedNext = objectValue(evidenceSource.recommended_next);
  const recommendedNextCommand = text(
    evidenceSource.recommended_next_command
      || action.recommended_next_command
      || dryRun.recommended_next_command,
  );
  const hasSavedRefLane = Boolean(
    selectedSavedRef
      || dryRunCommand
      || cleanupCommand
      || Object.keys(currentValidation).length > 0
      || Object.keys(recommendedNext).length > 0
      || recommendedNextCommand,
  );

  const beforePayload = evidenceEventPayload(before, {
    phase: 'before',
    target_dialect: targetDialect,
    target_with_ref: targetWithRef,
    ...(hasSavedRefLane ? { resolved_target: resolvedTarget } : {}),
    ...(selectedSavedRef ? { selected_saved_ref: selectedSavedRef } : {}),
    source_id: sourceId,
  });
  const dryRunPayload = dryRunCommand ? evidenceEventPayload(dryRun, {
    phase: 'dry_run',
    verb: actionVerb,
    status: dryRunStatusValue,
    target_dialect: targetDialect,
    target_with_ref: targetWithRef,
    ...(hasSavedRefLane ? { resolved_target: resolvedTarget } : {}),
    ...(selectedSavedRef ? { selected_saved_ref: selectedSavedRef } : {}),
    ...(Object.keys(currentValidation).length > 0 ? { current_validation: cloneJson(currentValidation) } : {}),
    source_id: sourceId,
  }) : null;
  const actionPayload = evidenceEventPayload(action, {
    phase: 'action',
    verb: actionVerb,
    status: actionStatusValue,
    target_dialect: targetDialect,
    target_with_ref: targetWithRef,
    ...(hasSavedRefLane ? { resolved_target: resolvedTarget } : {}),
    ...(selectedSavedRef ? { selected_saved_ref: selectedSavedRef } : {}),
    ...(Object.keys(currentValidation).length > 0 ? { current_validation: cloneJson(currentValidation) } : {}),
    execution: cloneJson(objectValue(action.execution)),
    source_id: sourceId,
  });
  const afterPayload = evidenceEventPayload(after, {
    phase: 'after',
    target_dialect: targetDialect,
    target_with_ref: targetWithRef,
    ...(hasSavedRefLane ? { resolved_target: resolvedTarget } : {}),
    ...(selectedSavedRef ? { selected_saved_ref: selectedSavedRef } : {}),
    source_id: sourceId,
  });
  const cleanupPayload = cleanupCommand ? evidenceEventPayload(cleanup, {
    phase: 'cleanup',
    status: cleanupStatusValue,
    target_dialect: targetDialect,
    target_with_ref: targetWithRef,
    selected_saved_ref: selectedSavedRef,
    resolved_target: resolvedTarget,
    source_id: sourceId,
  }) : null;

  const beforePostcondition = {
    id: `postcondition:${baseId}-before-perception`,
    kind: 'aos_see_before',
    description: 'The before perception captured the target scope and State ID used for the action premise.',
    target,
    state_id: beforeStateId,
    check: {
      kind: 'perception_state_captured',
      expected: beforeStateId,
      path: 'before_perception.state_id',
    },
    evidence_refs: [beforeEvidenceId],
    repair_policy: {
      mode: 'manual_review',
      notes: 'Before perception drift should be reviewed against the immutable see evidence before patching the execution map.',
    },
  };
  const actionPostcondition = {
    id: `postcondition:${baseId}-action-executed`,
    kind: 'aos_do_action',
    description: `The bounded AOS action completed successfully: ${actionCommand}`,
    target: targetWithRef,
    state_id: actionStateId,
    check: {
      kind: 'action_status_equals',
      expected: 'success',
      path: 'action.status',
    },
    evidence_refs: [actionEvidenceId],
    repair_policy: {
      mode: 'manual_review',
      notes: 'Action failures require an explicit workflow-gated re-run or execution-map review.',
    },
  };
  const dryRunPostcondition = dryRunCommand ? {
    id: `postcondition:${baseId}-dry-run`,
    kind: 'aos_do_dry_run',
    description: `The saved-ref dry-run resolved before mutation: ${dryRunCommand}`,
    target: selectedSavedRef || targetWithRef,
    state_id: actionStateId,
    check: {
      kind: 'dry_run_status_allows_dispatch',
      expected: 'reacquired_or_resolved',
      path: 'dry_run.status',
    },
    evidence_refs: [dryRunEvidenceId],
    repair_policy: {
      mode: dryRunPassed ? 'manual_review' : 'patch_execution_map',
      notes: 'Dry-run failures must re-perceive and re-resolve the saved ref under an explicit workflow gate before dispatch.',
    },
  } : null;
  const afterPostcondition = {
    id: text(postconditionSource.id, `postcondition:${baseId}-after-state`),
    kind: text(postconditionSource.kind, `${targetDialect}_post_action_state`),
    description: requireText(
      postconditionSource.description,
      'postcondition.description',
    ),
    target: text(postconditionSource.target, targetWithRef),
    state_id: text(postconditionSource.state_id, afterStateId),
    check: {
      kind: requireText(objectValue(postconditionSource.check).kind, 'postcondition.check.kind'),
      ...cloneJson(objectValue(postconditionSource.check)),
    },
    evidence_refs: [afterEvidenceId],
    repair_policy: {
      mode: text(objectValue(postconditionSource.repair_policy).mode, 'manual_review'),
      notes: text(
        objectValue(postconditionSource.repair_policy).notes,
        'Patch target refs or post-action checks only under an explicit workflow gate.',
      ),
    },
  };
  const cleanupPostcondition = cleanupCommand ? {
    id: text(cleanup.postcondition_id, `postcondition:${baseId}-cleanup`),
    kind: text(cleanup.kind, 'aos_cleanup'),
    description: text(cleanup.description, `Cleanup completed for ${target}.`),
    target,
    state_id: text(cleanup.state_id, afterStateId),
    check: {
      kind: 'cleanup_status_equals',
      expected: 'success',
      path: 'cleanup.status',
    },
    evidence_refs: [cleanupEvidenceId],
    repair_policy: {
      mode: cleanupPassed ? 'manual_review' : 'manual_review',
      notes: 'Cleanup failures are recorded as immutable evidence and require explicit follow-up; do not rewrite action evidence.',
    },
  } : null;
  const allPostconditions = [
    beforePostcondition,
    dryRunPostcondition,
    actionPostcondition,
    afterPostcondition,
    cleanupPostcondition,
  ].filter(Boolean);

  const claims = [
    {
      id: `claim:${baseId}-see-do-see-captured`,
      text: 'The bounded AOS action source captured before perception, action metadata, and after perception as immutable evidence.',
      scope: 'run',
      acceptance: 'Before, action, and after evidence refs are present and immutable.',
      postcondition_refs: [
        beforePostcondition.id,
        ...(dryRunPostcondition ? [dryRunPostcondition.id] : []),
        actionPostcondition.id,
        afterPostcondition.id,
        ...(cleanupPostcondition ? [cleanupPostcondition.id] : []),
      ],
    },
    {
      id: `claim:${baseId}-post-action-state-observed`,
      text: text(
        evidenceSource.claim_text,
        'The post-action AOS perception shows the expected target state.',
      ),
      scope: 'run',
      acceptance: text(
        evidenceSource.acceptance,
        text(postconditionSource.description),
      ),
      postcondition_refs: [afterPostcondition.id],
    },
  ];

  const capturePassed = dryRunPassed && actionPassed && postconditionPassed && cleanupPassed;
  const beforeResult = resultFor(beforePostcondition, {
    passed: true,
    evidenceRefs: [beforeEvidenceId],
    reason: 'Before perception includes a State ID and target-scope evidence.',
  });
  const dryRunResult = dryRunPostcondition ? resultFor(dryRunPostcondition, {
    passed: dryRunPassed,
    evidenceRefs: [dryRunEvidenceId],
    reason: dryRunPassed
      ? 'The saved-ref dry-run allowed dispatch under current validation.'
      : `The saved-ref dry-run reported ${dryRunStatusValue}.`,
  }) : null;
  const actionResult = resultFor(actionPostcondition, {
    passed: actionPassed,
    evidenceRefs: [actionEvidenceId],
    reason: actionPassed
      ? 'The AOS do action reported success with execution metadata.'
      : `The AOS do action reported ${actionStatusValue}.`,
  });
  const afterResult = resultFor(afterPostcondition, {
    passed: postconditionPassed,
    evidenceRefs: [afterEvidenceId],
    reason: text(
      postconditionSource.reason,
      postconditionPassed
        ? 'The after perception evidence satisfies the expected post-action state.'
        : 'The after perception evidence did not satisfy the expected post-action state.',
    ),
  });
  const cleanupResult = cleanupPostcondition ? resultFor(cleanupPostcondition, {
    passed: cleanupPassed,
    evidenceRefs: [cleanupEvidenceId],
    reason: cleanupPassed
      ? 'Cleanup evidence reports success.'
      : `Cleanup evidence reports ${cleanupStatusValue}.`,
  }) : null;
  const captureResults = [
    beforeResult,
    dryRunResult,
    actionResult,
    afterResult,
    cleanupResult,
  ].filter(Boolean);
  const claimResults = [
    claimResultForPostconditions({
      claim: claims[0],
      passed: capturePassed,
      evidenceRefs: evidenceIds,
      postconditionResults: captureResults,
      reason: capturePassed
        ? 'The see/do/see action evidence is complete and internally correlated.'
        : 'The see/do/see action evidence did not satisfy every capture postcondition.',
      confidence: capturePassed ? 0.97 : 0.35,
    }),
    claimResultForPostconditions({
      claim: claims[1],
      passed: postconditionPassed,
      evidenceRefs: [afterEvidenceId],
      postconditionResults: [afterResult],
      reason: text(
        postconditionSource.reason,
        postconditionPassed
          ? 'The expected post-action target state was observed in after perception evidence.'
          : 'The expected post-action target state was not observed in after perception evidence.',
      ),
      confidence: postconditionPassed ? 0.96 : 0.35,
    }),
  ];
  const allClaimsVerified = claimResults.every((result) => result.status === 'verified');
  const derivedIndexes = deriveWorkRecordClaimIndexes({ claim_results: claimResults });
  const verifierReportId = `verifier-report:${baseId}`;
  const healthVerdict = healthVerdictForSource({
    evidenceSource,
    actionPassed,
    postconditionPassed,
    cleanupPassed,
  });

  return {
    type: 'aos.work_record',
    schema_version: WORK_RECORD_V0_SCHEMA_VERSION,
    id: recordId,
    label: text(evidenceSource.label, `AOS action evidence: ${actionCommand}`),
    created_at: createdAt,
    origin: {
      kind: 'ad_hoc',
      ref: null,
      description: 'Generated from bounded AOS see/do/see action evidence.',
    },
    references: arrayValue(evidenceSource.references).map((reference) => cloneJson(reference)),
    intent: {
      summary: requireText(objectValue(evidenceSource.intent).summary, 'intent.summary'),
      purpose: text(objectValue(evidenceSource.intent).purpose),
      acceptance: text(objectValue(evidenceSource.intent).acceptance),
      constraints: arrayValue(objectValue(evidenceSource.intent).constraints).map((item) => text(item)).filter(Boolean),
      claim_refs: claims.map((claim) => claim.id),
    },
    execution_map: {
      targets: [
        {
          id: `target:${baseId}-${targetDialect}-scope`,
          target,
          dialect: targetDialect,
          state_id: beforeStateId,
          description: 'Target scope captured by AOS see before the action.',
          candidates: arrayValue(before.semantic_targets).map((candidate) => cloneJson(candidate)),
        },
        {
          id: `target:${baseId}-action-ref`,
          target: targetWithRef,
          dialect: targetDialect,
          state_id: actionStateId,
          description: 'Target-with-Ref selected from before perception and acted on by AOS do.',
          candidates: arrayValue(action.target_candidates).map((candidate) => cloneJson(candidate)),
        },
        {
          id: `target:${baseId}-postcondition-ref`,
          target: afterPostcondition.target,
          dialect: targetDialect,
          state_id: afterPostcondition.state_id,
          description: 'Post-action target checked against after perception evidence.',
          candidates: arrayValue(after.semantic_targets).map((candidate) => cloneJson(candidate)),
        },
      ],
      steps: [
        {
          id: `step:${baseId}-${slug(actionVerb)}`,
          intent: text(action.intent, `Execute ${actionVerb} against ${targetWithRef} and verify the post-action state.`),
          action: {
            verb: actionVerb,
            target: targetWithRef,
            state_id: actionStateId,
          args: {
            command: actionCommand,
            target_dialect: targetDialect,
            target_with_ref: targetWithRef,
            ...(selectedSavedRef ? { selected_saved_ref: selectedSavedRef } : {}),
            ...(hasSavedRefLane ? { resolved_target: resolvedTarget } : {}),
            before_state_id: beforeStateId,
            after_state_id: afterStateId,
            ...(dryRunCommand ? {
              dry_run_command: dryRunCommand,
              dry_run_status: dryRunStatusValue,
            } : {}),
            execution: cloneJson(objectValue(action.execution)),
            ...(Object.keys(currentValidation).length > 0 ? { current_validation: cloneJson(currentValidation) } : {}),
            ...(Object.keys(recommendedNext).length > 0 ? { recommended_next: cloneJson(recommendedNext) } : {}),
            ...(recommendedNextCommand ? { recommended_next_command: recommendedNextCommand } : {}),
          },
        },
          postcondition_refs: [afterPostcondition.id],
          repair_hints: [
            {
              kind: 'patch_target_ref_or_check',
              note: 'If the target ref drifts, re-run see under an explicit workflow gate and patch the execution map rather than replaying automatically.',
            },
          ],
        },
      ],
      postconditions: allPostconditions,
      artifact_routes: [
        {
          id: `artifact-route:${baseId}-before-see`,
          kind: 'aos_see_capture',
          destination: requireText(before.artifact_uri, 'before_perception.artifact_uri'),
          evidence_ref: beforeEvidenceId,
        },
        ...(dryRunCommand ? [{
          id: `artifact-route:${baseId}-dry-run`,
          kind: 'aos_do_dry_run',
          destination: requireText(dryRun.artifact_uri, 'dry_run.artifact_uri'),
          evidence_ref: dryRunEvidenceId,
        }] : []),
        {
          id: `artifact-route:${baseId}-do-action`,
          kind: 'aos_do_action',
          destination: requireText(action.artifact_uri, 'action.artifact_uri'),
          evidence_ref: actionEvidenceId,
        },
        {
          id: `artifact-route:${baseId}-after-see`,
          kind: 'aos_see_capture',
          destination: requireText(after.artifact_uri, 'after_perception.artifact_uri'),
          evidence_ref: afterEvidenceId,
        },
        ...(cleanupCommand ? [{
          id: `artifact-route:${baseId}-cleanup`,
          kind: 'aos_cleanup',
          destination: requireText(cleanup.artifact_uri, 'cleanup.artifact_uri'),
          evidence_ref: cleanupEvidenceId,
        }] : []),
      ],
      replay_policy: {
        mode: 'report_only',
        replay_requires_workflow_gate: true,
        repair_requires_workflow_gate: true,
        gate_refs: [],
        notes: 'This Work Record records and verifies AOS action evidence only; it does not authorize autonomous replay or repair.',
      },
    },
    evidence: [
      {
        id: beforeEvidenceId,
        kind: 'aos_see_capture',
        created_at: requireText(before.captured_at, 'before_perception.captured_at'),
        uri: requireText(before.artifact_uri, 'before_perception.artifact_uri'),
        digest: evidenceDigest(beforePayload),
        state_id: beforeStateId,
        target,
        immutable: true,
        summary: text(before.summary, 'Before perception captured the target scope.'),
        metadata: {
          builder: WORK_RECORD_AOS_ACTION_CAPTURE_BUILDER_VERSION,
          phase: 'before',
          command: text(before.command),
          target_dialect: targetDialect,
          target_with_ref: targetWithRef,
          ...(hasSavedRefLane ? { resolved_target: resolvedTarget } : {}),
          ...(selectedSavedRef ? { selected_saved_ref: selectedSavedRef } : {}),
          element_count: Number.isFinite(before.element_count) ? before.element_count : arrayValue(before.elements).length,
          semantic_targets: arrayValue(before.semantic_targets).map((candidate) => cloneJson(candidate)),
          source: {
            type: text(evidenceSource.type, 'aos.action_evidence'),
            id: sourceId,
          },
          ...cloneJson(objectValue(before.metadata)),
        },
      },
      ...(dryRunCommand ? [{
        id: dryRunEvidenceId,
        kind: 'aos_do_dry_run',
        created_at: requireText(dryRun.executed_at, 'dry_run.executed_at'),
        uri: requireText(dryRun.artifact_uri, 'dry_run.artifact_uri'),
        digest: evidenceDigest(dryRunPayload),
        state_id: actionStateId,
        target: selectedSavedRef || targetWithRef,
        immutable: true,
        summary: text(dryRun.summary, `AOS do ${actionVerb} dry-run reported ${dryRunStatusValue}.`),
        metadata: {
          builder: WORK_RECORD_AOS_ACTION_CAPTURE_BUILDER_VERSION,
          phase: 'dry_run',
          command: dryRunCommand,
          verb: actionVerb,
          status: dryRunStatusValue,
          target_dialect: targetDialect,
          target_with_ref: targetWithRef,
          ...(selectedSavedRef ? { selected_saved_ref: selectedSavedRef } : {}),
          resolved_target: resolvedTarget,
          ...(Object.keys(currentValidation).length > 0 ? { current_validation: cloneJson(currentValidation) } : {}),
          ...(Object.keys(recommendedNext).length > 0 ? { recommended_next: cloneJson(recommendedNext) } : {}),
          ...(recommendedNextCommand ? { recommended_next_command: recommendedNextCommand } : {}),
          source: {
            type: text(evidenceSource.type, 'aos.action_evidence'),
            id: sourceId,
          },
          ...cloneJson(objectValue(dryRun.metadata)),
        },
      }] : []),
      {
        id: actionEvidenceId,
        kind: 'aos_do_action',
        created_at: requireText(action.executed_at, 'action.executed_at'),
        uri: requireText(action.artifact_uri, 'action.artifact_uri'),
        digest: evidenceDigest(actionPayload),
        state_id: actionStateId,
        target: targetWithRef,
        immutable: true,
        summary: text(action.summary, `AOS do ${actionVerb} reported ${actionStatusValue}.`),
        metadata: {
          builder: WORK_RECORD_AOS_ACTION_CAPTURE_BUILDER_VERSION,
          phase: 'action',
          command: actionCommand,
          verb: actionVerb,
          status: actionStatusValue,
          target_dialect: targetDialect,
          target_with_ref: targetWithRef,
          ...(hasSavedRefLane ? { resolved_target: resolvedTarget } : {}),
          ...(selectedSavedRef ? { selected_saved_ref: selectedSavedRef } : {}),
          ...(Object.keys(currentValidation).length > 0 ? { current_validation: cloneJson(currentValidation) } : {}),
          execution: cloneJson(objectValue(action.execution)),
          ...(Object.keys(recommendedNext).length > 0 ? { recommended_next: cloneJson(recommendedNext) } : {}),
          ...(recommendedNextCommand ? { recommended_next_command: recommendedNextCommand } : {}),
          source: {
            type: text(evidenceSource.type, 'aos.action_evidence'),
            id: sourceId,
          },
          ...cloneJson(objectValue(action.metadata)),
        },
      },
      {
        id: afterEvidenceId,
        kind: 'aos_see_capture',
        created_at: requireText(after.captured_at, 'after_perception.captured_at'),
        uri: requireText(after.artifact_uri, 'after_perception.artifact_uri'),
        digest: evidenceDigest(afterPayload),
        state_id: afterStateId,
        target,
        immutable: true,
        summary: text(after.summary, 'After perception captured the post-action target state.'),
        metadata: {
          builder: WORK_RECORD_AOS_ACTION_CAPTURE_BUILDER_VERSION,
          phase: 'after',
          command: text(after.command),
          target_dialect: targetDialect,
          target_with_ref: targetWithRef,
          ...(hasSavedRefLane ? { resolved_target: resolvedTarget } : {}),
          ...(selectedSavedRef ? { selected_saved_ref: selectedSavedRef } : {}),
          element_count: Number.isFinite(after.element_count) ? after.element_count : arrayValue(after.elements).length,
          semantic_targets: arrayValue(after.semantic_targets).map((candidate) => cloneJson(candidate)),
          source: {
            type: text(evidenceSource.type, 'aos.action_evidence'),
            id: sourceId,
          },
          ...cloneJson(objectValue(after.metadata)),
        },
      },
      ...(cleanupCommand ? [{
        id: cleanupEvidenceId,
        kind: 'aos_cleanup',
        created_at: requireText(cleanup.completed_at || cleanup.executed_at, 'cleanup.completed_at'),
        uri: requireText(cleanup.artifact_uri, 'cleanup.artifact_uri'),
        digest: evidenceDigest(cleanupPayload),
        state_id: text(cleanup.state_id, afterStateId),
        target,
        immutable: true,
        summary: text(cleanup.summary, `Cleanup reported ${cleanupStatusValue}.`),
        metadata: {
          builder: WORK_RECORD_AOS_ACTION_CAPTURE_BUILDER_VERSION,
          phase: 'cleanup',
          command: cleanupCommand,
          status: cleanupStatusValue,
          target_dialect: targetDialect,
          target_with_ref: targetWithRef,
          ...(hasSavedRefLane ? { resolved_target: resolvedTarget } : {}),
          ...(selectedSavedRef ? { selected_saved_ref: selectedSavedRef } : {}),
          source: {
            type: text(evidenceSource.type, 'aos.action_evidence'),
            id: sourceId,
          },
          ...cloneJson(objectValue(cleanup.metadata)),
        },
      }] : []),
    ],
    claims,
    claim_results: claimResults,
    verifier_report: {
      id: verifierReportId,
      generated_at: completedAt,
      verifier: {
        id: verifierProfile.id,
        kind: verifierProfile.kind,
        version: verifierProfile.version,
      },
      claim_results_ref: 'claim_results',
      derived_indexes: derivedIndexes,
      evidence_refs: evidenceIds,
      feedback: allClaimsVerified
        ? []
        : [hasSavedRefLane
          ? 'Review failed AOS saved-ref action evidence before relying on this Work Record.'
          : 'Review failed AOS action evidence before relying on this Work Record.'],
    },
    health: {
      verdict: healthVerdict,
      reason: hasSavedRefLane
        ? healthReasonForVerdict(healthVerdict, objectValue(evidenceSource.health).reason)
        : (allClaimsVerified
          ? 'All run Claims verified against immutable AOS see/do/see evidence.'
          : 'One or more run Claims failed against the AOS action evidence.'),
      evaluated_at: completedAt,
      verifier_report_id: verifierReportId,
      confidence: Math.min(...claimResults.map((result) => result.confidence)),
      repair_gate_refs: [],
      replay_gate_refs: [],
    },
    metadata: {
      generated_by: WORK_RECORD_AOS_ACTION_CAPTURE_BUILDER_VERSION,
      evidence_source_id: sourceId,
      verifier_profile_id: verifierProfile.id,
      target_dialect: targetDialect,
      target_with_ref: targetWithRef,
      ...(selectedSavedRef ? { selected_saved_ref: selectedSavedRef } : {}),
      ...(hasSavedRefLane ? { resolved_target: resolvedTarget } : {}),
      ...(hasSavedRefLane ? { health_verdict: healthVerdict } : {}),
    },
  };
}

export function buildWorkRecordV0FromStepDescriptorEvidence(stepDescriptor = {}, source = {}, {
  verifierProfile = WORK_RECORD_REPORT_ONLY_PROFILE,
} = {}) {
  const step = objectValue(stepDescriptor);
  const evidenceSource = objectValue(source);
  const stepId = requireText(step.id, 'step_descriptor.id');
  const workflowRef = requireText(step.workflow_ref, 'step_descriptor.workflow_ref');
  const gates = objectValue(step.workflow_gates);
  const gateRefs = uniqueStrings(arrayValue(gates.gate_refs));
  const promotions = arrayValue(step.claim_promotions).map((promotion) => objectValue(promotion));
  const promotionRefs = promotions.map((promotion) => text(promotion.id)).filter(Boolean);

  const record = buildWorkRecordV0FromAosActionEvidence(
    stepDescriptorEvidenceSource(step, evidenceSource),
    { verifierProfile },
  );
  const beforePostcondition = arrayValue(record.execution_map.postconditions)
    .find((postcondition) => text(objectValue(postcondition).kind) === 'aos_see_before');
  const runStep = objectValue(arrayValue(record.execution_map.steps)[0]);

  record.origin = {
    kind: 'workflow',
    ref: workflowRef,
    run_id: text(evidenceSource.run_id, stepDescriptorRunId(step, evidenceSource)),
    version: text(step.version, 'v0'),
    subject_type: 'aos.workflow',
    description: text(
      objectValue(step.intent).summary,
      'Generated from a reusable Step descriptor and saved AOS action evidence.',
    ),
  };

  record.references = mergeReferences(
    [
      {
        id: 'origin-workflow-subject',
        relationship: 'origin_subject',
        ref: workflowRef,
        subject_type: 'aos.workflow',
        layer: 'execution_map',
        role: 'emitter',
      },
      {
        id: 'origin-step-descriptor',
        relationship: 'origin_step',
        ref: stepId,
        subject_type: 'aos.step_descriptor',
        layer: 'execution_map',
        role: 'step_template',
      },
    ],
    arrayValue(step.references),
    arrayValue(evidenceSource.references),
  );

  if (beforePostcondition && arrayValue(step.preconditions).length > 0) {
    runStep.precondition_refs = [beforePostcondition.id];
  }
  runStep.action.args = {
    ...objectValue(runStep.action.args),
    workflow_ref: workflowRef,
    step_descriptor_id: stepId,
    target_resolution: cloneJson(objectValue(step.target_resolution)),
    claim_promotion_refs: promotionRefs,
  };
  runStep.repair_hints = [
    ...arrayValue(runStep.repair_hints).map((hint) => cloneJson(hint)),
    ...arrayValue(step.repair_hints).map((hint) => cloneJson(hint)),
  ];

  record.execution_map.replay_policy = {
    mode: text(gates.mode, 'report_only'),
    replay_requires_workflow_gate: true,
    repair_requires_workflow_gate: true,
    gate_refs: gateRefs,
    notes: text(
      gates.notes,
      'This Workflow-origin Work Record is report-only and does not authorize autonomous replay or repair.',
    ),
  };

  for (const promotion of promotions) {
    const postconditionRef = text(promotion.postcondition_ref);
    const promotedClaim = arrayValue(record.claims).find((claim) => {
      const value = objectValue(claim);
      const refs = arrayValue(value.postcondition_refs).map((ref) => text(ref));
      return refs.length === 1 && refs[0] === postconditionRef;
    });
    if (!promotedClaim) continue;
    promotedClaim.metadata = {
      ...objectValue(promotedClaim.metadata),
      promoted_from: {
        workflow_ref: workflowRef,
        step_descriptor_id: stepId,
        claim_promotion_id: text(promotion.id),
        postcondition_ref: postconditionRef,
      },
      promotion_boundary: 'postcondition_to_work_record_claim',
    };
  }

  record.health.repair_gate_refs = gateRefs;
  record.health.replay_gate_refs = gateRefs;
  record.metadata = {
    ...objectValue(record.metadata),
    generated_by: WORK_RECORD_STEP_DESCRIPTOR_CAPTURE_BUILDER_VERSION,
    action_evidence_builder: WORK_RECORD_AOS_ACTION_CAPTURE_BUILDER_VERSION,
    workflow_ref: workflowRef,
    step_descriptor_id: stepId,
    step_descriptor_schema_version: text(step.schema_version),
    step_descriptor_version: text(step.version),
    claim_promotion_refs: promotionRefs,
    workflow_gate_refs: gateRefs,
  };

  return record;
}
