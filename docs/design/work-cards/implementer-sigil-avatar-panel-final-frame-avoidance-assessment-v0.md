# Implementer Work Card: Sigil Avatar Panel Final-Frame Avoidance Assessment V0

## Recipient

Implementer validation/correction round.

## Branch / Base

- `branch_from`: `implementer/toolkit-panel-placement-final-frame-contract-v0`
- `minimum_code_start_ref`: `599ff0cb86d9232cbf2a7a8e41428850ed0d6fb8`
- `required_start_ref`: the Foreman docs-alignment checkpoint containing this
  work card, descendant of `599ff0cb86d9232cbf2a7a8e41428850ed0d6fb8`
- `expected_output_branch`: `implementer/sigil-avatar-panel-final-frame-avoidance-assessment-v0`

Do not restart from `origin/main`. This work depends on the accepted
visible-surface audit, cross-process audit, runtime input-tap observability, and
toolkit panel placement/final-frame contract slices.

## Source Artifact

Foreman accepted the toolkit placement correction on:

```text
599ff0cb86d9232cbf2a7a8e41428850ed0d6fb8
```

That head makes panel placement observable with `requested_frame`,
`policy_adjusted_frame`, `final_settled_frame`, `viewport_overflow_policy`, and
audit-level `actual_native_frame`. The live-drag correction card remains paused
until Sigil avatar-panel overlap/input-winner risk has either been corrected or
explicitly ruled out with this new evidence.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
display, canvas, TCC, content-root, or prior live state. Read and rediscover
before editing. Leave unrelated untracked work cards and reports alone.

## Goal

Make it true that the live Sigil avatar controls panel has final-frame evidence
showing no avatar/panel input conflict, implementing minimal Sigil-owned avatar
avoidance only if the evidence shows overlap or a wrong input target winner.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `src/AGENTS.md`
- `docs/design/aos-panel-window-placement-contract.md`
- `docs/dev/reports/aos-visual-object-architecture.md`
- `docs/guides/test-harness-ladder-and-prep.md`
- `tests/README.md`
- `docs/design/work-cards/implementer-toolkit-panel-live-drag-correction-v0.md`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/display-utils.js`
- `apps/sigil/renderer/live-modules/hit-target.js`
- `apps/sigil/renderer/live-modules/input-regions.js`
- `apps/sigil/context-menu/menu.js`
- `apps/sigil/avatar-editor/panel.js`
- `apps/sigil/avatar-editor/panel.css`
- `tests/renderer/context-menu-hit-test.test.mjs`
- `tests/sigil-context-menu-real-input.sh`
- `tests/sigil-avatar-interactions.sh`
- `tests/canvas-visible-surface-audit.sh`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git merge-base --is-ancestor 599ff0cb86d9232cbf2a7a8e41428850ed0d6fb8 HEAD
./aos ready --json
./aos status --json
./aos show audit --json
./aos dev recommend --json --paths apps/sigil/renderer/live-modules/main.js,apps/sigil/renderer/live-modules/display-utils.js,apps/sigil/renderer/live-modules/hit-target.js,apps/sigil/context-menu/menu.js,apps/sigil/avatar-editor/panel.js,tests/renderer/context-menu-hit-test.test.mjs,tests/sigil-context-menu-real-input.sh,tests/sigil-avatar-interactions.sh
rg -n "SIGIL_AVATAR_PANEL_CANVAS_ID|sigil-avatar-controls|sigil.avatar_panel|panel.toggle|placement|final_settled_frame|actual_native_frame|input_target|hit target|avatar-main|avoid|viewport|display" apps/sigil packages/toolkit tests
```

If `./aos ready` or a bounded live check reports a repo-mode Accessibility,
Input Monitoring, or inactive input-tap blocker, do not loop. Run:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention`. After the human returns with `finished`, continue
in the same Implementer session and run:

```bash
./aos ready --post-permission
```

## Validation Questions

Use AOS-first evidence, not screenshots alone:

1. Does right-clicking or otherwise activating the live `avatar-main` open
   `sigil-avatar-controls-avatar-main` through the current canonical panel
   route?
2. Does the panel row expose `requested_frame`, `policy_adjusted_frame`,
   `final_settled_frame`, `viewport_overflow_policy`, and audit-level
   `actual_native_frame`?
3. Do the final settled panel frame and actual native panel frame overlap the
   avatar's registered/native hit region?
4. For points inside the panel, the avatar, and any overlap region, does
   `./aos show audit --json --point x,y` report the expected input target
   winner?
5. Are there any visible duplicate, stale, external, or orphan AOS windows that
   would make the result ambiguous?

## Required Behavior

If the evidence shows no avatar/panel overlap and no wrong input target winner,
do not implement avoidance. Report the proof clearly in the completion report
and leave the code unchanged except for any focused test/documentation evidence
that makes the finding durable.

If the panel overlaps the avatar, or if a point visually inside the panel is won
by `avatar-main`/its hit target instead of the panel, implement the smallest
Sigil-owned avoidance correction:

- wait for the panel's final settled frame, not the originally requested frame;
- move or nudge only the Sigil avatar/hit target enough to avoid the controls
  panel while staying inside the active display viewport;
- keep toolkit placement policy in toolkit and native truth in the daemon;
- make the correction deterministic enough for focused tests and live audit
  evidence.

## Scope

Sigil avatar/control-panel semantics, Sigil context-menu routing, and focused
tests are in scope. Toolkit or daemon changes are in scope only if the accepted
placement/audit contract is missing a small pass-through needed to observe the
required evidence.

## Hard Boundaries / Non-Goals

- Do not resume live drag correction.
- Do not migrate `sigil.avatar_panel.*` to the visual-object/resource contract.
- Do not add a new shared store or `aos.state.*`.
- Do not move Sigil avatar avoidance policy into toolkit or Swift daemon code.
- Do not redesign the avatar controls UI or panel chrome.
- Do not preserve old duplicate target vocabulary with compatibility shims.
- Do not remove or rewrite unrelated untracked work cards or reports.

## Suggested Evidence Shape

Use the current AOS commands and adapt coordinates to active displays:

```bash
./aos experience activate sigil --json
./aos show remove-all
./aos show audit --json
./aos show list --json
# Open the avatar controls panel through the canonical Sigil route.
./aos show audit --json --point <panel_x>,<panel_y>
./aos show audit --json --point <avatar_x>,<avatar_y>
./aos show audit --json --point <overlap_x>,<overlap_y>
./aos show remove-all
./aos status --json
./aos clean --dry-run --json
```

If no overlap exists, the overlap point is not applicable; say so explicitly.

## Verification

Use the harness ladder from `tests/README.md` and
`docs/guides/test-harness-ladder-and-prep.md`: deterministic checks first,
then bounded live AOS evidence only after readiness is clean.

Minimum checks:

```bash
git diff --check
./aos dev recommend --json --paths apps/sigil/renderer/live-modules/main.js,apps/sigil/renderer/live-modules/display-utils.js,apps/sigil/renderer/live-modules/hit-target.js,apps/sigil/context-menu/menu.js,apps/sigil/avatar-editor/panel.js,tests/renderer/context-menu-hit-test.test.mjs,tests/sigil-context-menu-real-input.sh,tests/sigil-avatar-interactions.sh
node --test tests/renderer/context-menu-hit-test.test.mjs
bash tests/canvas-visible-surface-audit.sh
```

If Sigil renderer or panel code changes, also run the focused adjacent tests Implementer
identifies from `./aos dev recommend`, such as:

```bash
node --test tests/renderer/sigil-context-menu-input.test.mjs tests/renderer/sigil-panel-window-migration.test.mjs
bash tests/sigil-context-menu-real-input.sh
bash tests/sigil-avatar-interactions.sh
```

Swift/native code is now Foreman-owned for this workstream. If this Implementer card is
reused and Swift or repo-binary work appears necessary, stop and report the
binary/native ownership issue to Foreman instead of rebuilding `./aos`.

Foreman-owned verification after native changes may include:

```bash
node --test tests/toolkit/panel-chrome.test.mjs tests/toolkit/panel-drag-transfer.test.mjs
bash tests/canvas-window-placement.sh
./aos dev build
```

Live proof is required unless the TCC/input-tap stop branch above is triggered.
The proof must include `show list` and `show audit --point` evidence for the
panel final frame, actual native frame, visible-surface exclusivity, and input
target winners.

## Completion Report

Report:

- changed files and whether code changed or this was validation-only;
- whether avatar avoidance was implemented or explicitly ruled out;
- panel requested/policy/final/actual frames;
- avatar frame or hit-region evidence used for overlap calculation;
- `show audit --point` winner results for panel/avatar/overlap points;
- visible duplicate/orphan/external AOS window findings;
- exact tests and live checks run;
- cleanup result from `./aos show list --json`, `./aos status --json`, and
  `./aos clean --dry-run --json`;
- local-only state and whether it is related.
