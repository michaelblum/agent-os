import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  GuidedUserSignalSessionStore,
  buildGuidedUserSignalShellPlan,
  completeGuidedUserSignalSession,
  createGuidedUserSignalSession,
} from '../../packages/toolkit/workbench/guided-user-signal-session.js';

const FIXED_ID = 'guided-signal-11111111-2222-3333-4444-555555555555';
const CREATED_AT = '2026-05-17T02:30:00.000Z';
const CAPTURED_AT = '2026-05-17T02:31:00.000Z';

function input() {
  return {
    session_id: FIXED_ID,
    source_operation: {
      operation_id: 'op-123',
      operation_kind: 'supervised_browser_repair',
      session_id: 'codex-session-123',
      harness: 'codex',
      agent: 'gdi',
    },
    subject: {
      reference: 'subject:browser:hero-cta',
      kind: 'browser_element',
      surface_id: 'browser-canvas',
      surface_kind: 'browser_page',
      canvas_id: 'browser-canvas',
      url: 'https://example.test',
    },
    guidance: [
      { kind: 'highlight', target_ref: 'subject:browser:hero-cta', rect: { x: 10, y: 20, width: 100, height: 40 } },
      { kind: 'callout', text: 'Click the intended CTA', point: { x: 24, y: 34 } },
      { kind: 'arrow', point: { x: 60, y: 40 }, style: { color: 'accent' } },
    ],
    capture_request: {
      kind: 'click',
      prompt: 'Click the account settings control.',
      coordinate_space: 'native_display',
      input_authority: { primitive: 'input_region', scope: 'point' },
    },
    linked_artifacts: {
      continuation_id: 'gate-cont-11111111-2222-3333-4444-555555555555',
    },
  };
}

test('guided user signal session normalizes provider-neutral contract and daemon input authority', () => {
  const session = createGuidedUserSignalSession(input(), { now: CREATED_AT, env: { AOS_RUNTIME_MODE: 'repo', AOS_STATE_ROOT: '/tmp/aos-guided-test' } });

  assert.equal(session.schema_version, 'aos.guided-user-signal.session.v1');
  assert.equal(session.session_id, FIXED_ID);
  assert.equal(session.lifecycle.state, 'pending');
  assert.equal(session.guidance.length, 3);
  assert.deepEqual(session.guidance.map((item) => item.kind), ['highlight', 'callout', 'arrow']);
  assert.equal(session.capture_request.input_authority.owner, 'daemon');
  assert.equal(session.capture_request.input_authority.primitive, 'input_region');
  assert.equal(session.capture_request.input_authority.future_full_screen_primitive, 'daemon_native_full_screen_input_capture');
  assert.equal(session.redaction.prompt_bodies, 'redact');
  assert.equal(session.capture_request.prompt, '');
  assert.equal(session.storage.session_path, path.join('/tmp/aos-guided-test', 'repo', 'guided-user-signal', 'sessions', `${FIXED_ID}.json`));
});

test('guided user signal session redacts prompt bodies and free text by default', () => {
  const session = createGuidedUserSignalSession({
    ...input(),
    capture_result: {
      kind: 'annotation',
      captured_at: CAPTURED_AT,
      annotation: { address: 'subject:browser:hero-cta', comment_text: 'Private locator note' },
      free_text: 'Private typed explanation',
    },
  }, { now: CREATED_AT });

  assert.equal(session.redaction.prompt_bodies, 'redact');
  assert.equal(session.redaction.free_text_answers, 'redact');
  assert.equal(session.capture_request.prompt, '');
  assert.equal(session.capture_result.free_text, '');
  assert.equal(session.capture_result.annotation.comment_text, '');
});

test('guided user signal session stores prompt bodies and free text only when policy opts in', () => {
  const session = createGuidedUserSignalSession({
    ...input(),
    capture_result: {
      kind: 'annotation',
      captured_at: CAPTURED_AT,
      annotation: { address: 'subject:browser:hero-cta', comment_text: 'Stored locator note' },
      free_text: 'Stored typed explanation',
    },
    redaction: {
      prompt_bodies: 'store',
      free_text_answers: 'store',
    },
  }, { now: CREATED_AT });

  assert.equal(session.redaction.prompt_bodies, 'store');
  assert.equal(session.redaction.free_text_answers, 'store');
  assert.equal(session.redaction.answer_payloads, 'redact');
  assert.equal(session.capture_request.prompt, 'Click the account settings control.');
  assert.equal(session.capture_result.free_text, 'Stored typed explanation');
  assert.equal(session.capture_result.annotation.comment_text, 'Stored locator note');
});

test('guided user signal session treats annotation text and note as free text answers', () => {
  const fromText = createGuidedUserSignalSession({
    ...input(),
    capture_result: {
      kind: 'annotation',
      captured_at: CAPTURED_AT,
      annotation: { address: 'subject:browser:hero-cta', text: 'Private text alias' },
    },
  }, { now: CREATED_AT });
  const fromNote = createGuidedUserSignalSession({
    ...input(),
    capture_result: {
      kind: 'annotation',
      captured_at: CAPTURED_AT,
      annotation: { address: 'subject:browser:hero-cta', note: 'Stored note alias' },
    },
    redaction: { free_text_answers: 'store' },
  }, { now: CREATED_AT });

  assert.equal(fromText.capture_result.annotation.comment_text, '');
  assert.equal(fromNote.capture_result.annotation.comment_text, 'Stored note alias');
});

test('guided user signal shell plan keeps toolkit policy separate from daemon capture', () => {
  const plan = buildGuidedUserSignalShellPlan(input(), { now: CREATED_AT });

  assert.equal(plan.schema, 'aos_guided_user_signal_shell_plan');
  assert.equal(plan.input_boundary.toolkit_policy, 'render_guidance_and_collect_one_response');
  assert.equal(plan.input_boundary.authoritative_input_owner, 'daemon');
  assert.equal(plan.input_boundary.daemon_primitive, 'input_region');
  assert.equal(plan.gate.submit_helper, 'submitGateContinuation');
  assert.equal(plan.gate.continuation_id, 'gate-cont-11111111-2222-3333-4444-555555555555');
});

test('guided user signal terminal completion is idempotent', () => {
  const pending = createGuidedUserSignalSession(input(), { now: CREATED_AT });
  const first = completeGuidedUserSignalSession(pending, {
    state: 'captured',
    capture_result: {
      kind: 'click',
      captured_at: CAPTURED_AT,
      point: { x: 50, y: 60 },
      input_event: {
        input_schema_version: 2,
        event_kind: 'pointer',
        type: 'mouse_down',
      },
    },
    linked_artifacts: {
      gate_record_id: 'gate-abc',
      resume_event_id: 'gate-resume-11111111-2222-3333-4444-555555555555',
      resume_event_path: '/tmp/resume.json',
    },
  }, { now: CAPTURED_AT });

  assert.equal(first.duplicate, false);
  assert.equal(first.session.lifecycle.state, 'captured');
  assert.equal(first.session.capture_result.point.x, 50);
  assert.equal(first.session.linked_artifacts.gate_record_id, 'gate-abc');

  const second = completeGuidedUserSignalSession(first.session, { state: 'error' }, { now: '2026-05-17T02:32:00.000Z' });
  assert.equal(second.duplicate, true);
  assert.equal(second.session.lifecycle.state, 'captured');
  assert.equal(second.session.lifecycle.terminal_at, CAPTURED_AT);
});

test('guided user signal store honors isolated runtime state root', async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), 'aos-guided-user-signal-'));
  const store = new GuidedUserSignalSessionStore({ env: { AOS_RUNTIME_MODE: 'repo', AOS_STATE_ROOT: stateRoot } });
  const created = await store.create(input(), { now: CREATED_AT });
  const completed = await store.complete(created.session_id, {
    state: 'gate_submitted',
    capture_result: { kind: 'region', captured_at: CAPTURED_AT, region: { x: 1, y: 2, width: 3, height: 4 } },
    linked_artifacts: { resume_event_id: 'gate-resume-11111111-2222-3333-4444-555555555555' },
  }, { now: CAPTURED_AT });
  const read = await store.read(created.session_id);

  assert.equal(created.storage.state_root, stateRoot);
  assert.equal(completed.duplicate, false);
  assert.equal(read.lifecycle.state, 'gate_submitted');
  assert.equal(read.capture_result.region.width, 3);
  assert.ok(read.storage.session_path.startsWith(path.join(stateRoot, 'repo', 'guided-user-signal', 'sessions')));
});
