import { DEFAULT_APPEARANCE } from './appearance.js';

export const DEFAULT_STAGE_AVATAR = Object.freeze({
    id: 'default',
    name: 'Default',
    appearance: {
        ...DEFAULT_APPEARANCE,
        aura: {
            ...DEFAULT_APPEARANCE.aura,
            reach: 0.75,
            pulseRate: 0.0025,
        },
    },
    instance: Object.freeze({
        birthplace: Object.freeze({
            anchor: 'nonant',
            nonant: 'bottom-right',
            display: 'main',
        }),
        size: 180,
    }),
    stage: Object.freeze({
        initiallyVisible: false,
        showDuration: 0.22,
        hideDuration: 0.18,
    }),
});

export function cloneStageAvatar() {
    return JSON.parse(JSON.stringify(DEFAULT_STAGE_AVATAR));
}
