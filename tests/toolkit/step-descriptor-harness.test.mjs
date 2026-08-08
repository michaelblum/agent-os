import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runOneStepStepDescriptorHarness,
  validateStepDescriptor,
} from '../../packages/toolkit/workbench/step-descriptor-harness.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => JSON.parse(fs.readFileSync(path.join(repoRoot, relative), 'utf8'));
const descriptor = () => read('shared/schemas/fixtures/aos-step-descriptor-v1/valid/browser-click-status.json');
const evidence = () => read('shared/schemas/fixtures/aos-work-record-v1/evidence/aos-browser-click-status.json');

test('one-step V1 harness simulates supplied evidence with no authority input', () => {
  assert.deepEqual(validateStepDescriptor(descriptor()), []);
  const result = runOneStepStepDescriptorHarness(descriptor(), { evidenceSource: evidence() });
  assert.equal(result.status, 'passed');
  assert.equal(result.record.schema_version, '2026-08-work-record-v1');
  assert.equal(result.record.origin.kind, 'workflow');
  assert.equal(result.verifier.status, 'passed');
  assert.doesNotMatch(JSON.stringify(result), /workflow_gate|authorization|approval|required_risk|risk_level|allowlisted|automatic_replay/);
});

test('execute mode invokes exactly one caller adapter and records its outcome', () => {
  let calls = 0;
  const result = runOneStepStepDescriptorHarness(descriptor(), {
    mode: 'execute',
    executeStep: ({ stepDescriptor }) => {
      calls += 1;
      assert.equal(stepDescriptor.id, descriptor().id);
      return evidence();
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'passed');
});

test('harness rejects historical descriptors, multiple steps, and missing evidence', () => {
  const historical = read('shared/schemas/fixtures/aos-step-descriptor-v0/valid/browser-click-status.json');
  assert.equal(runOneStepStepDescriptorHarness(historical, { evidenceSource: evidence() }).reason, 'unsupported_step_descriptor_schema');
  assert.equal(runOneStepStepDescriptorHarness({ ...descriptor(), steps: [{}] }, { evidenceSource: evidence() }).reason, 'one_step_only');
  assert.equal(runOneStepStepDescriptorHarness(descriptor()).reason, 'evidence_source_required');
});

test('harness rejects a discriminator-only malformed V1 descriptor', () => {
  const malformed = {
    type: 'aos.step_descriptor',
    schema_version: '2026-08-step-descriptor-v1',
    id: 'step:malformed',
    workflow_ref: 'workflow:malformed',
    target_resolution: { target: 'browser:page' },
    action: { verb: 'click' },
  };
  assert.ok(validateStepDescriptor(malformed).every((item) => item.code === 'step_descriptor_v1_schema_invalid'));
  assert.equal(runOneStepStepDescriptorHarness(malformed, { evidenceSource: evidence() }).status, 'rejected');
});

test('descriptor validation rejects incoherent identity and referential bindings', () => {
  const cases = [
    [
      (step) => { step.target_resolution.dialect = 'canvas'; },
      'step_descriptor_target_dialect_mismatch',
    ],
    [
      (step) => { step.action.target = 'browser:unrelated/e99'; },
      'step_descriptor_action_target_mismatch',
    ],
    [
      (step) => { step.target_resolution.target_with_ref = step.target_resolution.target_with_ref.replace('/e2', '/  e2'); },
      'step_descriptor_action_target_mismatch',
    ],
    [
      (step) => { step.claim_promotions[0].postcondition_ref = 'postcondition:unknown'; },
      'step_descriptor_claim_postcondition_unbound',
    ],
    [
      (step) => { step.preconditions.push(structuredClone(step.preconditions[0])); },
      'step_descriptor_v1_schema_invalid',
    ],
    [
      (step) => { step.postconditions.push(structuredClone(step.postconditions[0])); },
      'step_descriptor_v1_schema_invalid',
    ],
  ];
  for (const [mutate, expectedCode] of cases) {
    const step = descriptor();
    mutate(step);
    assert.ok(validateStepDescriptor(step).some((item) => item.code === expectedCode));
    const result = runOneStepStepDescriptorHarness(step, { evidenceSource: evidence() });
    assert.equal(result.status, 'rejected');
    assert.equal(result.record, null);
    assert.equal(result.verifier, null);
  }
});

test('harness rejects evidence not exactly bound to descriptor action, target, and observations', () => {
  const cases = [
    (source) => { source.action.verb = 'type'; },
    (source) => { source.target_with_ref = 'browser:unrelated/e99'; },
    (source) => { source.before_perception.semantic_targets[0].name = 'Unrelated target'; },
    (source) => { source.before_perception.semantic_targets[1].value = 'Not ready'; },
    (source) => { source.after_perception.semantic_targets[1].value = 'Never observed'; },
    (source) => { source.postcondition.check.expected = 'Never observed'; },
    (source) => { source.postcondition.state_id = 'see_unrelated_after_state'; },
  ];
  for (const mutate of cases) {
    const source = evidence();
    mutate(source);
    const result = runOneStepStepDescriptorHarness(descriptor(), { evidenceSource: source });
    assert.equal(result.status, 'rejected');
    assert.equal(result.record, null);
    assert.equal(result.verifier, null);
  }
});

test('postcondition state drift is rejected before Work Record emission', () => {
  const source = evidence();
  source.postcondition.state_id = 'see_unrelated_after_state';
  const result = runOneStepStepDescriptorHarness(descriptor(), { evidenceSource: source });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'step_descriptor_postcondition_state_binding_mismatch');
  assert.equal(result.record, null);
  assert.equal(result.verifier, null);
});

test('execute adapter evidence is checked against the descriptor before capture', () => {
  const source = evidence();
  source.action.target = 'browser:unrelated/e99';
  const result = runOneStepStepDescriptorHarness(descriptor(), {
    mode: 'execute',
    executeStep: () => source,
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'step_descriptor_evidence_binding_mismatch');
  assert.equal(result.record, null);
  assert.equal(result.verifier, null);
});

test('claim promotion template and scope project exactly into the emitted Work Record', () => {
  const step = descriptor();
  step.claim_promotions[0].claim_id_template = 'claim:explicit-different-id';
  step.claim_promotions[0].scope = 'subject';
  const result = runOneStepStepDescriptorHarness(step, { evidenceSource: evidence() });
  assert.equal(result.status, 'passed');
  const promoted = result.record.claims.find((claim) => claim.id === 'claim:explicit-different-id');
  assert.equal(promoted.scope, 'subject');
  assert.ok(result.record.claim_results.some((item) => item.claim_id === promoted.id));
});

test('descriptor action template and args must match caller evidence and are preserved', () => {
  const canonical = runOneStepStepDescriptorHarness(descriptor(), { evidenceSource: evidence() });
  assert.deepEqual(canonical.record.execution_map.steps[0].action.args.descriptor_action, descriptor().action);

  for (const mutate of [
    (step) => { step.action.command_template = './aos do type {{target_with_ref}} --text NEVER'; },
    (step) => { step.action.args.expected_role = 'textbox'; },
    (step) => { step.action.args.expected_name = 'Wrong'; },
  ]) {
    const step = descriptor();
    mutate(step);
    const result = runOneStepStepDescriptorHarness(step, { evidenceSource: evidence() });
    assert.equal(result.status, 'rejected');
    assert.equal(result.record, null);
  }
});

test('captured descriptor command bytes preserve repeated whitespace exactly', () => {
  const step = descriptor();
  const source = evidence();
  step.action.command_template = step.action.command_template.replace('click ', 'click  ');
  source.action.command = source.action.command.replace('click ', 'click  ');
  const result = runOneStepStepDescriptorHarness(step, { evidenceSource: source });
  assert.equal(result.status, 'passed');
  const actionEvidence = result.record.evidence.find((item) => item.kind === 'aos_do_action');
  assert.equal(actionEvidence.metadata.command, source.action.command);
  assert.equal(result.record.execution_map.steps[0].action.args.command, source.action.command);
});

test('target-resolution semantic identity must match hints and simulation or execute evidence', () => {
  const step = descriptor();
  step.target_resolution.semantic_ref = 'fabricated.semantic.target';
  const simulated = runOneStepStepDescriptorHarness(step, { evidenceSource: evidence() });
  assert.equal(simulated.status, 'rejected');
  assert.ok(simulated.diagnostics.some((item) => item.code === 'step_descriptor_resolution_semantic_ref_mismatch'));
  let calls = 0;
  const executed = runOneStepStepDescriptorHarness(step, {
    mode: 'execute',
    executeStep: () => { calls += 1; return evidence(); },
  });
  assert.equal(executed.status, 'rejected');
  assert.equal(calls, 0);
});

test('unsupported or missing required descriptor evidence fails before capture or execute', () => {
  const unsupported = descriptor();
  unsupported.evidence_requirements.push({
    id: 'evidence-requirement:impossible',
    kind: 'caller_proof_that_is_absent',
    phase: 'action',
    required: true,
  });
  assert.equal(runOneStepStepDescriptorHarness(unsupported, { evidenceSource: evidence() }).status, 'rejected');
  let calls = 0;
  assert.equal(runOneStepStepDescriptorHarness(unsupported, {
    mode: 'execute',
    executeStep: () => { calls += 1; return evidence(); },
  }).status, 'rejected');
  assert.equal(calls, 0);

  const missing = evidence();
  delete missing.action.evidence_id;
  assert.ok(runOneStepStepDescriptorHarness(descriptor(), { evidenceSource: missing }).diagnostics
    .some((item) => item.code === 'step_descriptor_required_evidence_missing'));
});

test('descriptor evidence requirements and exact phase mappings are preserved', () => {
  const result = runOneStepStepDescriptorHarness(descriptor(), { evidenceSource: evidence() });
  assert.deepEqual(result.record.metadata.step_descriptor_evidence_requirements, descriptor().evidence_requirements);
  assert.ok(result.record.metadata.step_descriptor_evidence_requirement_results
    .every((item) => item.status === 'satisfied' && item.evidence_refs.length === 1));
});

test('one-step capture rejects extra postconditions instead of silently dropping them', () => {
  const step = descriptor();
  step.postconditions.push({ ...structuredClone(step.postconditions[0]), id: 'postcondition:extra' });
  const result = runOneStepStepDescriptorHarness(step, { evidenceSource: evidence() });
  assert.equal(result.status, 'rejected');
  assert.equal(result.record, null);
});
