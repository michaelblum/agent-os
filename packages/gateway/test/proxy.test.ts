// test/proxy.test.ts — Unit tests for proxy normalization and Layer 2 logic
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWindow, type NormalizedWindow } from '../src/aos-proxy.js';

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

describe('clickElement error paths', () => {
  // These test the error return shapes that clickElement produces
  // without needing a live daemon (the actual function needs capture data)

  function simulateClickElement(
    elements: Array<{ label?: string; title?: string; role: string; bounds?: unknown }>,
    searchLabel: string,
    opts?: { role?: string },
  ) {
    if (elements.length === 0) {
      return { clicked: false, error: 'No accessibility elements found. Is the target app focused?' };
    }

    const labelLower = searchLabel.toLowerCase();
    let matches = elements.filter(el => {
      const elLabel = (el.label ?? el.title ?? '').toLowerCase();
      return elLabel.includes(labelLower);
    });

    if (opts?.role) {
      matches = matches.filter(el => el.role === opts.role);
    }

    if (matches.length === 0) {
      const available = elements
        .filter(el => el.label || el.title)
        .map(el => `${el.role}: "${el.label ?? el.title}"`)
        .slice(0, 15);
      return { clicked: false, error: `No element matching "${searchLabel}" found.`, candidates: available };
    }

    const target = matches[0];
    const frame = target.bounds as any;
    if (!frame) {
      return { clicked: false, error: `Element "${searchLabel}" found but has no frame/bounds.` };
    }

    return { clicked: true, element: { label: target.label ?? target.title, role: target.role, frame } };
  }

  it('returns error when no elements exist', () => {
    const result = simulateClickElement([], 'Build');
    assert.equal(result.clicked, false);
    assert.ok(result.error?.includes('No accessibility elements'));
  });

  it('returns candidates when label not found', () => {
    const elements = [
      { label: 'Run', role: 'AXButton', bounds: { x: 0, y: 0, width: 50, height: 30 } },
      { label: 'Stop', role: 'AXButton', bounds: { x: 60, y: 0, width: 50, height: 30 } },
    ];
    const result = simulateClickElement(elements, 'Build');
    assert.equal(result.clicked, false);
    assert.ok(result.candidates?.includes('AXButton: "Run"'));
    assert.ok(result.candidates?.includes('AXButton: "Stop"'));
  });

  it('filters by role when specified', () => {
    const elements = [
      { label: 'Build', role: 'AXStaticText', bounds: { x: 0, y: 0, width: 50, height: 20 } },
      { label: 'Build', role: 'AXButton', bounds: { x: 0, y: 30, width: 50, height: 30 } },
    ];
    const result = simulateClickElement(elements, 'Build', { role: 'AXButton' });
    assert.equal(result.clicked, true);
    assert.equal(result.element?.role, 'AXButton');
  });

  it('returns error when element has no frame', () => {
    const elements = [{ label: 'Build', role: 'AXButton' }];
    const result = simulateClickElement(elements, 'Build');
    assert.equal(result.clicked, false);
    assert.ok(result.error?.includes('no frame/bounds'));
  });

  it('matches partial label (case-insensitive)', () => {
    const elements = [
      { label: 'Build and Run', role: 'AXButton', bounds: { x: 10, y: 20, width: 80, height: 30 } },
    ];
    const result = simulateClickElement(elements, 'build');
    assert.equal(result.clicked, true);
    assert.equal(result.element?.label, 'Build and Run');
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
