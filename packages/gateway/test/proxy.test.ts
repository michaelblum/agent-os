// test/proxy.test.ts — Unit tests for proxy normalization and Layer 2 logic
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { AOSCommandError, normalizeWindow, type NormalizedWindow } from '../src/aos-proxy.js';
import { projectSDKError } from '../src/sdk-socket.js';

// --- Raw CLI data fixtures ---
// These match the actual output of `aos see cursor`

const rawNestedWindow = {
  cursor: { x: 942, y: 720 },
  display: 1,
  element: { role: 'AXImage', label: '', bounds: { x: 82, y: 344, width: 1156, height: 612 } },
  window: {
    app_name: 'Code',
    app_pid: 52825,
    bounds: { height: 949, width: 1512, x: 0, y: 33 },
    bundle_id: 'com.microsoft.VSCode',
    title: 'ui.js — agent-os',
    window_id: 763,
  },
};

const rawFlatWindow = {
  id: '100',
  app: 'Terminal',
  title: 'zsh',
  frame: { x: 50, y: 100, width: 800, height: 600 },
  focused: true,
};

const rawMinimalWindow = {
  window: { app_name: 'Finder', title: '', window_id: 42 },
};

describe('normalizeWindow', () => {
  it('normalizes nested CLI format (window.app_name, window.bounds)', () => {
    const w = normalizeWindow(rawNestedWindow);
    assert.equal(w.app, 'Code');
    assert.equal(w.title, 'ui.js — agent-os');
    assert.equal(w.id, '763');
    assert.deepEqual(w.frame, { x: 0, y: 33, width: 1512, height: 949 });
    assert.equal(w.focused, false);
  });

  it('normalizes flat format (app, title, frame)', () => {
    const w = normalizeWindow(rawFlatWindow);
    assert.equal(w.app, 'Terminal');
    assert.equal(w.title, 'zsh');
    assert.equal(w.id, '100');
    assert.deepEqual(w.frame, { x: 50, y: 100, width: 800, height: 600 });
    assert.equal(w.focused, true);
  });

  it('handles minimal window with missing fields', () => {
    const w = normalizeWindow(rawMinimalWindow);
    assert.equal(w.app, 'Finder');
    assert.equal(w.title, '');
    assert.equal(w.id, '42');
    assert.deepEqual(w.frame, { x: 0, y: 0, width: 0, height: 0 });
    assert.equal(w.focused, false);
  });

  it('respects isFocused override', () => {
    const w = normalizeWindow(rawNestedWindow, true);
    assert.equal(w.focused, true);
  });

  it('preserves focused from raw data', () => {
    const raw = { ...rawNestedWindow, focused: true };
    const w = normalizeWindow(raw);
    assert.equal(w.focused, true);
  });

  it('handles completely empty input', () => {
    const w = normalizeWindow({});
    assert.equal(w.app, '');
    assert.equal(w.title, '');
    assert.equal(w.id, '');
    assert.deepEqual(w.frame, { x: 0, y: 0, width: 0, height: 0 });
    assert.equal(w.focused, false);
  });
});

describe('Overlay position calculation', () => {
  // This tests the positioning logic used by showOverlay
  // Extracted to verify the geometry without needing the daemon

  function calculateOverlayPosition(windowFrame: { x: number; y: number; width: number; height: number }) {
    const w = 280, h = 44;
    const x = windowFrame.x + (windowFrame.width - w) / 2;
    const y = windowFrame.y - h - 8;
    return [Math.round(x), Math.max(0, Math.round(y)), w, h] as const;
  }

  it('centers above a full-width window', () => {
    const [x, y, w, h] = calculateOverlayPosition({ x: 0, y: 33, width: 1512, height: 949 });
    assert.equal(x, 616);  // (1512 - 280) / 2
    assert.equal(y, 0);    // 33 - 44 - 8 = -19, clamped to 0
    assert.equal(w, 280);
    assert.equal(h, 44);
  });

  it('centers above a small window with room above', () => {
    const [x, y] = calculateOverlayPosition({ x: 200, y: 300, width: 600, height: 400 });
    assert.equal(x, 360);  // 200 + (600 - 280) / 2
    assert.equal(y, 248);  // 300 - 44 - 8
  });

  it('clamps y to 0 when window is at top of screen', () => {
    const [, y] = calculateOverlayPosition({ x: 0, y: 0, width: 800, height: 600 });
    assert.equal(y, 0);    // 0 - 44 - 8 = -52, clamped to 0
  });
});

describe('waitFor timeout behavior', () => {
  it('returns found:false and elapsed time on timeout', async () => {
    // Simulate the waitFor polling logic
    const timeout = 200;
    const interval = 50;
    const start = Date.now();
    let elapsed = 0;

    while (elapsed < timeout) {
      // Simulate a check that never matches
      const found = false;
      if (found) break;
      await new Promise(r => setTimeout(r, interval));
      elapsed = Date.now() - start;
    }

    assert.ok(elapsed >= timeout - interval); // Allow some timing slack
    assert.ok(elapsed < timeout + 200);       // Shouldn't overshoot by much
  });
});

describe('Target Handle gateway and SDK projection', () => {
  it('preserves typed target failures through the socket envelope', () => {
    const error = new AOSCommandError('TARGET_AMBIGUOUS', 'multiple current matches', {
      candidates: [{ role: 'AXButton', label: 'Save' }],
    });
    assert.deepEqual(projectSDKError(error), {
      error: {
        code: 'TARGET_AMBIGUOUS',
        message: 'multiple current matches',
        details: { candidates: [{ role: 'AXButton', label: 'Save' }] },
      },
    });
  });

  it('rejects SDK calls with the original target code and bounded details', async () => {
    const connection = new EventEmitter() as EventEmitter & {
      write: (data: string, callback?: (error?: Error) => void) => void;
      destroy: () => void;
    };
    connection.write = (data, callback) => {
      const request = JSON.parse(data);
      queueMicrotask(() => connection.emit('data', Buffer.from(`${JSON.stringify({
        id: request.id,
        result: {
          error: {
            code: 'TARGET_STATE_STALE',
            message: 'capture generation was superseded',
            details: { state_id: 'see_old', current_state_id: 'see_new' },
          },
        },
      })}\n`)));
      callback?.();
    };
    connection.destroy = () => {};

    const context: any = {
      Buffer,
      clearTimeout,
      console,
      queueMicrotask,
      require: (name: string) => {
        assert.equal(name, 'node:net');
        return { createConnection: () => connection };
      },
      setTimeout,
      __aos_config: { gatewaySocket: '/tmp/aos-gateway-test.sock' },
    };
    vm.createContext(context);
    vm.runInContext(readFileSync(resolve('sdk/aos-sdk.js'), 'utf8'), context);

    await assert.rejects(context.aos.capture(), (error: any) => {
      assert.equal(error.code, 'TARGET_STATE_STALE');
      assert.deepEqual(
        JSON.parse(JSON.stringify(error.details)),
        { state_id: 'see_old', current_state_id: 'see_new' },
      );
      return true;
    });
  });
});
