import assert from 'node:assert/strict';
import test from 'node:test';

import THREE from '../../apps/sigil/renderer/vendor/three.min.js';
import state, { syncAvatarAliasesFromGraph } from '../../apps/sigil/renderer/state.js';
import { updateGeometry, updatePrimaryStellation } from '../../apps/sigil/renderer/geometry.js';

globalThis.THREE = THREE;

function configurePrimaryShape({ tesseron = false } = {}) {
  state.polyGroup = new THREE.Group();
  state.__sigilGeometryStats = {
    primaryFullRebuilds: 0,
    primaryStellationUpdates: 0,
    primaryStellationSuppressed: 0,
    omegaFullRebuilds: 0,
  };
  state.avatar.shape.type = 20;
  state.avatar.shape.stellationFactor = 0;
  state.avatar.shape.tesseron = { enabled: tesseron, proportion: 0.5, matchMother: true, child: {} };
  state.avatar.appearance.opacity = 0.45;
  state.avatar.appearance.edgeOpacity = 1;
  state.avatar.appearance.interiorEdges = false;
  state.avatar.appearance.maskEnabled = false;
  state.avatar.appearance.specular = true;
  state.avatar.appearance.skin = 'none';
  state.avatar.appearance.colors = {
    ...state.avatar.appearance.colors,
    face: ['#8cf8ff', '#ff6b9d'],
    edge: ['#ffffff', '#8cf8ff'],
  };
  syncAvatarAliasesFromGraph(state);
}

test('primary stellation edits reuse the existing shape hierarchy', () => {
  configurePrimaryShape();
  updateGeometry(20);

  const stats = state.__sigilGeometryStats;
  const depthMesh = state.depthMesh;
  const coreMesh = state.coreMesh;
  const wireframeMesh = state.wireframeMesh;
  const coreMaterial = coreMesh.material;
  const wireMaterial = wireframeMesh.material;
  const initialFullRebuilds = stats.primaryFullRebuilds;

  state.avatar.shape.stellationFactor = 0.5;
  const first = updatePrimaryStellation(0.5);
  const firstCoreGeometry = state.coreMesh.geometry;

  state.avatar.shape.stellationFactor = 1.25;
  const second = updatePrimaryStellation(1.25);

  assert.deepEqual(first, { updated: true, suppressed: false });
  assert.deepEqual(second, { updated: true, suppressed: false });
  assert.equal(state.depthMesh, depthMesh);
  assert.equal(state.coreMesh, coreMesh);
  assert.equal(state.wireframeMesh, wireframeMesh);
  assert.equal(state.coreMesh.material, coreMaterial);
  assert.equal(state.wireframeMesh.material, wireMaterial);
  assert.notEqual(state.coreMesh.geometry, firstCoreGeometry);
  assert.equal(stats.primaryFullRebuilds, initialFullRebuilds);
  assert.equal(stats.primaryStellationUpdates, 2);
  assert.doesNotThrow(() => JSON.stringify(state.avatar));
});

test('primary tesseron suppresses stellation geometry updates without erasing state', () => {
  configurePrimaryShape({ tesseron: true });
  state.avatar.shape.stellationFactor = 1.1;
  updateGeometry(20);

  const stats = state.__sigilGeometryStats;
  const coreGeometry = state.coreMesh.geometry;
  const childCoreMesh = state.tesseronChildCoreMesh;
  const initialFullRebuilds = stats.primaryFullRebuilds;

  state.avatar.shape.stellationFactor = 1.8;
  const result = updatePrimaryStellation(1.8);

  assert.deepEqual(result, { updated: false, suppressed: true });
  assert.equal(state.avatar.shape.stellationFactor, 1.8);
  assert.equal(state.coreMesh.geometry, coreGeometry);
  assert.equal(state.tesseronChildCoreMesh, childCoreMesh);
  assert.equal(stats.primaryFullRebuilds, initialFullRebuilds);
  assert.equal(stats.primaryStellationSuppressed, 1);
  assert.doesNotThrow(() => JSON.stringify(state.avatar));
});
