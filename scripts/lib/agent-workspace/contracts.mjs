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

export const SAVED_REF_V0_ACTION_MATRIX = {
  click: {
    supported_backends: {
      aos_canvas: ['reacquirable'],
      browser: ['snapshot_scoped'],
    },
    dry_run: true,
    required_args: ['ref target'],
    optional_args: ['--right', '--double', '--dwell'],
    mutation_risk: 'medium',
    validation: 'canvas refs use current canvas target resolution; browser refs only receive advisory xray validation and real mutation fails closed',
    statuses: ['dry_run', 'success', 'REF_REVALIDATION_REQUIRED', 'REF_STALE', 'REF_UNSUPPORTED', 'ACTION_INCOMPATIBLE', 'REF_AMBIGUOUS', 'REF_REVALIDATION_FAILED'],
  },
  fill: {
    supported_backends: {
      browser: ['snapshot_scoped'],
    },
    dry_run: true,
    required_args: ['ref target', 'text'],
    optional_args: [],
    mutation_risk: 'medium',
    validation: 'browser refs only receive advisory xray validation and real mutation fails closed',
    statuses: ['dry_run', 'REF_REVALIDATION_REQUIRED', 'REF_STALE', 'ACTION_INCOMPATIBLE', 'REF_AMBIGUOUS', 'REF_REVALIDATION_FAILED', 'MISSING_ARG'],
  },
  hover: {
    supported_backends: {
      browser: ['snapshot_scoped'],
    },
    dry_run: true,
    required_args: ['ref target'],
    optional_args: [],
    mutation_risk: 'low',
    validation: 'browser refs only receive advisory xray validation and real mutation fails closed',
    statuses: ['dry_run', 'REF_REVALIDATION_REQUIRED', 'REF_STALE', 'ACTION_INCOMPATIBLE', 'REF_AMBIGUOUS', 'REF_REVALIDATION_FAILED'],
  },
  scroll: {
    supported_backends: {
      browser: ['snapshot_scoped'],
    },
    dry_run: true,
    required_args: ['ref target', 'dx,dy'],
    optional_args: [],
    mutation_risk: 'medium',
    validation: 'browser refs only receive advisory xray validation and real mutation fails closed',
    statuses: ['dry_run', 'REF_REVALIDATION_REQUIRED', 'REF_STALE', 'ACTION_INCOMPATIBLE', 'REF_AMBIGUOUS', 'REF_REVALIDATION_FAILED', 'MISSING_ARG', 'INVALID_ARG'],
  },
  drag: {
    supported_backends: {
      browser: ['snapshot_scoped'],
    },
    dry_run: true,
    required_args: ['source ref target', 'destination ref target'],
    optional_args: [],
    mutation_risk: 'medium',
    validation: 'both browser refs must be from the same snapshot and session; xray validation is advisory and real mutation fails closed',
    statuses: ['dry_run', 'REF_REVALIDATION_REQUIRED', 'REF_STALE', 'REF_UNSUPPORTED', 'ACTION_INCOMPATIBLE', 'REF_AMBIGUOUS', 'REF_REVALIDATION_FAILED', 'MISSING_ARG', 'INVALID_REF_TARGET'],
  },
  'set-value': {
    supported_backends: {
      aos_canvas: ['reacquirable'],
    },
    dry_run: true,
    required_args: ['ref target', '--value or positional value'],
    optional_args: [],
    mutation_risk: 'medium',
    validation: 'canvas refs use current canvas target resolution',
    statuses: ['dry_run', 'success', 'REF_UNSUPPORTED', 'ACTION_INCOMPATIBLE', 'REF_AMBIGUOUS', 'MISSING_ARG'],
  },
  focus: {
    supported_backends: {},
    dry_run: false,
    required_args: ['ref target'],
    optional_args: [],
    mutation_risk: 'medium',
    validation: 'unsupported for saved refs in v0',
    statuses: ['REF_UNSUPPORTED', 'ACTION_INCOMPATIBLE'],
  },
  press: {
    supported_backends: {},
    dry_run: false,
    required_args: ['ref target'],
    optional_args: [],
    mutation_risk: 'high',
    validation: 'unsupported for saved refs in v0',
    statuses: ['REF_UNSUPPORTED', 'ACTION_INCOMPATIBLE'],
  },
  type: {
    supported_backends: {},
    dry_run: false,
    required_args: ['command-specific'],
    optional_args: [],
    mutation_risk: 'high',
    validation: 'unsupported for saved refs in v0; ref:* can be literal typed text for native type paths',
    statuses: ['ACTION_INCOMPATIBLE', 'REF_UNSUPPORTED'],
  },
  key: {
    supported_backends: {},
    dry_run: false,
    required_args: ['command-specific'],
    optional_args: [],
    mutation_risk: 'high',
    validation: 'unsupported for saved refs in v0',
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

export function savedRefResolutionClassesForAction(action, backend) {
  return savedRefActionContract(action)?.supported_backends?.[backend] ?? [];
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
