# PR 382 Thermo-Nuclear Review Round 2 Correction V0

## Recipient

GDI.

## Transfer Kind

Correction round.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, PR, or prior implementation state. Read and rediscover before editing.

## Single Goal

Make PR #382 acceptable under Foreman's round-2 thermo-nuclear review by
collapsing the UX-tree command adapter plus same-behavior fallback paths into
one authoritative command dispatch implementation.

This is a structural correction, not a product behavior change. Preserve
Selection Mode, context recording, avatar/radial/context-menu semantics, and
the existing `window.__sigilDebug` API names.

## Branch / Base

- `branch_from`: `origin/gdi/context-selection-mode-recording-follow-through-v0`
- `required_start_ref`: `6d4f94f93fcd470d3a5e4f727aef35afc22cfa11`
- Work surface / expected output branch:
  `gdi/context-selection-mode-recording-follow-through-v0`
- PR under review: https://github.com/michaelblum/agent-os/pull/382
- Base: `origin/main` at `4b649c7036050c35c117e843309108cd06a32522`
- Commit the correction on the PR branch and push if credentials are available.
- Do not merge to `main`, force-push unrelated history, post PR comments, close
  issues, or mutate GitHub PR state unless Foreman explicitly reassigns that
  responsibility.

Known local dirty/untracked state from Foreman review/setup:

- `.docks/foreman/skills/thermo-nuclear-code-quality-review/`
- `.playwright-cli/`
- `docs/design/work-cards/pr-382-thermo-nuclear-review-round-2-v0.md`
- `docs/design/work-cards/sigil-ux-tree-schema-embedded-ref-correction-v0.md`

Do not delete or rewrite unrelated paths. Treat
`docs/design/work-cards/pr-382-thermo-nuclear-review-round-2-v0.md` as the source
review artifact for this correction. Retain, amend if needed, and commit this
correction work card with the code correction unless Foreman supersedes it before
completion.

## Source Artifacts

- `docs/design/work-cards/pr-382-thermo-nuclear-review-round-2-v0.md` - durable
  round-2 review findings and evidence.
- `docs/design/work-cards/pr-382-thermo-nuclear-review-corrections-v0.md` -
  round-1 correction card and original ownership/data-contract blockers.
- `docs/design/work-cards/sigil-ux-tree-command-adapter-cutover-v0.md` - the
  narrower adapter slice that sanctioned only Selection Mode Escape as the first
  live cutover.

## Review Findings To Correct

### 1. Adapter plus fallback duplicates behavior and is not authoritative

At every routed site except Selection Mode Escape, the successful registry
handler and the per-site fallback resolve to the same behavior:

- `apps/sigil/renderer/live-modules/main.js` around the inline
  `sigilUxCommandRegistry` and the `execute*Command` wrappers.
- `apps/sigil/renderer/live-modules/main.js` around avatar press, goto, radial
  begin, Selection Mode enter, radial item release, and right-click context-menu
  branches.
- `apps/sigil/renderer/live-modules/selection-mode-runtime.js` around
  `fallbackForRoute` and `handleInput`.

Required correction:

- For UX-tree routed bindings, make the adapter path the single owner of command
  dispatch. The static Sigil UX tree should resolve these bindings; a resolution
  or handler failure should fail closed with trace/debug evidence, not execute a
  copied local behavior path.
- Delete per-site fallback bodies that duplicate the registry handler.
- If any safety path must remain for a genuinely external reason, it must share
  exactly one function body with the registry handler and carry an explicit
  removal gate in code/tests. Do not leave two independent copies of the same
  mutation.
- Keep the existing runtime semantics unchanged on the valid tree path.

The routed bindings to check include avatar press/goto/radial begin, Selection
Mode enter/cancel/commit/cycle/acquire, radial release item actions, and
right-click context-menu open/toggle.

### 2. main.js still owns command behavior behind wrappers

`apps/sigil/renderer/live-modules/main.js` still contains the whole
`sigilUxCommandRegistry` instance, five near-identical execute wrappers, and
many pure forwarders. This card does not ask for a broad renderer rewrite, but
the command adapter correction should reduce this ownership problem instead of
adding another layer.

Required correction:

- Move command registry construction and the shared execution wrapper out of
  `main.js`, or otherwise make `main.js` supply dependencies while a focused
  Sigil-local module owns the command registry/runner behavior.
- Collapse the repeated `executeRadialItemCommand`,
  `executeSelectionModeCommand`, `executeSelectionModeRouteCommand`,
  `executeContextMenuRightClickCommand`, and `executeAvatarCommand` shape into
  one command runner, subject to reading the code.
- Keep only forwarders that are needed for renderer lifecycle or preserved debug
  API names.

### 3. Readiness currently false-certifies incomplete routing

`apps/sigil/renderer/live-modules/ux-tree-readiness.js` reports
`routed_through_ux_command_adapter` from a hand-maintained routed binding id set
plus handler registration. That cannot distinguish an adapter-owned binding from
one still executed by a fallback path.

Required correction:

- Tie readiness `ok` and routed coverage to the same single source of truth used
  by the adapter-owned dispatch after Finding 1 is resolved.
- Remove or narrow any hand-maintained routed mirror that can claim routing
  while the runtime still has a fallback serving the behavior.
- Add or update tests so readiness would fail or stop claiming routed coverage
  if a binding has no authoritative adapter route/handler.

### 4. Right-click context-menu branch grew more conditional with identical behavior

`right_mouse_down` in `main.js` now has route resolution, nested `executed`
checks, and duplicated open/close behavior across handler and fallback. Resolve
this as part of the single command runner: keep the right-click route decision
readable, execute one command path, and do not duplicate close/open/cancel logic.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/work-cards/context-selection-mode-recording-follow-through-v0.md`
- `docs/design/work-cards/pr-382-thermo-nuclear-review-round-2-v0.md`
- `docs/design/work-cards/pr-382-thermo-nuclear-review-corrections-v0.md`
- `docs/design/work-cards/sigil-ux-tree-command-adapter-cutover-v0.md`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/selection-mode-runtime.js`
- `apps/sigil/renderer/live-modules/selection-mode-input.js`
- `apps/sigil/renderer/live-modules/ux-tree-command-registry.js`
- `apps/sigil/renderer/live-modules/ux-tree-readiness.js`
- `apps/sigil/renderer/live-modules/radial-item-action-dispatch.js`
- `tests/renderer/sigil-ux-tree-command-registry.test.mjs`
- `tests/renderer/sigil-ux-tree-readiness.test.mjs`
- `tests/renderer/sigil-selection-mode-runtime.test.mjs`
- `tests/renderer/sigil-selection-mode-input.test.mjs`
- `tests/renderer/sigil-context-menu-input.test.mjs`
- `tests/renderer/radial-item-action-dispatch.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/gdi/context-selection-mode-recording-follow-through-v0 origin/main
./aos ready
```

If `./aos ready` reports a repo-mode Accessibility, Input Monitoring, or
inactive input-tap blocker, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

Only continue live verification if it reports ready.

## Scope And Hard Boundaries

- Keep this as a correction to PR #382, not a new product slice.
- Do not branch from `origin/main`; start from the required PR head.
- Do not change Selection Mode semantics, context-menu semantics, radial menu
  geometry, reticle behavior, overlay visuals, context-session schemas, or
  context-recording data shape.
- Do not re-open the embedded `data:`/`blob:` asset-ref work; round 2 verified
  it clean.
- Do not introduce persistence, UX-tree editing, executable schema values,
  external dependencies, or daemon product hooks.
- Do not delete unrelated untracked Foreman files.

## Suggested Implementation Areas

These are suggestions after review, not mandatory filenames:

- Extend `apps/sigil/renderer/live-modules/ux-tree-command-registry.js` so it can
  own a Sigil command runner and registry builder when passed the existing
  runtime dependencies from `main.js`.
- Use one internal command implementation per action, referenced by the registry
  and any retained debug/lifecycle wrapper. Do not duplicate mutation bodies.
- Let `selection-mode-runtime.js` call the command runner without carrying
  `fallbackForRoute` copies for commit/cycle/acquire.
- Keep `main.js` as renderer integration wiring for projection, lifecycle,
  debug API exposure, and existing host/runtime hooks.
- Update readiness tests and command registry tests before broadening code
  movement.

## Required Behavior

- Valid UX-tree routed inputs execute exactly once through the registered command
  handler.
- Invalid tree, missing binding, missing command, non-allowlisted command,
  missing handler, or handler error records structured command runtime evidence
  and does not execute an old copied local fallback.
- Existing `window.__sigilDebug.snapshot()` command/runtime evidence remains
  coherent enough to see matched/executed/reason/fallback or no-fallback state.
- Selection Mode Escape remains the canonical fail-closed cutover pattern.
- Radial release item actions still terminate in
  `radialItemActionDispatcher.dispatch(...)`; the command adapter must not
  duplicate those action bodies.
- Right-click context-menu open/toggle behavior remains unchanged on the valid
  tree path.

## Verification

Run syntax checks for changed modules, at minimum:

```bash
node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/selection-mode-runtime.js
node --check apps/sigil/renderer/live-modules/ux-tree-command-registry.js
node --check apps/sigil/renderer/live-modules/ux-tree-readiness.js
node --check apps/sigil/renderer/live-modules/radial-item-action-dispatch.js
```

Run focused tests:

```bash
node --test tests/renderer/sigil-ux-tree-command-registry.test.mjs \
  tests/renderer/sigil-ux-tree-readiness.test.mjs \
  tests/renderer/sigil-selection-mode-runtime.test.mjs \
  tests/renderer/sigil-selection-mode-input.test.mjs \
  tests/renderer/sigil-context-menu-input.test.mjs \
  tests/renderer/radial-item-action-dispatch.test.mjs
```

If the change touches broader renderer command wiring, also run:

```bash
node --test tests/renderer/*.test.mjs
git diff --check
```

Run `./aos ready` after deterministic checks. If ready and the correction
changed live runtime wiring, perform a bounded live smoke only as far as current
TCC/input state allows; otherwise report the readiness blocker exactly.

## Completion Report

Include:

- branch name;
- head SHA and base SHA;
- changed files;
- how adapter dispatch became authoritative and where the single command body
  now lives;
- which duplicated fallbacks were removed or, if any remain, the external reason
  and removal gate;
- how `main.js` ownership changed;
- how readiness avoids false-certifying fallback-owned behavior;
- confirmation that Selection Mode, context recording, radial item actions,
  context menu behavior, and `window.__sigilDebug` API names still exist;
- exact tests and checks run with pass/fail results;
- live `./aos ready` result or the TCC/input-tap blocker path used;
- `git status --short --branch`;
- local-only state, especially unrelated untracked files left untouched.
