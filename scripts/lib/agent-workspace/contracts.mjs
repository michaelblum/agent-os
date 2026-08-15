export const AGENT_WORKSPACE_SCHEMA_VERSION = 'aos.agent-workspace.v1';

export const CAPTURE_MODE_VALUES = ['ax', 'vision', 'som'];
export const CAPTURE_SOURCE_KIND_VALUES = Object.freeze(['default_target', 'target', 'source_flags']);
export const CAPTURE_SOURCE_VALUE_FLAGS = Object.freeze(['--region', '--canvas', '--channel']);
export const SAVED_REF_BACKENDS = Object.freeze(['aos_canvas', 'browser', 'native_ax']);
export const SAVED_REF_CONFIDENCE_VALUES = Object.freeze(['high', 'medium', 'low']);
export const SAVED_REF_ANNOTATION_TARGET_KIND_BY_BACKEND = Object.freeze({
  browser: 'browser',
  aos_canvas: 'canvas',
  native_ax: 'native_ax',
});

// Saved records store one V1 handle. These capture-time action hints describe
// producer knowledge only; current action resolution is the admission owner.
export const SAVED_HANDLE_V1_ACTIONS_BY_BACKEND = Object.freeze({
  browser: Object.freeze([]),
  aos_canvas: Object.freeze(['click', 'set-value']),
  native_ax: Object.freeze(['press', 'focus', 'set-value']),
});

// The fixed browser Observation Ref grammar remains accepted so direct and
// saved callers receive state validation followed by the precise identity
// blocker. These are request forms, not advertised supported actions.
export const BROWSER_OBSERVATION_REF_REQUEST_ACTIONS = Object.freeze([
  'click', 'fill', 'hover', 'scroll', 'drag', 'type', 'key',
]);

export function savedRefSupportedActionsForBackend(backend, producerActions = null) {
  const allowed = SAVED_HANDLE_V1_ACTIONS_BY_BACKEND[backend] ?? [];
  if (!producerActions) return [...allowed];
  const producerSet = new Set((producerActions ?? []).filter(Boolean));
  return allowed.filter((action) => producerSet.has(action));
}

export function isSavedRefBackend(value) {
  return SAVED_REF_BACKENDS.includes(value);
}

export function isSavedRefConfidence(value) {
  return SAVED_REF_CONFIDENCE_VALUES.includes(value);
}

export const SAVED_CAPTURE_MODE_POLICY = Object.freeze({
  ax: Object.freeze({
    requires_tree: true,
    requires_image: false,
    browser_flags: Object.freeze(['--xray']),
    non_browser_flags: Object.freeze(['--xray']),
    known_limits: Object.freeze({
      browser: Object.freeze([]),
      non_browser: Object.freeze([
        'non-browser ax mode may still require the current native capture primitive until a tree-only native path lands',
      ]),
    }),
  }),
  vision: Object.freeze({
    requires_tree: false,
    requires_image: true,
    browser_flags: Object.freeze([]),
    non_browser_flags: Object.freeze([]),
    known_limits: Object.freeze({ browser: Object.freeze([]), non_browser: Object.freeze([]) }),
  }),
  som: Object.freeze({
    requires_tree: true,
    requires_image: true,
    browser_flags: Object.freeze(['--xray']),
    non_browser_flags: Object.freeze(['--xray']),
    known_limits: Object.freeze({
      browser: Object.freeze(['managed browser capture does not project local geometry or badge annotations']),
      non_browser: Object.freeze([]),
    }),
  }),
});

export function savedCaptureModePolicy(mode) {
  return SAVED_CAPTURE_MODE_POLICY[mode] ?? null;
}

export function savedCaptureModeFlags(mode, target) {
  const policy = savedCaptureModePolicy(mode);
  if (!policy) return [];
  return target?.startsWith?.('browser:') ? [...policy.browser_flags] : [...policy.non_browser_flags];
}

export function savedCaptureModeKnownLimits(mode, target) {
  const policy = savedCaptureModePolicy(mode);
  if (!policy) return [];
  const bucket = target?.startsWith?.('browser:') ? 'browser' : 'non_browser';
  return [...(policy.known_limits?.[bucket] ?? [])];
}

// Direct native AX responses retain their existing evidence block. It describes
// the primitive's current-match behavior and does not authorize saved handles.
export const NATIVE_AX_LOCATOR_INPUT_FACTS = Object.freeze([
  'app_pid',
  'window_id',
  'ax_identifier',
  'enabled',
  'action_names',
  'permission_state',
  'focus_cursor_space_baseline',
]);

export function nativeAxNoForegroundConformance(options = {}) {
  return {
    claim: 'not_claimed',
    focus_preservation: options.focusPreservation ?? 'unverified',
    cursor_preservation: options.cursorPreservation ?? 'unverified',
    space_preservation: options.spacePreservation ?? 'unverified',
    fallback_used: options.fallbackUsed === true,
    foreground_fallback_required: options.foregroundFallbackRequired === true,
    permission_state: options.permissionState ?? 'unknown',
  };
}

export function directNativeAxProofStory() {
  return {
    level: 'native_primitive_response_plus_wrapper_contract',
    status: 'deterministic_locator_contract_tested_native_acceptance_not_run',
    evidence: ['tests/native-target-locator-selection.sh'],
    approval_gates: [
      'HITL live smoke',
      'TCC/manual runtime flow',
      'native repo-mode artifact rebuild',
      'explicit no-foreground/focus/cursor/Space baseline verification',
    ],
  };
}
