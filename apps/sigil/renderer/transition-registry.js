export const DEFAULT_TRANSITION_EFFECT = 'scale';

export const TRANSITION_EFFECTS = [
    { id: 'scale', label: 'Scale' },
    { id: 'wormhole', label: 'Wormhole' },
];

const TRANSITION_EFFECT_IDS = new Set(TRANSITION_EFFECTS.map((effect) => effect.id));

export function isTransitionEffect(value) {
    return typeof value === 'string' && TRANSITION_EFFECT_IDS.has(value);
}

export function normalizeTransitionEffect(value, fallback = DEFAULT_TRANSITION_EFFECT) {
    return isTransitionEffect(value) ? value : fallback;
}
