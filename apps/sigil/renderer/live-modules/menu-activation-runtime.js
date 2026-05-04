const TOOLKIT_MENU_ACTIVATION_SPECIFIER = (
    typeof window !== 'undefined'
    && typeof location !== 'undefined'
    && /^https?:$/.test(location.protocol)
)
    ? '/toolkit/runtime/menu-activation.js'
    : (
        typeof location !== 'undefined'
        && location.protocol === 'aos:'
    )
        ? 'aos://toolkit/runtime/menu-activation.js'
        : '../../../../packages/toolkit/runtime/menu-activation.js';

export const {
    MENU_ACTIVATION_SCHEMA_VERSION,
    advanceMenuActivation,
    createMenuActivationRequest,
} = await import(TOOLKIT_MENU_ACTIVATION_SPECIFIER);
