import assert from 'node:assert/strict';
import test from 'node:test';
import default3d from '../../packages/toolkit/runtime/radial-menu/default-3d.json' with { type: 'json' };
import { resolveRadialMenuConfig } from '../../packages/toolkit/runtime/radial-menu-config.js';
import {
  createRadialMenuVisualObjectDescriptors,
  createRadialMenuWorkbenchSubject,
  radialMenuEntryHandle,
  radialMenuLogicalItems,
  radialMenuResourceEntryHandle,
  radialMenuResourceSubjectId,
  RADIAL_MENU_SUBJECT_TYPE,
} from '../../packages/toolkit/workbench/radial-menu-subject.js';
import {
  subjectContracts,
  subjectFacets,
} from '../../packages/toolkit/workbench/subject.js';
import { validateVisualObjectDescriptors } from '../../packages/toolkit/workbench/visual-object-contract.js';

function exampleMenu() {
  return resolveRadialMenuConfig({
    kind: 'aos.radial_menu_3d',
    schema_version: '2026-05-16',
    id: 'example.radial.main',
    label: 'Example Radial Menu',
    extends: 'aos://toolkit/runtime/radial-menu/default-3d.json',
    items: [
      {
        id: 'inspect',
        label: 'Inspect',
        action: 'inspect',
        geometry: {
          type: 'glyph',
          glyph: 'inspect',
          radiusScale: 1,
        },
      },
      {
        id: 'open',
        label: 'Open',
        action: 'open',
        geometry: {
          type: 'glyph',
          glyph: 'open',
          radiusScale: 1.1,
        },
      },
    ],
  }, {
    allowExtends: {
      'aos://toolkit/runtime/radial-menu/default-3d.json': default3d,
    },
  });
}

test('radial menu workbench subject exposes generic facets and logical items', () => {
  const menu = exampleMenu();
  const subject = createRadialMenuWorkbenchSubject({
    menu,
    owner: 'fixture.radial-editor',
    canvasId: 'preview',
    selectedItemId: 'inspect',
  });

  assert.equal(subject.subject_type, RADIAL_MENU_SUBJECT_TYPE);
  assert.equal(subject.id, 'aos.radial_menu:example.radial.main');
  assert.equal(subject.owner, 'fixture.radial-editor');
  assert.equal(subject.state.selected_item_id, 'inspect');
  assert.deepEqual(radialMenuLogicalItems(menu).map((item) => item.id), ['inspect', 'open']);
  assert.ok(subjectContracts(subject).includes('aos.radial_menu.logical_items'));
  assert.deepEqual(subjectFacets(subject).map((facet) => facet.key), [
    'menu-overview',
    'menu-config',
    'item-config',
    'source-notes',
    'radial-preview',
    'object-registry',
    'object-controls',
    'animation-controls',
    'export-lock-in',
  ]);
});

test('radial menu descriptors and entry handles remain generic and serializable', () => {
  const descriptors = createRadialMenuVisualObjectDescriptors({
    menu: exampleMenu(),
    selectedItemId: 'inspect',
  });
  assert.equal(validateVisualObjectDescriptors(JSON.parse(JSON.stringify(descriptors))).ok, true);
  assert.ok(descriptors.every((descriptor) => !JSON.stringify(descriptor).includes('sigil')));

  const subjectId = radialMenuResourceSubjectId('example.radial.main', 'item/inspect');
  assert.equal(radialMenuEntryHandle('example.radial.main', 'object-controls'), 'object-controls:aos.radial_menu:example.radial.main');
  assert.equal(radialMenuResourceEntryHandle('example.radial.main', 'item/inspect', 'object-controls'), `object-controls:${subjectId}`);
});
