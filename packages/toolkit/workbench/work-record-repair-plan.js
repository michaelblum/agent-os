import {
  readWorkRecord,
  verifyWorkRecord,
  WORK_RECORD_CONSUMER_VERSION,
} from './work-record-consumer.js';

export const WORK_RECORD_REPAIR_PLAN_SCHEMA_VERSION = '2026-07-work-record-repair-plan-v0';

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

function replacementRefs(record = {}) {
  return arrayValue(record.references)
    .filter((reference) => text(objectValue(reference).relationship) === 'superseded_by')
    .map((reference) => text(objectValue(reference).ref))
    .filter(Boolean);
}

function plannerStatus(verdict = '') {
  if (verdict === 'valid') return 'no_repair_needed';
  if (verdict === 'stale' || verdict === 'repairable') return 'planned';
  if (verdict === 'blocked') return 'blocked';
  if (verdict === 'impossible') return 'not_repairable';
  if (verdict === 'superseded') return 'superseded';
  if (verdict === 'retired') return 'retired';
  return 'unsupported';
}

function gatePurpose(gate = '', verdict = '') {
  if (gate.includes('repair_work_record_execution_map')) {
    return 'Approve and orchestrate a future execution-map patch candidate without rewriting evidence or historical Claim Results.';
  }
  if (gate.includes('reperceive_before_mutation')) {
    return 'Approve fresh re-perception or re-resolution before any mutation or new repair attempt.';
  }
  if (gate.includes('blocker_triage')) {
    return 'Resolve the named evidence, permission, runtime, cleanup, or postcondition blocker before reuse.';
  }
  if (verdict === 'repairable') return 'Authorize any future repair mutation before it is attempted.';
  if (verdict === 'stale') return 'Authorize any future mutation after fresh validation.';
  return 'Required workflow approval or orchestration boundary.';
}

function workflowGates(recovery = {}, verdict = '') {
  if (verdict === 'valid') return [];
  return uniqueStrings([
    ...arrayValue(recovery.workflow_gate_refs),
    ...arrayValue(recovery.next_gates),
  ]).map((gate) => ({
    id: gate,
    required: true,
    exists: !gate.startsWith('workflow_gate_required:'),
    missing: gate.startsWith('workflow_gate_required:'),
    purpose: gatePurpose(gate, verdict),
    satisfies_plan: false,
  }));
}

function commandDescriptor(command = '', { readOnly = true, requiresWorkflowGate = false, purpose = '' } = {}) {
  return {
    command,
    read_only: readOnly,
    mutates_state: !readOnly,
    requires_workflow_gate: requiresWorkflowGate,
    executes_in_plan: false,
    purpose,
  };
}

function recommendedCommands({ record = {}, verify = {}, verdict = '', recovery = {} } = {}) {
  if (verdict === 'valid') {
    return arrayValue(recovery.next_commands).map((command) => commandDescriptor(command, {
      readOnly: true,
      purpose: 'Inspect or export the verified Work Record without repair.',
    }));
  }
  if (verdict === 'stale' || verdict === 'repairable') {
    const commands = arrayValue(recovery.next_commands).map((command) => commandDescriptor(command, {
      readOnly: true,
      purpose: 'Gather fresh perception or target-resolution evidence before any gated mutation.',
    }));
    if (verdict === 'repairable') {
      commands.push(commandDescriptor(`./aos work-record status ${text(record.id, '<id-or-path>')} --json`, {
        readOnly: true,
        purpose: 'Re-run report-only status after any future gated repair attempt produces a patch candidate or new record.',
      }));
    }
    return commands;
  }
  if (verdict === 'superseded') {
    return replacementRefs(record).map((replacement) => commandDescriptor(`./aos work-record status ${replacement} --json`, {
      readOnly: true,
      purpose: 'Inspect the replacement Work Record instead of repairing this one.',
    }));
  }
  if (verdict === 'blocked') {
    return [commandDescriptor(`./aos work-record status ${text(record.id, '<id-or-path>')} --json`, {
      readOnly: true,
      purpose: 'Re-run report-only status after the external blocker is resolved.',
    })];
  }
  if (verdict === 'impossible' || verdict === 'retired') return [];
  return arrayValue(verify.recovery?.next_commands).map((command) => commandDescriptor(command));
}

function blockerActions(blockers = {}) {
  const categories = Object.entries(objectValue(blockers));
  return categories
    .filter(([, values]) => arrayValue(values).length > 0)
    .map(([category, values]) => ({
      category,
      codes: uniqueStrings(arrayValue(values)),
      required_external_action: category === 'permissions'
        ? 'Grant or restore the named permission before reuse.'
        : category === 'runtime'
          ? 'Restore the named runtime prerequisite before reuse.'
          : category === 'cleanup'
            ? 'Inspect cleanup evidence and resolve the leftover state before reuse.'
            : category === 'missing_evidence_or_refs'
              ? 'Gather or restore the missing evidence/ref through a gated workflow.'
              : 'Resolve the named postcondition failure before reuse.',
    }));
}

function planSteps({ verdict = '', recovery = {}, record = {} } = {}) {
  if (verdict === 'valid') {
    return [
      {
        id: 'step:read-current-record',
        title: 'Keep the Work Record unchanged',
        kind: 'read_only_review',
        read_only: true,
        requires_workflow_gate: false,
        description: 'Current report-only verification is sufficient; use read/export/verify only.',
      },
    ];
  }
  if (verdict === 'stale') {
    return [
      {
        id: 'step:reperceive-or-reresolve',
        title: 'Re-perceive or re-resolve the target',
        kind: 'fresh_validation',
        read_only: true,
        requires_workflow_gate: false,
        description: 'Collect fresh target evidence before any future mutation.',
      },
      {
        id: 'step:produce-followup-work-record',
        title: 'Produce a new Work Record after future gated work',
        kind: 'followup_work_record',
        read_only: false,
        requires_workflow_gate: true,
        workflow_gate_refs: arrayValue(recovery.next_gates),
        description: 'Keep the stale historical Work Record unchanged and record any future attempt separately.',
      },
    ];
  }
  if (verdict === 'repairable') {
    return [
      {
        id: 'step:reperceive-or-reresolve',
        title: 'Re-perceive or re-resolve stale refs',
        kind: 'fresh_validation',
        read_only: true,
        requires_workflow_gate: false,
        description: 'Gather fresh evidence to identify a candidate execution-map ref or postcondition patch.',
      },
      {
        id: 'step:prepare-candidate-patch',
        title: 'Prepare an execution-map patch candidate',
        kind: 'candidate_patch',
        read_only: false,
        requires_workflow_gate: true,
        workflow_gate_refs: arrayValue(recovery.next_gates),
        description: 'Describe the patch candidate under a workflow gate; do not apply it in this plan.',
      },
      {
        id: 'step:produce-followup-work-record',
        title: 'Produce a follow-up Work Record after any future repair attempt',
        kind: 'followup_work_record',
        read_only: false,
        requires_workflow_gate: true,
        workflow_gate_refs: arrayValue(recovery.next_gates),
        description: 'A future repair attempt must emit new evidence or an explicit patch artifact.',
      },
    ];
  }
  if (verdict === 'blocked') {
    return blockerActions(recovery.blockers).map((action, index) => ({
      id: `step:resolve-blocker-${index + 1}`,
      title: `Resolve ${action.category}`,
      kind: 'blocker_resolution',
      read_only: false,
      requires_workflow_gate: true,
      workflow_gate_refs: arrayValue(recovery.next_gates),
      blocker: action,
      description: action.required_external_action,
    }));
  }
  if (verdict === 'impossible') {
    return [
      {
        id: 'step:stop-replay',
        title: 'Do not replay or repair this record',
        kind: 'prohibit_replay',
        read_only: true,
        requires_workflow_gate: false,
        description: 'The known target class cannot satisfy the recorded intent; create a new plan or Work Record instead.',
      },
    ];
  }
  if (verdict === 'superseded') {
    const replacements = replacementRefs(record);
    return [
      {
        id: 'step:inspect-replacement',
        title: 'Use the replacement Work Record',
        kind: 'replacement_lookup',
        read_only: true,
        requires_workflow_gate: false,
        replacement_refs: replacements,
        description: 'This record is superseded; avoid repair and inspect the replacement when available.',
      },
    ];
  }
  if (verdict === 'retired') {
    return [
      {
        id: 'step:preserve-historical-record',
        title: 'Preserve as historical evidence',
        kind: 'historical_only',
        read_only: true,
        requires_workflow_gate: false,
        description: 'Retired records are historical only and should not be repaired or replayed.',
      },
    ];
  }
  return [];
}

function candidatePatches({ verdict = '', verify = {}, recovery = {} } = {}) {
  if (verdict !== 'repairable') return [];
  return [{
    id: 'candidate_patch:execution_map_refs',
    target: 'execution_map',
    status: 'descriptive_only',
    applied: false,
    requires_workflow_gate: true,
    workflow_gate_refs: arrayValue(recovery.next_gates),
    controlled_repair_executor: {
      registry_kind: 'controlled_repair_fixture_registry',
      allowlisted_operation_id: 'controlled_fixture.write_success',
    },
    rationale: 'Current report-only diagnostics indicate refs or postconditions may be patched in a future gated repair attempt.',
    failure_classes: arrayValue(verify.failure_classes),
    diagnostic_codes: uniqueStrings(arrayValue(verify.diagnostics).map((diagnostic) => objectValue(diagnostic).code)),
  }];
}

function followup({ verdict = '', recovery = {}, record = {} } = {}) {
  if (verdict === 'valid') {
    return {
      should_create_new_work_record: false,
      reason: 'No repair is needed.',
    };
  }
  if (verdict === 'stale' || verdict === 'repairable') {
    return {
      should_create_new_work_record: true,
      requires_workflow_gate: true,
      workflow_gate_refs: arrayValue(recovery.next_gates),
      reason: 'Any future repair or re-run attempt must produce new evidence or an explicit patch artifact instead of rewriting this Work Record.',
    };
  }
  if (verdict === 'blocked') {
    return {
      should_create_new_work_record: true,
      requires_workflow_gate: true,
      workflow_gate_refs: arrayValue(recovery.next_gates),
      reason: 'After resolving blockers, capture the follow-up attempt separately.',
    };
  }
  if (verdict === 'superseded') {
    return {
      should_create_new_work_record: false,
      replacement_refs: replacementRefs(record),
      reason: 'Use the replacement Work Record when present.',
    };
  }
  return {
    should_create_new_work_record: false,
    reason: 'Replay and repair are not appropriate for this health verdict.',
  };
}

export function planWorkRecordRepair(ref, options = {}) {
  const read = readWorkRecord(ref, options);
  if (read.status !== 'success') return read;

  const verify = verifyWorkRecord(ref, options);
  if (verify.status === 'unsupported_profile') {
    return {
      type: 'work_record.repair_plan',
      schema_version: WORK_RECORD_REPAIR_PLAN_SCHEMA_VERSION,
      status: 'unsupported',
      source_work_record: {
        id: text(read.record?.id),
        path: text(read.source?.path),
        requested_ref: text(ref),
      },
      current_report: cloneJson(verify),
      mutates_record: false,
      executes_actions: false,
      automatic_replay_allowed: false,
      diagnostics: arrayValue(verify.diagnostics),
    };
  }

  const record = objectValue(read.record);
  const recovery = objectValue(verify.recovery);
  const verdict = text(verify.health_verdict, text(recovery.verdict, 'blocked'));
  const status = plannerStatus(verdict);
  const gates = workflowGates(recovery, verdict);
  const commands = recommendedCommands({ record, verify, verdict, recovery });
  const steps = planSteps({ verdict, recovery, record });
  return {
    type: 'work_record.repair_plan',
    schema_version: WORK_RECORD_REPAIR_PLAN_SCHEMA_VERSION,
    source_consumer_schema_version: WORK_RECORD_CONSUMER_VERSION,
    status,
    source_work_record: {
      id: text(record.id),
      path: text(read.source?.path),
      match: text(read.source?.match),
      requested_ref: text(ref),
      schema_version: text(record.schema_version),
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
    mutates_record: false,
    executes_actions: false,
    automatic_replay_allowed: false,
    workflow_gates: gates,
    plan_steps: steps,
    candidate_patches: candidatePatches({ verdict, verify, recovery }),
    recommended_commands: commands,
    evidence_refs: arrayValue(verify.evidence_refs_used),
    diagnostics: arrayValue(verify.diagnostics),
    depends_on: {
      verifier_profile_id: text(verify.verifier_profile_id),
      report_only: true,
      source_work_record_immutable: true,
      evidence_refs: arrayValue(verify.evidence_refs_used),
    },
    followup: followup({ verdict, recovery, record }),
    notes: [
      'This Repair Plan is read-only planning output, not evidence of completed repair.',
      'The planner does not run recommended commands, replay actions, patch execution maps, or mutate the source Work Record.',
    ],
  };
}

export function validateWorkRecordRepairPlan(plan = {}) {
  const value = objectValue(plan);
  const diagnostics = [];
  function add(code, message, path) {
    diagnostics.push({
      severity: 'error',
      code,
      message,
      path,
    });
  }

  if (text(value.type) !== 'work_record.repair_plan') {
    add('INVALID_REPAIR_PLAN_TYPE', 'Repair Plan type must be work_record.repair_plan.', 'type');
  }
  if (text(value.schema_version) !== WORK_RECORD_REPAIR_PLAN_SCHEMA_VERSION) {
    add('INVALID_REPAIR_PLAN_SCHEMA_VERSION', 'Repair Plan schema_version is not supported.', 'schema_version');
  }
  if (value.mutates_record !== false) {
    add('REPAIR_PLAN_MUTATES_RECORD', 'Repair Plans must report mutates_record:false.', 'mutates_record');
  }
  if (value.executes_actions !== false) {
    add('REPAIR_PLAN_EXECUTES_ACTIONS', 'Repair Plans must report executes_actions:false.', 'executes_actions');
  }
  if (value.automatic_replay_allowed !== false) {
    add('REPAIR_PLAN_ALLOWS_AUTOMATIC_REPLAY', 'Repair Plans must report automatic_replay_allowed:false.', 'automatic_replay_allowed');
  }

  arrayValue(value.plan_steps).forEach((step, index) => {
    const item = objectValue(step);
    if (item.read_only === false && item.requires_workflow_gate !== true) {
      add(
        'MUTATING_STEP_WITHOUT_WORKFLOW_GATE',
        'Mutation candidate steps must require a workflow gate.',
        `plan_steps[${index}].requires_workflow_gate`,
      );
    }
  });

  arrayValue(value.candidate_patches).forEach((patch, index) => {
    const item = objectValue(patch);
    if (item.applied !== false) {
      add('CANDIDATE_PATCH_APPLIED', 'Repair Plan candidate patches must be descriptive and unapplied.', `candidate_patches[${index}].applied`);
    }
    if (item.requires_workflow_gate !== true) {
      add('CANDIDATE_PATCH_WITHOUT_WORKFLOW_GATE', 'Candidate patches must require a workflow gate.', `candidate_patches[${index}].requires_workflow_gate`);
    }
    if (item.controlled_repair_executor !== undefined) {
      const executor = objectValue(item.controlled_repair_executor);
      if (
        text(executor.registry_kind) !== 'controlled_repair_fixture_registry'
        || !text(executor.allowlisted_operation_id).startsWith('controlled_fixture.')
      ) {
        add(
          'CANDIDATE_PATCH_CONTROLLED_EXECUTOR_INVALID',
          'Candidate patch controlled executor provenance must name the fixture registry and a controlled_fixture operation.',
          `candidate_patches[${index}].controlled_repair_executor`,
        );
      }
    }
  });

  arrayValue(value.recommended_commands).forEach((command, index) => {
    const item = objectValue(command);
    if (!text(item.command)) {
      add('RECOMMENDED_COMMAND_MISSING_COMMAND', 'Recommended commands must include command text.', `recommended_commands[${index}].command`);
    }
    if (item.executes_in_plan !== false) {
      add('RECOMMENDED_COMMAND_EXECUTES_IN_PLAN', 'Recommended commands must not execute inside the Repair Plan.', `recommended_commands[${index}].executes_in_plan`);
    }
    if (item.mutates_state === true && item.requires_workflow_gate !== true) {
      add('MUTATING_COMMAND_WITHOUT_WORKFLOW_GATE', 'Mutating command candidates must require a workflow gate.', `recommended_commands[${index}].requires_workflow_gate`);
    }
  });

  return {
    type: 'work_record.repair_plan.validation',
    schema_version: WORK_RECORD_REPAIR_PLAN_SCHEMA_VERSION,
    status: diagnostics.length > 0 ? 'failed' : 'passed',
    diagnostics,
  };
}
