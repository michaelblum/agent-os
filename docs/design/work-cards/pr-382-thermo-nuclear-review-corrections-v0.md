# PR 382 Thermo-Nuclear Review Corrections V0

## Recipient

Implementer.

## Transfer Kind

Correction round.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, PR, or prior implementation state. Read and rediscover before editing.

## Single Goal

Make PR #382 acceptable under Foreman's thermo-nuclear review by correcting the
two current blockers:

1. `apps/sigil/renderer/live-modules/main.js` now owns too much of the new
   Selection Mode, active-context, context-recording, and UX-command runtime.
2. The new context-session asset-ref contracts still accept embedded `blob:`
   refs and leading-whitespace `data:` refs that should be rejected.

Preserve current user-visible behavior and debug surfaces while making the
ownership boundaries cleaner and the data contract strict.

## Branch / Base

- `branch_from`: `origin/implementer/context-selection-mode-recording-follow-through-v0`
- `required_start_ref`: `f4acb1afa45f3d3ecb6430375a4b46e0898d5b3c`
- Work surface / expected output branch:
  `implementer/context-selection-mode-recording-follow-through-v0`
- PR under review: https://github.com/michaelblum/agent-os/pull/382
- Base: `origin/main` at `4b649c7036050c35c117e843309108cd06a32522`
- Commit the correction and push the PR branch if credentials are available.
- Do not merge to `main`, force-push unrelated history, or mutate GitHub PR
  state unless Foreman explicitly reassigns that responsibility.

Known unrelated local dirty/untracked state from Foreman review setup:

- `.docks/foreman/skills/thermo-nuclear-code-quality-review/`
- `docs/design/work-cards/sigil-ux-tree-schema-embedded-ref-correction-v0.md`

Do not delete or rewrite those unrelated paths. This work card is the active
correction artifact; retain, amend, and commit it with the correction unless
Foreman supersedes it before completion.

## Review Findings To Correct

### 1. Large Runtime Ownership Regression

`main.js` grew from 3,926 lines on `origin/main` to 4,778 lines on the PR head.
The new code includes whole feature runtimes rather than thin wiring:

- active context / recording helpers:
  `apps/sigil/renderer/live-modules/main.js` around lines 2541-2660
- Selection Mode candidate/session/input state machine:
  `apps/sigil/renderer/live-modules/main.js` around lines 2663-3068
- UX command registry closures and fallback execution wrappers:
  `apps/sigil/renderer/live-modules/main.js` around lines 2784-2917
- avatar/input branches now wrapping adapter calls plus local fallback bodies:
  `apps/sigil/renderer/live-modules/main.js` around lines 3443-3501

Cleaner direction:

- Extract focused Sigil-local runtime owners so `main.js` wires dependencies and
  lifecycle calls instead of hosting the whole feature.
- Suggested split, subject to reading the code:
  - `selection-mode-runtime.js` owns Selection Mode state transitions,
    candidate acquisition, context-session creation, node comments, commit,
    cancel, and input command handlers.
  - `active-context-runtime.js` or `context-recording-runtime.js` owns active
    context provider state, keyframe creation, recording append/export, and
    reticle/Selection Mode provider updates.
  - Keep command lookup/adapter policy in `ux-tree-command-registry.js`; keep
    radial item action dispatch in `radial-item-action-dispatch.js`.
- `main.js` may keep renderer-specific projection/wiring where it truly depends
  on stage projection, overlay drawing, host runtime, or existing global state,
  but it should no longer own most of the new feature state machine.
- Preserve existing debug API names where practical:
  `window.__sigilDebug.snapshot()`, `uxTree*`, `createSelectionModeContext`,
  `enterSelectionMode`, `cancelSelectionMode`, `commitSelectionMode`,
  `appendActiveContextKeyframe`, `appendContextRecordingEvent`, and
  `exportContextRecording`.

Do not perform broad visual polish or rewrite unrelated avatar/radial behavior.
The correction is accepted when the new runtime ownership is clear enough that
future readers do not need to parse another large block inside `main.js` to
understand Selection Mode or context recording.

### 2. Context-Session Embedded Ref Contract Gap

The PR adds context session/keyframe/recording asset refs, but both runtime
helpers and schema still accept embedded refs that should remain external-only.

Current repro from the PR head:

```bash
node --input-type=module - <<'NODE'
import { createContextKeyframe, createContextRecording } from './packages/toolkit/workbench/context-session.js'
for (const [name, fn] of [
  ['keyframe string blob', () => createContextKeyframe({ asset_refs: { capture: 'blob:https://example.test/resource' } })],
  ['keyframe whitespace data', () => createContextKeyframe({ asset_refs: { capture: ' Data:text/plain;base64,SGk=' } })],
  ['recording object blob uri', () => createContextRecording({ asset_refs: { capture: { uri: 'blob:https://example.test/resource' } } })],
]) {
  try { console.log(name, 'ACCEPTED', JSON.stringify(fn().asset_refs)) }
  catch (error) { console.log(name, 'REJECTED', error.message) }
}
NODE
```

And schema validation currently reports `errors= 0` for:

- `blob:https://example.test/resource`
- ` Data:text/plain;base64,SGk=`
- `{ "uri": "blob:https://example.test/resource" }`
- `{ "uri": " Data:text/plain;base64,SGk=" }`

Required correction:

- Update `packages/toolkit/workbench/context-session.js` so asset refs reject
  `data:` and `blob:` case-insensitively after trimming leading whitespace for
  both string refs and object `uri` refs.
- Update `shared/schemas/aos-context-session-v0.schema.json` with equivalent
  strictness.
- Add invalid fixtures and tests covering `blob:` and leading-whitespace
  `data:` for context keyframe/recording asset refs.
- Keep valid relative/file-like artifact refs such as `capture.png`,
  `annotation-snapshot.json`, and `notes/context-recording.md` valid.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/work-cards/context-selection-mode-recording-follow-through-v0.md`
- `docs/design/work-cards/sigil-ux-tree-pre-toolkit-adoption-closure-v0.md`
- `docs/design/context-annotation-session-keyframe-convergence-map-v0.md`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/selection-mode-input.js`
- `apps/sigil/renderer/live-modules/ux-tree-command-registry.js`
- `apps/sigil/renderer/live-modules/radial-item-action-dispatch.js`
- `apps/sigil/renderer/live-modules/ux-tree-readiness.js`
- `packages/toolkit/workbench/context-session.js`
- `shared/schemas/aos-context-session-v0.schema.json`
- `tests/toolkit/context-session.test.mjs`
- `tests/schemas/aos-context-session-v0.test.mjs`
- `tests/renderer/sigil-ux-tree-command-registry.test.mjs`
- `tests/renderer/sigil-selection-mode-input.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/implementer/context-selection-mode-recording-follow-through-v0 origin/main
./aos ready
```

If `./aos ready` reports a repo-mode Accessibility, Input Monitoring, or
inactive input-tap blocker, run:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

Only continue live verification if it reports ready.

## Scope And Hard Boundaries

- Keep this as a correction to PR #382, not a new product slice.
- Do not branch from `origin/main`; start from the required PR head.
- Do not change Selection Mode semantics, context-menu semantics, radial menu
  geometry, reticle behavior, or overlay visuals except as needed to preserve
  behavior through extraction.
- Do not introduce persistence, video/blob recording, remote web dependencies,
  or daemon product hooks.
- Do not remove explicit UX-command fallback paths unless focused tests prove
  the adapter path and fallback path are equivalent and the removal reduces
  complexity.
- Do not touch unrelated untracked Foreman files.

## Suggested Implementation Areas

These are suggestions after review, not mandatory filenames:

- Add `apps/sigil/renderer/live-modules/selection-mode-runtime.js` for
  Selection Mode state/context/comment/input-command ownership.
- Add `apps/sigil/renderer/live-modules/context-recording-runtime.js` or
  `active-context-runtime.js` for active context and recording assembly.
- Keep `main.js` as the integration owner for host/runtime dependencies,
  overlay projection, debug API exposure, and lifecycle scheduling.
- Add small focused tests for any extracted pure runtime helpers when possible.
  Avoid importing all of `main.js` into Node tests if a small module seam is
  enough.

## Verification

Run at least:

```bash
node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/selection-mode-input.js
node --check apps/sigil/renderer/live-modules/ux-tree-command-registry.js
node --check apps/sigil/renderer/live-modules/radial-item-action-dispatch.js
node --check packages/toolkit/workbench/context-session.js
```

If new Sigil modules are added, include them in `node --check`.

Run focused tests:

```bash
node --test tests/toolkit/context-session.test.mjs \
  tests/schemas/aos-context-session-v0.test.mjs \
  tests/renderer/sigil-ux-tree-command-registry.test.mjs \
  tests/renderer/sigil-ux-tree-readiness.test.mjs \
  tests/renderer/sigil-selection-mode-input.test.mjs \
  tests/renderer/sigil-context-menu-input.test.mjs \
  tests/renderer/radial-item-action-dispatch.test.mjs \
  tests/renderer/annotation-reticle.test.mjs
```

Run aggregate checks if the extraction touches shared runtime behavior:

```bash
node --test tests/renderer/*.test.mjs
node --test tests/toolkit/*.test.mjs tests/schemas/*.test.mjs
bash tests/help-contract.sh
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
- how `main.js` ownership changed, with the new module boundaries;
- confirmation that Selection Mode, active context, UX-command debug surfaces,
  and context recording debug API names still exist;
- exact embedded-ref cases now rejected by runtime helper and schema;
- tests and checks run with pass/fail results;
- live `./aos ready` result or the TCC/input-tap blocker path used;
- `git status --short --branch`;
- local-only state, especially unrelated untracked files left untouched.

## Implementer Correction Notes

- Extracted Selection Mode state/session/input ownership to
  `apps/sigil/renderer/live-modules/selection-mode-runtime.js`.
- Extracted active-context keyframe and context-recording assembly to
  `apps/sigil/renderer/live-modules/context-recording-runtime.js`.
- Kept `main.js` as renderer integration wiring for projection, lifecycle,
  debug API exposure, UX-command execution, and existing host/runtime hooks.
- Hardened context-session asset refs to reject `blob:` and leading-whitespace
  `data:` refs for string refs and object `uri` refs.
- Added runtime/schema fixtures and tests for the embedded-ref contract gap.
