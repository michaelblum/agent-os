import { WORK_RECORD_V0_SCHEMA_VERSION } from './work-record-adapter.js';
import {
  deriveWorkRecordClaimIndexes,
  WORK_RECORD_REPORT_ONLY_PROFILE,
} from './work-record-verifier.js';

export const WORK_RECORD_COMMAND_CAPTURE_BUILDER_VERSION = '2026-05-command-evidence-v0';

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

export function buildWorkRecordV0FromCommandEvidence(source = {}, {
  verifierProfile = WORK_RECORD_REPORT_ONLY_PROFILE,
} = {}) {
  const evidenceSource = objectValue(source);
  const command = requireText(evidenceSource.command, 'command');
  const createdAt = requireText(evidenceSource.created_at, 'created_at');
  const completedAt = text(evidenceSource.completed_at, createdAt);
  const sourceId = requireText(evidenceSource.id, 'id');
  const baseId = slug(text(evidenceSource.record_id || sourceId).replace(/^work-record:/, ''));
  const requestedRecordId = text(evidenceSource.record_id);
  const recordId = requestedRecordId
    ? (requestedRecordId.startsWith('work-record:') ? requestedRecordId : `work-record:${requestedRecordId}`)
    : `work-record:${baseId}`;
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
