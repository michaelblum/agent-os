import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  isWorkRecordV0,
  normalizeWorkRecord,
  workRecordSubjectId,
  WORK_RECORD_V0_SCHEMA_VERSION,
} from './work-record-adapter.js';
import {
  runWorkRecordVerifierProfile,
  WORK_RECORD_REPORT_ONLY_PROFILE_ID,
} from './work-record-verifier.js';

export const WORK_RECORD_CONSUMER_VERSION = '2026-07-consumption-recovery-v0';

const HEALTH_VERDICTS = Object.freeze([
  'valid',
  'stale',
  'repairable',
  'blocked',
  'impossible',
  'superseded',
  'retired',
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

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => text(value)).filter(Boolean))].sort();
}

function looksLikeJsonFile(file) {
  return file.endsWith('.json');
}

function repoRelative(file, repoRoot = process.cwd()) {
  const relative = path.relative(repoRoot, file);
  return relative && !relative.startsWith('..') ? relative : file;
}

export function defaultWorkRecordRoots(repoRoot = process.cwd()) {
  return [
    path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0/valid'),
    path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0/report-only-failures'),
  ];
}

function candidateFiles(root) {
  const resolved = path.resolve(root);
  if (!fs.existsSync(resolved)) {
    return {
      files: [],
      diagnostics: [{
        severity: 'error',
        code: 'WORK_RECORD_ROOT_NOT_FOUND',
        message: `Work Record root not found: ${root}`,
        path: root,
      }],
    };
  }
  const stat = fs.statSync(resolved);
  if (stat.isFile()) return { files: [resolved], diagnostics: [] };
  if (!stat.isDirectory()) {
    return {
      files: [],
      diagnostics: [{
        severity: 'error',
        code: 'WORK_RECORD_ROOT_UNSUPPORTED',
        message: `Work Record root is not a file or directory: ${root}`,
        path: root,
      }],
    };
  }
  return {
    files: fs.readdirSync(resolved)
      .filter(looksLikeJsonFile)
      .sort()
      .map((file) => path.join(resolved, file)),
    diagnostics: [],
  };
}

function loadJsonFile(file) {
  try {
    return { value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (error) {
    return {
      error: {
        severity: 'error',
        code: 'WORK_RECORD_JSON_INVALID',
        message: `Invalid JSON in Work Record ${file}: ${error.message}`,
        path: file,
      },
    };
  }
}

function contractDiagnostics(record, file = '') {
  const diagnostics = [];
  if (!isWorkRecordV0(record)) {
    diagnostics.push({
      severity: 'error',
      code: 'UNSUPPORTED_WORK_RECORD_SCHEMA',
      message: `Expected ${WORK_RECORD_V0_SCHEMA_VERSION} Work Record`,
      path: file,
      record_id: text(objectValue(record).id),
      record_schema_version: text(objectValue(record).schema_version),
    });
    return diagnostics;
  }

  const origin = objectValue(record.origin);
  if (text(origin.kind) === 'ad_hoc' && origin.ref !== null) {
    diagnostics.push({
      severity: 'error',
      code: 'AD_HOC_ORIGIN_REF_NOT_NULL',
      message: 'ad_hoc Work Record origins must use ref:null',
      path: 'origin.ref',
      record_id: text(record.id),
    });
  }
  if (Object.hasOwn(objectValue(record), 'postconditions')) {
    diagnostics.push({
      severity: 'error',
      code: 'TOP_LEVEL_POSTCONDITIONS_UNSUPPORTED',
      message: 'Work Record postconditions must live under execution_map.postconditions[]',
      path: 'postconditions',
      record_id: text(record.id),
    });
  }
  const replayPolicy = objectValue(objectValue(record.execution_map).replay_policy);
  if (replayPolicy.replay_requires_workflow_gate !== true) {
    diagnostics.push({
      severity: 'error',
      code: 'REPLAY_GATE_NOT_REQUIRED',
      message: 'execution_map.replay_policy.replay_requires_workflow_gate must be true',
      path: 'execution_map.replay_policy.replay_requires_workflow_gate',
      record_id: text(record.id),
    });
  }
  if (replayPolicy.repair_requires_workflow_gate !== true) {
    diagnostics.push({
      severity: 'error',
      code: 'REPAIR_GATE_NOT_REQUIRED',
      message: 'execution_map.replay_policy.repair_requires_workflow_gate must be true',
      path: 'execution_map.replay_policy.repair_requires_workflow_gate',
      record_id: text(record.id),
    });
  }
  return diagnostics;
}

function recordSummary(record, file = '', repoRoot = process.cwd()) {
  const normalized = normalizeWorkRecord(record);
  return {
    id: normalized.id,
    schema_version: normalized.schemaVersion,
    label: normalized.label,
    path: file,
    repo_relative_path: file ? repoRelative(file, repoRoot) : '',
    origin_kind: text(normalized.origin?.kind),
    health_verdict: text(normalized.health?.verdict || normalized.health?.state),
    claims: normalized.claims.length,
    claim_results: normalized.claimResults.length,
    evidence: normalized.evidence.length,
    historical_claim_results_present: normalized.claimResults.length > 0,
  };
}

export function discoverWorkRecords({
  roots = [],
  repoRoot = process.cwd(),
} = {}) {
  const scanRoots = roots.length > 0 ? roots : defaultWorkRecordRoots(repoRoot);
  const records = [];
  const diagnostics = [];
  const byId = new Map();

  for (const root of scanRoots) {
    const discovered = candidateFiles(root);
    diagnostics.push(...discovered.diagnostics);
    for (const file of discovered.files) {
      const loaded = loadJsonFile(file);
      if (loaded.error) {
        diagnostics.push(loaded.error);
        continue;
      }
      const record = loaded.value;
      const recordDiagnostics = contractDiagnostics(record, file);
      diagnostics.push(...recordDiagnostics);
      if (recordDiagnostics.length > 0) continue;
      const id = text(record.id);
      if (!id) {
        diagnostics.push({
          severity: 'error',
          code: 'WORK_RECORD_ID_MISSING',
          message: `Work Record ${file} is missing id`,
          path: file,
        });
        continue;
      }
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(file);
      records.push({ record, path: file });
    }
  }

  for (const [id, files] of byId) {
    if (files.length > 1) {
      diagnostics.push({
        severity: 'warning',
        code: 'DUPLICATE_WORK_RECORD_ID',
        message: `Work Record id ${id} appears in multiple discovered files; id-based read is ambiguous`,
        record_id: id,
        paths: files,
      });
    }
  }

  const status = diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? 'failed' : 'success';
  return {
    type: 'work_record.discovery',
    schema_version: WORK_RECORD_CONSUMER_VERSION,
    status,
    roots: scanRoots,
    count: status === 'success' ? records.length : 0,
    records: status === 'success'
      ? records.map((item) => recordSummary(item.record, item.path, repoRoot))
      : [],
    diagnostics,
  };
}

function readRecordFromPath(file, repoRoot = process.cwd()) {
  const resolved = path.resolve(file);
  const loaded = loadJsonFile(resolved);
  if (loaded.error) return { error: loaded.error };
  const diagnostics = contractDiagnostics(loaded.value, resolved);
  if (diagnostics.length > 0) {
    return {
      error: {
        severity: 'error',
        code: 'INVALID_WORK_RECORD',
        message: `Invalid Work Record: ${resolved}`,
        path: resolved,
        diagnostics,
      },
    };
  }
  return {
    record: loaded.value,
    path: resolved,
    summary: recordSummary(loaded.value, resolved, repoRoot),
  };
}

export function resolveWorkRecord(ref, {
  roots = [],
  repoRoot = process.cwd(),
} = {}) {
  const value = text(ref);
  if (!value) {
    return {
      status: 'failed',
      code: 'MISSING_WORK_RECORD_REF',
      error: 'Work Record id or path is required',
    };
  }

  if (fs.existsSync(path.resolve(value))) {
    const direct = readRecordFromPath(value, repoRoot);
    if (direct.error) {
      return {
        status: 'failed',
        code: direct.error.code,
        error: direct.error.message,
        diagnostics: direct.error.diagnostics ? direct.error.diagnostics : [direct.error],
      };
    }
    return {
      status: 'success',
      match: 'path',
      ...direct,
    };
  }

  const targetIds = new Set([value, workRecordSubjectId(value)]);
  const discovery = discoverWorkRecords({ roots, repoRoot });
  if (discovery.status !== 'success') {
    return {
      status: 'failed',
      code: 'WORK_RECORD_DISCOVERY_FAILED',
      error: 'Work Record discovery failed',
      diagnostics: discovery.diagnostics,
    };
  }
  const matches = discovery.records.filter((record) => targetIds.has(record.id));
  if (matches.length === 0) {
    return {
      status: 'failed',
      code: 'WORK_RECORD_NOT_FOUND',
      error: `Work Record not found: ${value}`,
      diagnostics: [],
    };
  }
  if (matches.length > 1) {
    return {
      status: 'failed',
      code: 'WORK_RECORD_REF_AMBIGUOUS',
      error: `Work Record ref is ambiguous: ${value}`,
      candidates: matches,
      diagnostics: [{
        severity: 'error',
        code: 'WORK_RECORD_REF_AMBIGUOUS',
        message: `Work Record ref is ambiguous: ${value}`,
        record_id: value,
      }],
    };
  }
  const direct = readRecordFromPath(matches[0].path, repoRoot);
  if (direct.error) {
    return {
      status: 'failed',
      code: direct.error.code,
      error: direct.error.message,
      diagnostics: direct.error.diagnostics ? direct.error.diagnostics : [direct.error],
    };
  }
  return {
    status: 'success',
    match: 'id',
    ...direct,
  };
}

export function readWorkRecord(ref, options = {}) {
  const resolved = resolveWorkRecord(ref, options);
  if (resolved.status !== 'success') return resolved;
  return {
    type: 'work_record.read',
    schema_version: WORK_RECORD_CONSUMER_VERSION,
    status: 'success',
    source: {
      path: resolved.path,
      match: resolved.match,
    },
    summary: resolved.summary,
    record: cloneJson(resolved.record),
  };
}

function diagnosticSummary(diagnostics = []) {
  const missing = [];
  const permissions = [];
  const runtime = [];
  const cleanup = [];
  const postconditions = [];
  for (const diagnostic of diagnostics) {
    const haystack = `${diagnostic.code} ${diagnostic.failure_class} ${diagnostic.message}`.toLowerCase();
    if (haystack.includes('evidence') || haystack.includes('missing')) missing.push(diagnostic.code);
    if (haystack.includes('permission')) permissions.push(diagnostic.code);
    if (haystack.includes('runtime')) runtime.push(diagnostic.code);
    if (haystack.includes('cleanup')) cleanup.push(diagnostic.code);
    if (haystack.includes('postcondition')) postconditions.push(diagnostic.code);
  }
  return {
    missing_evidence_or_refs: uniqueStrings(missing),
    permissions: uniqueStrings(permissions),
    runtime: uniqueStrings(runtime),
    cleanup: uniqueStrings(cleanup),
    postconditions: uniqueStrings(postconditions),
  };
}

function recommendedCaptureCommands(record = {}) {
  const commands = [];
  for (const step of arrayValue(objectValue(record.execution_map).steps)) {
    const args = objectValue(objectValue(step.action).args);
    const direct = text(args.recommended_next_command || objectValue(args.post_action).recommended_next_command);
    if (direct) commands.push(direct);
  }
  return uniqueStrings(commands);
}

function replacementRefs(record = {}) {
  return arrayValue(record.references)
    .filter((reference) => text(objectValue(reference).relationship) === 'superseded_by')
    .map((reference) => text(objectValue(reference).ref))
    .filter(Boolean);
}

export function recoveryGuidanceForWorkRecord(record = {}, verifierReport = {}) {
  const embeddedVerdict = text(objectValue(record.health).verdict, 'blocked');
  const verdict = text(verifierReport.health_verdict, embeddedVerdict);
  const diagnostics = arrayValue(verifierReport.diagnostics);
  const failureClasses = uniqueStrings(arrayValue(verifierReport.failure_classes));
  const gates = uniqueStrings([
    ...arrayValue(objectValue(record.health).repair_gate_refs),
    ...arrayValue(objectValue(record.health).replay_gate_refs),
    ...arrayValue(objectValue(objectValue(record.execution_map).replay_policy).gate_refs),
  ]);
  const captureCommands = recommendedCaptureCommands(record);
  const blockers = diagnosticSummary(diagnostics);
  const base = {
    verdict,
    embedded_record_health: embeddedVerdict,
    conservative: true,
    mutates_record: false,
    automatic_replay_allowed: false,
    failure_classes: failureClasses,
    workflow_gate_refs: gates,
    next_commands: [],
    next_gates: [],
    blockers,
    notes: [],
  };

  if (verdict === 'valid') {
    return {
      ...base,
      action: 'no_repair_needed',
      next_commands: [
        `./aos work-record read ${record.id} --json`,
        `./aos work-record export ${record.id} --json`,
      ],
      notes: ['Current report-only verification is sufficient; do not run redundant live proof loops for this record.'],
    };
  }
  if (verdict === 'stale') {
    return {
      ...base,
      action: 'reperceive_and_create_new_record',
      next_commands: captureCommands,
      next_gates: gates.length > 0 ? gates : ['workflow_gate_required:reperceive_before_mutation'],
      notes: ['Re-perceive or re-resolve the target before any mutation; keep this historical Work Record unchanged.'],
    };
  }
  if (verdict === 'repairable') {
    return {
      ...base,
      action: 'workflow_gated_repair_required',
      next_commands: captureCommands,
      next_gates: gates.length > 0 ? gates : ['workflow_gate_required:repair_work_record_execution_map'],
      notes: ['Repairable means a workflow-gated repair may patch future execution-map refs; this verifier does not repair automatically.'],
    };
  }
  if (verdict === 'blocked') {
    return {
      ...base,
      action: 'resolve_blocker_before_reuse',
      next_gates: gates.length > 0 ? gates : ['workflow_gate_required:blocker_triage'],
      notes: ['Blocked records require the named missing evidence, permission, runtime, cleanup, or postcondition problem to be resolved before reuse.'],
    };
  }
  if (verdict === 'impossible') {
    return {
      ...base,
      action: 'do_not_replay',
      notes: ['The known target class can no longer satisfy the recorded intent; create a new plan or Work Record instead of replaying this one.'],
    };
  }
  if (verdict === 'superseded') {
    const replacements = replacementRefs(record);
    return {
      ...base,
      action: 'use_replacement_record',
      replacements,
      next_commands: replacements.map((replacement) => `./aos work-record status ${replacement} --json`),
      notes: ['This record has been superseded; inspect the replacement instead of replaying this one.'],
    };
  }
  if (verdict === 'retired') {
    return {
      ...base,
      action: 'historical_only',
      notes: ['This Work Record is retired historical evidence and is no longer executable.'],
    };
  }
  return {
    ...base,
    verdict: 'blocked',
    action: 'resolve_unknown_health',
    next_gates: ['workflow_gate_required:unknown_work_record_health'],
    notes: ['Unknown health is treated as blocked.'],
  };
}

function verifyResolvedRecord(resolved, { profileId = WORK_RECORD_REPORT_ONLY_PROFILE_ID } = {}) {
  const report = runWorkRecordVerifierProfile(resolved.record, { profileId });
  return {
    type: 'work_record.verify',
    schema_version: WORK_RECORD_CONSUMER_VERSION,
    status: report.status,
    source: {
      path: resolved.path,
      match: resolved.match,
    },
    record_id: text(resolved.record.id),
    record_schema_version: text(resolved.record.schema_version),
    verifier_profile_id: text(report.profile_id || profileId),
    verifier_mode: text(report.mode || report.profile?.mode, 'report_only'),
    mutates_record: report.mutates_record === false ? false : Boolean(report.mutates_record),
    health_verdict: text(report.health_verdict || objectValue(resolved.record.health).verdict),
    embedded_record_health: text(report.embedded_health_verdict || objectValue(resolved.record.health).verdict),
    current_report_status: text(report.status),
    failure_classes: uniqueStrings(arrayValue(report.failure_classes)),
    diagnostics: arrayValue(report.diagnostics),
    derived_claim_indexes: cloneJson(report.derived_indexes || {}),
    evidence_adapter_summary: cloneJson(objectValue(report.summary)),
    evidence_refs_used: uniqueStrings([
      ...arrayValue(objectValue(resolved.record.verifier_report).evidence_refs),
      ...arrayValue(resolved.record.claim_results).flatMap((result) => arrayValue(objectValue(result).evidence_refs)),
      ...arrayValue(objectValue(resolved.record.execution_map).postconditions)
        .flatMap((postcondition) => arrayValue(objectValue(postcondition).evidence_refs)),
    ]),
    historical_claim_results: {
      source: 'record.claim_results',
      count: arrayValue(resolved.record.claim_results).length,
      statuses: uniqueStrings(arrayValue(resolved.record.claim_results).map((result) => objectValue(result).status)),
      distinct_from_current_report: true,
    },
    current_report: cloneJson(report),
    recovery: recoveryGuidanceForWorkRecord(resolved.record, report),
  };
}

export function verifyWorkRecord(ref, options = {}) {
  const resolved = resolveWorkRecord(ref, options);
  if (resolved.status !== 'success') return resolved;
  return verifyResolvedRecord(resolved, options);
}

export function explainWorkRecordStatus(ref, options = {}) {
  const resolved = resolveWorkRecord(ref, options);
  if (resolved.status !== 'success') return resolved;
  const verify = verifyResolvedRecord(resolved, options);
  return {
    type: 'work_record.status',
    schema_version: WORK_RECORD_CONSUMER_VERSION,
    status: verify.status,
    summary: resolved.summary,
    health_verdict: verify.health_verdict,
    embedded_record_health: verify.embedded_record_health,
    current_report_status: verify.status,
    historical_claim_results: verify.historical_claim_results,
    failure_classes: verify.failure_classes,
    diagnostics: verify.diagnostics,
    evidence_refs_used: verify.evidence_refs_used,
    recovery: verify.recovery,
    verifier: {
      profile_id: verify.verifier_profile_id,
      mode: verify.verifier_mode,
      mutates_record: verify.mutates_record,
    },
  };
}

function localArtifactPath(uri = '', recordPath = '') {
  const value = text(uri);
  if (!value) return '';
  if (value.startsWith('file://')) return new URL(value).pathname;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return '';
  if (path.isAbsolute(value)) return value;
  return recordPath ? path.resolve(path.dirname(recordPath), value) : path.resolve(value);
}

function fileDigest(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return `sha256:${hash.digest('hex')}`;
}

function evidenceBundleEntries(record = {}, recordPath = '') {
  return arrayValue(record.evidence).map((item) => {
    const evidence = objectValue(item);
    const uri = text(evidence.uri || evidence.artifact_uri || objectValue(evidence.metadata).artifact_uri);
    const artifactPath = localArtifactPath(uri, recordPath);
    let stat = null;
    if (artifactPath && fs.existsSync(artifactPath) && fs.statSync(artifactPath).isFile()) {
      stat = fs.statSync(artifactPath);
    }
    return {
      evidence_id: text(evidence.id),
      kind: text(evidence.kind),
      uri,
      artifact_path: artifactPath,
      exists: Boolean(stat),
      content_type: text(evidence.content_type || objectValue(evidence.metadata).content_type),
      size_bytes: stat ? stat.size : null,
      digest: stat ? fileDigest(artifactPath) : text(evidence.digest || objectValue(evidence.metadata).digest),
      missing_diagnostic: stat || !uri ? null : {
        severity: 'warning',
        code: artifactPath ? 'EVIDENCE_ARTIFACT_MISSING' : 'EVIDENCE_URI_NOT_LOCAL_PAYLOAD',
        message: artifactPath
          ? `Evidence artifact is missing: ${artifactPath}`
          : `Evidence URI is not a local bundle payload: ${uri}`,
      },
    };
  });
}

export function exportWorkRecordBundle(ref, options = {}) {
  const resolved = resolveWorkRecord(ref, options);
  if (resolved.status !== 'success') return resolved;
  const verify = verifyResolvedRecord(resolved, options);
  const evidence = evidenceBundleEntries(resolved.record, resolved.path);
  const missing = evidence.map((item) => item.missing_diagnostic).filter(Boolean);
  return {
    type: 'work_record.bundle_manifest',
    schema_version: WORK_RECORD_CONSUMER_VERSION,
    status: verify.status === 'unsupported_profile' ? 'failed' : 'success',
    mode: 'read_only_manifest',
    inlines_heavy_payloads: false,
    mutates_record: false,
    record: {
      id: text(resolved.record.id),
      path: resolved.path,
      schema_version: text(resolved.record.schema_version),
      compact_summary: resolved.summary,
    },
    verifier_report: {
      profile_id: verify.verifier_profile_id,
      status: verify.status,
      health_verdict: verify.health_verdict,
      failure_classes: verify.failure_classes,
      diagnostics: verify.diagnostics,
      recovery: verify.recovery,
    },
    evidence,
    missing_artifact_diagnostics: missing,
  };
}
