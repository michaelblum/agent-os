// presets.js — named appearance presets.
//
// Per the state-as-source-of-truth refactor (plan 2026-04-12-sigil-foundation):
// presets are now partial appearance blobs. applyPreset(name) merges the named
// patch onto the current snapshot and routes it through applyAppearance. UI
// wiring (DOM input-value sync) is handled by Studio calling syncUIFromState()
// after this returns.

import { applyAppearance, snapshotAppearance, DEFAULT_APPEARANCE } from './appearance.js';

// Preset patches: partial blobs layered onto DEFAULT_APPEARANCE.
// Each preset is a full-reset blob — to match the legacy `applyPreset`
// behavior of wiping counts, omega, lightning, magnetic, etc., we start from
// DEFAULT_APPEARANCE and override only the fields the preset cares about.
const PRESET_PATCHES = {
    default: (base) => ({
        ...base,
        shape: 6,
        // maskEnabled: Studio's checkbox is "Show Faces" (inverted). Old
        // preset set UI checkbox=true → listener wrote state=!true → false.
        maskEnabled: false, interiorEdges: true, specular: true,
        opacity: 0.25, edgeOpacity: 1.0,
        aura: { ...base.aura, enabled: true, reach: 1.0, intensity: 1.0 },
        phenomena: {
            pulsar:    { enabled: false, count: 1 },
            accretion: { enabled: false, count: 1 },
            gamma:     { enabled: false, count: 1 },
            neutrino:  { enabled: false, count: 1 }
        },
        colors: {
            ...base.colors,
            face: ['#bc13fe', '#4a2b6e'],
            edge: ['#bc13fe', '#4a2b6e']
        },
        lightning: { ...base.lightning, enabled: false },
        magnetic: { ...base.magnetic, enabled: false },
        omega: { ...base.omega, enabled: false }
    }),

    blackhole: (base) => ({
        ...base,
        shape: 100,
        // Show-Faces inversion: old UI=false → state=!false → true
        maskEnabled: true, interiorEdges: false, specular: false,
        opacity: 1.0, edgeOpacity: 0.0,
        aura: { ...base.aura, enabled: false },
        phenomena: {
            pulsar:    { enabled: true, count: 1 },
            accretion: { enabled: true, count: 1 },
            gamma:     { enabled: true, count: 1 },
            neutrino:  { enabled: true, count: 1 }
        },
        colors: {
            ...base.colors,
            face: ['#000000', '#000000'],
            edge: ['#000000', '#000000'],
            pulsar: ['#ffffff', '#ffffff'],
            gamma: ['#ffffff', '#ffffff'],
            accretion: ['#ffff00', '#ff8800'],
            neutrino: ['#ffff00', '#ffff00']
        },
        grid: { ...base.grid, mode: 'flat' },
        lightning: { ...base.lightning, enabled: false },
        magnetic: { ...base.magnetic, enabled: false },
        omega: { ...base.omega, enabled: false }
    }),

    crystal: (base) => ({
        ...base,
        shape: 20,
        // Show-Faces inversion: old UI=false → state=!false → true
        maskEnabled: true, interiorEdges: true, specular: true,
        opacity: 0.15, edgeOpacity: 0.8,
        aura: { ...base.aura, enabled: true, reach: 0.8, intensity: 1.5, pulseRate: 0.002 },
        phenomena: {
            pulsar:    { enabled: false, count: 1 },
            accretion: { enabled: false, count: 1 },
            gamma:     { enabled: false, count: 1 },
            neutrino:  { enabled: false, count: 1 }
        },
        colors: {
            ...base.colors,
            face: ['#00e5ff', '#ffffff'],
            edge: ['#ffffff', '#ffffff'],
            aura: ['#00e5ff', '#004488']
        },
        lightning: { ...base.lightning, enabled: false },
        magnetic: { ...base.magnetic, enabled: false },
        omega: { ...base.omega, enabled: false }
    }),

    neon: (base) => ({
        ...base,
        // Show-Faces inversion: old UI=true → state=!true → false
        maskEnabled: false, interiorEdges: true, specular: false,
        opacity: 0.0, edgeOpacity: 1.0,
        aura: { ...base.aura, enabled: true, reach: 1.5, intensity: 2.0, pulseRate: 0.008 },
        phenomena: {
            pulsar:    { enabled: true, count: 1 },
            accretion: { enabled: false, count: 1 },
            gamma:     { enabled: false, count: 1 },
            neutrino:  { enabled: true, count: 1 }
        },
        colors: {
            ...base.colors,
            face: ['#ff00ff', '#ff00ff'],
            edge: ['#00ffcc', '#0044aa'],
            aura: ['#ff00ff', '#440044'],
            pulsar: ['#00ffcc', '#ff00ff']
        },
        lightning: { ...base.lightning, enabled: false },
        magnetic: { ...base.magnetic, enabled: false },
        omega: { ...base.omega, enabled: false }
    }),

    higgs: (base) => ({
        ...base,
        shape: 6,
        stellation: -1,
        // Show-Faces inversion: old UI=true → state=!true → false
        // (omega.maskEnabled below is NOT flipped — already correct.)
        maskEnabled: false, interiorEdges: true, specular: true,
        opacity: 0.25, edgeOpacity: 0.4,
        skin: 'none',
        idleSpin: 0.01,
        zDepth: 0.89,
        aura: { ...base.aura, enabled: true, reach: 0.64, intensity: 0.48, pulseRate: 0.001 },
        phenomena: {
            pulsar:    { enabled: true, count: 1 },
            accretion: { enabled: false, count: 1 },
            gamma:     { enabled: true, count: 1 },
            neutrino:  { enabled: true, count: 1 }
        },
        colors: {
            ...base.colors,
            face: ['#bc13fe', '#4a2b6e'],
            edge: ['#bc13fe', '#4a2b6e'],
            aura: ['#bc13fe', '#2a1b3d'],
            pulsar: ['#ffffff', '#bc13fe'],
            gamma: ['#ffffff', '#00ffff'],
            neutrino: ['#bc13fe', '#4a2b6e'],
            lightning: ['#ffffff', '#bc13fe'],
            magnetic: ['#bc13fe', '#4a2b6e']
        },
        lightning: { ...base.lightning, enabled: true },
        magnetic: { ...base.magnetic, enabled: true },
        omega: {
            ...base.omega,
            enabled: true,
            shape: 6, stellation: 0,
            opacity: 0.15, edgeOpacity: 0.8,
            maskEnabled: true, interiorEdges: true, specular: false,
            scale: 1.5,
            interDimensional: true,
            ghostCount: 23,
            ghostDuration: 2,
            ghostMode: 'vertexDissolve'
        }
    })
};

/**
 * Apply a named preset. Legacy entry point — now funnels through appearance.js.
 * Studio should call syncUIFromState() after this returns to reflect the new
 * state in DOM input values.
 */
export function applyPreset(preset) {
    const builder = PRESET_PATCHES[preset] ?? PRESET_PATCHES.default;
    // Start from DEFAULT_APPEARANCE, not the current snapshot — presets have
    // always done a full reset of phenomena counts / omega / lightning etc.
    const base = structuredClone(DEFAULT_APPEARANCE);
    const blob = builder(base);
    applyAppearance(blob);
}

// Re-exported so Studio can keep a single import surface for appearance ops.
export { applyAppearance, snapshotAppearance, DEFAULT_APPEARANCE };
