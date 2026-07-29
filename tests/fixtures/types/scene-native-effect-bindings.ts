import type {
  SceneCartridgeInteraction,
  SceneNativeEffectDescriptor,
} from '../../../packages/toolkit/scene/index.js';

const program = {
  implementation: 'aos.scene.effect.program',
  programId: 'example.effect',
  parameters: {},
} as const;

const timedEnd: SceneNativeEffectDescriptor = {
  ...program,
  trigger: { phase: 'end' },
  lifecycle: { kind: 'timed' },
};

const gestureStart: SceneNativeEffectDescriptor = {
  ...program,
  trigger: { phase: 'start' },
  lifecycle: { kind: 'gesture' },
};

// @ts-expect-error Gesture-owned native effects are admitted only at gesture start.
const invalidGestureEnd: SceneNativeEffectDescriptor = {
  ...program,
  trigger: { phase: 'end' },
  lifecycle: { kind: 'gesture' },
};

const interaction = {
  id: 'example-interaction',
  affordanceId: 'example-affordance',
  recognizer: {
    implementation: 'aos.scene.gesture.drag',
    parameters: {},
  },
  response: {
    implementation: 'aos.scene.response.aim_commit',
    parameters: {},
  },
} as const;

const fiveBindings: SceneCartridgeInteraction = {
  ...interaction,
  nativeEffects: [timedEnd, gestureStart, timedEnd, gestureStart, timedEnd],
};

const sixBindings: SceneCartridgeInteraction = {
  ...interaction,
  nativeEffects: [
    timedEnd,
    gestureStart,
    timedEnd,
    gestureStart,
    timedEnd,
    // @ts-expect-error One interaction cannot exceed five native-effect bindings.
    gestureStart,
  ],
};

void [fiveBindings, invalidGestureEnd, sixBindings];
