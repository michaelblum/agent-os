export const DEFAULT_TRANSITION_EFFECT = 'scale';
export const DEFAULT_FAST_TRAVEL_EFFECT = 'line';

export const TRANSITION_EFFECTS = [
    { id: 'scale', label: 'Scale' },
    { id: 'wormhole', label: 'Wormhole' },
];

export const FAST_TRAVEL_EFFECTS = [
    { id: 'line', label: 'Line' },
    { id: 'wormhole', label: 'Wormhole' },
];

const TRANSITION_EFFECT_IDS = new Set(TRANSITION_EFFECTS.map((effect) => effect.id));
const FAST_TRAVEL_EFFECT_IDS = new Set(FAST_TRAVEL_EFFECTS.map((effect) => effect.id));

export function isTransitionEffect(value) {
    return typeof value === 'string' && TRANSITION_EFFECT_IDS.has(value);
}

export function normalizeTransitionEffect(value, fallback = DEFAULT_TRANSITION_EFFECT) {
    return isTransitionEffect(value) ? value : fallback;
}

export function isFastTravelEffect(value) {
    return typeof value === 'string' && FAST_TRAVEL_EFFECT_IDS.has(value);
}

export function normalizeFastTravelEffect(value, fallback = DEFAULT_FAST_TRAVEL_EFFECT) {
    return isFastTravelEffect(value) ? value : fallback;
}
