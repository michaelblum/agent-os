// randomize.js — scope-partitioned seeded randomization.
// Split from ui.js so the reroll flyout can target shape / palette / effects
// independently. Preserves the setUI(el,val)→dispatch(input,change) path so
// panels auto-persist via their existing listeners.
import state from '../../renderer/state.js';

// Seeded PRNG (mulberry32). Same seed → same result.
export function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function setUI(id, val, strVal) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.type === 'checkbox') {
    if (el.checked !== val) { el.checked = val; el.dispatchEvent(new Event('change')); }
  } else {
    el.value = val;
    if (strVal !== undefined) {
      const vDisp = document.getElementById(id.replace('Slider', 'Val'));
      if (vDisp) vDisp.innerText = strVal;
    }
    el.dispatchEvent(new Event('input'));
    el.dispatchEvent(new Event('change'));
  }
}

function randomizeShape(rng) {
  const shapes = [4, 6, 8, 12, 20, 90, 91, 92, 93, 100];
  setUI('shapeSelect', shapes[Math.floor(rng() * shapes.length)]);
  const stellation = (rng() * 3 - 1).toFixed(2); setUI('stellationSlider', stellation, stellation);
  const opacity = rng().toFixed(2); setUI('opacitySlider', opacity, opacity);
  const edgeOpacity = (rng() * 0.8 + 0.2).toFixed(2); setUI('edgeOpacitySlider', edgeOpacity, edgeOpacity);
  setUI('maskToggle', rng() > 0.5);
  setUI('interiorEdgesToggle', rng() > 0.5);
  setUI('specularToggle', rng() > 0.5);
  state.tetartoidA = 1.0; state.tetartoidB = 1.5; state.tetartoidC = 2.0;
  setUI('tetASlider', 1.0, '1.00'); setUI('tetBSlider', 1.5, '1.50'); setUI('tetCSlider', 2.0, '2.00');
  state.torusRadius = 1.0; state.torusTube = 0.3; state.torusArc = 1.0;
  setUI('torusRadiusSlider', 1.0, '1.00'); setUI('torusTubeSlider', 0.3, '0.30'); setUI('torusArcSlider', 1.0, '1.00');
  state.cylinderTopRadius = 1.0; state.cylinderBottomRadius = 1.0; state.cylinderHeight = 1.0; state.cylinderSides = 32;
  setUI('cylinderTopSlider', 1.0, '1.00'); setUI('cylinderBottomSlider', 1.0, '1.00');
  setUI('cylinderHeightSlider', 1.0, '1.00'); setUI('cylinderSidesSlider', 32, '32');
  state.boxWidth = 1.0; state.boxHeight = 1.0; state.boxDepth = 1.0;
  setUI('boxWidthSlider', 1.0, '1.00'); setUI('boxHeightSlider', 1.0, '1.00'); setUI('boxDepthSlider', 1.0, '1.00');
}

function randomizePalette(rng) {
  if (rng() > 0.5) {
    const c1 = '#' + Math.floor(rng() * 16777215).toString(16).padStart(6, '0');
    const c2 = '#' + Math.floor(rng() * 16777215).toString(16).padStart(6, '0');
    setUI('masterColor1', c1);
    setUI('masterColor2', c2);
  }
  const skins = ['none', 'none', 'none', 'rocky', 'gas-giant', 'ice', 'volcanic', 'solar'];
  setUI('skinSelect', skins[Math.floor(rng() * skins.length)]);
}

function randomizeEffects(rng, deps) {
  const aReach = (rng() * 3).toFixed(2); setUI('auraReachSlider', aReach, aReach);
  const aInt = (rng() * 3).toFixed(2); setUI('auraIntensitySlider', aInt, aInt);
  const spin = (rng() * 0.025).toFixed(3); setUI('idleSpinSlider', spin, spin);
  const pulse = (rng() * 0.019 + 0.001).toFixed(3); setUI('pulseRateSlider', pulse, pulse);
  setUI('pulsarToggle', rng() > 0.7);
  setUI('accretionToggle', rng() > 0.7);
  setUI('gammaToggle', rng() > 0.7);
  setUI('neutrinoToggle', rng() > 0.7);
  setUI('lightningToggle', rng() > 0.7);
  setUI('magneticToggle', rng() > 0.7);
  if (state.isOmegaEnabled) {
    setUI('omegaShapeSelect', [4, 6, 8, 12, 20, 90, 100][Math.floor(rng() * 7)]);
    setUI('omegaStellationSlider', (rng() * 3 - 1), (rng() * 3 - 1).toFixed(2));
    setUI('omegaOpacitySlider', rng(), rng().toFixed(2));
    setUI('omegaEdgeOpacitySlider', rng(), rng().toFixed(2));
    setUI('omegaScaleSlider', 0.5 + rng() * 3, (0.5 + rng() * 3).toFixed(2));
    setUI('omegaMaskToggle', rng() > 0.5);
    setUI('omegaCounterSpin', rng() > 0.5);
    setUI('omegaInterDimensional', rng() > 0.7);
  }
  ['pulsarCount', 'accretionCount', 'gammaCount', 'neutrinoCount'].forEach(id => setUI(id, 1));
  state.pulsarRayCount = 1; state.accretionDiskCount = 1; state.gammaRayCount = 1; state.neutrinoJetCount = 1;
  deps.updatePulsars(1); deps.updateGammaRays(1); deps.updateAccretion(1); deps.updateNeutrinos(1);
  ['p', 'a', 'g', 'n'].forEach(k => {
    const tVal = (rng() * 0.5).toFixed(2);
    const tSpd = (rng() * 4 + 0.5).toFixed(1);
    const tMod = ['uniform', 'staggered', 'random'][Math.floor(rng() * 3)];
    setUI(`${k}TurbSlider`, tVal, tVal);
    setUI(`${k}TurbSpdSlider`, tSpd, tSpd);
    document.getElementById(`${k}TurbMod`).value = tMod;
    state.turbState[k].val = parseFloat(tVal);
    state.turbState[k].spd = parseFloat(tSpd);
    state.turbState[k].mod = tMod;
  });
}

export function randomizeAll(seed, scope = 'everything', deps = {}) {
  const rng = mulberry32(seed >>> 0);
  if (scope === 'shape' || scope === 'everything') randomizeShape(rng);
  if (scope === 'palette' || scope === 'everything') randomizePalette(rng);
  if (scope === 'effects' || scope === 'everything') randomizeEffects(rng, deps);
  return seed;
}
