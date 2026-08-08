import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  readWorkRecord,
  verifyWorkRecord,
  WORK_RECORD_CONSUMER_VERSION,
} from './work-record-consumer.js';
import validateRepairPlanV1 from './work-record-repair-plan-v1-validator.generated.js';

export const WORK_RECORD_REPAIR_PLAN_SCHEMA_VERSION = '2026-08-work-record-repair-plan-v1';

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

export function digestRepairPlanValue(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function sourceRecordDigest(read = {}) {
  const sourcePath = rawText(read.source?.path);
  if (sourcePath) {
    try {
      return crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
    } catch {
      // Active consumers normally resolve a file. The parsed-value fallback
      // keeps report-only failure envelopes deterministic if that file vanishes.
    }
  }
  return digestRepairPlanValue(read.record);
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => text(value)).filter(Boolean))].sort();
}

function replacementRefs(record = {}) {
  return arrayValue(record.references)
    .filter((reference) => text(objectValue(reference).relationship) === 'superseded_by')
    .map((reference) => text(objectValue(reference).ref))
    .filter(Boolean);
}

function plannerStatus(verdict = '') {
  if (verdict === 'valid') return 'no_repair_needed';
  if (verdict === 'stale' || verdict === 'repairable') return 'planned';
  if (verdict === 'blocked') return 'blocked_inputs';
  if (verdict === 'impossible') return 'not_repairable';
  if (verdict === 'superseded') return 'superseded';
  if (verdict === 'retired') return 'retired';
  return 'unsupported';
}

function commandDescriptor(command = '', { readOnly = true, purpose = '' } = {}) {
  return {
    command,
    read_only: readOnly,
    mutates_state: !readOnly,
    executes_in_plan: false,
    purpose,
  };
}

function recommendedCommands({ record = {}, verdict = '', recovery = {} } = {}) {
  if (verdict === 'valid') {
    return arrayValue(recovery.next_commands).map((command) => commandDescriptor(command, {
      purpose: 'Inspect or export the verified Work Record.',
    }));
  }
  if (verdict === 'stale' || verdict === 'repairable') {
    const commands = arrayValue(recovery.next_commands).map((command) => commandDescriptor(command, {
      purpose: 'Gather fresh perception or target-resolution evidence for a separate attempt.',
    }));
    commands.push(commandDescriptor(`./aos work-record status ${text(record.id, '<id-or-path>')} --json`, {
      purpose: 'Re-run report-only status after a caller-supplied attempt artifact exists.',
    }));
    return commands;
  }
  if (verdict === 'superseded') {
    return replacementRefs(record).map((replacement) => commandDescriptor(`./aos work-record status ${replacement} --json`, {
      purpose: 'Inspect the replacement Work Record.',
    }));
  }
  if (verdict === 'blocked') {
    return [commandDescriptor(`./aos work-record status ${text(record.id, '<id-or-path>')} --json`, {
      purpose: 'Re-run status after the missing input or external blocker is resolved.',
    })];
  }
  return [];
}

function blockerActions(blockers = {}) {
  return Object.entries(objectValue(blockers))
    .filter(([, values]) => arrayValue(values).length > 0)
    .map(([category, values]) => ({
      category,
      codes: uniqueStrings(arrayValue(values)),
      required_external_action: category === 'permissions'
        ? 'Restore the named operating-system permission before a caller attempts the work.'
        : category === 'runtime'
          ? 'Restore the named runtime prerequisite before a caller attempts the work.'
          : category === 'cleanup'
            ? 'Inspect cleanup evidence and resolve leftover state.'
            : category === 'missing_evidence_or_refs'
              ? 'Gather or restore the missing evidence or reference.'
              : 'Resolve the named postcondition failure.',
    }));
}

function planSteps({ verdict = '', recovery = {}, record = {} } = {}) {
  const common = { executes_in_plan: false };
  if (verdict === 'valid') {
    return [{
      ...common,
      id: 'step:read-current-record',
      title: 'Keep the Work Record unchanged',
      kind: 'read_only_review',
      proposes_mutation: false,
      description: 'Current verification is sufficient; use read, export, or verify only.',
    }];
  }
  if (verdict === 'stale') {
    return [
      {
        ...common,
        id: 'step:reperceive-or-reresolve',
        title: 'Re-perceive or re-resolve the target',
        kind: 'fresh_validation',
        proposes_mutation: false,
        description: 'Collect fresh target evidence for a separate attempt.',
      },
      {
        ...common,
        id: 'step:produce-followup-work-record',
        title: 'Record any future attempt separately',
        kind: 'followup_work_record',
        proposes_mutation: true,
        declared_mutation_paths: ['new_work_record'],
        description: 'Keep the stale source bytes unchanged and record any caller-run attempt separately.',
      },
    ];
  }
  if (verdict === 'repairable') {
    return [
      {
        ...common,
        id: 'step:reperceive-or-reresolve',
        title: 'Re-perceive or re-resolve stale refs',
        kind: 'fresh_validation',
        proposes_mutation: false,
        description: 'Gather fresh evidence for a candidate execution-map patch.',
      },
      {
        ...common,
        id: 'step:prepare-candidate-patch',
        title: 'Prepare an execution-map patch candidate',
        kind: 'candidate_patch',
        proposes_mutation: true,
        declared_mutation_paths: ['execution_map'],
        description: 'Describe a source-bound patch candidate without applying it.',
      },
      {
        ...common,
        id: 'step:produce-followup-work-record',
        title: 'Record a future attempt separately',
        kind: 'followup_work_record',
        proposes_mutation: true,
        declared_mutation_paths: ['new_work_record'],
        description: 'A caller-run attempt must emit new evidence or an explicit patch artifact.',
      },
    ];
  }
  if (verdict === 'blocked') {
    return blockerActions(recovery.blockers).map((action, index) => ({
      ...common,
      id: `step:resolve-blocker-${index + 1}`,
      title: `Resolve ${action.category}`,
      kind: 'blocker_resolution',
      proposes_mutation: false,
      blocker: action,
      description: action.required_external_action,
    }));
  }
  if (verdict === 'impossible') {
    return [{
      ...common,
      id: 'step:stop-reuse',
      title: 'Do not reuse this record',
      kind: 'not_repairable',
      proposes_mutation: false,
      description: 'Create a new plan or Work Record for a different target.',
    }];
  }
  if (verdict === 'superseded') {
    return [{
      ...common,
      id: 'step:inspect-replacement',
      title: 'Use the replacement Work Record',
      kind: 'replacement_lookup',
      proposes_mutation: false,
      replacement_refs: replacementRefs(record),
      description: 'Inspect the replacement instead of changing this source record.',
    }];
  }
  if (verdict === 'retired') {
    return [{
      ...common,
      id: 'step:preserve-historical-record',
      title: 'Preserve as historical evidence',
      kind: 'historical_only',
      proposes_mutation: false,
      description: 'Retired records remain historical evidence.',
    }];
  }
  return [];
}

function candidatePatches({ verdict = '', verify = {} } = {}) {
  if (verdict !== 'repairable') return [];
  return [{
    id: 'candidate_patch:execution_map_refs',
    target: 'execution_map',
    status: 'proposed',
    applied: false,
    executes_in_plan: false,
    declared_mutation_paths: ['execution_map'],
    expected_side_effects: ['new_patch_artifact', 'new_verifier_report'],
    rationale: 'Current diagnostics indicate refs or postconditions may be patched in a later caller-run attempt.',
    failure_classes: arrayValue(verify.failure_classes),
    diagnostic_codes: uniqueStrings(arrayValue(verify.diagnostics).map((diagnostic) => objectValue(diagnostic).code)),
  }];
}

function followup({ verdict = '', record = {} } = {}) {
  if (verdict === 'valid') {
    return { should_create_new_work_record: false, reason: 'No repair is needed.' };
  }
  if (verdict === 'stale' || verdict === 'repairable' || verdict === 'blocked') {
    return {
      should_create_new_work_record: true,
      source_work_record_immutable: true,
      reason: 'Any later caller-run attempt must preserve the source and emit separate evidence.',
    };
  }
  if (verdict === 'superseded') {
    return {
      should_create_new_work_record: false,
      replacement_refs: replacementRefs(record),
      reason: 'Use the replacement Work Record when present.',
    };
  }
  return { should_create_new_work_record: false, reason: 'A repair attempt is not appropriate for this health verdict.' };
}

export function repairPlanIdentity(plan = {}) {
  const value = objectValue(plan);
  const planStepBindings = arrayValue(value.plan_steps).map((step) => {
    const item = objectValue(step);
    const projected = {
      id: text(item.id),
      kind: text(item.kind),
      proposes_mutation: item.proposes_mutation === true,
      declared_mutation_paths: uniqueStrings(arrayValue(item.declared_mutation_paths)),
      description: text(item.description),
    };
    return { id: projected.id, digest: digestRepairPlanValue(projected) };
  }).sort((left, right) => left.id.localeCompare(right.id));
  const candidatePatchBindings = arrayValue(value.candidate_patches).map((patch) => {
    const item = cloneJson(objectValue(patch));
    return { id: text(item.id), digest: digestRepairPlanValue(item) };
  }).sort((left, right) => left.id.localeCompare(right.id));
  const identity = {
    schema_version: text(value.schema_version),
    source_work_record: {
      id: text(value.source_work_record?.id),
      path: rawText(value.source_work_record?.path),
      requested_ref: rawText(value.source_work_record?.requested_ref),
      schema_version: text(value.source_work_record?.schema_version),
      digest: text(value.source_work_record?.digest),
    },
    health_verdict: text(value.health_verdict || value.current_health),
    plan_step_ids: uniqueStrings(arrayValue(value.plan_steps).map((step) => objectValue(step).id)),
    plan_step_bindings: planStepBindings,
    candidate_patch_ids: uniqueStrings(arrayValue(value.candidate_patches).map((patch) => objectValue(patch).id)),
    candidate_patch_bindings: candidatePatchBindings,
    evidence_refs: uniqueStrings(arrayValue(value.evidence_refs)),
    payload_digest: digestRepairPlanValue(value),
  };
  return { ...identity, digest: digestRepairPlanValue(identity) };
}

export function planWorkRecordRepair(ref, options = {}) {
  const read = readWorkRecord(ref, options);
  if (read.status !== 'success') return read;
  const sourceDigest = sourceRecordDigest(read);
  const verify = verifyWorkRecord(ref, options);
  if (!['passed', 'failed'].includes(text(verify.status))) {
    return {
      type: 'work_record.repair_plan',
      schema_version: WORK_RECORD_REPAIR_PLAN_SCHEMA_VERSION,
      status: 'unsupported',
      source_work_record: {
        id: text(read.record?.id),
        path: rawText(read.source?.path),
        requested_ref: rawText(ref),
        schema_version: text(read.record?.schema_version),
        digest: sourceDigest,
      },
      mutates_source: false,
      executes_actions: false,
      plan_steps: [],
      candidate_patches: [],
      recommended_commands: [],
      evidence_refs: [],
      diagnostics: arrayValue(verify.diagnostics),
    };
  }

  const record = objectValue(read.record);
  const recovery = objectValue(verify.recovery);
  const verdict = text(verify.health_verdict, text(recovery.verdict, 'blocked'));
  const plan = {
    type: 'work_record.repair_plan',
    schema_version: WORK_RECORD_REPAIR_PLAN_SCHEMA_VERSION,
    source_consumer_schema_version: WORK_RECORD_CONSUMER_VERSION,
    status: plannerStatus(verdict),
    source_work_record: {
      id: text(record.id),
      path: rawText(read.source?.path),
      match: text(read.source?.match),
      requested_ref: rawText(ref),
      schema_version: text(record.schema_version),
      digest: sourceDigest,
      summary: cloneJson(read.summary),
    },
    current_report: {
      type: text(verify.type),
      status: text(verify.status),
      verifier_profile_id: text(verify.verifier_profile_id),
      verifier_mode: text(verify.verifier_mode),
      mutates_record: verify.mutates_record === false ? false : Boolean(verify.mutates_record),
      report: cloneJson(verify.current_report),
    },
    current_health: verdict,
    embedded_health: text(verify.embedded_record_health),
    health_verdict: verdict,
    historical_results: cloneJson(verify.historical_claim_results),
    failure_classes: arrayValue(verify.failure_classes),
    blockers: cloneJson(recovery.blockers || {}),
    mutates_source: false,
    executes_actions: false,
    plan_steps: planSteps({ verdict, recovery, record }),
    candidate_patches: candidatePatches({ verdict, verify }),
    recommended_commands: recommendedCommands({ record, verdict, recovery }),
    evidence_refs: arrayValue(verify.evidence_refs_used),
    diagnostics: arrayValue(verify.diagnostics),
    depends_on: {
      verifier_profile_id: text(verify.verifier_profile_id),
      report_only: true,
      source_work_record_immutable: true,
      source_work_record_digest: sourceDigest,
      evidence_refs: arrayValue(verify.evidence_refs_used),
    },
    followup: followup({ verdict, record }),
    notes: [
      'This Repair Plan is a non-executing mechanical proposal.',
      'It does not run commands, apply patches, mutate the source, or decide whether a caller may act.',
    ],
  };
  return plan;
}

export function validateWorkRecordRepairPlan(plan = {}) {
  const value = objectValue(plan);
  const diagnostics = [];
  const add = (code, message, path) => diagnostics.push({ severity: 'error', code, message, path });
  if (!validateRepairPlanV1(value)) {
    for (const error of arrayValue(validateRepairPlanV1.errors)) {
      add('REPAIR_PLAN_V1_SCHEMA_INVALID', `Repair Plan V1 schema validation failed: ${text(objectValue(error).message, 'invalid value')}`, text(objectValue(error).instancePath, 'repair_plan'));
    }
  }
  if (text(value.type) !== 'work_record.repair_plan') add('INVALID_REPAIR_PLAN_TYPE', 'Repair Plan type must be work_record.repair_plan.', 'type');
  if (text(value.schema_version) !== WORK_RECORD_REPAIR_PLAN_SCHEMA_VERSION) add('INVALID_REPAIR_PLAN_SCHEMA_VERSION', 'Repair Plan schema_version is not supported.', 'schema_version');
  if (value.mutates_source !== false) add('REPAIR_PLAN_MUTATES_SOURCE', 'Repair Plans must report mutates_source:false.', 'mutates_source');
  if (value.executes_actions !== false) add('REPAIR_PLAN_EXECUTES_ACTIONS', 'Repair Plans must report executes_actions:false.', 'executes_actions');
  if (!text(value.source_work_record?.id) || !text(value.source_work_record?.digest)) {
    add('REPAIR_PLAN_SOURCE_IDENTITY_INCOMPLETE', 'Repair Plans require source id and digest.', 'source_work_record');
  }
  arrayValue(value.plan_steps).forEach((step, index) => {
    if (objectValue(step).executes_in_plan !== false) add('PLAN_STEP_EXECUTES_IN_PLAN', 'Plan steps must not execute inside the Repair Plan.', `plan_steps[${index}].executes_in_plan`);
  });
  arrayValue(value.candidate_patches).forEach((patch, index) => {
    const item = objectValue(patch);
    if (item.applied !== false) add('CANDIDATE_PATCH_APPLIED', 'Repair Plan candidate patches must remain unapplied.', `candidate_patches[${index}].applied`);
    if (item.executes_in_plan !== false) add('CANDIDATE_PATCH_EXECUTES_IN_PLAN', 'Candidate patches must not execute inside the Repair Plan.', `candidate_patches[${index}].executes_in_plan`);
    if (arrayValue(item.declared_mutation_paths).length === 0) add('CANDIDATE_PATCH_MUTATION_PATHS_MISSING', 'Candidate patches must declare their mutation paths.', `candidate_patches[${index}].declared_mutation_paths`);
  });
  const candidatePatchIds = arrayValue(value.candidate_patches).map((patch) => text(objectValue(patch).id));
  if (new Set(candidatePatchIds).size !== candidatePatchIds.length) {
    add('CANDIDATE_PATCH_IDS_NOT_UNIQUE', 'Repair Plan candidate patch ids must be unique.', 'candidate_patches');
  }
  if (candidatePatchIds.length > 1) {
    add('REPAIR_PLAN_MULTIPLE_CANDIDATE_PATCHES_UNSUPPORTED', 'Repair Plan V1 supports at most one atomic execution-map candidate patch.', 'candidate_patches');
  }
  arrayValue(value.recommended_commands).forEach((command, index) => {
    const item = objectValue(command);
    if (!text(item.command)) add('RECOMMENDED_COMMAND_MISSING_COMMAND', 'Recommended commands must include command text.', `recommended_commands[${index}].command`);
    if (item.executes_in_plan !== false) add('RECOMMENDED_COMMAND_EXECUTES_IN_PLAN', 'Recommended commands must not execute inside the Repair Plan.', `recommended_commands[${index}].executes_in_plan`);
  });
  return {
    type: 'work_record.repair_plan.validation',
    schema_version: WORK_RECORD_REPAIR_PLAN_SCHEMA_VERSION,
    status: diagnostics.length > 0 ? 'failed' : 'passed',
    diagnostics,
  };
}
