import assert from 'node:assert/strict';
import { test } from 'node:test';

import THREE from '../../apps/sigil/renderer/vendor/three.min.js';
import state from '../../apps/sigil/renderer/state.js';

globalThis.THREE = THREE;

const original = {
  accretionGroup: state.accretionGroup,
  diskMat: state.diskMat,
  accretionRings: state.accretionRings,
  isAccretionEnabled: state.isAccretionEnabled,
  accretionMinHeight: state.accretionMinHeight,
  accretionMaxHeight: state.accretionMaxHeight,
  accretionWidth: state.accretionWidth,
  accretionWidthVariance: state.accretionWidthVariance,
  neutrinoGroup: state.neutrinoGroup,
  neutrinoMat: state.neutrinoMat,
  neutrinoParticles: state.neutrinoParticles,
};

const { updateAccretion, updateNeutrinos } = await import('../../apps/sigil/renderer/phenomena.js');

function restoreState() {
  Object.assign(state, {
    accretionGroup: original.accretionGroup,
    diskMat: original.diskMat,
    accretionRings: original.accretionRings,
    isAccretionEnabled: original.isAccretionEnabled,
    accretionMinHeight: original.accretionMinHeight,
    accretionMaxHeight: original.accretionMaxHeight,
    accretionWidth: original.accretionWidth,
    accretionWidthVariance: original.accretionWidthVariance,
    neutrinoGroup: original.neutrinoGroup,
    neutrinoMat: original.neutrinoMat,
    neutrinoParticles: original.neutrinoParticles,
  });
}

test('accretion count decrease prunes ring state and disposes removed disk resources', () => {
  state.accretionGroup = new THREE.Group();
  state.diskMat = new THREE.MeshBasicMaterial();
  state.accretionRings = [];
  state.isAccretionEnabled = true;
  state.accretionMinHeight = 0.01;
  state.accretionMaxHeight = 0.03;
  state.accretionWidth = 0.7;
  state.accretionWidthVariance = 0.18;

  try {
    updateAccretion(2);

    assert.equal(state.accretionGroup.children.length, 2);
    assert.equal(state.accretionRings.length, 20);

    const removedGroup = state.accretionGroup.children[1];
    let disposed = 0;
    removedGroup.traverse((child) => {
      if (child.geometry) child.geometry.dispose = () => { disposed += 1; };
      if (child.material && child.material !== state.diskMat) {
        child.material.dispose = () => { disposed += 1; };
      }
    });

    updateAccretion(1);

    assert.equal(state.accretionGroup.children.length, 1);
    assert.equal(state.accretionRings.length, 10);
    assert.equal(state.accretionRings.some((ring) => ring.mesh?.parent === removedGroup), false);
    assert.ok(disposed >= 11, `expected removed disk resources to be disposed, got ${disposed}`);
  } finally {
    restoreState();
  }
});

test('neutrino count decrease prunes particle state for removed jets', () => {
  state.neutrinoGroup = new THREE.Group();
  state.neutrinoMat = new THREE.SpriteMaterial();
  state.neutrinoParticles = [];

  try {
    updateNeutrinos(2);

    assert.equal(state.neutrinoGroup.children.length, 2);
    assert.equal(state.neutrinoParticles.length, 60);

    const removedGroup = state.neutrinoGroup.children[1];

    updateNeutrinos(1);

    assert.equal(state.neutrinoGroup.children.length, 1);
    assert.equal(state.neutrinoParticles.length, 30);
    assert.equal(state.neutrinoParticles.some((particle) => particle.parentJet === removedGroup), false);
  } finally {
    restoreState();
  }
});
