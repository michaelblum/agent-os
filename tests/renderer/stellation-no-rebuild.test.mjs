import assert from 'node:assert/strict';
import test from 'node:test';
import * as v8 from 'node:v8';

import THREE from '../../apps/sigil/renderer/vendor/three.min.js';
import state, { syncAvatarAliasesFromGraph } from '../../apps/sigil/renderer/state.js';
import { analyzePrimaryStellationTopologyFeasibility, updateGeometry, updatePrimaryAppearance, updatePrimaryStellation, updatePrimaryTesseronProportion } from '../../apps/sigil/renderer/geometry.js';
import {
  createVisualObjectResourceLifecycleEvidence,
  validateVisualObjectResourceLifecycleEvidence,
} from '../../packages/toolkit/workbench/visual-object-resource-lifecycle.js';

globalThis.THREE = THREE;

function configurePrimaryShape({ tesseron = false } = {}) {
  state.polyGroup = new THREE.Group();
  state.__sigilGeometryStats = {
    primaryFullRebuilds: 0,
    primaryStellationUpdates: 0,
    primaryStellationSuppressed: 0,
    primaryStellationReplacementGeometriesCreated: 0,
    primaryStellationReplacementGeometriesDisposed: 0,
    primaryStellationTemporaryGeometriesCreated: 0,
    primaryStellationTemporaryGeometriesDisposed: 0,
    primaryStellationRetainedGeometries: 0,
    primaryStellationMaxRetainedGeometries: 0,
    primaryAppearanceUpdates: 0,
    primaryAppearanceSuppressed: 0,
    primaryAppearanceMaterialsMutated: 0,
    primaryTesseronProportionUpdates: 0,
    primaryTesseronProportionSuppressed: 0,
    primaryTesseronProportionTemporaryGeometriesCreated: 0,
    primaryTesseronProportionTemporaryGeometriesDisposed: 0,
    primaryTesseronProportionRetainedGeometries: 0,
    primaryTesseronProportionMaxRetainedGeometries: 0,
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

function hasFinitePositions(geometry) {
  const attribute = geometry?.getAttribute?.('position');
  if (!attribute?.array?.length) return false;
  for (const value of attribute.array) {
    if (!Number.isFinite(value)) return false;
  }
  return true;
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
  const firstWireGeometry = state.wireframeMesh.geometry;

  state.avatar.shape.stellationFactor = 1.25;
  const second = updatePrimaryStellation(1.25);

  assert.equal(first.updated, true);
  assert.equal(first.suppressed, false);
  assert.equal(second.updated, true);
  assert.equal(second.suppressed, false);
  assert.equal(second.gpuPath, 'morph-target');
  assert.equal(state.depthMesh, depthMesh);
  assert.equal(state.coreMesh, coreMesh);
  assert.equal(state.wireframeMesh, wireframeMesh);
  assert.equal(state.coreMesh.material, coreMaterial);
  assert.equal(state.wireframeMesh.material, wireMaterial);
  assert.equal(state.coreMesh.geometry, firstCoreGeometry);
  assert.equal(state.wireframeMesh.geometry, firstWireGeometry);
  assert.equal(stats.primaryFullRebuilds, initialFullRebuilds);
  assert.equal(stats.primaryStellationUpdates, 2);
  assert.doesNotThrow(() => JSON.stringify(state.avatar));
});

test('primary stellation topology feasibility exposes the positive-factor morph subset', () => {
  const supportedTypes = [4, 6, 8, 12, 20, 90, 91, 92, 93, 100];
  for (const type of supportedTypes) {
    const result = analyzePrimaryStellationTopologyFeasibility(type);
    assert.equal(result.positiveFactorTopologyStable, true, `positive topology for ${type}`);
    assert.equal(result.zeroFactorTopologyStable, false, `zero topology split for ${type}`);
    assert.equal(result.safeGpuPath, 'positive-factor-morph-target');
    assert.match(result.blocker, /zero-factor stellation/);
    assert.ok(result.morphVertexCount > result.flatVertexCount);
  }
});

test('long primary stellation-only edit session keeps renderer resources bounded', () => {
  configurePrimaryShape();
  updateGeometry(20);

  const stats = state.__sigilGeometryStats;
  const depthMesh = state.depthMesh;
  const coreMesh = state.coreMesh;
  const wireframeMesh = state.wireframeMesh;
  const depthGeometry = depthMesh.geometry;
  const coreGeometry = coreMesh.geometry;
  const wireGeometry = wireframeMesh.geometry;
  const depthMaterial = depthMesh.material;
  const coreMaterial = coreMesh.material;
  const wireMaterial = wireframeMesh.material;
  const initialFullRebuilds = stats.primaryFullRebuilds;

  const editCount = 1_000;
  const proofStartedAt = performance.now();
  const profilerBefore = process.memoryUsage();
  let profilerPeak = profilerBefore.heapUsed;
  let profilerSamples = 0;
  for (let index = 0; index < editCount; index += 1) {
    const value = ((index % 25) + 1) / 20;
    state.avatar.shape.stellationFactor = value;
    const result = updatePrimaryStellation(value);
    if (index % 50 === 0) {
      const sample = process.memoryUsage();
      profilerPeak = Math.max(profilerPeak, sample.heapUsed);
      profilerSamples += 1;
    }

    assert.equal(result.updated, true);
    assert.equal(result.suppressed, false);
    assert.equal(result.gpuPath, 'morph-target');
    assert.equal(state.depthMesh, depthMesh);
    assert.equal(state.coreMesh, coreMesh);
    assert.equal(state.wireframeMesh, wireframeMesh);
    assert.equal(state.depthMesh.geometry, depthGeometry);
    assert.equal(state.coreMesh.geometry, coreGeometry);
    assert.equal(state.wireframeMesh.geometry, wireGeometry);
    assert.equal(state.depthMesh.material, depthMaterial);
    assert.equal(state.coreMesh.material, coreMaterial);
    assert.equal(state.wireframeMesh.material, wireMaterial);
    assert.equal(hasFinitePositions(state.depthMesh.geometry), true);
    assert.equal(hasFinitePositions(state.coreMesh.geometry), true);
    assert.equal(hasFinitePositions(state.wireframeMesh.geometry), true);
  }
  const proofDurationMs = performance.now() - proofStartedAt;
  const profilerAfter = process.memoryUsage();

  assert.equal(stats.primaryFullRebuilds, initialFullRebuilds);
  assert.equal(stats.primaryStellationUpdates, editCount);
  assert.equal(stats.primaryStellationSuppressed, 0);
  assert.equal(stats.primaryStellationReplacementGeometriesCreated, 0);
  assert.equal(stats.primaryStellationReplacementGeometriesDisposed, 0);
  assert.equal(stats.primaryStellationTemporaryGeometriesCreated, 4);
  assert.equal(stats.primaryStellationTemporaryGeometriesDisposed, 4);
  assert.equal(stats.primaryStellationRetainedGeometries, 2);
  assert.equal(stats.primaryStellationMaxRetainedGeometries, 2);
  assert.equal(stats.primaryStellationGpuMorphSetups, 1);
  assert.equal(stats.primaryStellationGpuMorphUpdates, editCount);
  assert.equal(state.coreMesh.morphTargetInfluences[0], 1.25);
  assert.equal(state.wireframeMesh.morphTargetInfluences[0], 1.25);
  const evidence = createVisualObjectResourceLifecycleEvidence({
    descriptor: {
      id: 'sigil-avatar-stellation',
      state_path: 'avatar.shape.stellationFactor',
      route: 'canvas_object.transform.patch',
      renderer_sync: ['updatePrimaryStellation'],
    },
    editCount,
    rebuildsBefore: initialFullRebuilds,
    rebuildsAfter: stats.primaryFullRebuilds,
    retainedResources: stats.primaryStellationRetainedGeometries,
    retainedResourceLimit: stats.primaryStellationMaxRetainedGeometries,
    replacementResourcesCreated: stats.primaryStellationReplacementGeometriesCreated,
    replacementResourcesDisposed: stats.primaryStellationReplacementGeometriesDisposed,
    temporaryResourcesCreated: stats.primaryStellationTemporaryGeometriesCreated,
    temporaryResourcesDisposed: stats.primaryStellationTemporaryGeometriesDisposed,
    finiteDataValid: [state.depthMesh.geometry, state.coreMesh.geometry, state.wireframeMesh.geometry].every(hasFinitePositions),
    proofWindow: {
      kind: 'deterministic_runtime_duration',
      durationMs: proofDurationMs,
      iterationLimit: editCount,
    },
    poolingBoundary: {
      owner: 'sigil-renderer',
      decision: 'renderer-local',
      rationale: 'Primary stellation reuse mutates renderer-owned Three.js buffers and materials in place; no toolkit pool is extracted for Three.js resources.',
    },
    profilerMeasurement: {
      kind: 'deterministic_heap_window',
      source: 'node:process.memoryUsage',
      metric: 'heapUsed',
      windowMs: proofDurationMs,
      sampleCount: profilerSamples + 2,
      available: true,
      before: profilerBefore.heapUsed,
      after: profilerAfter.heapUsed,
      peak: profilerPeak,
      delta: profilerAfter.heapUsed - profilerBefore.heapUsed,
      limit: v8.getHeapStatistics().heap_size_limit,
      within_limit: profilerPeak <= v8.getHeapStatistics().heap_size_limit,
      resource_counts: {
        geometries: stats.primaryStellationRetainedGeometries,
        textures: 0,
        programs: 0,
        draw_calls: 0,
      },
    },
    jsonSerializableState: state.avatar,
  });
  assert.equal(evidence.minimal_update, true);
  assert.equal(evidence.proof_window.kind, 'deterministic_runtime_duration');
  assert.equal(evidence.proof_window.iteration_limit, editCount);
  assert.ok(evidence.proof_window.duration_ms >= 0);
  assert.equal(evidence.profiler_measurement.kind, 'deterministic_heap_window');
  assert.equal(evidence.profiler_measurement.source, 'node:process.memoryUsage');
  assert.equal(evidence.profiler_measurement.resource_counts.geometries, 2);
  assert.equal(validateVisualObjectResourceLifecycleEvidence(evidence).ok, true);
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

test('primary appearance edits mutate materials without rebuilding non-tesseron hierarchy', () => {
  configurePrimaryShape();
  updateGeometry(20);

  const stats = state.__sigilGeometryStats;
  const depthMesh = state.depthMesh;
  const coreMesh = state.coreMesh;
  const wireframeMesh = state.wireframeMesh;
  const depthGeometry = depthMesh.geometry;
  const coreGeometry = coreMesh.geometry;
  const wireGeometry = wireframeMesh.geometry;
  const depthMaterial = depthMesh.material;
  const coreMaterial = coreMesh.material;
  const wireMaterial = wireframeMesh.material;
  const initialFullRebuilds = stats.primaryFullRebuilds;

  state.avatar.appearance.opacity = 0.25;
  state.avatar.appearance.edgeOpacity = 0.2;
  state.avatar.appearance.interiorEdges = true;
  state.avatar.appearance.specular = false;
  syncAvatarAliasesFromGraph(state);
  const result = updatePrimaryAppearance();

  assert.equal(result.updated, true);
  assert.equal(result.rebuilt, false);
  assert.equal(state.depthMesh, depthMesh);
  assert.equal(state.coreMesh, coreMesh);
  assert.equal(state.wireframeMesh, wireframeMesh);
  assert.equal(state.depthMesh.geometry, depthGeometry);
  assert.equal(state.coreMesh.geometry, coreGeometry);
  assert.equal(state.wireframeMesh.geometry, wireGeometry);
  assert.equal(state.depthMesh.material, depthMaterial);
  assert.equal(state.coreMesh.material, coreMaterial);
  assert.equal(state.wireframeMesh.material, wireMaterial);
  assert.equal(state.coreMesh.material.opacity, 0.25);
  assert.equal(state.coreMesh.material.transparent, true);
  assert.equal(state.coreMesh.material.depthWrite, false);
  assert.equal(state.coreMesh.material.shininess, 0);
  assert.equal(state.wireframeMesh.material.opacity, 0.2);
  assert.equal(state.depthMesh.visible, false);
  assert.equal(stats.primaryFullRebuilds, initialFullRebuilds);
  assert.equal(stats.primaryAppearanceUpdates, 1);
  assert.doesNotThrow(() => JSON.stringify(state.avatar));
});

test('primary appearance edits update skin uniforms without replacing skin material', () => {
  configurePrimaryShape();
  state.avatar.appearance.skin = 'rocky';
  syncAvatarAliasesFromGraph(state);
  updateGeometry(20);

  const stats = state.__sigilGeometryStats;
  const coreMesh = state.coreMesh;
  const skinMaterial = coreMesh.material;
  const initialFullRebuilds = stats.primaryFullRebuilds;

  state.avatar.appearance.opacity = 0.55;
  state.avatar.appearance.specular = false;
  syncAvatarAliasesFromGraph(state);
  const result = updatePrimaryAppearance();

  assert.equal(result.updated, true);
  assert.equal(state.coreMesh, coreMesh);
  assert.equal(state.coreMesh.material, skinMaterial);
  assert.equal(skinMaterial.uniforms.uOpacity.value, 0.55);
  assert.equal(skinMaterial.uniforms.uSpecular.value, 0);
  assert.equal(stats.primaryFullRebuilds, initialFullRebuilds);
  assert.doesNotThrow(() => JSON.stringify(state.avatar));
});

test('primary appearance edits preserve tesseron child overrides when child does not match mother', () => {
  configurePrimaryShape({ tesseron: true });
  state.avatar.shape.tesseron = {
    enabled: true,
    proportion: 0.5,
    matchMother: false,
    child: {
      opacity: 0.8,
      edgeOpacity: 0.7,
      maskEnabled: true,
      interiorEdges: true,
      specular: true,
    },
  };
  syncAvatarAliasesFromGraph(state);
  updateGeometry(20);

  const stats = state.__sigilGeometryStats;
  const childDepthMesh = state.tesseronChildDepthMesh;
  const childCoreMesh = state.tesseronChildCoreMesh;
  const childWireframeMesh = state.tesseronChildWireframeMesh;
  const childDepthGeometry = childDepthMesh.geometry;
  const childCoreGeometry = childCoreMesh.geometry;
  const childWireGeometry = childWireframeMesh.geometry;
  const childDepthMaterial = childDepthMesh.material;
  const childCoreMaterial = childCoreMesh.material;
  const childWireMaterial = childWireframeMesh.material;
  const initialFullRebuilds = stats.primaryFullRebuilds;

  assert.equal(childCoreMesh.material.opacity, 0.8);
  assert.equal(childWireframeMesh.material.opacity, 0.7);
  assert.equal(childCoreMesh.visible, false);
  assert.equal(childDepthMesh.visible, false);
  assert.equal(childCoreMesh.material.shininess, 80);

  state.avatar.appearance.opacity = 0.2;
  state.avatar.appearance.edgeOpacity = 0.1;
  state.avatar.appearance.maskEnabled = false;
  state.avatar.appearance.interiorEdges = false;
  state.avatar.appearance.specular = false;
  syncAvatarAliasesFromGraph(state);
  const result = updatePrimaryAppearance();

  assert.equal(result.updated, true);
  assert.equal(result.rebuilt, false);
  assert.equal(state.tesseronChildDepthMesh, childDepthMesh);
  assert.equal(state.tesseronChildCoreMesh, childCoreMesh);
  assert.equal(state.tesseronChildWireframeMesh, childWireframeMesh);
  assert.equal(state.tesseronChildDepthMesh.geometry, childDepthGeometry);
  assert.equal(state.tesseronChildCoreMesh.geometry, childCoreGeometry);
  assert.equal(state.tesseronChildWireframeMesh.geometry, childWireGeometry);
  assert.equal(state.tesseronChildDepthMesh.material, childDepthMaterial);
  assert.equal(state.tesseronChildCoreMesh.material, childCoreMaterial);
  assert.equal(state.tesseronChildWireframeMesh.material, childWireMaterial);
  assert.equal(state.coreMesh.material.opacity, 0.2);
  assert.equal(state.wireframeMesh.material.opacity, 0.1);
  assert.equal(state.coreMesh.material.shininess, 0);
  assert.equal(state.tesseronChildCoreMesh.material.opacity, 0.8);
  assert.equal(state.tesseronChildWireframeMesh.material.opacity, 0.7);
  assert.equal(state.tesseronChildCoreMesh.material.shininess, 80);
  assert.equal(state.tesseronChildCoreMesh.visible, false);
  assert.equal(state.tesseronChildDepthMesh.visible, false);
  assert.equal(stats.primaryFullRebuilds, initialFullRebuilds);
  assert.doesNotThrow(() => JSON.stringify(state.avatar));
});

test('primary appearance edits keep tesseron child matched to mother when configured', () => {
  configurePrimaryShape({ tesseron: true });
  updateGeometry(20);

  const childCoreMesh = state.tesseronChildCoreMesh;
  const childWireframeMesh = state.tesseronChildWireframeMesh;
  const initialFullRebuilds = state.__sigilGeometryStats.primaryFullRebuilds;

  state.avatar.appearance.opacity = 0.2;
  state.avatar.appearance.edgeOpacity = 0.1;
  state.avatar.appearance.specular = false;
  syncAvatarAliasesFromGraph(state);
  const result = updatePrimaryAppearance();

  assert.equal(result.updated, true);
  assert.equal(result.rebuilt, false);
  assert.equal(state.tesseronChildCoreMesh, childCoreMesh);
  assert.equal(state.tesseronChildWireframeMesh, childWireframeMesh);
  assert.equal(state.tesseronChildCoreMesh.material.opacity, 0.2);
  assert.equal(state.tesseronChildWireframeMesh.material.opacity, 0.1);
  assert.equal(state.tesseronChildCoreMesh.material.shininess, 0);
  assert.equal(state.__sigilGeometryStats.primaryFullRebuilds, initialFullRebuilds);
});

test('long primary tesseron proportion edit session keeps child/link resources bounded', () => {
  configurePrimaryShape({ tesseron: true });
  updateGeometry(20);

  const stats = state.__sigilGeometryStats;
  const meshes = {
    depth: state.depthMesh,
    core: state.coreMesh,
    wire: state.wireframeMesh,
    childDepth: state.tesseronChildDepthMesh,
    childCore: state.tesseronChildCoreMesh,
    childWire: state.tesseronChildWireframeMesh,
    innerWire: state.innerWireframeMesh,
    innerHighlight: state.innerHighlightWireframeMesh,
  };
  const geometries = Object.fromEntries(Object.entries(meshes).map(([key, mesh]) => [key, mesh.geometry]));
  const materials = Object.fromEntries(Object.entries(meshes).map(([key, mesh]) => [key, mesh.material]));
  const initialFullRebuilds = stats.primaryFullRebuilds;

  const editCount = 160;
  for (let index = 0; index < editCount; index += 1) {
    const value = 0.12 + ((index % 25) * 0.03);
    state.avatar.shape.tesseron.proportion = value;
    syncAvatarAliasesFromGraph(state);
    const result = updatePrimaryTesseronProportion(value);

    assert.deepEqual(result, { updated: true, rebuilt: false, suppressed: false });
    const stateKeys = {
      depth: 'depthMesh',
      core: 'coreMesh',
      wire: 'wireframeMesh',
      childDepth: 'tesseronChildDepthMesh',
      childCore: 'tesseronChildCoreMesh',
      childWire: 'tesseronChildWireframeMesh',
      innerWire: 'innerWireframeMesh',
      innerHighlight: 'innerHighlightWireframeMesh',
    };
    for (const [key, mesh] of Object.entries(meshes)) {
      assert.equal(state[stateKeys[key]], mesh);
      assert.equal(mesh.geometry, geometries[key]);
      assert.equal(mesh.material, materials[key]);
      assert.equal(hasFinitePositions(mesh.geometry), true);
    }
  }

  assert.equal(stats.primaryFullRebuilds, initialFullRebuilds);
  assert.equal(stats.primaryTesseronProportionUpdates, editCount);
  assert.equal(stats.primaryTesseronProportionSuppressed, 0);
  assert.equal(stats.primaryTesseronProportionTemporaryGeometriesCreated, editCount * 5);
  assert.equal(stats.primaryTesseronProportionTemporaryGeometriesDisposed, editCount * 5);
  assert.equal(stats.primaryTesseronProportionRetainedGeometries, 7);
  assert.equal(stats.primaryTesseronProportionMaxRetainedGeometries, 7);
  const evidence = createVisualObjectResourceLifecycleEvidence({
    descriptor: {
      id: 'sigil-avatar-tesseron-proportion',
      state_path: 'avatar.shape.tesseron.proportion',
      route: 'canvas_object.transform.patch',
      renderer_sync: ['updatePrimaryTesseronProportion'],
    },
    editCount,
    rebuildsBefore: initialFullRebuilds,
    rebuildsAfter: stats.primaryFullRebuilds,
    retainedResources: stats.primaryTesseronProportionRetainedGeometries,
    retainedResourceLimit: stats.primaryTesseronProportionMaxRetainedGeometries,
    temporaryResourcesCreated: stats.primaryTesseronProportionTemporaryGeometriesCreated,
    temporaryResourcesDisposed: stats.primaryTesseronProportionTemporaryGeometriesDisposed,
    finiteDataValid: Object.values(geometries).every(hasFinitePositions),
    poolingBoundary: {
      owner: 'sigil-renderer',
      decision: 'renderer-local',
      rationale: 'Tesseron child/link geometry reuse depends on renderer-owned topology and disposal behavior.',
    },
    jsonSerializableState: state.avatar,
  });
  assert.equal(evidence.minimal_update, true);
  assert.equal(validateVisualObjectResourceLifecycleEvidence(evidence).ok, true);
  assert.doesNotThrow(() => JSON.stringify(state.avatar));
});

test('primary skin rebuilds dispose shader ramp textures once', () => {
  configurePrimaryShape();
  state.avatar.appearance.skin = 'rocky';
  syncAvatarAliasesFromGraph(state);
  updateGeometry(20);

  const oldRamp = state.skinColorRamp;
  let disposed = 0;
  oldRamp.dispose = () => {
    disposed += 1;
  };

  updateGeometry(20);

  assert.equal(disposed, 1);
  assert.notEqual(state.skinColorRamp, oldRamp);
  assert.equal(oldRamp.userData.__sigilDisposed, true);
  assert.doesNotThrow(() => JSON.stringify(state.avatar));
});

test('primary stellation replacement geometries stay finite for editable shapes', () => {
  for (const type of [6, 92, 93]) {
    configurePrimaryShape();
    state.avatar.shape.type = type;
    syncAvatarAliasesFromGraph(state);
    updateGeometry(type);

    state.avatar.shape.stellationFactor = 0.5;
    const result = updatePrimaryStellation(0.5);

    assert.equal(result.updated, true);
    assert.equal(result.suppressed, false);
    assert.equal(result.gpuPath, 'morph-target');
    assert.equal(hasFinitePositions(state.depthMesh.geometry), true, `depth geometry should be finite for type ${type}`);
    assert.equal(hasFinitePositions(state.coreMesh.geometry), true, `core geometry should be finite for type ${type}`);
    assert.equal(hasFinitePositions(state.wireframeMesh.geometry), true, `wire geometry should be finite for type ${type}`);
  }
});
