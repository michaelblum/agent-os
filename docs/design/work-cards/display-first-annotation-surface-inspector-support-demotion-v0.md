# Display-First Annotation Surface Inspector Support Demotion V0

## Tracker

- Active issue: https://github.com/michaelblum/agent-os/issues/296
- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Direction note:
  `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- Sequence:
  `docs/design/work-cards/display-first-annotation-mode-implementation-sequence-v0.md`
- Builds on accepted slices:
  - `94a46bd Preserve annotation anchor data on status refresh`
  - `a082196 Add display-first annotation overlay renderer`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing. Work in `/Users/Michael/Code/agent-os`, not in `.docks/`.

The shared session model and overlay renderer are already implemented in:

- `packages/toolkit/workbench/annotation-session.js`
- `packages/toolkit/workbench/annotation-overlay-renderer.js`

Do not reimplement those state machines. This slice should make Surface
Inspector consume and present the shared display-first model as a support and
diagnostic surface.

## Goal

Demote Surface Inspector annotation UI from primary authoring surface to support
surface.

Surface Inspector should keep entry/exit, snapshot, current scope/path, adapter
evidence, anchor counts, and stale/blocker diagnostics. It should stop
presenting inspector list rows, visible pin controls, or minimap actions as the
main annotation workflow. Display overlays remain the primary live visual
surface for frames, preview, hover, comments, and stale/blocked states.

## Read First

- `AGENTS.md`
- `docs/design/display-first-annotation-mode-and-sigil-reticle.md`
- `docs/design/work-cards/display-first-annotation-mode-implementation-sequence-v0.md`
- `docs/design/work-cards/display-first-annotation-session-model-v0.md`
- `docs/design/work-cards/display-first-annotation-overlay-renderer-v0.md`
- `packages/toolkit/workbench/annotation-session.js`
- `packages/toolkit/workbench/annotation-overlay-renderer.js`
- `packages/toolkit/workbench/surface-inspector-annotations.js`
- `packages/toolkit/workbench/annotation-projection.js`
- `packages/toolkit/components/surface-inspector/index.js`
- `tests/toolkit/annotation-session.test.mjs`
- `tests/toolkit/annotation-overlay-renderer.test.mjs`
- `tests/toolkit/surface-inspector-annotations.test.mjs`
- `tests/toolkit/surface-inspector.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git log --oneline --decorate -8
./aos ready
./aos dev gh issue view 296 --json
./aos dev recommend --json
```

Use the repo wrapper syntax exactly as shown for GitHub issue discovery. Do not
append a raw `gh issue view --json <fields>` field list to
`./aos dev gh issue view`; the wrapper expects one issue number plus `--json`.

If `./aos ready` reports a repo-mode TCC/input-tap blocker, stop and report the
blocker with the concrete human recovery step. This slice has deterministic
tests, but the UI demotion affects live display behavior and should receive a
bounded Operator smoke before acceptance.

If `./aos dev recommend --json` reports broad changed files because the branch
is ahead of origin, treat that as branch context rather than this card's test
scope. Prefer focused toolkit tests unless current dirty state touches Swift,
schema, or command-contract files.

## Existing Code To Inspect

- `packages/toolkit/components/surface-inspector/index.js` - currently renders
  annotation mode controls, scope breadcrumbs, pin/comment rows, inspector
  editor/confirmation overlays, minimap annotation layer, display action
  controls, hit layers, and controlled display overlays.
- `packages/toolkit/workbench/surface-inspector-annotations.js` - owns legacy
  Surface Inspector annotation state and snapshot compatibility. Internal
  `pin` names may remain at this compatibility boundary.
- `packages/toolkit/workbench/annotation-session.js` - owns the neutral
  session/anchor model, conversion helpers, and opacity helpers.
- `packages/toolkit/workbench/annotation-overlay-renderer.js` - owns the
  session-to-render-plan helper and per-group overlay signatures.
- `tests/toolkit/surface-inspector.test.mjs` - currently asserts some legacy
  inspector authoring controls; update those assertions to the support-surface
  contract.
- `tests/toolkit/surface-inspector-annotations.test.mjs` - preserves state and
  snapshot compatibility; update only where the old Surface Inspector-first
  presentation leaks into the new contract.

## Required Behavior

### Surface Inspector Role

When Annotation Mode is active, Surface Inspector should expose support state:

- mode active/inactive and entry/exit controls;
- current root and current scope/path;
- live anchor count and comment count;
- snapshot count or snapshot-ready state;
- latest hover candidate as transient preview/debug state, not as a durable row;
- adapter evidence for current/active anchors, including adapter id, subject
  address, reveal/project support, stale/absent/blocked status, and blocker
  reason;
- passive minimap projection evidence.

Surface Inspector should not be the primary place where a user authors
annotations. Remove, hide, or replace primary list-row/pin-icon authoring flows
from the new active-mode UI. In particular, avoid making visible inspector
controls for selecting, revealing, copying, removing, or expanding pins look like
the main annotation workflow.

Use neutral product language in new UI and tests: frame, anchor, annotation,
scope, subject, and comment. Internal `pin` naming may remain where renaming
would add churn.

### Shared Session Consumption

Surface Inspector support views should consume the shared annotation session or
a clearly bounded adapter from legacy state to session:

- committed scope comes from session scope/anchors;
- hover candidate remains preview-only;
- frame anchors can be commentless;
- comments are optional text on anchors;
- subject address is authoritative;
- projection/status is current evidence only.

Do not grow another parallel annotation state machine. If a temporary adapter is
needed for legacy state, keep it small and close to the compatibility boundary.

### Display-First Interaction Preservation

Do not regress the accepted display overlay renderer behavior:

- overlay groups use renderer-provided per-group signatures;
- live frame rects are drawn from projected frame rects in canvas-local
  coordinates;
- stale/absent/null-rect frames are not drawn as full-canvas stale borders;
- repeated hover over the same candidate does not spam overlay create/update
  work.

This card may keep the existing display action-control canvases if removing them
would leave no display-first anchor creation path. If they remain, their role
must be treated as display-surface compatibility, not Surface Inspector list
authoring.

### Minimap

The minimap is passive evidence:

- it may show projected annotation state and blockers;
- it must not be an action surface for authoring, deleting, selecting, or
  revealing anchors;
- transient hover candidates must not become durable minimap rows or action
  targets.

### Snapshot Compatibility

Keep existing annotation snapshot artifact compatibility. This slice should not
change snapshot schema or bundle file contracts unless a tiny compatibility
field is unavoidable. If a UI label changes from pin to frame/anchor, keep the
artifact data shape compatible unless the card reveals a real contract bug.

## Scope

Ownership is toolkit component/workbench:

- Surface Inspector owns the support UI surface;
- workbench helpers own shared annotation session and render-plan behavior;
- daemon/native primitives should not encode annotation UI policy;
- Sigil is out of scope for this slice.

## Hard Boundaries / Non-Goals

- No Sigil reticle implementation.
- No full drag/keyboard interaction router.
- No settled reprojection engine.
- No browser DOM/CDP adapter expansion.
- No broad AX harvesting.
- No snapshot schema redesign.
- No long-lived persistent annotation database.
- No removal of deterministic snapshot compatibility tests.
- No move of toolkit annotation policy into the daemon.
- No Employer Brand workflow changes.

## Suggested Implementation Areas

After reading the code, likely edits are:

- `packages/toolkit/components/surface-inspector/index.js`
  - replace active Annotation Mode list authoring rows with support summary and
    diagnostic state;
  - keep entry/exit, scope path/back, clear, snapshot/support state, and
    blocker diagnostics;
  - remove or hide primary pin row buttons from active-mode UI;
  - preserve display overlay and hit/action compatibility where still needed.
- `tests/toolkit/surface-inspector.test.mjs`
  - assert the new support-surface contract and absence of primary list-row
    authoring controls in active Annotation Mode.
- `tests/toolkit/surface-inspector-annotations.test.mjs`
  - keep state/snapshot compatibility; update only assertions that encode the
    superseded Surface Inspector-first presentation.

Add a helper in `packages/toolkit/workbench/` only if it keeps the Canvas
Inspector component from growing presentation-specific data wrangling.

## Verification

Run focused deterministic checks:

```bash
node --test tests/toolkit/surface-inspector.test.mjs
node --test tests/toolkit/surface-inspector-annotations.test.mjs
node --test tests/toolkit/annotation-session.test.mjs
node --test tests/toolkit/annotation-overlay-renderer.test.mjs
node --test tests/toolkit/annotation-projection.test.mjs
git diff --check
```

If `./aos ready` passes, run one bounded live smoke:

1. Open Surface Inspector.
2. Enable Annotation Mode.
3. Create or reuse a visible frame anchor/comment through the current
   display-surface path.
4. Verify Surface Inspector shows support state, current path, counts, and
   stale/blocker diagnostics without making list rows or pin controls the
   primary authoring UI.
5. Verify display overlays still update on hover/comment/projection changes.
6. Verify the minimap remains passive.
7. Clean up smoke canvases.

If live readiness is blocked, report the exact blocker and deterministic
coverage completed.

## Completion Report

Report:

- changed files;
- how Surface Inspector now presents annotation support state;
- which inspector list-row/pin-icon authoring controls were removed, hidden, or
  replaced;
- how the shared session model or compatibility adapter is consumed;
- how transient hover candidates are kept preview-only;
- how minimap passivity is preserved;
- deterministic tests and results;
- live smoke result or readiness blocker;
- final `git status --short --branch`;
- recommended next card, likely Sigil reticle visual validation or settled
  reprojection depending on remaining #296 gaps.
