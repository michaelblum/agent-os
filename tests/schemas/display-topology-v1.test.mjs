import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const schema = JSON.parse(await fs.readFile(
  new URL('../../shared/schemas/display-topology-v1.schema.json', import.meta.url),
  'utf8',
));
const uuidFixture = JSON.parse(await fs.readFile(
  new URL('../../shared/schemas/fixtures/display-topology-v1/valid/uuid-members.json', import.meta.url),
  'utf8',
));
const fallbackFixture = JSON.parse(await fs.readFile(
  new URL('../../shared/schemas/fixtures/display-topology-v1/valid/fallback-member.json', import.meta.url),
  'utf8',
));

test('display topology schema and all nested records are closed', () => {
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.schema.const, 'aos.display-topology.v1');
  assert.equal(schema.properties.identity.pattern, '^sha256:[0-9a-f]{64}$');
  for (const name of ['Point', 'Bounds', 'PositiveBounds', 'Display']) {
    assert.equal(schema.$defs[name].additionalProperties, false, name);
  }
  for (const variant of schema.$defs.MemberIdentity.oneOf) {
    assert.equal(variant.additionalProperties, false);
  }
});

test('fixtures pin lowercase UUID and explicit fallback member identities', () => {
  assert.match(uuidFixture.identity, /^sha256:[0-9a-f]{64}$/);
  assert.equal(uuidFixture.uses_display_id_fallback, false);
  assert.deepEqual(uuidFixture.displays.map((display) => display.ordinal), [1, 2]);
  assert.equal(uuidFixture.displays[0].is_main, true);
  assert.match(
    uuidFixture.displays[0].member_identity.display_uuid,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );

  assert.match(fallbackFixture.identity, /^sha256:[0-9a-f]{64}$/);
  assert.equal(fallbackFixture.uses_display_id_fallback, true);
  assert.deepEqual(fallbackFixture.displays[1].member_identity, {
    kind: 'display_id_fallback',
    display_id_fallback: 202,
  });
});

test('public topology contains every native and DesktopWorld aggregate and member mapping', () => {
  const topRequired = new Set(schema.required);
  for (const field of [
    'desktop_world_origin_native',
    'native_bounds',
    'native_visible_bounds',
    'desktop_world_bounds',
    'visible_desktop_world_bounds',
  ]) {
    assert.ok(topRequired.has(field), field);
  }
  const displayRequired = new Set(schema.$defs.Display.required);
  for (const field of [
    'ordinal',
    'is_main',
    'member_identity',
    'native_bounds',
    'native_visible_bounds',
    'desktop_world_bounds',
    'visible_desktop_world_bounds',
    'scale_factor',
    'rotation',
  ]) {
    assert.ok(displayRequired.has(field), field);
  }
});
