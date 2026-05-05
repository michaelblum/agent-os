import { toolkitSpecifier } from './content-roots.js';

export const {
    MENU_ACTIVATION_SCHEMA_VERSION,
    advanceMenuActivation,
    createMenuActivationRequest,
} = await import(toolkitSpecifier('runtime/menu-activation.js'));
