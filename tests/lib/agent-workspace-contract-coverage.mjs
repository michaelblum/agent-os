export const AGENT_WORKSPACE_V0_CONTRACT_COVERAGE = Object.freeze({
  workspace_selection: Object.freeze({
    required_doc_terms: Object.freeze([
      'Workspace selection is command-scoped',
      'AOS_AGENT_WORKSPACE',
      '`--workspace <id>`',
      'AOS uses `default`',
      'No daemon-held current workspace exists',
      '`aos see workspace use <id>` is not a current command',
      'recommended_next_command',
      'aos show wait',
      'Work Record postconditions',
    ]),
    required_doc_patterns: Object.freeze([
      /parallel agents|parallel-session/,
      /Current wait\/diff\/assertion boundary/,
    ]),
    unsupported_saved_workspace_commands: Object.freeze([
      'aos see capture --wait-for-change',
      'aos see capture --until-stable',
      'aos see refs --diff',
      'aos see assert',
    ]),
  }),
  capture_source: Object.freeze({
    source_flag_usage: Object.freeze(['--region <rect>', '--canvas <id>', '--channel <id>']),
    api_terms: Object.freeze([
      'Saved capture uses the same capture-source contract as ordinary capture',
      'defaults to `main`',
      'source forms are',
      'capture_source',
    ]),
    schema_terms: Object.freeze([
      'capture_source',
      'Positional target and source-flag forms',
      'exclusive',
    ]),
    skill_terms: Object.freeze([
      'A saved capture source can be a positional target',
      'capture defaults to',
      'source forms are mutually exclusive',
    ]),
  }),
  do_action_tiers: Object.freeze([
    Object.freeze({
      action: 'click',
      api_terms: Object.freeze(['coordinates', 'saved refs', 'direct browser targets', 'AOS canvas semantic refs']),
    }),
    Object.freeze({
      action: 'hover',
      api_terms: Object.freeze(['saved/browser hover', 'coordinate hover']),
    }),
    Object.freeze({
      action: 'drag',
      api_terms: Object.freeze(['saved/browser two-endpoint drag', 'direct canvas semantic drag', '--by', '--to-value', 'native coordinate drag']),
      api_forbidden_terms: Object.freeze(['drag between coordinates, browser refs, or AOS canvas semantic refs']),
    }),
    Object.freeze({
      action: 'scroll',
      api_terms: Object.freeze(['saved/browser scroll', 'dx,dy', 'coordinate scroll', '--dx', '--dy']),
    }),
    Object.freeze({
      action: 'type',
      api_terms: Object.freeze(['literal native text input', 'direct browser target text', 'no saved-ref action']),
    }),
    Object.freeze({
      action: 'key',
      api_terms: Object.freeze(['literal native key combo', 'direct browser target key press', 'no saved-ref action']),
    }),
    Object.freeze({
      action: 'press',
      api_terms: Object.freeze(['saved native AX press', 'direct `--pid` / `--role` AX press']),
    }),
    Object.freeze({
      action: 'set-value',
      api_terms: Object.freeze(['saved refs', 'direct AX', 'AOS canvas semantic set-value']),
    }),
    Object.freeze({
      action: 'focus',
      api_terms: Object.freeze(['saved native AX focus', 'direct `--pid` / `--role` AX focus']),
    }),
  ]),
});
