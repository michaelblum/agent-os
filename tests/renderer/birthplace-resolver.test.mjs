import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBirthplace } from '../../apps/sigil/renderer/birthplace-resolver.js';

const mainDisplay = {
  uuid: 'main-uuid',
  is_main: true,
  visible_bounds: { x: 0, y: 0, w: 1000, h: 800 },
};
const extDisplay = {
  uuid: 'ext-uuid',
  is_main: false,
  visible_bounds: { x: -1920, y: 0, w: 1920, h: 1080 },
};

test('anchor=coords returns the coords verbatim', () => {
  const out = resolveBirthplace(
    { anchor: 'coords', coords: { x: 123, y: 456 } },
    [mainDisplay]
  );
  assert.deepEqual(out, { x: 123, y: 456 });
});

test('anchor=nonant bottom-right on main display', () => {
  const out = resolveBirthplace(
    { anchor: 'nonant', nonant: 'bottom-right', display: 'main' },
    [mainDisplay]
  );
  // 5/6 of (0..1000) = 833.33..; 5/6 of (0..800) = 666.66..
  assert.ok(Math.abs(out.x - 1000 * 5/6) < 0.01);
  assert.ok(Math.abs(out.y - 800 * 5/6) < 0.01);
});

test('anchor=nonant middle-center on external display (negative origin)', () => {
  const out = resolveBirthplace(
    { anchor: 'nonant', nonant: 'middle-center', display: 'ext-uuid' },
    [mainDisplay, extDisplay]
  );
  // center of (-1920..0, 0..1080) → (-960, 540)
  assert.ok(Math.abs(out.x - (-960)) < 0.01);
  assert.ok(Math.abs(out.y - 540) < 0.01);
});

test('unknown display UUID falls back to main', () => {
  const out = resolveBirthplace(
    { anchor: 'nonant', nonant: 'top-left', display: 'bogus-uuid' },
    [mainDisplay]
  );
  assert.ok(Math.abs(out.x - 1000 * 1/6) < 0.01);
  assert.ok(Math.abs(out.y - 800 * 1/6) < 0.01);
});

test('unknown nonant cell falls back to bottom-right', () => {
  const out = resolveBirthplace(
    { anchor: 'nonant', nonant: 'nonsense', display: 'main' },
    [mainDisplay]
  );
  assert.ok(Math.abs(out.x - 1000 * 5/6) < 0.01);
  assert.ok(Math.abs(out.y - 800 * 5/6) < 0.01);
});

test('empty displays array returns {0, 0}', () => {
  const out = resolveBirthplace(
    { anchor: 'nonant', nonant: 'top-left', display: 'main' },
    []
  );
  assert.deepEqual(out, { x: 0, y: 0 });
});

test('missing nonant field defaults to bottom-right', () => {
  const out = resolveBirthplace(
    { anchor: 'nonant', display: 'main' },
    [mainDisplay]
  );
  assert.ok(Math.abs(out.x - 1000 * 5/6) < 0.01);
});
