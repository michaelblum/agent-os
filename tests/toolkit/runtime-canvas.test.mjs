import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canvasInfo, evalCanvas, waitForCanvasStatusReady, warmCanvas, writeClipboardText } from '../../packages/toolkit/runtime/canvas.js';

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

test('warmCanvas creates a suspended canvas and waits for document readiness', async (t) => {
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

  const promise = warmCanvas({
    id: 'warm-inspector',
    url: 'aos://toolkit/components/surface-inspector/index.html',
    frame: [10, 20, 320, 240],
    timeoutMs: 1000,
  });

  assert.equal(outbound.length, 1);
  assert.equal(outbound[0].type, 'canvas.create');
  assert.deepEqual(outbound[0].payload, {
    id: 'warm-inspector',
    url: 'aos://toolkit/components/surface-inspector/index.html',
    frame: [10, 20, 320, 240],
    interactive: true,
    focus: false,
    parent: undefined,
    cascade: true,
    suspended: true,
    request_id: outbound[0].payload.request_id,
  });

  window.headsup.receive(encodeMessage({
    type: 'canvas.response',
    request_id: outbound[0].payload.request_id,
    status: 'ok',
    id: 'warm-inspector',
  }));

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(outbound[1].type, 'canvas.eval');
  assert.equal(outbound[1].payload.id, 'warm-inspector');
  assert.match(outbound[1].payload.js, /document\.readyState/);

  window.headsup.receive(encodeMessage({
    type: 'canvas.response',
    request_id: outbound[1].payload.request_id,
    status: 'ok',
    result: JSON.stringify({
      readyState: 'complete',
      manifest: { name: 'Surface Inspector' },
      ready: true,
    }),
  }));

  assert.deepEqual(await promise, {
    id: 'warm-inspector',
    lifecycle_state: 'warm_suspended',
    suspended: true,
    ready: {
      id: 'warm-inspector',
      readyState: 'complete',
      manifest: { name: 'Surface Inspector' },
      ready: true,
    },
  });
});

test('canvasInfo posts canvas.info and resolves non-mutating readiness metadata', async (t) => {
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

  const promise = canvasInfo('aos-desktop-world-stage', { timeoutMs: 100 });
  assert.equal(outbound[0].type, 'canvas.info');
  assert.equal(outbound[0].payload.id, 'aos-desktop-world-stage');

  window.headsup.receive(encodeMessage({
    type: 'canvas.response',
    request_id: outbound[0].payload.request_id,
    status: 'ok',
    exists: true,
    canvas: {
      id: 'aos-desktop-world-stage',
      lifecycle_state: 'active',
      manifest: { name: 'desktop-world-stage' },
    },
    ready: {
      ready: true,
      lifecycle_state: 'active',
      manifest: { name: 'desktop-world-stage' },
    },
  }));

  assert.deepEqual(await promise, {
    id: 'aos-desktop-world-stage',
    exists: true,
    canvas: {
      id: 'aos-desktop-world-stage',
      lifecycle_state: 'active',
      manifest: { name: 'desktop-world-stage' },
    },
    ready: true,
    manifest: { name: 'desktop-world-stage' },
    lifecycle_state: 'active',
    suspended: null,
  });
});

test('waitForCanvasStatusReady uses canvas.info and does not require canvas.eval', async (t) => {
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

  const promise = waitForCanvasStatusReady('aos-desktop-world-stage', {
    timeoutMs: 1000,
    intervalMs: 10,
    infoTimeoutMs: 100,
    requireManifest: true,
    manifestName: 'desktop-world-stage',
  });

  assert.equal(outbound[0].type, 'canvas.info');
  window.headsup.receive(encodeMessage({
    type: 'canvas.response',
    request_id: outbound[0].payload.request_id,
    status: 'ok',
    exists: true,
    canvas: { id: 'aos-desktop-world-stage', lifecycle_state: 'active' },
    ready: {
      ready: true,
      lifecycle_state: 'active',
      manifest: { name: 'desktop-world-stage' },
    },
  }));

  const result = await promise;
  assert.equal(result.ready, true);
  assert.equal(result.manifest.name, 'desktop-world-stage');
  assert.equal(outbound.some((message) => message.type === 'canvas.eval'), false);
});

test('writeClipboardText posts clipboard.write and resolves daemon ack', async (t) => {
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

  const promise = writeClipboardText('copy me', { timeoutMs: 100, browserFallback: false });
  assert.equal(outbound.length, 1);
  assert.equal(outbound[0].type, 'clipboard.write');
  assert.equal(outbound[0].payload.text, 'copy me');
  assert.ok(outbound[0].payload.request_id);

  window.headsup.receive(encodeMessage({
    type: 'canvas.response',
    request_id: outbound[0].payload.request_id,
    status: 'ok',
  }));

  assert.equal(await promise, true);
});

test('writeClipboardText falls back to browser clipboard when native write fails', async (t) => {
  const previousWindow = globalThis.window;
  const previousNavigator = globalThis.navigator;
  const previousAtob = globalThis.atob;
  const outbound = [];
  const browserWrites = [];

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
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      clipboard: {
        async writeText(text) {
          browserWrites.push(text);
        },
      },
    },
  });
  globalThis.atob = (value) => Buffer.from(value, 'base64').toString('utf8');

  t.after(() => {
    globalThis.window = previousWindow;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: previousNavigator,
    });
    globalThis.atob = previousAtob;
  });

  const promise = writeClipboardText('fallback text', { timeoutMs: 100 });
  window.headsup.receive(encodeMessage({
    type: 'canvas.response',
    request_id: outbound[0].payload.request_id,
    status: 'error',
    code: 'INVALID_PAYLOAD',
    message: 'test failure',
  }));

  assert.equal(await promise, true);
  assert.deepEqual(browserWrites, ['fallback text']);
});
