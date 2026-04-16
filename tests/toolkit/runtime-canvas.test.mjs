import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalCanvas } from '../../packages/toolkit/runtime/canvas.js';

function encodeMessage(msg) {
  return Buffer.from(JSON.stringify(msg), 'utf8').toString('base64');
}

test('evalCanvas posts canvas.eval and resolves with the daemon result', async (t) => {
  const previousWindow = globalThis.window;
  const previousAtob = globalThis.atob;
  const outbound = [];

  globalThis.window = {
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

  t.after(() => {
    globalThis.window = previousWindow;
    globalThis.atob = previousAtob;
  });

  const promise = evalCanvas('target-canvas', 'document.title', { timeoutMs: 100 });
  assert.equal(outbound.length, 1);
  assert.equal(outbound[0].type, 'canvas.eval');
  assert.equal(outbound[0].payload.id, 'target-canvas');
  assert.equal(outbound[0].payload.js, 'document.title');
  assert.ok(outbound[0].payload.request_id);
  assert.equal(typeof window.headsup.receive, 'function');

  window.headsup.receive(encodeMessage({
    type: 'canvas.response',
    request_id: outbound[0].payload.request_id,
    status: 'ok',
    result: 'Inspector',
  }));

  assert.equal(await promise, 'Inspector');
});
