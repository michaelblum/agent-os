import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submitGateContinuation } from '../../packages/toolkit/runtime/gate.js';

function encodeMessage(message) {
  return Buffer.from(JSON.stringify(message), 'utf8').toString('base64');
}

function installWindow() {
  const outbound = [];
  globalThis.window = {
    headsup: {},
    webkit: {
      messageHandlers: {
        headsup: {
          postMessage(message) {
            outbound.push(message);
          },
        },
      },
    },
  };
  globalThis.atob = (value) => Buffer.from(value, 'base64').toString('utf8');
  return outbound;
}

test('submitGateContinuation emits gate.submit and resolves success ack', async () => {
  const outbound = installWindow();
  const promise = submitGateContinuation({
    continuationId: 'gate-cont-11111111-2222-3333-4444-555555555555',
    response: { decision: 'approve' },
    submittedBy: { role: 'human', user: 'tester' },
    timeoutMs: 100,
  });

  assert.equal(outbound.length, 1);
  assert.equal(outbound[0].type, 'gate.submit');
  assert.equal(outbound[0].payload.continuation_id, 'gate-cont-11111111-2222-3333-4444-555555555555');
  assert.deepEqual(outbound[0].payload.response, { decision: 'approve' });
  assert.equal(outbound[0].payload.store_response, false);
  assert.ok(outbound[0].payload.request_id);

  window.headsup.receive(encodeMessage({
    type: 'canvas.response',
    request_id: outbound[0].payload.request_id,
    status: 'ok',
    gate_submit: {
      state: 'submitted',
      duplicate: false,
      resume_event: { event_id: 'gate-resume-11111111-2222-3333-4444-555555555555' },
    },
  }));

  const result = await promise;
  assert.equal(result.state, 'submitted');
  assert.equal(result.duplicate, false);
});

test('submitGateContinuation rejects error ack', async () => {
  const outbound = installWindow();
  const promise = submitGateContinuation({
    continuationId: 'gate-cont-11111111-2222-3333-4444-555555555555',
    response: { decision: 'approve' },
    timeoutMs: 100,
  });

  window.headsup.receive(encodeMessage({
    type: 'canvas.response',
    request_id: outbound[0].payload.request_id,
    status: 'error',
    code: 'INVALID_CONTINUATION_ID',
    message: 'bad id',
  }));

  await assert.rejects(promise, /INVALID_CONTINUATION_ID: bad id/);
});
