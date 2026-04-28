import assert from 'node:assert/strict';
import test from 'node:test';

import THREE from '../../apps/sigil/renderer/vendor/three.min.js';
import {
  TESSERON_MIN_PROPORTION,
  clampTesseronProportion,
  createTesseronBridgeGeometry,
  createTesseronDepthGeometry,
  createTesseronLinkGeometry,
  normalizePolyhedronType,
  normalizeTesseronConfig,
  uniqueGeometryVertices,
} from '../../apps/sigil/renderer/tesseron.js';

globalThis.THREE = THREE;

test('Tesseron clamps child proportion away from invisible geometry', () => {
  assert.equal(clampTesseronProportion(0.01), TESSERON_MIN_PROPORTION);
  assert.equal(clampTesseronProportion(0.5), 0.5);
  assert.equal(clampTesseronProportion(2), 0.9);
});

test('Tesseron preserves legacy tesseract shape as box plus modifier', () => {
  assert.equal(normalizePolyhedronType(94), 6);
});

test('Tesseron link geometry connects corresponding unique vertices', () => {
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const vertices = uniqueGeometryVertices(cube);
  const links = createTesseronLinkGeometry(cube, 0.5);

  assert.equal(vertices.length, 8);
  assert.equal(links.getAttribute('position').count, 16);
});

test('Tesseron depth geometry includes bridge faces for depth-tested links', () => {
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const bridge = createTesseronBridgeGeometry(cube, 0.5);
  const depth = createTesseronDepthGeometry(cube, 0.5);

  assert.equal(bridge.getAttribute('position').count, 72);
  assert.ok(depth.getAttribute('position').count > cube.getAttribute('position').count);
});

test('Tesseron config keeps child form values while matching mother by default', () => {
  const normalized = normalizeTesseronConfig({
    enabled: true,
    proportion: 0.02,
    child: { opacity: 0.3 },
  });

  assert.equal(normalized.enabled, true);
  assert.equal(normalized.matchMother, true);
  assert.equal(normalized.proportion, TESSERON_MIN_PROPORTION);
  assert.equal(normalized.child.opacity, 0.3);
});

test('Tesseron build suppresses stellation without erasing the stored value', async () => {
  const { default: state } = await import('../../apps/sigil/renderer/state.js');
  const { updateGeometry, updateInnerEdgePulse } = await import('../../apps/sigil/renderer/geometry.js');

  state.polyGroup = new THREE.Group();
  state.currentGeometryType = 4;
  state.stellationFactor = 1.2;
  state.tesseron = { enabled: true, proportion: 0.5, matchMother: true, child: {} };
  state.currentOpacity = 0.25;
  state.currentEdgeOpacity = 1;
  state.isInteriorEdgesEnabled = false;
  state.isMaskEnabled = true;
  state.isSpecularEnabled = true;
  state.currentSkin = 'none';
  state.colors = {
    ...state.colors,
    face: ['#bc13fe', '#4a2b6e'],
    edge: ['#bc13fe', '#4a2b6e'],
  };

  updateGeometry(4);

  assert.equal(state.stellationFactor, 1.2);
  assert.ok(state.tesseronChildCoreMesh);
  assert.ok(state.tesseronChildWireframeMesh);
  assert.ok(state.innerWireframeMesh);
  assert.equal(state.innerWireframeMesh.visible, true);
  assert.equal(state.innerWireframeMesh.material.linewidth, state.wireframeMesh.material.linewidth);
  assert.equal(state.innerWireframeMesh.material.depthTest, true);
  assert.equal(state.innerWireframeMesh.material.depthWrite, false);
  assert.equal(state.innerWireframeMesh.material.opacity, state.wireframeMesh.material.opacity);

  updateInnerEdgePulse(false);

  assert.equal(state.innerWireframeMesh.visible, true);
  assert.equal(state.innerWireframeMesh.material.opacity, state.wireframeMesh.material.opacity);
  assert.equal(state.innerWireframeMesh.scale.x, 1);
  assert.equal(state.innerWireframeMesh.material.color.getHex(), state.wireframeMesh.material.color.getHex());
});
