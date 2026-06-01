# AOS Native Agent-Ready UI Contract V0

## Recipient

GDI implementation/design round.

## Branch / Base

- branch_from: `gdi/post-refactor-real-input-dogfooding-corrections-v0`
- required_start_ref: current branch checkpoint
- expected output branch: `gdi/post-refactor-real-input-dogfooding-corrections-v0`

## Source Context

User direction: AOS toolkit primitives and components should function as a
framework agents can use to build and operate UI on the fly. AOS-native UI
should be fully agent-ready. Agents should be able to find their way around an
unfamiliar AOS UI through standard AOS/AX semantics instead of ad hoc DOM,
pixel, or app-private folklore.

Relevant existing docs and code:

- `docs/guides/aos-app-accessibility-surfaces.md`
- `docs/guides/aos-surface-interaction-decision-tree.md`
- `tests/README.md`
- `apps/sigil/AGENTS.md`
- `apps/sigil/renderer/hit-area.html`
- `apps/sigil/renderer/radial-menu-surface.html`
- `apps/sigil/context-menu/menu.js`
- `apps/sigil/avatar-editor/compact-surface.js`
- `packages/toolkit/controls/`
- `packages/toolkit/panel/`
- `packages/toolkit/workbench/`
- `tests/renderer/radial-menu-target-surface.test.mjs`
- `tests/sigil-hit-target-drag-fast-travel.sh`
- `tests/scenarios/sigil/radial-menu/real-input.sh`

## Goal

Make the current AOS-native UI contract explicit and executable enough that
tests and agents can operate AOS toolkit/Sigil UI by semantic control identity
rather than CSS selectors, magic pixels, or renderer debug shortcuts.

For AOS-owned surfaces, pixel inference is not an acceptable primary operation
path. AOS `see`/`do` should make agents operate AOS-native UI through
DOM/AX-shaped semantic structure, control metadata, and action contracts. Pixel
inspection is reserved for visual design evaluation, screenshots as evidence,
alignment diagnostics, or last-resort failure forensics when the semantic
contract is missing or broken.

This is not a full framework rebuild. The single next goal is to define and
prove the smallest useful V0 contract for agent-ready AOS-native controls, then
apply it to one Sigil path that is currently too ad hoc.

## Required Outcome

Produce a small, reviewable V0 that answers:

1. What must every AOS-native actionable control expose for agents?
2. How does an agent discover an unfamiliar AOS-native control?
3. How does a test or recipe operate that control without private DOM selectors?
4. How do Sigil avatar/radial/context-menu surfaces fit the same stack?
5. Which current AOS-native test paths still rely on pixel inference, magic
   numbers, private selectors, or renderer debug shortcuts, and what missing
   semantic/control primitive would remove each dependency?

## Contract Shape To Evaluate

Start from the existing AX/semantic-target direction. Prefer standard roles and
human-readable names, with AOS identity in metadata.

A useful V0 target shape may include:

```json
{
  "id": "sigil-menu-fast-travel-effect",
  "ref": "aos.control:sigil-menu-fast-travel-effect",
  "role": "AXRadioGroup",
  "name": "Fast Travel Effect",
  "value": "line",
  "options": [
    { "value": "line", "name": "Line", "selected": true },
    { "value": "wormhole", "name": "Wormhole", "selected": false }
  ],
  "enabled": true,
  "bounds": [0, 0, 0, 0],
  "actions": ["set_value"],
  "canvas_id": "avatar-main",
  "owner": "sigil"
}
```

Do not invent a parallel agent-only language if existing AX/ARIA plus
`semantic_targets`, `data-aos-ref`, `data-aos-action`, and descriptor ids can
carry the contract.

## Implementation Direction

Prefer this progression:

1. Audit the existing AOS-native surface contract in docs and tests.
2. Add or update a concise doc section defining "agent-ready AOS-native
   controls" and the minimum metadata/actions they must expose.
3. Add the smallest toolkit helper for discovering/operating controls by
   semantic identity, not CSS selector. This can live in tests first if a
   production `aos do control ...` command is too large for V0, but the helper
   must name the missing command primitive clearly.
4. Apply it to one concrete Sigil path, preferably fast-travel effect selection
   in the compact context menu or radial item selection.
5. Update or add focused tests proving the helper uses stable semantic/control
   identity.

## Sigil Expectations

- The radial menu should be treated as an AOS-native semantic surface built on
  reusable AOS primitives. Tests should target named radial items through
  semantic targets or a reusable helper such as `select_radial_item("context-menu")`.
- The avatar hit target should adhere to standard AOS patterns: stable child
  surface, AX/semantic role/name/frame, daemon-routed behavior, and no private
  input folklore.
- Compact context-menu controls should be operable through descriptor/control
  identity, not raw selectors like
  `.aos-form-field[data-descriptor-id="..."] .aos-segmented ...` in scenario
  tests.
- Real-input scenarios may use physical pointer movement at the final input
  boundary, but target discovery must still come from AOS semantic/control
  contracts rather than screenshot interpretation or unexplained coordinates.

## No-Pixels Primary Contract

When the target is an AOS-owned surface, the default agent path should be:

```text
see semantic/control tree -> resolve target ref -> do semantic action -> see -> verify
```

It should not be:

```text
screenshot -> infer pixels -> guess coordinate -> click -> inspect debug state
```

If a current test or recipe must use a pixel, CSS selector, or magic coordinate
for an AOS-native control, classify that as a missing contract. Either add the
smallest semantic/control primitive in this slice or record a concrete follow-up
with the affected control, missing role/ref/action/value, and the temporary
fallback being used.

## Boundaries

- Do not rewrite all toolkit controls in this slice.
- Do not block on live real-input if repo-mode readiness is degraded.
- Do not remove current Sigil behavior or reticle/selection subsystems.
- Do not create app-private agent APIs for Sigil when a toolkit/AOS primitive is
  the right layer.
- Do not weaken AX/ARIA semantics by stuffing machine ids into accessible names.
- Do not normalize pixel inference as the operating model for AOS-native UI.

## Verification

Run the smallest relevant deterministic checks for touched files. Likely
commands include:

```bash
git diff --check
node --test tests/renderer/radial-menu-target-surface.test.mjs
node --test tests/renderer/context-menu-hit-test.test.mjs
node --test tests/renderer/hit-target.test.mjs tests/renderer/sigil-input-regions.test.mjs
bash -n tests/lib/*.sh tests/*.sh tests/scenarios/sigil/radial-menu/*.sh
```

If adding a test helper under `tests/lib`, include a focused test or shell proof
that it discovers controls by semantic/control identity and does not depend on
private CSS beyond the helper boundary.

If live readiness is clean and the slice touches real radial/avatar operation,
run the canonical real-input scenario:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
```

If readiness is degraded, report the blocker instead.

## Completion Report

Include:

- branch and head SHA;
- files changed;
- proposed/implemented V0 contract;
- whether this is test-helper-only or includes production AOS/toolkit control
  discovery;
- the Sigil path converted or proven;
- verification results;
- missing command primitive, if the implementation remains test-helper-only;
- follow-up slices for broader toolkit component coverage.
