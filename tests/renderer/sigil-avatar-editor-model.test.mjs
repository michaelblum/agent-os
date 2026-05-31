import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSigilAvatarEditorModel,
  classifySigilAvatarControlSurfaceDescriptors,
  getSigilAvatarEditorControl,
  SIGIL_AVATAR_CHILD_OBJECT_IDS,
  SIGIL_AVATAR_GEOMETRY_OPTIONS,
  SIGIL_AVATAR_SUBJECT_ID,
  SIGIL_AVATAR_SUBJECT_TYPE,
} from '../../apps/sigil/avatar-editor/model.js';
import rendererState from '../../apps/sigil/renderer/state.js';

function avatarState(overrides = {}) {
  const avatar = {
    shape: {
      type: 12,
      size: { base: 153, min: 40, max: 400 },
      tesseron: { enabled: false, proportion: 0.5, matchMother: true },
      stellationFactor: 0.25,
      params: {
        tetartoid: { a: 0.8, b: 1.2, c: 1.6 },
        torus: { radius: 1.1, tube: 0.25, arc: 0.75 },
        cylinder: { topRadius: 0.4, bottomRadius: 1.3, height: 2.4, sides: 9 },
        box: { width: 1.4, height: 0.8, depth: 2.1 },
      },
    },
    appearance: {
      opacity: 0.8,
      edgeOpacity: 0.6,
      interiorEdges: false,
      specular: true,
      colors: {
        face: ['#112233', '#445566'],
        edge: ['#ffffff', '#88ccff'],
        aura: ['#4488ff', '#0044aa'],
        lightning: ['#ffffff', '#00ffff'],
        magnetic: ['#4488ff', '#0044aa'],
        grid: ['#224488', '#001133'],
      },
    },
    effects: {
      aura: { reach: 1.4, intensity: 1.2 },
      phenomena: {
        pulsar: { enabled: false },
        accretion: { enabled: false },
        gamma: { enabled: true },
        neutrino: { enabled: false },
      },
      lightning: { enabled: true },
      magnetic: { enabled: true },
      trail: { enabled: true, length: 12, opacity: 0.45, fadeMs: 800, style: 'omega' },
      omega: {
        enabled: true,
        shape: {
          type: 8,
          tesseron: { enabled: false, proportion: 0.45, matchMother: true },
          stellationFactor: 0.1,
        },
        scale: 1.75,
        counterSpin: true,
        lockPosition: false,
      },
    },
  };
  return {
    avatar,
    currentGeometryType: 12,
    currentType: 12,
    avatarBase: 153,
    tesseron: {
      enabled: false,
      proportion: 0.5,
      matchMother: true,
    },
    stellationFactor: 0.25,
    currentOpacity: 0.8,
    currentEdgeOpacity: 0.6,
    isInteriorEdgesEnabled: false,
    isSpecularEnabled: true,
    tetartoidA: 0.8,
    tetartoidB: 1.2,
    tetartoidC: 1.6,
    torusRadius: 1.1,
    torusTube: 0.25,
    torusArc: 0.75,
    cylinderTopRadius: 0.4,
    cylinderBottomRadius: 1.3,
    cylinderHeight: 2.4,
    cylinderSides: 9,
    boxWidth: 1.4,
    boxHeight: 0.8,
    boxDepth: 2.1,
    isOmegaEnabled: true,
    omegaGeometryType: 8,
    omegaType: 8,
    omegaTesseron: {
      enabled: false,
      proportion: 0.45,
      matchMother: true,
    },
    omegaStellationFactor: 0.1,
    omegaScale: 1.75,
    omegaCounterSpin: true,
    omegaLockPosition: false,
    auraReach: 1.4,
    auraIntensity: 1.2,
    isPulsarEnabled: false,
    isAccretionEnabled: false,
    isGammaEnabled: true,
    isNeutrinosEnabled: false,
    isLightningEnabled: true,
    isMagneticEnabled: true,
    isTrailEnabled: true,
    trailLength: 12,
    trailOpacity: 0.45,
    trailFadeMs: 800,
    trailStyle: 'omega',
    transitionFastTravelEffect: 'line',
    fastTravelLineInterDimensional: true,
    fastTravelLineDuration: 0.22,
    fastTravelLineDelay: 0,
    fastTravelLineRepeatCount: 10,
    fastTravelLineRepeatDuration: 2,
    fastTravelLineLag: 0.05,
    fastTravelLineScale: 1.5,
    fastTravelLineTrailMode: 'fade',
    colors: {
      face: ['#112233', '#445566'],
      edge: ['#ffffff', '#88ccff'],
      aura: ['#4488ff', '#0044aa'],
      lightning: ['#ffffff', '#00ffff'],
      magnetic: ['#4488ff', '#0044aa'],
      grid: ['#224488', '#001133'],
    },
    ...overrides,
  };
}

test('classifies every compact surface descriptor as canonical avatar editing or projection-only', () => {
  const classification = classifySigilAvatarControlSurfaceDescriptors();

  assert.equal(classification.unmapped.length, 0);
  assert.ok(classification.canonical.includes('sigil-menu-shape-select'));
  assert.ok(classification.canonical.includes('sigil-menu-omega-shape'));
  assert.ok(classification.canonical.includes('sigil-menu-lightning'));
  assert.ok(classification.canonical.includes('sigil-menu-magnetic'));
  assert.ok(classification.projection_only.includes('toggle-inspector'));
  assert.ok(classification.projection_only.includes('toggle-trace'));
  assert.ok(classification.projection_only.includes('toggle-render-performance'));
  assert.ok(classification.projection_only.includes('toggle-log'));
  assert.ok(classification.projection_only.includes('copy'));
  assert.ok(classification.projection_only.includes('save'));
  assert.ok(classification.projection_only.includes('import'));
  assert.ok(classification.projection_only.includes('sigil-menu-grid-mode'));
  assert.ok(classification.projection_only.includes('sigil-menu-avatar-above-menu'));
});

test('renderer state exposes a canonical JSON-serializable avatar graph', () => {
  const serialized = JSON.stringify(rendererState.avatar);
  const parsed = JSON.parse(serialized);

  assert.equal(parsed.shape.type, 12);
  assert.equal(parsed.appearance.skin, 'none');
  assert.equal(parsed.effects.lightning.enabled, false);
  assert.equal(parsed.transform.scale, 1);
});

test('buildSigilAvatarEditorModel exposes stable subject, child objects, groups, and routed controls', () => {
  const model = buildSigilAvatarEditorModel(avatarState());
  const groups = new Map(model.groups.map((group) => [group.key, group]));

  assert.equal(model.subject_id, SIGIL_AVATAR_SUBJECT_ID);
  assert.equal(model.subject_type, SIGIL_AVATAR_SUBJECT_TYPE);
  assert.equal(model.object_ids.primaryShape, SIGIL_AVATAR_CHILD_OBJECT_IDS.primaryShape);
  assert.equal(model.object_ids.omegaShape, SIGIL_AVATAR_CHILD_OBJECT_IDS.omegaShape);
  assert.equal(model.object_ids.lightning, SIGIL_AVATAR_CHILD_OBJECT_IDS.lightning);
  assert.equal(model.object_ids.magnetic, SIGIL_AVATAR_CHILD_OBJECT_IDS.magnetic);
  assert.equal(model.object_graph.kind, 'sigil.avatar.object_graph');
  assert.equal(model.object_graph.root_object_id, SIGIL_AVATAR_CHILD_OBJECT_IDS.root);
  assert.equal(model.object_graph.node_ids.primaryShape, SIGIL_AVATAR_CHILD_OBJECT_IDS.primaryShape);
  assert.ok(model.contracts.includes('sigil.avatar.object_graph.read'));
  assert.ok(model.object_graph.edges.some((edge) => edge.from === SIGIL_AVATAR_CHILD_OBJECT_IDS.root
    && edge.to === SIGIL_AVATAR_CHILD_OBJECT_IDS.lightning
    && edge.relationship === 'owns_effect_node'));
  assert.equal(model.metadata.canonical_model, 'sigil.avatar.object_graph');
  assert.equal(model.surface_layouts.compact_control_surface.invocation, 'avatar_right_click');
  assert.equal(model.surface_layouts.compact_control_surface.layout, 'tabs');
  assert.equal(model.surface_layouts.compact_control_surface.source, 'sigil.avatar.object_graph');
  assert.ok(model.surface_layouts.compact_control_surface.toolkit_primitives.includes('slider'));
  assert.equal(model.surface_layouts.compact_control_surface.toolkit_primitives.includes('range'), false);
  assert.deepEqual(
    model.surface_layouts.compact_control_surface.tabs.map((tab) => tab.key),
    ['alpha', 'omega', 'effects', 'travel'],
  );
  assert.ok(model.surface_layouts.compact_control_surface.tabs
    .find((tab) => tab.key === 'alpha')
    .groups.some((group) => group.group_key === 'primary-polyhedron'));
  assert.ok(model.surface_layouts.compact_control_surface.tabs
    .find((tab) => tab.key === 'effects')
    .object_ids.includes(SIGIL_AVATAR_CHILD_OBJECT_IDS.lightning));
  assert.equal(model.surface_layouts.wiki_browser_object_graph.layout, 'object_graph_drilldown');
  assert.equal(model.surface_layouts.wiki_browser_object_graph.root_object_id, SIGIL_AVATAR_CHILD_OBJECT_IDS.root);
  assert.deepEqual(
    [...groups.keys()],
    [
      'avatar-root',
      'primary-polyhedron',
      'omega-polyhedron',
      'appearance-materials',
      'aura-effects',
      'phenomena-effects',
      'lightning-effects',
      'magnetic-effects',
      'path-trail-effects',
      'fast-travel-visuals',
    ],
  );

  const alphaGeometry = getSigilAvatarEditorControl(model, 'sigil-menu-shape-select');
  assert.equal(alphaGeometry.state_path, 'avatar.shape.type');
  assert.equal(alphaGeometry.value, 12);
  assert.equal(alphaGeometry.route, 'canvas_object.transform.patch');
  assert.equal(alphaGeometry.object_ids[0], SIGIL_AVATAR_CHILD_OBJECT_IDS.primaryShape);
  assert.deepEqual(alphaGeometry.options, SIGIL_AVATAR_GEOMETRY_OPTIONS.map((option) => ({ ...option })));
  assert.ok(alphaGeometry.options.some((option) => option.value === 6 && option.label === 'Box'));

  const prismSides = getSigilAvatarEditorControl(model, 'sigil-menu-prism-sides');
  assert.equal(prismSides.kind ?? prismSides.type, 'slider');
  assert.equal(prismSides.state_path, 'avatar.shape.params.cylinder.sides');
  assert.equal(prismSides.value, 9);
  assert.equal(prismSides.min, 3);
  assert.equal(prismSides.max, 64);
  assert.equal(prismSides.step, 1);
  assert.deepEqual(prismSides.visible_when, { field: alphaGeometry.id, equals: 93 });
  assert.deepEqual(prismSides.renderer_sync, ['updateGeometry', 'updateOmegaGeometry']);

  const tetartoidA = getSigilAvatarEditorControl(model, 'sigil-menu-tetartoid-a');
  assert.equal(tetartoidA.state_path, 'avatar.shape.params.tetartoid.a');
  assert.equal(tetartoidA.value, 0.8);
  assert.deepEqual(tetartoidA.visible_when, { field: alphaGeometry.id, equals: 90 });

  const omegaGeometry = getSigilAvatarEditorControl(model, 'sigil-menu-omega-shape');
  assert.equal(omegaGeometry.state_path, 'avatar.effects.omega.shape.type');
  assert.equal(omegaGeometry.value, 8);
  assert.equal(omegaGeometry.object_ids[0], SIGIL_AVATAR_CHILD_OBJECT_IDS.omegaShape);
  const omegaTorusTube = getSigilAvatarEditorControl(model, 'sigil-menu-omega-torus-tube');
  assert.equal(omegaTorusTube.state_path, 'avatar.shape.params.torus.tube');
  assert.equal(omegaTorusTube.value, 0.25);
  assert.deepEqual(omegaTorusTube.visible_when, { field: omegaGeometry.id, equals: 92 });

  const lightning = getSigilAvatarEditorControl(model, 'sigil-menu-lightning');
  assert.equal(lightning.group_key, 'lightning-effects');
  assert.equal(lightning.object_ids[0], SIGIL_AVATAR_CHILD_OBJECT_IDS.lightning);

  const magnetic = getSigilAvatarEditorControl(model, 'sigil-menu-magnetic');
  assert.equal(magnetic.group_key, 'magnetic-effects');
  assert.equal(magnetic.object_ids[0], SIGIL_AVATAR_CHILD_OBJECT_IDS.magnetic);

  const lightningColor = getSigilAvatarEditorControl(model, 'sigil-menu-lightning1');
  assert.equal(lightningColor.group_key, 'appearance-materials');
  assert.ok(lightningColor.object_ids.includes(SIGIL_AVATAR_CHILD_OBJECT_IDS.lightning));
  assert.ok(lightningColor.object_ids.includes(SIGIL_AVATAR_CHILD_OBJECT_IDS.magnetic));
});

test('compact control surface projection keeps shortcuts out of canonical avatar editor controls', () => {
  const model = buildSigilAvatarEditorModel(avatarState());
  const canonicalIds = new Set(model.controls.flatMap((control) => control.compatibility_ids));
  const projection = model.projection.compact_control_surface;
  const projectionIds = projection.projection_only_controls.map((control) => control.id);

  assert.equal(projection.role, 'compact-tabbed-control-surface-projection');
  assert.equal(projection.themed_surface, 'sigil.avatar-control-surface');
  assert.equal(projection.surface_layout.kind, 'sigil.avatar.compact_tabbed_control_surface');
  assert.deepEqual(projection.surface_layout.tabs.map((tab) => tab.key), ['alpha', 'omega', 'effects', 'travel']);

  for (const id of [
    'toggle-inspector',
    'toggle-trace',
    'toggle-render-performance',
    'toggle-log',
    'copy',
    'save',
    'import',
    'sigil-menu-grid-mode',
    'sigil-menu-avatar-above-menu',
  ]) {
    assert.equal(canonicalIds.has(id), false, id);
    assert.ok(projectionIds.includes(id), id);
  }
});
