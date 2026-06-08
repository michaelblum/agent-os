# AOS TCC Capability Broker Refactor Map V0

This map sequences follow-on work after
`docs/adr/0015-aos-tcc-capability-broker-boundary.md`. It is a roadmap only;
this slice does not refactor source behavior.

## 1. Inventory Remaining Swift Public And Runtime Policy

Goal: classify remaining Swift command/runtime behavior as broker primitive,
external composition, or remove/cut over.

Likely files:

- `src/main.swift`
- `src/commands/`
- `src/daemon/`
- `src/shared/external-command-dispatch.swift`
- `manifests/commands/aos-external-commands.json`
- `manifests/commands/aos-commands.json`
- `docs/dev/command-surface.md`

Stop conditions:

- any candidate requires a new native primitive before extraction;
- any route appears to serve a real external release boundary that needs a
  removal gate;
- inventory cannot distinguish bootstrap-native routes from public policy.

Acceptance evidence:

- a table of every public `$AOS_PATH` route and remaining direct Swift command
  path;
- each row classified as broker primitive, external composition, or remove/cut
  over;
- explicit no-shim decisions for in-repo callers;
- focused `rg` checks showing no unclassified public-policy entry points.

## 2. Extract Runtime And Readiness Policy

Goal: move runtime/readiness workflow policy out of
`src/commands/operator.swift` and adjacent Swift command code while preserving
small private broker primitives for native facts/actions.

Likely files:

- `src/commands/operator.swift`
- `src/commands/ready.swift`
- `src/commands/status.swift`
- `src/commands/doctor.swift`
- `scripts/aos-*.mjs`
- `manifests/commands/aos-external-commands.json`
- `tests/external-command-dispatch.sh`
- command/help contract tests

Stop conditions:

- extraction would require rebuilding `./aos` without an accepted native
  primitive design;
- readiness depends on a missing TCC/input-tap probe;
- behavior cannot be proven without live TCC access.

Acceptance evidence:

- public `ready` behavior routes through external composition;
- Swift exposes only private broker primitives for native readiness facts or
  actions;
- existing readiness output expectations are updated rather than shimmed;
- no-build command-surface tests pass.

## 3. Extract Status And Doctor Presentation

Goal: keep native status/doctor facts in the broker and move presentation,
interpretation, recovery text, and next actions outside Swift.

Likely files:

- `src/commands/status.swift`
- `src/commands/doctor.swift`
- `scripts/aos-status*.mjs`
- `scripts/aos-doctor*.mjs`
- `manifests/commands/aos-commands.json`
- `manifests/commands/aos-external-commands.json`
- tests covering help and JSON output

Stop conditions:

- a status field is not available through a private stable primitive;
- a doctor check mutates native state and needs primitive separation first;
- output contracts are ambiguous between agent JSON and user text.

Acceptance evidence:

- native status/doctor primitives return structured facts only;
- public status/doctor commands perform presentation externally;
- recovery and next-action strings are absent from Swift public policy paths;
- JSON and help contract tests prove the new route.

## 4. Extract Permissions Workflow Policy

Goal: preserve native TCC probes/reset primitives where truly required and move
permission workflow sequencing, explanations, and human-action text outside the
binary.

Likely files:

- `src/commands/permissions.swift`
- `src/commands/ready.swift`
- the manual TCC blocker report path
- scripts or packages that own permission workflow composition
- manifests and help metadata

Stop conditions:

- a TCC grant cannot be observed without adding or changing a native primitive;
- the workflow would open Settings, reset permissions, or require human action
  without a bounded handoff contract;
- live TCC verification is blocked and no deterministic check can prove the
  change.

Acceptance evidence:

- Swift permission code exposes native probes/reset primitives only;
- human-facing permission workflow text and sequencing live outside Swift;
- TCC stall instructions remain dock-owned and do not rebuild or mutate
  `./aos`;
- deterministic tests prove route and output contracts, with live checks routed
  separately when needed.

## 5. Add Guard Tests Against Swift Policy Creep

Goal: keep public command policy, presentation strings, and command-surface
grammar from creeping back into Swift.

Likely files:

- `tests/`
- `scripts/`
- `docs/dev/workflow-rules.json`
- `manifests/commands/`
- source-level allowlists for private broker primitives

Stop conditions:

- the guard would flag unavoidable native error strings without an allowlist;
- tests cannot distinguish public policy from private primitive diagnostics;
- the guard depends on rebuilding the repo-mode binary for docs or manifest
  changes.

Acceptance evidence:

- a machine-checkable guard fails on new public command policy in Swift;
- allowlists are narrow and cite broker primitive reasons;
- `./aos dev recommend` routes the guard for command-surface or Swift broker
  changes;
- tests demonstrate at least one fixture or pattern that would catch a policy
  regression.
