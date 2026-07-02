export const AGENT_WORKSPACE_SCHEMA_VERSION = 'aos.agent-workspace.v0';

export const CAPTURE_MODE_VALUES = ['ax', 'vision', 'som'];
export const SAVED_REF_BACKENDS = ['aos_canvas', 'browser', 'native_ax'];
export const SAVED_REF_RESOLUTION_CLASSES = [
  'stable',
  'reacquirable',
  'snapshot_scoped',
  'volatile',
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
    optional_args: ['--right', '--double', '--dwell'],
    mutation_risk: 'medium',
    validation: 'canvas refs use current canvas target resolution; browser refs require fresh page/frame/navigation identity and exactly one enabled matching current xray element before real dispatch',
    known_limits: {
      browser: 'browser saved refs fail closed when page, frame, navigation, role, title, label, context, enabled state, or uniqueness validation fails',
      aos_canvas: 'canvas refs are re-read from the current canvas; missing, disabled, segmented, or ambiguous current targets fail closed',
    },
    statuses: ['dry_run', 'success', 'REF_REVALIDATION_REQUIRED', 'REF_STALE', 'REF_UNSUPPORTED', 'ACTION_INCOMPATIBLE', 'REF_AMBIGUOUS', 'REF_REVALIDATION_FAILED'],
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
    statuses: ['dry_run', 'success', 'REF_REVALIDATION_REQUIRED', 'REF_STALE', 'ACTION_INCOMPATIBLE', 'REF_AMBIGUOUS', 'REF_REVALIDATION_FAILED', 'MISSING_ARG'],
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
    statuses: ['dry_run', 'success', 'REF_REVALIDATION_REQUIRED', 'REF_STALE', 'ACTION_INCOMPATIBLE', 'REF_AMBIGUOUS', 'REF_REVALIDATION_FAILED'],
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
    statuses: ['dry_run', 'success', 'REF_REVALIDATION_REQUIRED', 'REF_STALE', 'ACTION_INCOMPATIBLE', 'REF_AMBIGUOUS', 'REF_REVALIDATION_FAILED', 'MISSING_ARG', 'INVALID_ARG'],
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
    statuses: ['dry_run', 'success', 'REF_REVALIDATION_REQUIRED', 'REF_STALE', 'REF_UNSUPPORTED', 'ACTION_INCOMPATIBLE', 'REF_AMBIGUOUS', 'REF_REVALIDATION_FAILED', 'MISSING_ARG', 'INVALID_REF_TARGET'],
  },
  'set-value': {
    supported_backends: {
      aos_canvas: ['reacquirable'],
    },
    dry_run: true,
    real_mutation: {
      aos_canvas: true,
    },
    required_args: ['ref target', '--value or positional value'],
    optional_args: [],
    mutation_risk: 'medium',
    validation: 'canvas refs use current canvas target resolution',
    known_limits: {
      aos_canvas: 'only current single-value canvas controls with existing semantic value handling are supported',
    },
    statuses: ['dry_run', 'success', 'REF_UNSUPPORTED', 'ACTION_INCOMPATIBLE', 'REF_AMBIGUOUS', 'MISSING_ARG'],
  },
  focus: {
    supported_backends: {},
    dry_run: false,
    real_mutation: {},
    required_args: ['ref target'],
    optional_args: [],
    mutation_risk: 'medium',
    validation: 'unsupported for saved refs in v0',
    known_limits: {},
    statuses: ['REF_UNSUPPORTED', 'ACTION_INCOMPATIBLE'],
  },
  press: {
    supported_backends: {},
    dry_run: false,
    real_mutation: {},
    required_args: ['ref target'],
    optional_args: [],
    mutation_risk: 'high',
    validation: 'unsupported for saved refs in v0',
    known_limits: {},
    statuses: ['REF_UNSUPPORTED', 'ACTION_INCOMPATIBLE'],
  },
  type: {
    supported_backends: {},
    dry_run: false,
    real_mutation: {},
    required_args: ['command-specific'],
    optional_args: [],
    mutation_risk: 'high',
    validation: 'unsupported for saved refs in v0; ref:* can be literal typed text for native type paths',
    known_limits: {},
    statuses: ['ACTION_INCOMPATIBLE', 'REF_UNSUPPORTED'],
  },
  key: {
    supported_backends: {},
    dry_run: false,
    real_mutation: {},
    required_args: ['command-specific'],
    optional_args: [],
    mutation_risk: 'high',
    validation: 'unsupported for saved refs in v0',
    known_limits: {},
    statuses: ['ACTION_INCOMPATIBLE', 'REF_UNSUPPORTED'],
  },
};

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
