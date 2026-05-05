import { toolkitSpecifier } from './content-roots.js';

export const {
    DEFAULT_RADIAL_ITEM_ACTIVATION_TRANSITION_PRESET,
    RADIAL_ITEM_ACTIVATION_TRANSITION_PRESETS,
    RADIAL_ITEM_ACTIVATION_TRANSITION_SCHEMA_VERSION,
    normalizeRadialItemActivationTransition,
    radialItemActivationTransitionPreset,
    resolveRadialItemActivationTransition,
} = await import(toolkitSpecifier('runtime/radial-item-transition.js'));
