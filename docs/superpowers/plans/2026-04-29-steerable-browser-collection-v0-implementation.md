# Steerable Browser Collection V0 Implementation

Tracking epic: GitHub issue #141.

Child issues:

- #143 — Schemas and browser fixtures
- #144 — Run-control plane and action gate
- #145 — Ambient run puck canvas
- #146 — Browser intent sensor
- #147 — Session and source-pack writer
- #148 — Deterministic demo and recipe

## Implementation Order

1. Lock shared schemas and browser-only fixtures first. This is the contract
   checkpoint for all downstream code.
2. Add toolkit run-control logic and action gating as pure JavaScript modules.
   The state machine is testable without a daemon.
3. Add the run puck as a sibling toolkit canvas using the existing bridge and
   input normalization APIs.
4. Add browser intent canonicalization and in-page install helpers. The
   canonicalizer owns locator candidate generation and deterministic primary
   selection.
5. Add a Node-compatible source-pack writer under
   `src/sessions/steerable-collection/`. Live output follows the existing
   mode-scoped state root convention.
6. Add a deterministic demo, checked-in sample source pack, API docs, and the
   operator recipe.

## Verification

Focused gates:

```bash
node --test tests/schemas/steerable-collection.test.mjs
node --test tests/toolkit/run-control-*.test.mjs tests/toolkit/run-puck-*.test.mjs
node --test tests/toolkit/browser-intent-canonicalize.test.mjs
node --test tests/steerable-collection-source-pack.test.mjs
```

No Swift rebuild is required for this V0 substrate because the implementation
adds schemas, toolkit JavaScript, docs, fixtures, and a Node-compatible
source-pack writer only.
