# Context Selection Mode Recording Follow-Through V0

## Recipient

Implementer.

## Transfer Kind

Long-running multi-phase Implementer implementation round.

## Single Goal

Make canonical context artifacts usable as a live product path across Selection
Mode, active context export, and recording primitives, while preserving the
existing reticle, Surface Inspector, radial camera, and clipboard compatibility
paths.

This is one long Implementer round with phase commits. Complete the phases in order
until the goal is done, a documented blocker is reached, or the boundaries below
would be violated.

## Branch / Base

- `branch_from`: `implementer/context-keyframe-export-selection-recording-long-run-v0`
- `required_start_ref`: local branch at or after `3a2a446a57f85c458dc583a95b7ac77480471a23`
- Expected output branch: `implementer/context-selection-mode-recording-follow-through-v0`
- Do not push, open PRs, or mutate GitHub state unless explicitly reassigned.

## Source Artifacts

Read these first:

- `docs/design/work-cards/context-keyframe-export-selection-recording-long-run-v0.md`
- `docs/design/context-annotation-session-keyframe-convergence-map-v0.md`
- `shared/schemas/aos-context-session-v0.schema.json`
- `shared/schemas/aos-context-recording-v0.schema.json`
- `packages/toolkit/workbench/context-session.js`
- `packages/toolkit/workbench/selection-mode.js`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/annotation-reticle.js`
- `apps/sigil/renderer/live-modules/interaction-overlay.js`
- `apps/sigil/renderer/live-modules/fast-travel.js`
- `apps/sigil/renderer/live-modules/hit-target.js`
- `apps/sigil/AGENTS.md`
- `docs/wiki/repo-docs-projection-v0.json`

Useful tests to inspect before changing behavior:

- `tests/toolkit/selection-mode.test.mjs`
- `tests/toolkit/context-session.test.mjs`
- `tests/renderer/annotation-reticle.test.mjs`
- `tests/renderer/radial-gesture-menu.test.mjs`
- `tests/sigil-avatar-interactions.sh`
- `tests/sigil-hit-target-drag-fast-travel.sh`
- `tests/toolkit/surface-interaction-decision-tree-contract.test.mjs`

## Product Model To Preserve

Selection Mode is adjacent to the reticle frame model, not a separate context
family. Reticle drill-down and Selection Mode climb-up should both produce the
same canonical context artifact/keyframe family.

Reticle mode builds a nested path intentionally by targeting a surface, then
optionally targeting lower-level panels, text, buttons, or other descendants.
Selection Mode starts from a clicked leaf and lets the user climb the discovered
ancestor chain to select the intended scope. In both cases, path nodes may carry
comments, and the selected node may be the leaf or any ancestor up to the whole
screen.

## Hard Boundaries

- Do not add an always-on full-screen mouse capture canvas.
- Do not add an expensive pointer stream watcher.
- Do not intercept clicks outside explicit active Selection Mode.
- Do not perform live AX/DOM inspection on every mouse move.
- Do not add daemon product hooks named for Sigil or Selection Mode. Prefer the
  existing generic input-region, pointer, bundle, and context surfaces.
- Do not remove or rename existing compatibility outputs such as
  `annotation-snapshot.json` or `surface_inspector_annotation_snapshot`.
- Do not add persistent database storage, video/blob recording, or remote web
  dependencies.
- Do not do broad visual polish beyond what is needed for a coherent V0.
- Do not branch from `origin/main`; this round builds on the local context
  foundation branch named above.

## Phase 0: Hygiene And Branch Prep

1. Create the output branch from the required start ref.
2. Run `git status --short --branch` and record the starting state.
3. Fix active stale `docs/recipes/...` references that break current tests.
   At minimum, inspect `apps/sigil/AGENTS.md` and the failing
   `tests/toolkit/surface-interaction-decision-tree-contract.test.mjs` path.
   Prefer the existing `docs/guides/...` paths. Do not sweep historical work
   cards unless an active test or shipped doc requires it.
4. Verify the targeted guardrail:

```bash
node --test tests/toolkit/surface-interaction-decision-tree-contract.test.mjs
```

Commit this as a small hygiene commit if it changes files.

## Phase 1: Selection Mode Runtime

Add the first runtime path for Selection Mode in Sigil.

Required behavior:

- Double-clicking the avatar enters Selection Mode.
- Selection Mode is explicitly visible and has clear exit paths:
  `Escape`, second double-click, successful commit, or cancel.
- Only while Selection Mode is active should a selection click be captured and
  prevented from passing through to underlying apps.
- Outside Selection Mode, preserve the current click-through behavior and avatar
  hit region behavior.
- Store runtime state under `liveJs.selectionMode`, with fields equivalent to:
  `active`, `entered_at`, `cursor`, `leaf_candidate`, `path_candidates`,
  `selected_node_id`, `context_session`, `events`, and `blocker`.
- Reuse `createSelectionModeContextSession()` and
  `selectionModeContextArtifact()` rather than inventing another artifact
  shape.

Candidate acquisition:

- V0 should use existing evidence already available to Sigil or AOS: current
  DesktopWorld target data, native window/app evidence, native AX element
  evidence when safely available, browser DOM bridge evidence when already
  available, display root, and whole-screen fallback.
- A click may trigger a bounded one-shot evidence request if an existing safe
  AOS command/API path exists.
- If bounded evidence is not available, use a deterministic adapter seam and
  record the missing evidence as blocker/provenance metadata in the context
  session. Do not block the whole phase on perfect live ancestry.

Ancestor selection:

- After a selection click, expose the root-to-leaf path and allow the active
  target to differ from the clicked leaf.
- A minimal V0 UI is acceptable: simple ancestor badges near the cursor/target,
  keyboard cycling, debug API selection, or a small overlay. The important part
  is the canonical artifact path and active target.
- Preserve comments in the data path. Full text-entry UI is optional for V0 if
  the debug API can attach comments to any path node and the runtime structure
  supports later UI.

Commit this phase separately.

## Phase 2: Cursor Decoration And Overlay

Draw Selection Mode visuals on the existing Sigil overlay path.

Required behavior:

- Use the same overlay/canvas family as the avatar, reticle, and fast-travel
  visuals. Do not add a new capture canvas.
- Keep the overlay `pointer-events: none` unless an existing input-region path
  needs an active-mode hit region.
- Draw a vivid animated cursor decoration when Selection Mode is active.
- Include a trail that reuses fast-travel settings where practical:
  duration, delay, repeat count, trail mode, lag, and scale.
- A simple cursor-shaped glowing outline plus short trail is acceptable for V0.
- Draw a selection target highlight and ancestor badge visuals with a cohesive
  look relative to the reticle frame assets.

Commit this phase separately.

## Phase 3: Active Context Provider

Add one active context provider path so export shutters do not need to know
which mode produced the context.

Required behavior:

- The provider exposes the latest canonical `aos_context_session` and active
  keyframe candidate from reticle mode, Selection Mode, and compatibility
  adapters.
- Radial camera export, `ctrl+opt+c`, and future recording code should prefer
  the active provider when present.
- Existing reticle context, Surface Inspector bundle, and annotation snapshot
  compatibility outputs must continue to work.
- A debug-visible or renderer-local provider is acceptable for V0 if a
  daemon-visible event channel would make the slice too large. If daemon-visible
  work is deferred, document the removal gate and the exact next file.

Commit this phase separately.

## Phase 4: Recording Assembler

Implement the minimal recording primitive on top of ordered context keyframes.

Required behavior:

- Add or reuse a toolkit helper that builds a valid `aos_context_recording`
  from ordered context keyframes plus optional text/blocker/action events.
- Add a minimal Sigil/debug/session path that can append keyframes/events and
  export the recording.
- Keep recording compact and machine-readable. Do not add video capture, image
  blobs, or persistent database storage.
- Preserve ordering semantics so a sequence of reticle and Selection Mode
  choices can read as keyframes in a concise workspace story.

Commit this phase separately.

## Phase 5: Export And Live Confidence

Prove the canonical context path in current export surfaces.

Required behavior:

- Radial camera export should be able to include the canonical active context
  keyframe/session when the active provider has one.
- `ctrl+opt+c` should still include context files/fields and existing
  compatibility snapshot fields.
- Surface Inspector see bundles should preserve existing shape and add canonical
  context only where already intended by the previous foundation work.

Use `./aos ready` before live checks. If readiness reports a repo-mode TCC or
input-tap blocker, use:

```bash
the manual TCC blocker report path
./aos ready --post-permission
```

If the blocker remains, stop with `manual_intervention` and do not route more
live-dependent work.

Commit this phase separately if it changes files.

## Phase 6: Docs, Wiki, And Tests

Update durable docs and tests for the implemented surface.

Docs to consider:

- `docs/api/toolkit/workbench.md`
- `docs/api/toolkit/components.md`
- `docs/api/aos.md`
- `docs/design/context-annotation-session-keyframe-convergence-map-v0.md`
- `docs/wiki/repo-docs-projection-v0.json`
- Any guide referenced by active Sigil guardrails.

Documentation expectations:

- Describe Selection Mode as another producer of canonical context artifacts,
  not as a separate context model.
- Describe how comments can attach to path nodes and how the selected target may
  be an ancestor of the clicked leaf.
- Mark any deferred UI editor or daemon-visible provider work explicitly.
- Update wiki projection metadata/concepts only when it improves discoverability
  for shipped docs. Do not add broad wiki content unless it is testable.

Test expectations:

- Add focused toolkit tests for any new recording helper behavior.
- Add renderer tests for Selection Mode state transitions, active-mode click
  capture, escape/cancel, context session creation, ancestor target selection,
  and comment preservation.
- Add overlay rendering tests for active cursor decoration and target/badge
  output if the renderer test harness already supports it.
- Add export tests for provider-preferred context output.
- Keep tests deterministic. Use live input only for bounded smoke evidence.

## Recommended Verification

Start with:

```bash
./aos dev recommend --json --files <changed files>
```

Run the relevant recommendations, and include at least:

```bash
node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/interaction-overlay.js
node --check apps/sigil/renderer/live-modules/annotation-reticle.js
node --check packages/toolkit/workbench/context-session.js
node --check packages/toolkit/workbench/selection-mode.js
node --test tests/toolkit/selection-mode.test.mjs
node --test tests/toolkit/context-session.test.mjs
node --test tests/renderer/annotation-reticle.test.mjs
node --test tests/renderer/radial-gesture-menu.test.mjs
node --test tests/toolkit/surface-interaction-decision-tree-contract.test.mjs
node --test tests/schemas/aos-context-session-v0.test.mjs
node --test tests/schemas/aos-context-recording-v0.test.mjs
bash tests/help-contract.sh
git diff --check
```

If daemon, Swift, bundle, or live Sigil behavior changes, also run:

```bash
./aos dev build
./aos ready
bash tests/surface-inspector-see-bundle.sh
bash tests/surface-inspector-see-bundle-config.sh
```

If real input is required and the environment is ready, run the narrowest
applicable Sigil smoke test. Prefer deterministic renderer tests when possible.

## Stop Conditions

Stop and report a blocker if:

- implementing the mode would require always-on full-screen capture;
- live TCC/input-tap readiness blocks Phase 5 after the documented recovery
  path;
- candidate ancestry requires a new daemon/API contract that cannot be safely
  represented through existing generic surfaces;
- comments on path nodes require a product decision about UI beyond the
  deterministic/debug path;
- compatibility exports would need to be removed or renamed.

## Completion Report Required

Report:

- branch, base SHA, and head SHA;
- phase commits and which phases were completed, deferred, or blocked;
- files changed by phase;
- Selection Mode entry/exit and click-capture model;
- evidence sources used for root-to-leaf ancestry and any blockers recorded;
- active context provider surface and export precedence;
- recording helper/export names;
- compatibility outputs preserved;
- tests run with pass/fail/skip details;
- live readiness result and any manual-intervention packet used;
- conflict risk and open PRs on same files if checked;
- final `git status --short --branch`;
- first remaining follow-up, if any.
