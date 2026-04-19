import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const schema = JSON.parse(
  await fs.readFile(new URL('../../shared/schemas/spatial-topology.schema.json', import.meta.url), 'utf8'),
);

test('Display typedef carries both native and DesktopWorld bounds', () => {
  const display = schema.$defs?.Display;
  assert.ok(display, 'expected $defs.Display');
  const props = display.properties || {};
  assert.ok(props.native_bounds, 'expected native_bounds property');
  assert.ok(props.native_visible_bounds, 'expected native_visible_bounds property');
  assert.ok(props.desktop_world_bounds, 'expected desktop_world_bounds property');
  assert.ok(props.visible_desktop_world_bounds, 'expected visible_desktop_world_bounds property');
  const required = new Set(display.required || []);
  for (const key of ['native_bounds', 'native_visible_bounds', 'desktop_world_bounds', 'visible_desktop_world_bounds']) {
    assert.ok(required.has(key), `expected Display.required to include ${key}`);
  }
});

test('top-level defines desktop_world_bounds + visible_desktop_world_bounds', () => {
  const props = schema.properties || {};
  assert.ok(props.desktop_world_bounds, 'expected top-level desktop_world_bounds');
  assert.ok(props.visible_desktop_world_bounds, 'expected top-level visible_desktop_world_bounds');
  const required = new Set(schema.required || []);
  assert.ok(required.has('desktop_world_bounds'), 'top-level required must include desktop_world_bounds');
  assert.ok(required.has('visible_desktop_world_bounds'), 'top-level required must include visible_desktop_world_bounds');
});

test('Cursor typedef carries DesktopWorld siblings', () => {
  const cursor = schema.$defs?.Cursor;
  assert.ok(cursor, 'expected $defs.Cursor');
  const props = cursor.properties || {};
  assert.ok(props.desktop_world_x, 'expected desktop_world_x sibling');
  assert.ok(props.desktop_world_y, 'expected desktop_world_y sibling');
  const required = new Set(cursor.required || []);
  assert.ok(required.has('desktop_world_x'), 'Cursor.required must include desktop_world_x');
  assert.ok(required.has('desktop_world_y'), 'Cursor.required must include desktop_world_y');
});

test('NativeBounds and DesktopWorldBounds typedefs are defined', () => {
  assert.ok(schema.$defs?.NativeBounds, 'expected $defs.NativeBounds');
  assert.ok(schema.$defs?.DesktopWorldBounds, 'expected $defs.DesktopWorldBounds');
});
