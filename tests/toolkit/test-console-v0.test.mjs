import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import TestConsole from '../../packages/toolkit/components/test-console/index.js';
import {
  TEST_CONSOLE_MESSAGE_TYPES,
  TEST_CONSOLE_SCHEMA_VERSION,
  TEST_CONSOLE_SURFACE,
  createTestConsoleHumanResponse,
  createTestConsoleState,
  loadTestConsolePayload,
  renderTestConsoleHtml,
  requestTestConsoleOpenEvidence,
  requestTestConsoleRetry,
  testConsoleSnapshot,
} from '../../packages/toolkit/components/test-console/model.js';
import {
  TEST_CONSOLE_URL,
  applyTestConsoleSemanticTarget,
  testConsoleAosRef,
  testConsoleSemanticRefs,
} from '../../packages/toolkit/components/test-console/semantics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixturePath = path.join(repoRoot, 'shared/schemas/fixtures/aos-supervised-run-v0/valid/dry-run-human-confirmed.json');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-supervised-run-v0.schema.json');

function fixtureRun() {
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

async function repoText(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

function validateSchemaDef(defName, instance) {
  const result = spawnSync('python3', ['-c', `
import json
import sys
from pathlib import Path
from jsonschema import Draft202012Validator

schema_path = Path(sys.argv[1])
def_name = sys.argv[2]
instance = json.loads(sys.stdin.read())
schema = json.loads(schema_path.read_text())
subschema = {
    "$schema": schema["$schema"],
    "$defs": schema["$defs"],
    "$ref": f"#/$defs/{def_name}",
}
Draft202012Validator.check_schema(subschema)
validator = Draft202012Validator(subschema)
errors = sorted(validator.iter_errors(instance), key=lambda error: list(error.path))
if errors:
    for error in errors[:8]:
        print(error.message)
    sys.exit(1)
`, schemaPath, defName], {
    input: JSON.stringify(instance),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout || result.stderr);
}

class FakeElement {
  constructor(tagName = 'button') {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.textContent = '';
    this.value = '';
    this.disabled = false;
  }

  setAttribute(name, value) {
    const normalized = String(value);
    this.attributes.set(name, normalized);
    if (name === 'id') this.id = normalized;
    if (name === 'type') this.type = normalized;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === 'id') delete this.id;
    if (name === 'type') delete this.type;
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
}

test('Supervised Run Test Console V0 renders one supplied supervised-run step payload', () => {
  const state = createTestConsoleState();
  const result = loadTestConsolePayload(state, {
    run: fixtureRun(),
    artifact_refs: [
      {
        id: 'artifact-ref:dry-run-output',
        ref: 'artifact:dry-run-output',
        kind: 'artifact_ref',
        relationship: 'fixture_context',
        summary: 'Dry-run output bundle.',
      },
    ],
  });
  const snapshot = testConsoleSnapshot(state);
  const html = renderTestConsoleHtml(snapshot);

  assert.equal(result.status, 'loaded');
  assert.equal(snapshot.surface, TEST_CONSOLE_SURFACE);
  assert.equal(snapshot.url, TEST_CONSOLE_URL);
  assert.equal(snapshot.operating_path, 'agent/dev/testing/headed/real-input/hitl-sidecar');
  assert.equal(snapshot.title, 'Confirm deterministic fixture status');
  assert.equal(snapshot.instruction.text, 'Observe the deterministic fixture status output.');
  assert.equal(snapshot.expectation.text, 'The fixture status output reads ready.');
  assert.equal(snapshot.automated_checks[0].status, 'passed');
  assert.ok(snapshot.evidence_refs.some((ref) => ref.ref === 'evidence:dry-run-automated-check'));
  assert.ok(snapshot.artifact_refs.some((ref) => ref.ref === 'artifact:dry-run-output'));
  assert.match(html, /data-action="confirm"/);
  assert.match(html, /data-action="fail"/);
  assert.match(html, /data-action="blocked"/);
  assert.match(html, /data-action="add-note"/);
  assert.match(html, /data-action="retry"/);
  assert.match(html, /data-action="open-evidence"/);
});

test('component manifest and serialized state stay fixture-backed', () => {
  const shell = TestConsole({ initialState: { run: fixtureRun() } });
  const saved = shell.serialize();

  assert.equal(shell.manifest.name, TEST_CONSOLE_SURFACE);
  assert.ok(shell.manifest.accepts.includes(TEST_CONSOLE_MESSAGE_TYPES.load));
  assert.ok(shell.manifest.emits.includes(TEST_CONSOLE_MESSAGE_TYPES.humanResponseCaptured));
  assert.equal(saved.run.id, 'supervised-run:hitl-dry-run-2026-05-06');
  assert.equal(saved.step.id, 'step:dry-run-confirm-status');
  assert.equal(saved.operating_path, 'agent/dev/testing/headed/real-input/hitl-sidecar');
});

test('human response capture emits schema-shaped response JSON and timeline event', () => {
  const state = createTestConsoleState({ run: fixtureRun() });
  const result = createTestConsoleHumanResponse(state, {
    response: 'confirmed',
    summary: 'The ready status is visible.',
    now: '2026-05-06T18:02:00Z',
  });

  assert.equal(result.type, TEST_CONSOLE_MESSAGE_TYPES.humanResponseCaptured);
  assert.equal(result.schema_version, TEST_CONSOLE_SCHEMA_VERSION);
  assert.equal(result.status, 'captured');
  assert.equal(result.operating_path, 'agent/dev/testing/headed/real-input/hitl-sidecar');
  assert.equal(result.response.response, 'confirmed');
  assert.equal(result.response.source.kind, 'console');
  assert.equal(result.response.source.id, TEST_CONSOLE_SURFACE);
  assert.equal(result.timeline_event.type, 'supervised.human.confirmed');
  assert.equal(result.timeline_event.human_response_ref, result.response.id);
  validateSchemaDef('human_response', result.response);
  validateSchemaDef('timeline_event', result.timeline_event);
});

test('file-backed bridge metadata is carried without adding a daemon event channel', () => {
  const bridge = {
    kind: 'file_backed',
    run_dir: '/tmp/aos-supervised-run',
    events_jsonl: '/tmp/aos-supervised-run/events.jsonl',
    current_step_json: '/tmp/aos-supervised-run/state/current-step.json',
    response_events_jsonl: '/tmp/aos-supervised-run/response-events.jsonl',
    human_responses_jsonl: '/tmp/aos-supervised-run/human-responses.jsonl',
  };
  const state = createTestConsoleState({
    run: {
      ...fixtureRun(),
      metadata: { bridge },
    },
    bridge,
  });
  const snapshot = testConsoleSnapshot(state);
  const result = createTestConsoleHumanResponse(state, {
    response: 'confirmed',
    summary: 'The ready status is visible through the bridge.',
    now: '2026-05-06T18:02:00Z',
  });

  assert.equal(snapshot.boundaries.file_backed_bridge, true);
  assert.equal(snapshot.boundaries.daemon_event_bus, false);
  assert.equal(result.bridge.response_events_jsonl, bridge.response_events_jsonl);
  assert.equal(result.response.metadata.bridge.response_events_jsonl, bridge.response_events_jsonl);
  validateSchemaDef('human_response', result.response);
});

test('retry and open-evidence affordances stay request-only in V0', () => {
  const state = createTestConsoleState({ run: fixtureRun() });
  const retry = requestTestConsoleRetry(state);
  const evidence = requestTestConsoleOpenEvidence(state, {
    ref: 'evidence:dry-run-automated-check',
  });

  assert.equal(retry.type, TEST_CONSOLE_MESSAGE_TYPES.retryRequested);
  assert.equal(retry.status, 'requested');
  assert.equal(retry.replay_started, false);
  assert.equal(retry.repair_started, false);
  assert.equal(retry.macro_playback_started, false);
  assert.equal(evidence.type, TEST_CONSOLE_MESSAGE_TYPES.evidenceOpenRequested);
  assert.equal(evidence.status, 'requested');
  assert.equal(evidence.viewer_started, false);
  assert.equal(evidence.second_evidence_viewer_started, false);
});

test('test console exposes stable semantic refs for xray and do-target routing', async () => {
  const refs = testConsoleSemanticRefs();
  const button = new FakeElement('button');
  button.textContent = 'Confirm';

  applyTestConsoleSemanticTarget(button, {
    id: 'response-confirm',
    name: 'Confirm supervised step',
    action: 'human_response.confirmed',
  }, {
    preserveText: true,
  });

  assert.equal(refs.confirm, testConsoleAosRef('response-confirm'));
  assert.equal(button.getAttribute('id'), 'test-console-v0-response-confirm');
  assert.equal(button.getAttribute('type'), 'button');
  assert.equal(button.getAttribute('aria-label'), 'Confirm supervised step');
  assert.equal(button.dataset.aosRef, 'test-console-v0:response-confirm');
  assert.equal(button.dataset.aosAction, 'human_response.confirmed');
  assert.equal(button.dataset.aosSurface, TEST_CONSOLE_SURFACE);
  assert.equal(button.dataset.semanticTargetId, 'response-confirm');
  assert.equal(button.textContent, 'Confirm');

  const indexHtml = await repoText('packages/toolkit/components/test-console/index.html');
  const indexJs = await repoText('packages/toolkit/components/test-console/index.js');
  const launch = await repoText('packages/toolkit/components/test-console/launch.sh');
  const writeResponse = await repoText('packages/toolkit/components/test-console/write-response.sh');

  assert.match(indexHtml, /Test Console V0/);
  assert.match(indexJs, /data-action="confirm"/);
  assert.match(indexJs, /data-action="retry"/);
  assert.match(indexJs, /data-action="open-evidence"/);
  assert.match(launch, /--manifest test-console-v0/);
  assert.match(launch, /test_console\.load/);
  assert.match(launch, /RUN_DIR/);
  assert.match(writeResponse, /show eval/);
  assert.match(writeResponse, /aos_supervised_run_append_response_event/);
  assert.doesNotMatch(indexJs, /data-action="[^"]*(replay|repair|macro)[^"]*"/i);
  assert.doesNotMatch(launch, /aos test run/);
  assert.doesNotMatch(writeResponse, /aos test run/);
});
