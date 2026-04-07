import state from './state.js';
import { updateAllColors } from './colors.js';
import { updatePulsars, updateGammaRays, updateAccretion, updateNeutrinos } from './phenomena.js';

export function applyPreset(preset) {
    const setUI = (id, val) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.type === 'checkbox') { el.checked = val; el.dispatchEvent(new Event('change')); }
        else { el.value = val; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); }
    };

    // Reset counts to 1 on any preset
    ['pulsarCount', 'accretionCount', 'gammaCount', 'neutrinoCount'].forEach(id => setUI(id, 1));
    state.pulsarRayCount = 1; state.accretionDiskCount = 1; state.gammaRayCount = 1; state.neutrinoJetCount = 1;
    updatePulsars(1); updateGammaRays(1); updateAccretion(1); updateNeutrinos(1);

    // Reset lightning, magnetic, omega
    setUI('lightningToggle', false);
    setUI('magneticToggle', false);
    setUI('omegaToggle', false);

    if (preset === 'blackhole') {
        setUI('shapeSelect', 100);
        setUI('maskToggle', false); setUI('interiorEdgesToggle', false); setUI('specularToggle', false);
        setUI('opacitySlider', 1.0); setUI('edgeOpacitySlider', 0.0);
        setUI('gridToggle', true); setUI('gridBendToggle', true); setUI('gridMassSlider', 3.0); setUI('gridDivsSlider', 100);
        setUI('gammaToggle', true); setUI('pulsarToggle', true); setUI('accretionToggle', true); setUI('neutrinoToggle', true);
        setUI('auraToggle', false);
        setUI('pulsarColor1', '#ffffff'); setUI('pulsarColor2', '#ffffff');
        setUI('gammaColor1', '#ffffff'); setUI('gammaColor2', '#ffffff');
        setUI('accretionColor1', '#ffff00'); setUI('accretionColor2', '#ff8800');
        setUI('neutrinoColor1', '#ffff00'); setUI('neutrinoColor2', '#ffff00');
        setUI('faceColor1', '#000000'); setUI('faceColor2', '#000000');
        setUI('edgeColor1', '#000000'); setUI('edgeColor2', '#000000');
    } else if (preset === 'crystal') {
        setUI('shapeSelect', 20);
        setUI('maskToggle', false); setUI('interiorEdgesToggle', true); setUI('specularToggle', true);
        setUI('opacitySlider', 0.15); setUI('edgeOpacitySlider', 0.8);
        setUI('auraToggle', true); setUI('auraReachSlider', 0.8); setUI('auraIntensitySlider', 1.5); setUI('pulseRateSlider', 0.002);
        setUI('accretionToggle', false); setUI('pulsarToggle', false); setUI('gammaToggle', false); setUI('neutrinoToggle', false);
        setUI('faceColor1', '#00e5ff'); setUI('faceColor2', '#ffffff');
        setUI('edgeColor1', '#ffffff'); setUI('edgeColor2', '#ffffff');
        setUI('auraColor1', '#00e5ff'); setUI('auraColor2', '#004488');
    } else if (preset === 'neon') {
        setUI('maskToggle', true); setUI('interiorEdgesToggle', true); setUI('specularToggle', false);
        setUI('opacitySlider', 0.0); setUI('edgeOpacitySlider', 1.0);
        setUI('auraToggle', true); setUI('auraReachSlider', 1.5); setUI('auraIntensitySlider', 2.0); setUI('pulseRateSlider', 0.008);
        setUI('pulsarToggle', true); setUI('neutrinoToggle', true); setUI('accretionToggle', false); setUI('gammaToggle', false);
        setUI('faceColor1', '#ff00ff'); setUI('faceColor2', '#ff00ff');
        setUI('edgeColor1', '#00ffcc'); setUI('edgeColor2', '#0044aa');
        setUI('auraColor1', '#ff00ff'); setUI('auraColor2', '#440044');
        setUI('pulsarColor1', '#00ffcc'); setUI('pulsarColor2', '#ff00ff');
    } else {
        // Default
        setUI('shapeSelect', 6);
        setUI('maskToggle', true); setUI('interiorEdgesToggle', true); setUI('specularToggle', true);
        setUI('opacitySlider', 0.25); setUI('edgeOpacitySlider', 1.0);
        setUI('auraToggle', true); setUI('auraReachSlider', 1.0); setUI('auraIntensitySlider', 1.0);
        setUI('accretionToggle', false); setUI('pulsarToggle', false); setUI('gammaToggle', false); setUI('neutrinoToggle', false);
        setUI('masterColor1', '#bc13fe'); setUI('masterColor2', '#4a2b6e');
    }
}
