import {
  WORK_RECORD_V0_SCHEMA_VERSION,
} from './work-record-adapter.js';
import {
  deriveWorkRecordClaimIndexes,
  WORK_RECORD_REPORT_ONLY_PROFILE,
} from './work-record-verifier.js';
import {
  WORK_RECORD_COMMAND_CAPTURE_BUILDER_VERSION,
} from './work-record-capture-versions.js';
import {
  arrayValue,
  claimResult,
  cloneJson,
  commandTarget,
  evidenceDigest,
  multilineText,
  objectValue,
  requireText,
  text,
  workRecordCaptureBaseId,
  workRecordCaptureRecordId,
} from './work-record-capture-helpers.js';

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

