import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-supervised-run-v0.schema.json');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-supervised-run-v0');

async function jsonFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

async function loadJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function validate(instancePath) {
  return spawnSync(
    'python3',
    [
      '-c',
      `
import json, sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema = json.loads(Path(sys.argv[1]).read_text())
instance = json.loads(Path(sys.argv[2]).read_text())
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema)
errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
if errors:
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`,
      schemaPath,
      instancePath,
    ],
    { encoding: 'utf8' },
  );
}

function assertUnique(values, fixture, label) {
  assert.equal(
    new Set(values).size,
    values.length,
    `${fixture}: expected unique ${label}`,
  );
}

function findAutomatedCheck(steps, checkId) {
  return steps
    .flatMap((step) => step.automated_checks || [])
    .find((check) => check.id === checkId);
}

function findInstruction(steps, instructionId) {
  return steps.find((step) => step.instruction?.id === instructionId)?.instruction;
}

function findExpectation(steps, expectationId) {
  return steps.find((step) => step.expectation?.id === expectationId)?.expectation;
}

function findHumanRequest(steps, requestId) {
  return steps.find((step) => step.human_request?.id === requestId)?.human_request;
}

function assertEvidenceRefsResolve(refs, evidenceRefs, fixture, context) {
  for (const ref of refs || []) {
    assert.ok(evidenceRefs.has(ref), `${fixture}: ${context} evidence_ref ${ref} must resolve`);
  }
}

function assertTimeline(run, fixture) {
  const eventIds = run.timeline.map((event) => event.id);
  const stepIds = new Set(run.steps.map((step) => step.id));
  const humanResponseIds = new Set(run.human_responses.map((response) => response.id));
  const evidenceRefs = new Set(run.evidence_refs.map((evidenceRef) => evidenceRef.ref));

  assertUnique(eventIds, fixture, 'timeline event ids');
  run.timeline.forEach((event, index) => {
    assert.equal(
      event.sequence,
      index + 1,
      `${fixture}: timeline sequence should be contiguous and ordered`,
    );
    assert.ok(
      event.type.startsWith('supervised.'),
      `${fixture}: event ${event.id} must use supervised.* naming`,
    );
    assert.ok(
      !event.type.startsWith('test.'),
      `${fixture}: event ${event.id} must not use old test.* naming`,
    );

    if (event.step_ref) {
      assert.ok(stepIds.has(event.step_ref), `${fixture}: event ${event.id} step_ref resolves`);
    }
    if (event.instruction_ref) {
      assert.ok(
        findInstruction(run.steps, event.instruction_ref),
        `${fixture}: event ${event.id} instruction_ref resolves`,
      );
    }
    if (event.expectation_ref) {
      assert.ok(
        findExpectation(run.steps, event.expectation_ref),
        `${fixture}: event ${event.id} expectation_ref resolves`,
      );
    }
    if (event.automated_check_ref) {
      assert.ok(
        findAutomatedCheck(run.steps, event.automated_check_ref),
        `${fixture}: event ${event.id} automated_check_ref resolves`,
      );
    }
    if (event.human_request_ref) {
      assert.ok(
        findHumanRequest(run.steps, event.human_request_ref),
        `${fixture}: event ${event.id} human_request_ref resolves`,
      );
    }
    if (event.human_response_ref) {
      assert.ok(
        humanResponseIds.has(event.human_response_ref),
        `${fixture}: event ${event.id} human_response_ref resolves`,
      );
    }
    assertEvidenceRefsResolve(event.evidence_refs, evidenceRefs, fixture, `event ${event.id}`);
  });
}

function assertStepState(run, fixture) {
  const eventIds = new Set(run.timeline.map((event) => event.id));
  const stepIds = new Set(run.steps.map((step) => step.id));
  const humanResponseIds = new Set(run.human_responses.map((response) => response.id));
  const evidenceRefs = new Set(run.evidence_refs.map((evidenceRef) => evidenceRef.ref));

  for (const stepRef of run.intent.step_refs || []) {
    assert.ok(stepIds.has(stepRef), `${fixture}: intent step_ref ${stepRef} must resolve`);
  }

  for (const step of run.steps) {
    assert.ok(
      eventIds.has(step.instruction.event_ref),
      `${fixture}: step ${step.id} instruction event_ref resolves`,
    );
    assert.ok(
      eventIds.has(step.expectation.event_ref),
      `${fixture}: step ${step.id} expectation event_ref resolves`,
    );

    for (const check of step.automated_checks || []) {
      assert.ok(
        eventIds.has(check.event_ref),
        `${fixture}: check ${check.id} event_ref resolves`,
      );
      assertEvidenceRefsResolve(check.evidence_refs, evidenceRefs, fixture, `check ${check.id}`);
    }

    if (step.human_request) {
      assert.ok(
        eventIds.has(step.human_request.event_ref),
        `${fixture}: human request ${step.human_request.id} event_ref resolves`,
      );
    }

    for (const responseRef of step.human_response_refs || []) {
      assert.ok(
        humanResponseIds.has(responseRef),
        `${fixture}: step ${step.id} human_response_ref ${responseRef} resolves`,
      );
    }

    if (step.completion) {
      const checkIds = new Set((step.automated_checks || []).map((check) => check.id));
      assert.ok(
        eventIds.has(step.completion.event_ref),
        `${fixture}: step ${step.id} completion event_ref resolves`,
      );
      for (const checkRef of step.completion.automated_check_refs) {
        assert.ok(
          checkIds.has(checkRef),
          `${fixture}: step ${step.id} completion automated_check_ref ${checkRef} resolves`,
        );
      }
      for (const responseRef of step.completion.human_response_refs) {
        assert.ok(
          humanResponseIds.has(responseRef),
          `${fixture}: step ${step.id} completion human_response_ref ${responseRef} resolves`,
        );
      }
      assertEvidenceRefsResolve(
        step.completion.evidence_refs,
        evidenceRefs,
        fixture,
        `step ${step.id} completion`,
      );
    }
  }
}

function assertHumanResponses(run, fixture) {
  const eventById = new Map(run.timeline.map((event) => [event.id, event]));
  const stepIds = new Set(run.steps.map((step) => step.id));
  const evidenceRefs = new Set(run.evidence_refs.map((evidenceRef) => evidenceRef.ref));
  const expectedEventType = {
    confirmed: 'supervised.human.confirmed',
    failed: 'supervised.human.failed',
    blocked: 'supervised.human.blocked',
    note: 'supervised.human.note',
  };

  for (const response of run.human_responses) {
    assert.ok(
      stepIds.has(response.step_ref),
      `${fixture}: human response ${response.id} step_ref resolves`,
    );
    assert.ok(
      findHumanRequest(run.steps, response.request_ref),
      `${fixture}: human response ${response.id} request_ref resolves`,
    );

    const event = eventById.get(response.event_ref);
    assert.ok(event, `${fixture}: human response ${response.id} event_ref resolves`);
    assert.equal(
      event.type,
      expectedEventType[response.response],
      `${fixture}: human response ${response.id} event type matches response kind`,
    );
    assert.equal(
      event.human_response_ref,
      response.id,
      `${fixture}: human response ${response.id} is referenced by its event`,
    );
    assertEvidenceRefsResolve(
      response.evidence_refs,
      evidenceRefs,
      fixture,
      `human response ${response.id}`,
    );
  }
}

function assertWorkRecordProjection(run, fixture) {
  if (!run.work_record_projection) {
    return;
  }

  const stepIds = new Set(run.steps.map((step) => step.id));
  const evidenceRefs = new Set(run.evidence_refs.map((evidenceRef) => evidenceRef.ref));

  assert.equal(
    run.work_record_projection.target_schema,
    '2026-05-work-record-v0',
    `${fixture}: projection must target Work Record v0`,
  );
  assertEvidenceRefsResolve(
    run.work_record_projection.evidence_refs,
    evidenceRefs,
    fixture,
    'work_record_projection',
  );

  for (const promotion of run.work_record_projection.claim_promotions || []) {
    assert.ok(
      stepIds.has(promotion.step_ref),
      `${fixture}: projection claim promotion ${promotion.id} step_ref resolves`,
    );
    assertEvidenceRefsResolve(
      promotion.evidence_refs,
      evidenceRefs,
      fixture,
      `projection claim promotion ${promotion.id}`,
    );
  }
}

function assertCompletedRunsHaveStepEvidence(run, fixture) {
  if (run.status !== 'completed') {
    return;
  }

  assert.ok(run.completed_at, `${fixture}: completed run should have completed_at`);
  assert.ok(
    run.timeline.some((event) => event.type === 'supervised.run.completed'),
    `${fixture}: completed run should include a supervised.run.completed event`,
  );

  for (const step of run.steps) {
    assert.equal(step.status, 'completed', `${fixture}: completed run step ${step.id} completed`);
    assert.ok(
      step.completion?.evidence_refs?.length > 0,
      `${fixture}: completed run step ${step.id} has completion evidence`,
    );
  }
}

function assertNoDuplicatedWorkRecordEvidenceSchema(run, fixture) {
  for (const evidenceRef of run.evidence_refs) {
    for (const forbidden of ['uri', 'digest', 'immutable', 'created_at']) {
      assert.equal(
        Object.hasOwn(evidenceRef, forbidden),
        false,
        `${fixture}: evidence_refs[] should not duplicate Work Record evidence.${forbidden}`,
      );
    }
  }
}

test('valid Supervised Run v0 fixtures match the schema and resolve internal ids', async () => {
  const fixtures = await jsonFiles(path.join(fixtureRoot, 'valid'));
  assert.ok(fixtures.length >= 1, 'expected valid Supervised Run fixtures');

  for (const fixture of fixtures) {
    const result = validate(fixture);
    assert.equal(
      result.status,
      0,
      `${path.relative(repoRoot, fixture)} should validate\n${result.stdout}${result.stderr}`,
    );

    const run = await loadJson(fixture);
    const relative = path.relative(repoRoot, fixture);
    assertTimeline(run, relative);
    assertStepState(run, relative);
    assertHumanResponses(run, relative);
    assertWorkRecordProjection(run, relative);
    assertCompletedRunsHaveStepEvidence(run, relative);
    assertNoDuplicatedWorkRecordEvidenceSchema(run, relative);
  }
});

test('invalid Supervised Run v0 fixtures are rejected by the schema', async () => {
  const fixtures = await jsonFiles(path.join(fixtureRoot, 'invalid'));
  assert.ok(fixtures.length >= 3, 'expected invalid Supervised Run fixtures');

  for (const fixture of fixtures) {
    const result = validate(fixture);
    assert.notEqual(result.status, 0, `${path.relative(repoRoot, fixture)} should fail validation`);
  }
});
