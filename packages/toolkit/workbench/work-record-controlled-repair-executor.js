import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildWorkRecordRepairAttemptArtifact,
  validateWorkRecordRepairAttemptArtifact,
  digestJson,
} from './work-record-repair-attempt-artifact.js';
import {
  validateWorkRecordRepairAttemptPlan,
} from './work-record-repair-attempt-plan.js';

export const WORK_RECORD_CONTROLLED_REPAIR_EXECUTOR_RESULT_SCHEMA_VERSION = '2026-07-work-record-controlled-repair-executor-result-v0';
export const WORK_RECORD_CONTROLLED_REPAIR_EXECUTOR_RESULT_TYPE = 'work_record.controlled_repair_executor_result';

export const WORK_RECORD_CONTROLLED_REPAIR_EXECUTOR_STATUSES = [
  'dry_run',
  'succeeded',
  'failed',
  'partial',
  'aborted_precondition',
  'blocked_plan_not_ready',
  'blocked_authorization',
  'blocked_unsupported_operation',
  'blocked_unsafe_command',
  'blocked_workspace_escape',
  'blocked_timeout',
  'artifact_invalid',
  'finalize_blocked',
  'cleanup_failed',
  'rollback_failed',
  'unsupported',
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STDIO_LIMIT_BYTES = 64 * 1024;

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

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function fileDigest(file) {
  if (!fs.existsSync(file)) return '';
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function rawPathHasTraversal(value = '') {
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

function resolveContainedRoot(root, field, diagnostics) {
  if (!text(root)) {
    diagnostics.push({
      severity: 'error',
      code: 'CONTROLLED_REPAIR_EXECUTOR_ROOT_REQUIRED',
      message: `${field} is required.`,
      path: field,
    });
    return '';
  }
  if (rawPathHasTraversal(root) || !fs.existsSync(root)) {
    diagnostics.push({
      severity: 'error',
      code: 'CONTROLLED_REPAIR_EXECUTOR_ROOT_UNSAFE',
      message: `${field} must be an existing explicit root without path traversal.`,
      path: field,
    });
    return '';
  }
  return fs.realpathSync(path.resolve(root));
}

function safeRelativePath(value = '') {
  const rel = text(value);
  if (!rel || path.isAbsolute(rel) || rawPathHasTraversal(rel) || rel === '.' || rel.startsWith('/')) return '';
  return rel;
}

function resolveUnderRoot(root, rel, diagnostics, field) {
  const safe = safeRelativePath(rel);
  if (!safe) {
    diagnostics.push({
      severity: 'error',
      code: 'CONTROLLED_REPAIR_EXECUTOR_PATH_TRAVERSAL',
      message: `${field} must be a relative path under the execution root.`,
      path: field,
    });
    return '';
  }
  const resolved = path.resolve(root, safe);
  const existingReal = realExistingPath(resolved);
  if (!existingReal || !containedPath(existingReal, root)) {
    diagnostics.push({
      severity: 'error',
      code: 'CONTROLLED_REPAIR_EXECUTOR_WORKSPACE_ESCAPE',
      message: `${field} escapes the execution root.`,
      path: field,
      value: rel,
    });
    return '';
  }
  return resolved;
}

function defaultRepoRoot() {
  return path.resolve(__dirname, '../../..');
}

function fixtureScript(repoRoot) {
  return path.join(repoRoot, 'scripts/work-record-fixture-operation.mjs');
}

function descriptorMap(repoRoot = defaultRepoRoot()) {
  const script = fixtureScript(repoRoot);
  const base = {
    operation_kind: 'deterministic_repo_command_file_fixture',
    executable: process.execPath,
    script,
    timeout_ms: 2000,
    allowed_mutations: ['output/result.txt'],
    digest_paths: ['input.txt', 'output/result.txt'],
    environment: {
      AOS_CONTROLLED_REPAIR_EXECUTOR: '1',
    },
  };
  return new Map([
    ['controlled_fixture.write_success', {
      ...base,
      id: 'controlled_fixture.write_success',
      argv: [process.execPath, script, '--mode', 'write', '--file', 'output/result.txt', '--value', 'controlled repair succeeded'],
      cleanup: { id: 'cleanup:result-file', argv: [process.execPath, script, '--mode', 'cleanup', '--file', 'cleanup.tmp'] },
    }],
    ['controlled_fixture.write_failure', {
      ...base,
      id: 'controlled_fixture.write_failure',
      argv: [process.execPath, script, '--mode', 'fail-after-write', '--file', 'output/result.txt', '--value', 'controlled repair failed'],
      rollback: { id: 'rollback:result-file', argv: [process.execPath, script, '--mode', 'rollback', '--file', 'output/result.txt'] },
    }],
    ['controlled_fixture.write_timeout', {
      ...base,
      id: 'controlled_fixture.write_timeout',
      timeout_ms: 50,
      argv: [process.execPath, script, '--mode', 'sleep', '--ms', '5000'],
    }],
    ['controlled_fixture.cleanup_success', {
      ...base,
      id: 'controlled_fixture.cleanup_success',
      allowed_mutations: ['output/result.txt', 'cleanup.tmp'],
      digest_paths: ['input.txt', 'output/result.txt', 'cleanup.tmp'],
      argv: [process.execPath, script, '--mode', 'write', '--file', 'output/result.txt', '--value', 'cleanup succeeds'],
      cleanup: { id: 'cleanup:declared-temp', argv: [process.execPath, script, '--mode', 'cleanup', '--file', 'cleanup.tmp'] },
    }],
    ['controlled_fixture.cleanup_failure', {
      ...base,
      id: 'controlled_fixture.cleanup_failure',
      argv: [process.execPath, script, '--mode', 'write', '--file', 'output/result.txt', '--value', 'cleanup fails'],
      cleanup: { id: 'cleanup:declared-temp', argv: [process.execPath, script, '--mode', 'cleanup-fail', '--file', 'cleanup.tmp'] },
    }],
    ['controlled_fixture.rollback_success', {
      ...base,
      id: 'controlled_fixture.rollback_success',
      argv: [process.execPath, script, '--mode', 'fail-after-write', '--file', 'output/result.txt', '--value', 'rollback succeeds'],
      rollback: { id: 'rollback:result-file', argv: [process.execPath, script, '--mode', 'rollback', '--file', 'output/result.txt'] },
    }],
    ['controlled_fixture.rollback_failure', {
      ...base,
      id: 'controlled_fixture.rollback_failure',
      argv: [process.execPath, script, '--mode', 'fail-after-write', '--file', 'output/result.txt', '--value', 'rollback fails'],
      rollback: { id: 'rollback:result-file', argv: [process.execPath, script, '--mode', 'rollback-fail', '--file', 'output/result.txt'] },
    }],
  ]);
}

function operationAllowlistId(operation = {}) {
  return text(operation.allowlisted_operation_id || operation.allowlisted_operation?.id || operation.controlled_repair_executor?.allowlisted_operation_id);
}

function isUnsupportedLiveOperation(operation = {}) {
  const haystack = [
    operation.kind,
    operation.target_boundary,
    operation.surface,
    operation.adapter,
    operation.allowlisted_operation_id,
  ].map(text).join(' ').toLowerCase();
  return ['browser', 'native', 'ax', 'canvas', 'coordinate', 'screenshot', 'image_matching', 'tcc'].some((token) => haystack.includes(token));
}

function hasUnsafeCommand(operation = {}) {
  return text(operation.command) || text(operation.shell) || arrayValue(operation.argv).length > 0 || operation.sh === true;
}

function selectOperation(plan = {}, explicitOperationId = '') {
  const operations = arrayValue(plan.planned_operations).map(objectValue);
  if (explicitOperationId) return operations.find((operation) => text(operation.id) === explicitOperationId) || null;
  return operations.find((operation) => operationAllowlistId(operation)) || operations.find((operation) => operation.mutates_state === true) || null;
}

function artifactPath(artifactRoot, plan = {}) {
  const digest = text(plan.attempt_identity?.digest, digestJson(plan)).slice(0, 24);
  return path.join(artifactRoot, `repair-attempt-artifact-${digest}.json`);
}

function baseResult({
  status = 'unsupported',
  mode = 'execute',
  plan = {},
  operation = {},
  descriptor = {},
  execution = {},
  operationOutcomes = [],
  artifact = {},
  artifactValidation = null,
  diagnostics = [],
  finalization = null,
} = {}) {
  const dryRun = mode === 'dry_run';
  const succeeded = status === 'succeeded';
  return {
    type: WORK_RECORD_CONTROLLED_REPAIR_EXECUTOR_RESULT_TYPE,
    schema_version: WORK_RECORD_CONTROLLED_REPAIR_EXECUTOR_RESULT_SCHEMA_VERSION,
    status,
    mode,
    repair_attempt_plan: {
      path: text(plan.__path),
      schema_version: text(plan.schema_version),
      status: text(plan.status),
      attempt_id: text(plan.attempt_identity?.attempt_id),
      digest: text(plan.attempt_identity?.digest, digestJson(plan)),
    },
    source_work_record: cloneJson(plan.source_work_record || {}),
    execution: {
      allowlisted_operation_id: text(descriptor.id),
      planned_operation_id: text(operation.id),
      command_identity: text(descriptor.id),
      argv: cloneJson(arrayValue(descriptor.argv)),
      execution_root: text(execution.execution_root),
      artifact_root: text(execution.artifact_root),
      artifact_path: text(execution.artifact_path),
      timeout_ms: descriptor.timeout_ms || 0,
      allowed_mutations: cloneJson(arrayValue(descriptor.allowed_mutations)),
      digest_paths: cloneJson(arrayValue(descriptor.digest_paths)),
      deterministic_environment: cloneJson(descriptor.environment || {}),
      cleanup_plan: descriptor.cleanup ? cloneJson({ id: descriptor.cleanup.id, argv: descriptor.cleanup.argv }) : null,
      rollback_plan: descriptor.rollback ? cloneJson({ id: descriptor.rollback.id, argv: descriptor.rollback.argv }) : null,
      expected_side_effects: dryRun ? cloneJson(arrayValue(descriptor.allowed_mutations).map((item) => `mutate:${item}`)) : [],
      ...cloneJson(execution.observed || {}),
    },
    operation_outcomes: cloneJson(operationOutcomes),
    artifact: cloneJson(artifact),
    artifact_validation: artifactValidation ? cloneJson(artifactValidation) : null,
    finalization: finalization ? cloneJson(finalization) : {
      requested: false,
      status: 'not_requested',
    },
    side_effects: succeeded ? ['write_repair_attempt_artifact'] : [],
    mutates_execution_root: !dryRun && ['succeeded', 'failed', 'partial', 'cleanup_failed', 'rollback_failed', 'blocked_timeout'].includes(status),
    mutates_source_record: false,
    executes_repair: !dryRun && ['succeeded', 'failed', 'partial', 'cleanup_failed', 'rollback_failed', 'blocked_timeout'].includes(status),
    would_execute_repair: dryRun,
    executes_actions: false,
    uses_live_ui: false,
    uses_browser: false,
    uses_native_ax: false,
    uses_canvas: false,
    applies_patches: false,
    automatic_replay_allowed: false,
    diagnostics,
    recommended_next: succeeded
      ? { action: 'validate_or_finalize_artifact', artifact_path: text(execution.artifact_path) }
      : { action: dryRun ? 'rerun_without_dry_run_to_execute_fixture' : 'inspect_executor_diagnostics' },
  };
}

function blocked(status, diagnostic, context = {}) {
  return baseResult({
    status,
    mode: context.mode || 'execute',
    plan: context.plan || {},
    operation: context.operation || {},
    descriptor: context.descriptor || {},
    execution: context.execution || {},
    diagnostics: [diagnostic, ...arrayValue(context.diagnostics)],
  });
}

function snapshotPaths(root, rels = []) {
  return rels.map((rel) => {
    const resolved = path.resolve(root, rel);
    return {
      path: rel,
      exists: fs.existsSync(resolved),
      digest: fileDigest(resolved),
    };
  });
}

function fileChanges(before = [], after = []) {
  const afterByPath = new Map(after.map((item) => [item.path, item]));
  return before.map((item) => {
    const next = afterByPath.get(item.path) || { path: item.path, exists: false, digest: '' };
    return {
      path: item.path,
      before_exists: item.exists,
      after_exists: next.exists,
      before_digest: item.digest,
      after_digest: next.digest,
      changed: item.exists !== next.exists || item.digest !== next.digest,
    };
  });
}

function boundedAppend(current, chunk, limit) {
  const next = Buffer.concat([current, Buffer.from(chunk)]);
  if (next.length <= limit) return { buffer: next, truncated: false };
  return { buffer: next.subarray(0, limit), truncated: true };
}

function runCommand(argv, {
  cwd,
  env = {},
  timeoutMs = 2000,
  stdioLimitBytes = DEFAULT_STDIO_LIMIT_BYTES,
} = {}) {
  return new Promise((resolve) => {
    const startedAt = new Date();
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env: {
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        HOME: process.env.HOME || '',
        TMPDIR: process.env.TMPDIR || '/tmp',
        ...env,
      },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      const next = boundedAppend(stdout, chunk, stdioLimitBytes);
      stdout = next.buffer;
      stdoutTruncated = stdoutTruncated || next.truncated;
    });
    child.stderr.on('data', (chunk) => {
      const next = boundedAppend(stderr, chunk, stdioLimitBytes);
      stderr = next.buffer;
      stderrTruncated = stderrTruncated || next.truncated;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        started_at: startedAt.toISOString(),
        finished_at: new Date().toISOString(),
        exit_code: null,
        signal: null,
        timed_out: timedOut,
        stdout: stdout.toString('utf8'),
        stderr: `${stderr.toString('utf8')}${error.message}`,
        stdout_truncated: stdoutTruncated,
        stderr_truncated: stderrTruncated,
      });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        started_at: startedAt.toISOString(),
        finished_at: new Date().toISOString(),
        exit_code: code,
        signal,
        timed_out: timedOut,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        stdout_truncated: stdoutTruncated,
        stderr_truncated: stderrTruncated,
      });
    });
  });
}

function commandStatus(result) {
  if (result.timed_out) return 'blocked_timeout';
  return result.exit_code === 0 ? 'succeeded' : 'failed';
}

function cleanupResult(outcomeId, descriptor, result) {
  return {
    id: text(descriptor.id, `cleanup:${outcomeId}`),
    operation_outcome_id: outcomeId,
    status: result.exit_code === 0 && !result.timed_out ? 'passed' : 'failed',
    command: {
      argv: descriptor.argv,
      exit_code: result.exit_code,
      signal: result.signal,
      timed_out: result.timed_out,
      stdout: result.stdout,
      stderr: result.stderr,
      stdout_truncated: result.stdout_truncated,
      stderr_truncated: result.stderr_truncated,
    },
  };
}

function rollbackResult(outcomeId, descriptor, result) {
  return {
    id: text(descriptor.id, `rollback:${outcomeId}`),
    operation_outcome_id: outcomeId,
    status: result.exit_code === 0 && !result.timed_out ? 'passed' : 'failed',
    command: {
      argv: descriptor.argv,
      exit_code: result.exit_code,
      signal: result.signal,
      timed_out: result.timed_out,
      stdout: result.stdout,
      stderr: result.stderr,
      stdout_truncated: result.stdout_truncated,
      stderr_truncated: result.stderr_truncated,
    },
  };
}

export async function executeControlledWorkRecordRepair(input = {}) {
  const diagnostics = [];
  const mode = input.dryRun === true ? 'dry_run' : 'execute';
  const repoRoot = path.resolve(input.repoRoot || defaultRepoRoot());
  const planPath = text(input.attemptPlanPath);
  if (!planPath || !fs.existsSync(planPath)) {
    return blocked('aborted_precondition', {
      severity: 'error',
      code: 'CONTROLLED_REPAIR_EXECUTOR_ATTEMPT_PLAN_NOT_FOUND',
      message: 'Repair Attempt Plan JSON path is required and must exist.',
      path: 'attempt_plan',
    }, { mode });
  }

  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  plan.__path = path.resolve(planPath);
  const executionRoot = resolveContainedRoot(input.executionRoot, 'execution_root', diagnostics);
  const artifactRoot = resolveContainedRoot(input.artifactRoot, 'artifact_root', diagnostics);
  const plannedArtifactPath = artifactRoot ? artifactPath(artifactRoot, plan) : '';
  const execution = {
    execution_root: executionRoot,
    artifact_root: artifactRoot,
    artifact_path: plannedArtifactPath,
  };
  if (diagnostics.length > 0) {
    return baseResult({
      status: 'blocked_workspace_escape',
      mode,
      plan,
      execution,
      diagnostics,
    });
  }

  const planValidation = validateWorkRecordRepairAttemptPlan(plan);
  if (planValidation.status !== 'passed') {
    return baseResult({
      status: 'unsupported',
      mode,
      plan,
      execution,
      diagnostics: planValidation.diagnostics,
    });
  }
  if (text(plan.status) !== 'ready') {
    return baseResult({
      status: 'blocked_plan_not_ready',
      mode,
      plan,
      execution,
      diagnostics: [{
        severity: 'error',
        code: 'CONTROLLED_REPAIR_EXECUTOR_PLAN_NOT_READY',
        message: 'Controlled Repair Executor requires a ready Repair Attempt Plan.',
        path: 'repair_attempt_plan.status',
        actual: text(plan.status),
      }],
    });
  }
  if (!arrayValue(plan.workflow_gate_authorizations).some((authorization) => text(objectValue(authorization).status || objectValue(authorization).authorization_status) === 'authorized')) {
    return baseResult({
      status: 'blocked_authorization',
      mode,
      plan,
      execution,
      diagnostics: [{
        severity: 'error',
        code: 'CONTROLLED_REPAIR_EXECUTOR_AUTHORIZATION_MISSING',
        message: 'Ready Repair Attempt Plans must carry an authorized Workflow Gate Authorization.',
        path: 'workflow_gate_authorizations',
      }],
    });
  }

  const operation = selectOperation(plan, input.operationId);
  if (!operation) {
    return baseResult({
      status: 'blocked_unsupported_operation',
      mode,
      plan,
      execution,
      diagnostics: [{
        severity: 'error',
        code: 'CONTROLLED_REPAIR_EXECUTOR_OPERATION_MISSING',
        message: 'No planned operation is available for execution.',
        path: 'planned_operations',
      }],
    });
  }
  if (isUnsupportedLiveOperation(operation)) {
    return blocked('blocked_unsupported_operation', {
      severity: 'error',
      code: 'CONTROLLED_REPAIR_EXECUTOR_LIVE_SURFACE_UNSUPPORTED',
      message: 'Browser, native AX, canvas, coordinate, screenshot, image matching, and TCC-gated operations are unsupported.',
      path: 'planned_operations',
    }, { mode, plan, operation, execution });
  }
  if (hasUnsafeCommand(operation)) {
    return blocked('blocked_unsafe_command', {
      severity: 'error',
      code: 'CONTROLLED_REPAIR_EXECUTOR_UNSAFE_COMMAND_DESCRIPTOR',
      message: 'Repair Attempt Plans may not carry shell strings, argv, or free-form command descriptors for this executor.',
      path: 'planned_operations',
    }, { mode, plan, operation, execution });
  }

  const allowlistedOperationId = operationAllowlistId(operation);
  const descriptor = descriptorMap(repoRoot).get(allowlistedOperationId);
  if (!descriptor) {
    return blocked('blocked_unsupported_operation', {
      severity: 'error',
      code: 'CONTROLLED_REPAIR_EXECUTOR_OPERATION_NOT_ALLOWLISTED',
      message: 'Planned operation is not in the Controlled Repair Executor allowlist.',
      path: 'planned_operations.allowlisted_operation_id',
      actual: allowlistedOperationId,
    }, { mode, plan, operation, execution });
  }
  if (!fs.existsSync(descriptor.script) || descriptor.argv.some((arg) => typeof arg !== 'string') || descriptor.argv[0] !== process.execPath) {
    return blocked('blocked_unsafe_command', {
      severity: 'error',
      code: 'CONTROLLED_REPAIR_EXECUTOR_DESCRIPTOR_UNSAFE',
      message: 'Allowlisted command descriptor is not a repo-owned direct argv command.',
      path: 'allowlist',
    }, { mode, plan, operation, descriptor, execution });
  }
  for (const rel of [...arrayValue(descriptor.allowed_mutations), ...arrayValue(descriptor.digest_paths)]) {
    resolveUnderRoot(executionRoot, rel, diagnostics, `allowlist.path:${rel}`);
  }
  if (diagnostics.length > 0) {
    return baseResult({
      status: 'blocked_workspace_escape',
      mode,
      plan,
      operation,
      descriptor,
      execution,
      diagnostics,
    });
  }
  if (mode === 'dry_run') {
    return baseResult({
      status: 'dry_run',
      mode,
      plan,
      operation,
      descriptor,
      execution,
      diagnostics,
    });
  }

  const sourcePath = text(plan.source_work_record?.path);
  const sourceBefore = sourcePath && fs.existsSync(sourcePath) ? fileDigest(sourcePath) : '';
  const beforeSnapshot = snapshotPaths(executionRoot, descriptor.digest_paths);
  const startedAt = new Date();
  const command = await runCommand(descriptor.argv, {
    cwd: executionRoot,
    env: descriptor.environment,
    timeoutMs: descriptor.timeout_ms,
  });
  const afterSnapshot = snapshotPaths(executionRoot, descriptor.digest_paths);
  const changes = fileChanges(beforeSnapshot, afterSnapshot);
  const sourceAfter = sourcePath && fs.existsSync(sourcePath) ? fileDigest(sourcePath) : sourceBefore;
  const outcomeId = `operation-outcome:${text(operation.id).replace(/[^A-Za-z0-9._:-]+/g, '_')}`;
  const status = commandStatus(command);
  const cleanupResults = [];
  const rollbackResults = [];
  if (descriptor.cleanup) {
    const result = await runCommand(descriptor.cleanup.argv, {
      cwd: executionRoot,
      env: descriptor.environment,
      timeoutMs: descriptor.timeout_ms,
    });
    cleanupResults.push(cleanupResult(outcomeId, descriptor.cleanup, result));
  }
  if (descriptor.rollback && status !== 'succeeded') {
    const result = await runCommand(descriptor.rollback.argv, {
      cwd: executionRoot,
      env: descriptor.environment,
      timeoutMs: descriptor.timeout_ms,
    });
    rollbackResults.push(rollbackResult(outcomeId, descriptor.rollback, result));
  }
  const cleanupFailed = cleanupResults.some((result) => result.status === 'failed');
  const rollbackFailed = rollbackResults.some((result) => result.status === 'failed');
  const executorStatus = status === 'blocked_timeout'
    ? 'blocked_timeout'
    : cleanupFailed
      ? 'cleanup_failed'
      : rollbackFailed
        ? 'rollback_failed'
        : status === 'succeeded'
          ? 'succeeded'
          : rollbackResults.some((result) => result.status === 'passed')
            ? 'failed'
            : 'failed';
  const artifactStatus = executorStatus === 'succeeded'
    ? 'succeeded'
    : executorStatus === 'cleanup_failed'
      ? 'cleanup_failed'
      : executorStatus === 'rollback_failed'
        ? 'rollback_failed'
        : 'failed';
  const requiredEvidence = arrayValue(operation.evidence_requirement_refs).map(text).filter(Boolean);
  const allRequiredEvidence = arrayValue(plan.evidence_requirements)
    .filter((requirement) => objectValue(requirement).required === true)
    .map((requirement) => text(objectValue(requirement).id))
    .filter(Boolean);
  const evidenceIds = [...new Set([...requiredEvidence, ...allRequiredEvidence])].sort();
  const digestEvidenceId = `evidence:controlled-repair-digests:${text(operation.id).replace(/[^A-Za-z0-9._:-]+/g, '_')}`;
  const evidenceRefs = [
    ...evidenceIds.map((id) => ({
      id,
      uri: `artifact:${digestEvidenceId}`,
      digest: digestJson({ id, before: beforeSnapshot, after: afterSnapshot }),
    })),
    {
      id: digestEvidenceId,
      uri: `artifact:${digestEvidenceId}`,
      digest: digestJson({ before: beforeSnapshot, after: afterSnapshot }),
    },
  ];
  const operationOutcome = {
    id: outcomeId,
    planned_operation_id: text(operation.id),
    kind: text(operation.kind),
    status: artifactStatus === 'succeeded' ? 'succeeded' : artifactStatus === 'cleanup_failed' ? 'cleanup_failed' : 'failed',
    started_at: command.started_at,
    finished_at: command.finished_at,
    mutated_state: true,
    target_boundary: text(operation.target_boundary),
    authorization_ref: text(operation.authorization_ref),
    allowlisted_operation_id: descriptor.id,
    command: {
      argv: descriptor.argv,
      execution_root: executionRoot,
      exit_code: command.exit_code,
      signal: command.signal,
      timed_out: command.timed_out,
      stdout: command.stdout,
      stderr: command.stderr,
      stdout_truncated: command.stdout_truncated,
      stderr_truncated: command.stderr_truncated,
    },
    before_digests: beforeSnapshot,
    after_digests: afterSnapshot,
    file_changes: changes,
    evidence_ref_ids: requiredEvidence,
    cleanup_required: Boolean(descriptor.cleanup),
      rollback_required: Boolean(descriptor.rollback) && status !== 'succeeded',
  };
  const operationOutcomes = arrayValue(plan.planned_operations).map((planned) => {
    const plannedOperation = objectValue(planned);
    if (text(plannedOperation.id) === text(operation.id)) return operationOutcome;
    return {
      id: `operation-outcome:${text(plannedOperation.id).replace(/[^A-Za-z0-9._:-]+/g, '_')}`,
      planned_operation_id: text(plannedOperation.id),
      kind: text(plannedOperation.kind),
      status: 'skipped',
      started_at: command.started_at,
      finished_at: command.finished_at,
      mutated_state: false,
      target_boundary: text(plannedOperation.target_boundary),
      authorization_ref: text(plannedOperation.authorization_ref),
      evidence_ref_ids: [],
      cleanup_required: false,
      rollback_required: false,
      skip_reason: 'not_selected_by_controlled_repair_executor',
    };
  });
  const artifactInput = {
    status: artifactStatus,
    repair_attempt_plan: plan,
    executor: {
      id: 'controlled_repair_executor:v0',
      kind: 'controlled_repair_executor',
      version: WORK_RECORD_CONTROLLED_REPAIR_EXECUTOR_RESULT_SCHEMA_VERSION,
      implemented: true,
      description: 'Controlled Repair Executor V0 for deterministic repo-command/file-fixture operations only.',
    },
    timing: {
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      source: 'controlled_repair_executor',
    },
    operation_outcomes: operationOutcomes,
    candidate_patch_outcomes: operation.source_candidate_patch_id ? [{
      id: `candidate-patch-outcome:${operation.source_candidate_patch_id}`,
      candidate_patch_id: operation.source_candidate_patch_id,
      status: artifactStatus === 'succeeded' ? 'applied' : 'failed',
      applied: artifactStatus === 'succeeded',
      evidence_ref_ids: evidenceIds,
    }] : [],
    recommended_command_outcomes: arrayValue(plan.recommended_commands).map((recommended, index) => ({
      id: `recommended-command-outcome:${index + 1}`,
      command_ref: text(objectValue(recommended).command),
      status: 'skipped',
      executed: false,
    })),
    evidence_refs: evidenceRefs,
    verifier_before: { status: 'failed', health_verdict: 'repairable' },
    verifier_after: artifactStatus === 'succeeded' ? { status: 'passed', health_verdict: 'valid' } : null,
    postcondition_results: arrayValue(plan.postconditions).map((postcondition) => ({
      id: `postcondition-result:${text(objectValue(postcondition).id)}`,
      postcondition_id: text(objectValue(postcondition).id),
      status: sourceBefore === sourceAfter ? 'passed' : 'failed',
      evidence_ref_ids: [digestEvidenceId],
    })),
    cleanup_results: cleanupResults,
    rollback_results: rollbackResults,
    source_work_record_mutation_check: {
      status: sourceBefore === sourceAfter ? 'passed' : 'failed',
      before_digest: sourceBefore,
      after_digest: sourceAfter,
    },
    source_work_record_mutated: sourceBefore !== sourceAfter,
    final_health: {
      classification: artifactStatus === 'succeeded' ? 'valid' : 'repairable',
    },
  };
  const artifact = buildWorkRecordRepairAttemptArtifact(artifactInput);
  const artifactValidation = validateWorkRecordRepairAttemptArtifact(artifact);
  if (artifactValidation.status !== 'passed') {
    return baseResult({
      status: 'artifact_invalid',
      mode,
      plan,
      operation,
      descriptor,
      execution: {
        ...execution,
        observed: {
          source_work_record_digest_before: sourceBefore,
          source_work_record_digest_after: sourceAfter,
        },
      },
      operationOutcomes,
      artifact,
      artifactValidation,
      diagnostics: artifactValidation.diagnostics,
    });
  }
  fs.writeFileSync(plannedArtifactPath, stableJson(artifact));
  return baseResult({
    status: executorStatus,
    mode,
    plan,
    operation,
    descriptor,
    execution: {
      ...execution,
      observed: {
        source_work_record_digest_before: sourceBefore,
        source_work_record_digest_after: sourceAfter,
        artifact_digest: fileDigest(plannedArtifactPath),
        artifact_written: true,
      },
    },
    operationOutcomes,
    artifact: {
      path: plannedArtifactPath,
      digest: fileDigest(plannedArtifactPath),
      validation_status: artifactValidation.status,
      attempt_artifact_identity: artifact.attempt_artifact_identity,
    },
    artifactValidation,
    diagnostics: command.timed_out ? [{
      severity: 'error',
      code: 'CONTROLLED_REPAIR_EXECUTOR_TIMEOUT',
      message: 'Allowlisted fixture command timed out.',
      path: 'execution.timeout_ms',
    }] : [],
  });
}
