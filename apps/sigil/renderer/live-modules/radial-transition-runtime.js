const TOOLKIT_RADIAL_TRANSITION_SPECIFIER = (
    typeof window !== 'undefined'
    && typeof location !== 'undefined'
    && /^https?:$/.test(location.protocol)
)
    ? '/toolkit/runtime/radial-item-transition.js'
    : (
        typeof location !== 'undefined'
        && location.protocol === 'aos:'
    )
        ? 'aos://toolkit/runtime/radial-item-transition.js'
        : '../../../../packages/toolkit/runtime/radial-item-transition.js';

export const {
    DEFAULT_RADIAL_ITEM_ACTIVATION_TRANSITION_PRESET,
    RADIAL_ITEM_ACTIVATION_TRANSITION_PRESETS,
    RADIAL_ITEM_ACTIVATION_TRANSITION_SCHEMA_VERSION,
    normalizeRadialItemActivationTransition,
    radialItemActivationTransitionPreset,
    resolveRadialItemActivationTransition,
} = await import(TOOLKIT_RADIAL_TRANSITION_SPECIFIER);
