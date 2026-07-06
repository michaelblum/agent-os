export const AGENT_WORKSPACE_SCHEMA_VERSION = 'aos.agent-workspace.v0';

export const CAPTURE_MODE_VALUES = ['ax', 'vision', 'som'];
export const CAPTURE_SOURCE_KIND_VALUES = Object.freeze(['default_target', 'target', 'source_flags']);
export const CAPTURE_SOURCE_VALUE_FLAGS = Object.freeze(['--region', '--canvas', '--channel']);
export const SAVED_REF_BACKENDS = ['aos_canvas', 'browser', 'native_ax'];
export const SAVED_REF_ANNOTATION_TARGET_KIND_BY_BACKEND = Object.freeze({
  browser: 'browser',
  aos_canvas: 'canvas',
  native_ax: 'native_ax',
});
export const SAVED_REF_ANNOTATION_ACTIONABLE_RESOLUTION_CLASSES = Object.freeze([
  'stable',
  'reacquirable',
  'snapshot_scoped',
]);
export const NATIVE_AX_SAVED_REF_REQUIRED_IDENTITY_FACTS = Object.freeze([
  'app_pid',
  'window_id',
  'ax_identifier',
  'enabled',
  'action_names',
  'permission_state',
  'focus_cursor_space_baseline',
  'native_saved_ref_evidence',
]);

function present(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return String(value).length > 0;
}

export function nativeFocusCursorSpaceBaselinePresent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.captured === true) return true;
  return String(value.status ?? '').toLowerCase() === 'captured';
}

export function nativeSavedRefEvidenceActionable(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const status = normalizedString(value.status);
  const actionability = normalizedString(value.actionability ?? value.saved_ref_actionability);
  const knownLimitFacts = value.known_limit_facts_complete === true
    || normalizedString(value.known_limit_facts) === 'complete';
  return knownLimitFacts
    && ['actionable', 'producer_actionable', 'stable'].includes(status)
    && ['actionable', 'direct_ax_saved_ref_mutation', 'saved_ref_mutation'].includes(actionability);
}

export function nativePermissionStateGranted(value) {
  return String(value ?? '').toLowerCase() === 'granted';
}

export function nativeEnabledStatePresent(value) {
  return value === true || String(value ?? '').toLowerCase() === 'true';
}

function nativeIdentityFactPresent(facts, fact) {
  if (!facts || typeof facts !== 'object') return false;
  if (fact === 'ax_identifier') {
    return present(facts.ax_identifier) || present(facts.identifier);
  }
  if (fact === 'ax_identifier_or_stable_path') {
    return present(facts.ax_identifier_or_stable_path)
      || present(facts.ax_identifier)
      || present(facts.identifier)
      || present(facts.stable_path)
      || present(facts.ax_path);
  }
  if (fact === 'focus_cursor_space_baseline') {
    return nativeFocusCursorSpaceBaselinePresent(facts.focus_cursor_space_baseline);
  }
  if (fact === 'native_saved_ref_evidence') {
    return nativeSavedRefEvidenceActionable(facts.native_saved_ref_evidence);
  }
  if (fact === 'permission_state') {
    return nativePermissionStateGranted(facts.permission_state);
  }
  if (fact === 'enabled') {
    return nativeEnabledStatePresent(facts.enabled);
  }
  return present(facts[fact]);
}

export function nativeAxSavedRefMissingIdentityFacts(facts) {
  return NATIVE_AX_SAVED_REF_REQUIRED_IDENTITY_FACTS.filter((fact) => !nativeIdentityFactPresent(facts, fact));
}

export function nativeAxSavedRefHasRequiredIdentity(facts) {
  return nativeAxSavedRefMissingIdentityFacts(facts).length === 0;
}

function normalizedString(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function nativeFlagTrue(...values) {
  return values.some((value) => value === true || ['true', 'yes', '1'].includes(normalizedString(value)));
}

export function nativeAxSavedRefBlockedKnownLimitReasons(facts = {}) {
  const reasons = [];
  const windowState = normalizedString(facts.window_state);
  const spaceState = normalizedString(facts.space_state);
  const controlKind = normalizedString(facts.control_kind);
  const surfaceKind = normalizedString(facts.surface_kind);
  const focusState = normalizedString(facts.focus_state);
  const baselineFocus = normalizedString(facts.focus_cursor_space_baseline?.focus);

  if (nativeFlagTrue(facts.off_space) || ['off_space', 'offspace', 'different_space'].includes(spaceState)) {
    reasons.push('native AX target was captured off-Space; saved-ref mutation is blocked until Space preservation is live-proven');
  }
  if (nativeFlagTrue(facts.minimized) || windowState === 'minimized') {
    reasons.push('native AX target was captured in a minimized window; saved-ref mutation is blocked until minimized-window behavior is live-proven');
  }
  if (nativeFlagTrue(facts.custom_control) || controlKind.includes('custom')) {
    reasons.push('native AX target is a custom control; saved-ref mutation is blocked until control-specific AX action behavior is proven');
  }
  if (nativeFlagTrue(facts.canvas_surface) || ['canvas', 'game', 'game_canvas'].includes(surfaceKind)) {
    reasons.push('native AX target belongs to a canvas/game surface; use AOS canvas semantic targets or fresh perception instead of native label/bounds mutation');
  }
  if (['mismatch', 'changed', 'not_focused', 'different'].includes(focusState) || ['changed', 'mismatch', 'different'].includes(baselineFocus)) {
    reasons.push('native AX focus baseline reports mismatch; saved-ref mutation cannot claim focus preservation');
  }
  return reasons;
}

export function nativeAxSavedRefHasBlockingKnownLimit(facts = {}) {
  return nativeAxSavedRefBlockedKnownLimitReasons(facts).length > 0;
}

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

export function notApplicableNoForegroundConformance() {
  return {
    claim: 'not_applicable',
    focus_preservation: 'not_applicable',
    cursor_preservation: 'not_applicable',
    space_preservation: 'not_applicable',
    fallback_used: false,
    foreground_fallback_required: false,
    permission_state: 'not_applicable',
  };
}

export const NATIVE_AX_LIVE_PROOF_APPROVAL_GATES = Object.freeze([
  'HITL live smoke',
  'TCC/manual runtime flow',
  'native repo-mode artifact rebuild',
  'explicit no-foreground/focus/cursor/Space baseline verification',
]);

export const NATIVE_AX_LIVE_DISPATCH_EVIDENCE = Object.freeze([
  'tests/agent-workspace-native-refs.sh',
  'tests/manual/native-ax-saved-ref-live-proof.sh',
  'docs/design/work-cards/operator-aos-agent-workspace-native-live-proof-v0.md',
]);

export const NATIVE_AX_LIVE_DISPATCH_STATUS = 'live_dispatch_proven_no_foreground_not_claimed';

function proofStory(level, status, evidence, approvalGates = []) {
  return {
    level,
    status,
    evidence: [...evidence],
    approval_gates: [...approvalGates],
  };
}

export function savedRefProofStory(backend, resolutionClass, hasMutation) {
  if (resolutionClass === 'coordinate_fallback') {
    return proofStory(
      'known_limit_contract',
      'known_limit_refusal_tested',
      [
        'tests/agent-workspace-browser-refs.sh',
        'tests/agent-workspace-canvas-refs.sh',
        'tests/agent-workspace-native-refs.sh',
      ],
    );
  }

  if (backend === 'browser' && hasMutation) {
    return proofStory(
      'deterministic_contract_tests',
      'deterministic_contract_tests_passed',
      ['tests/agent-workspace-browser-refs.sh', 'tests/agent-workspace-saved-ref.sh'],
    );
  }

  if (backend === 'aos_canvas' && hasMutation) {
    return proofStory(
      'deterministic_contract_tests',
      'deterministic_contract_tests_passed',
      ['tests/agent-workspace-canvas-refs.sh', 'tests/agent-workspace-saved-ref.sh'],
    );
  }

  if (backend === 'native_ax' && hasMutation) {
    return proofStory(
      'native_saved_ref_contract_tests_plus_approval_gates',
      NATIVE_AX_LIVE_DISPATCH_STATUS,
      NATIVE_AX_LIVE_DISPATCH_EVIDENCE,
    );
  }

  if (backend === 'native_ax') {
    return proofStory(
      'known_limit_contract',
      'approval_gated_live_proof_not_run',
      ['tests/agent-workspace-native-refs.sh'],
      NATIVE_AX_LIVE_PROOF_APPROVAL_GATES,
    );
  }

  return proofStory(
    'known_limit_contract',
    'known_limit_contract_tested',
    ['tests/agent-workspace-contract-drift.sh'],
  );
}

export function directNativeAxProofStory() {
  return proofStory(
    'native_primitive_response_plus_wrapper_contract',
    NATIVE_AX_LIVE_DISPATCH_STATUS,
    NATIVE_AX_LIVE_DISPATCH_EVIDENCE,
  );
}

export const SAVED_REF_RESOLUTION_CLASSES = [
  'stable',
  'reacquirable',
  'snapshot_scoped',
  'volatile',
  'coordinate_fallback',
  'unsupported',
];
export const SAVED_REF_CONFIDENCE_VALUES = ['high', 'medium', 'low'];

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
    known_limits: Object.freeze({
      browser: Object.freeze([]),
      non_browser: Object.freeze([]),
    }),
  }),
  som: Object.freeze({
    requires_tree: true,
    requires_image: true,
    browser_flags: Object.freeze(['--xray', '--label']),
    non_browser_flags: Object.freeze(['--xray']),
    known_limits: Object.freeze({
      browser: Object.freeze([]),
      non_browser: Object.freeze([]),
    }),
  }),
});

export const SAVED_REF_V0_ACTION_MATRIX = {
  click: {
    supported_backends: {
      aos_canvas: ['reacquirable'],
      browser: ['snapshot_scoped'],
    },
    dry_run: true,
    real_mutation: {
      aos_canvas: true,
      browser: true,
    },
    required_args: ['ref target'],
    optional_args: ['--right', '--double', 'aos_canvas --dwell'],
    mutation_risk: 'medium',
    validation: 'canvas refs use current canvas target resolution; browser refs require fresh page/frame/navigation identity and exactly one enabled matching current xray element before real dispatch',
    known_limits: {
      browser: 'browser saved refs fail closed when page, frame, navigation, role, title, label, context, enabled state, or uniqueness validation fails',
      aos_canvas: 'canvas refs are re-read from the current canvas; missing, disabled, segmented, or ambiguous current targets fail closed',
    },
    statuses: ['dry_run', 'success', 'REF_NOT_FOUND', 'REF_REVALIDATION_REQUIRED', 'REF_STALE', 'REF_UNSUPPORTED', 'ACTION_INCOMPATIBLE', 'REF_AMBIGUOUS', 'REF_REVALIDATION_FAILED', 'UNKNOWN_ARG', 'UNKNOWN_FLAG'],
  },
  fill: {
    supported_backends: {
      browser: ['snapshot_scoped'],
    },
    dry_run: true,
    real_mutation: {
      browser: true,
    },
    required_args: ['ref target', 'text'],
    optional_args: [],
    mutation_risk: 'medium',
    validation: 'browser refs require fresh page/frame/navigation identity and exactly one enabled action-compatible current xray element before real dispatch',
    known_limits: {
      browser: 'browser fill is allowed only after page, frame, navigation, role, title, label, context, enabled state, and uniqueness validation pass',
    },
    statuses: ['dry_run', 'success', 'REF_NOT_FOUND', 'REF_REVALIDATION_REQUIRED', 'REF_STALE', 'REF_UNSUPPORTED', 'ACTION_INCOMPATIBLE', 'REF_AMBIGUOUS', 'REF_REVALIDATION_FAILED', 'MISSING_ARG', 'UNKNOWN_ARG', 'UNKNOWN_FLAG'],
  },
  hover: {
    supported_backends: {
      browser: ['snapshot_scoped'],
    },
    dry_run: true,
    real_mutation: {
      browser: true,
    },
    required_args: ['ref target'],
    optional_args: [],
    mutation_risk: 'low',
    validation: 'browser refs require fresh page/frame/navigation identity and exactly one enabled action-compatible current xray element before real dispatch',
    known_limits: {
      browser: 'browser hover is allowed only after page, frame, navigation, role, title, label, context, enabled state, and uniqueness validation pass',
    },
    statuses: ['dry_run', 'success', 'REF_NOT_FOUND', 'REF_REVALIDATION_REQUIRED', 'REF_STALE', 'REF_UNSUPPORTED', 'ACTION_INCOMPATIBLE', 'REF_AMBIGUOUS', 'REF_REVALIDATION_FAILED', 'UNKNOWN_ARG', 'UNKNOWN_FLAG'],
  },
  scroll: {
    supported_backends: {
      browser: ['snapshot_scoped'],
    },
    dry_run: true,
    real_mutation: {
      browser: true,
    },
    required_args: ['ref target', 'dx,dy'],
    optional_args: [],
    mutation_risk: 'medium',
    validation: 'browser refs require fresh page/frame/navigation identity and exactly one enabled action-compatible current xray element before real dispatch',
    known_limits: {
      browser: 'browser scroll is allowed only after page, frame, navigation, role, title, label, context, enabled state, and uniqueness validation pass',
    },
    statuses: ['dry_run', 'success', 'REF_NOT_FOUND', 'REF_REVALIDATION_REQUIRED', 'REF_STALE', 'REF_UNSUPPORTED', 'ACTION_INCOMPATIBLE', 'REF_AMBIGUOUS', 'REF_REVALIDATION_FAILED', 'MISSING_ARG', 'INVALID_ARG', 'UNKNOWN_ARG', 'UNKNOWN_FLAG'],
  },
  drag: {
    supported_backends: {
      browser: ['snapshot_scoped'],
    },
    dry_run: true,
    real_mutation: {
      browser: true,
    },
    required_args: ['source ref target', 'destination ref target'],
    optional_args: [],
    mutation_risk: 'medium',
    validation: 'both browser refs must be from the same snapshot and session; each endpoint requires fresh page/frame/navigation identity and exactly one enabled action-compatible current xray element before real dispatch',
    known_limits: {
      browser: 'browser drag is allowed only after both endpoints pass same-session, same-snapshot, page, frame, navigation, role, title, label, context, enabled state, and uniqueness validation',
    },
    statuses: ['dry_run', 'success', 'REF_NOT_FOUND', 'REF_REVALIDATION_REQUIRED', 'REF_STALE', 'REF_UNSUPPORTED', 'ACTION_INCOMPATIBLE', 'REF_AMBIGUOUS', 'REF_REVALIDATION_FAILED', 'MISSING_ARG', 'INVALID_REF_TARGET', 'UNKNOWN_ARG', 'UNKNOWN_FLAG'],
  },
  'set-value': {
    supported_backends: {
      aos_canvas: ['reacquirable'],
      native_ax: ['stable'],
    },
    dry_run: true,
    real_mutation: {
      aos_canvas: true,
      native_ax: true,
    },
    required_args: ['ref target', '--value or positional value'],
    optional_args: [],
    mutation_risk: 'medium',
    validation: 'canvas refs use current canvas target resolution; native AX refs require durable saved native identity facts plus an actionable native producer verdict and route through direct AX current matching semantics',
    known_limits: {
      aos_canvas: 'only current single-value canvas controls with existing semantic value handling are supported',
      native_ax: 'native AX set-value saved refs require durable pid/window/AX identifier/enabled-state/action/permission/baseline facts plus an actionable native_saved_ref_evidence producer verdict, block captured off-Space/minimized/custom/canvas-game/focus-mismatch states, and still do not claim no-foreground proof',
    },
    statuses: ['dry_run', 'success', 'REF_NOT_FOUND', 'REF_UNSUPPORTED', 'ACTION_INCOMPATIBLE', 'REF_AMBIGUOUS', 'MISSING_ARG', 'INVALID_ARG', 'UNKNOWN_ARG', 'UNKNOWN_FLAG', 'AX_TARGET_NOT_FOUND'],
  },
  focus: {
    supported_backends: {
      native_ax: ['stable'],
    },
    dry_run: true,
    real_mutation: {
      native_ax: true,
    },
    required_args: ['ref target'],
    optional_args: [],
    mutation_risk: 'medium',
    validation: 'native AX refs require durable saved native identity facts plus an actionable native producer verdict and route through direct AX current matching semantics',
    known_limits: {
      native_ax: 'native AX focus saved refs require durable pid/window/AX identifier/enabled-state/action/permission/baseline facts plus an actionable native_saved_ref_evidence producer verdict, block captured off-Space/minimized/custom/canvas-game/focus-mismatch states, and still do not claim no-foreground proof',
    },
    statuses: ['dry_run', 'success', 'REF_NOT_FOUND', 'REF_UNSUPPORTED', 'ACTION_INCOMPATIBLE', 'REF_AMBIGUOUS', 'UNKNOWN_ARG', 'UNKNOWN_FLAG', 'AX_TARGET_NOT_FOUND'],
  },
  press: {
    supported_backends: {
      native_ax: ['stable'],
    },
    dry_run: true,
    real_mutation: {
      native_ax: true,
    },
    required_args: ['ref target'],
    optional_args: [],
    mutation_risk: 'high',
    validation: 'native AX refs require durable saved native identity facts plus an actionable native producer verdict and route through direct AX current matching semantics',
    known_limits: {
      native_ax: 'native AX press saved refs require durable pid/window/AX identifier/enabled-state/action/permission/baseline facts plus an actionable native_saved_ref_evidence producer verdict, block captured off-Space/minimized/custom/canvas-game/focus-mismatch states, and still do not claim no-foreground proof',
    },
    statuses: ['dry_run', 'success', 'REF_NOT_FOUND', 'REF_UNSUPPORTED', 'ACTION_INCOMPATIBLE', 'REF_AMBIGUOUS', 'UNKNOWN_ARG', 'UNKNOWN_FLAG', 'AX_TARGET_NOT_FOUND'],
  },
  type: {
    supported_backends: {
      browser: ['snapshot_scoped'],
    },
    dry_run: true,
    real_mutation: {
      browser: true,
    },
    required_args: ['ref target', 'text'],
    optional_args: [],
    mutation_risk: 'high',
    validation: 'browser refs require fresh page/frame/navigation identity and exactly one enabled text-compatible current xray element before real dispatch',
    known_limits: {
      browser: 'browser saved-ref type is allowed only for text-compatible refs after page, frame, navigation, role, title, label, context, enabled state, and uniqueness validation pass',
    },
    statuses: ['dry_run', 'success', 'REF_NOT_FOUND', 'REF_REVALIDATION_REQUIRED', 'REF_STALE', 'REF_UNSUPPORTED', 'ACTION_INCOMPATIBLE', 'REF_AMBIGUOUS', 'REF_REVALIDATION_FAILED', 'MISSING_ARG', 'UNKNOWN_ARG', 'UNKNOWN_FLAG'],
  },
  key: {
    supported_backends: {
      browser: ['snapshot_scoped'],
    },
    dry_run: true,
    real_mutation: {
      browser: true,
    },
    required_args: ['ref target', 'key combo'],
    optional_args: [],
    mutation_risk: 'high',
    validation: 'browser refs require fresh page/frame/navigation identity and exactly one enabled text-compatible current xray element before real dispatch',
    known_limits: {
      browser: 'browser saved-ref key is allowed only for text-compatible refs after page, frame, navigation, role, title, label, context, enabled state, and uniqueness validation pass',
    },
    statuses: ['dry_run', 'success', 'REF_NOT_FOUND', 'REF_REVALIDATION_REQUIRED', 'REF_STALE', 'REF_UNSUPPORTED', 'ACTION_INCOMPATIBLE', 'REF_AMBIGUOUS', 'REF_REVALIDATION_FAILED', 'MISSING_ARG', 'UNKNOWN_ARG', 'UNKNOWN_FLAG'],
  },
};

export const SAVED_REF_V0_ACTION_MATRIX_ROWS = Object.freeze(
  Object.entries(SAVED_REF_V0_ACTION_MATRIX).map(([action, contract]) => Object.freeze({
    action,
    supported_backends: Object.freeze(Object.fromEntries(
      Object.entries(contract.supported_backends).map(([backend, classes]) => [backend, Object.freeze([...classes])]),
    )),
    dry_run: contract.dry_run,
    real_mutation: Object.freeze({ ...contract.real_mutation }),
    required_args: Object.freeze([...contract.required_args]),
    optional_args: Object.freeze([...contract.optional_args]),
    mutation_risk: contract.mutation_risk,
    validation: contract.validation,
    known_limits: Object.freeze({ ...contract.known_limits }),
    statuses: Object.freeze([...contract.statuses]),
  })),
);

export const SAVED_REF_V0_ACTIONS_BY_BACKEND = Object.freeze(
  Object.fromEntries(SAVED_REF_BACKENDS.map((backend) => [
    backend,
    Object.freeze(Object.entries(SAVED_REF_V0_ACTION_MATRIX)
      .filter(([, contract]) => Object.hasOwn(contract.supported_backends, backend))
      .map(([action]) => action)),
  ])),
);

export function savedRefActionContract(action) {
  return SAVED_REF_V0_ACTION_MATRIX[action] ?? null;
}

export function savedRefSupportedActionsForBackend(backend, producerActions = null) {
  const allowed = SAVED_REF_V0_ACTIONS_BY_BACKEND[backend] ?? [];
  if (!producerActions) return [...allowed];
  const producerSet = new Set((producerActions ?? []).filter(Boolean));
  return allowed.filter((action) => producerSet.has(action));
}

export function savedRefBackendSupportsAction(backend, action) {
  return (SAVED_REF_V0_ACTIONS_BY_BACKEND[backend] ?? []).includes(action);
}

export function savedRefBackendSupportsDryRun(backend, action) {
  return savedRefBackendSupportsAction(backend, action) && savedRefActionContract(action)?.dry_run === true;
}

export function savedRefBackendSupportsRealMutation(backend, action) {
  return savedRefActionContract(action)?.real_mutation?.[backend] === true;
}

export function savedRefResolutionClassesForAction(action, backend) {
  return savedRefActionContract(action)?.supported_backends?.[backend] ?? [];
}

export function savedRefActionKnownLimit(action, backend) {
  return savedRefActionContract(action)?.known_limits?.[backend] ?? null;
}

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

export function savedRefProducerActionsForBrowserElement(element) {
  const role = String(element?.role || '').toLowerCase();
  if (['textbox', 'searchbox', 'combobox', 'input'].includes(role)) {
    return savedRefSupportedActionsForBackend('browser', ['click', 'fill', 'hover', 'scroll', 'drag', 'type', 'key']);
  }
  if (['button', 'link', 'checkbox', 'radio', 'menuitem', 'tab'].includes(role)) {
    return savedRefSupportedActionsForBackend('browser', ['click', 'hover', 'scroll', 'drag']);
  }
  return savedRefSupportedActionsForBackend('browser', ['click', 'hover', 'scroll', 'drag']);
}

export function isSavedRefBackend(value) {
  return SAVED_REF_BACKENDS.includes(value);
}

export function isSavedRefResolutionClass(value) {
  return SAVED_REF_RESOLUTION_CLASSES.includes(value);
}

export function isSavedRefConfidence(value) {
  return SAVED_REF_CONFIDENCE_VALUES.includes(value);
}
