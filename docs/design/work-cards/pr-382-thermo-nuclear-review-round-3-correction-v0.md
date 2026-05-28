# PR 382 Thermo-Nuclear Review Round 3 Correction V0

## Recipient

GDI.

## Transfer Kind

Correction round.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, PR, or prior implementation state. Read and rediscover before editing.

## Single Goal

Make PR #382 acceptable under Foreman's round-3 thermo-nuclear review by
tightening the daemon-side context payload contract and deleting the remaining
avoidable duplication in the Sigil UX-tree/context wiring.

This is a structural correction. Preserve current user-visible Selection Mode,
radial camera, Surface Inspector bundle, context recording, and debug API
behavior.

## Branch / Base

- `branch_from`: `origin/gdi/context-selection-mode-recording-follow-through-v0`
- `required_start_ref`: `f9cc514069ab0565bb0c13af34c409bf33405ec2`
- Work surface / expected output branch:
  `gdi/context-selection-mode-recording-follow-through-v0`
- PR under review: https://github.com/michaelblum/agent-os/pull/382
- Base: `origin/main` at `4b649c7036050c35c117e843309108cd06a32522`
- Commit the correction on the PR branch and push if credentials are available.
- Do not merge to `main`, force-push unrelated history, close issues, or mutate
  GitHub PR state unless Foreman explicitly reassigns that responsibility.

Known local dirty/untracked state from Foreman review/setup:

- `.docks/foreman/skills/thermo-nuclear-code-quality-review/`
- `.playwright-cli/`
- `docs/design/work-cards/sigil-ux-tree-schema-embedded-ref-correction-v0.md`
- `interrupted_claude.md`

Do not delete or rewrite unrelated paths. Retain this correction work card and
commit it with the correction unless Foreman supersedes it before completion.

## Source Artifacts

- `interrupted_claude.md` - interrupted launch review that identified the same
  high-risk areas.
- `docs/design/work-cards/pr-382-thermo-nuclear-review-corrections-v0.md` -
  round-1 ownership and embedded-ref correction.
- `docs/design/work-cards/pr-382-thermo-nuclear-review-round-2-acceptance-v0.md`
  - prior acceptance after the command-dispatch fallback correction.

## Review Findings To Correct

### 1. Daemon context payload safety is weaker than the canonical contract

`src/daemon/surface-inspector-bundle.swift` now accepts canvas-supplied
`context_session` and `context_keyframe` dictionaries for
`canvas_inspector.capture_bundle`. The only safety gate is
`safeContextDictionary`, which serializes the dictionary and rejects only
`data:image/` text.

That is weaker than the canonical context contract:

- `packages/toolkit/workbench/context-session.js` rejects asset-ref keys such as
  `image_data`, string refs with `data:` or `blob:` after trimming, object
  `uri` refs with `data:` or `blob:`, and embedded image data inside asset-ref
  objects.
- `shared/schemas/aos-context-session-v0.schema.json` rejects `data:`/`blob:`
  asset refs in keyframes and recordings.
- `tests/surface-inspector-see-bundle.sh` and
  `tests/surface-inspector-see-bundle-config.sh` currently only scan for
  `data:image/`, so `blob:https://...`, `data:text/plain,...`, or non-image
  embedded data in supplied context payloads can pass daemon bundle export while
  canonical validators would reject them.

Required correction:

- Make daemon-side context payload acceptance match the canonical context asset
  ref contract. Prefer a focused Swift sanitizer/validator for context
  `asset_refs` and nested supplied keyframes rather than a broad string scan.
- Reject `data:` and `blob:` case-insensitively after leading whitespace for
  string refs and object `uri` refs.
- Reject asset-ref keys that imply embedded payloads (`base64`, `binary`,
  `image_data`) in the same places the JS helper/schema reject them.
- Do not silently write invalid supplied context JSON into
  `context-session.json`, `context-keyframe.json`, or clipboard payload output.
  Either skip supplied context with explicit evidence or fail the bundle request
  with structured status.
- Add deterministic coverage for both bundle-path and clipboard-payload modes
  or the nearest bounded daemon/toolkit test that can exercise the sanitizer.
  The test must include at least one `blob:` ref and one leading-whitespace
  `data:` ref; do not only test `data:image/`.

### 2. UX-tree readiness duplicates executor registry lookup

`apps/sigil/renderer/live-modules/ux-tree-command-registry.js` and
`apps/sigil/renderer/live-modules/ux-tree-readiness.js` each define their own
`ownValue`, `ownFunction`, and `registryHandler` logic. Readiness is a
certification surface; it should not have a hand-copied implementation of the
executor's handler lookup semantics.

Required correction:

- Move the registry lookup helper to the command-registry owner and reuse it from
  readiness, or expose a small command-registration classifier that both
  executor and readiness call.
- Preserve current own-property protections and Map registry support.
- Keep readiness fail-closed behavior for missing handlers, inherited
  prototype-name handlers, invalid trees, missing commands, and unclassified
  bindings.
- Add or adjust tests so a future drift between execution lookup and readiness
  lookup cannot falsely certify `ok: true`.

### 3. main.js still duplicates canonical context and Selection Mode state

`apps/sigil/renderer/live-modules/main.js` is still 4,281 lines after the round-2
correction, up from 3,926 on `origin/main`. Some of the remaining growth is
unavoidable integration, but these duplicated concepts are avoidable:

- `liveJs.selectionMode`, `activeContext`, and `contextRecording` default shapes
  are literal objects in `main.js` even though
  `selection-mode-runtime.js` and `context-recording-runtime.js` define default
  state helpers.
- `requestAnnotationSnapshot` rebuilds reticle keyframe asset refs inline even
  though `context-recording-runtime.js` owns the reticle context asset ref set.
- New source-regex tests assert those `main.js` literals and wrapper function
  names, which locks in the large-file shape instead of testing behavior.

Required correction:

- Make the runtime modules the single owners of their default state shapes.
  `main.js` should either import the default factories or omit the prefilled
  shapes and let the runtimes initialize them.
- Move reticle snapshot/keyframe asset-ref assembly into the context recording
  owner or expose one small helper from that owner. `main.js` should only wire
  event/session data and host posting.
- Keep preserved `window.__sigilDebug` names, but do not keep pass-through
  wrappers only because tests regex for their exact source form.
- Replace or narrow any new source-regex tests that require the duplicated
  `main.js` shape. Prefer runtime/helper tests or debug API behavior checks.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/work-cards/context-selection-mode-recording-follow-through-v0.md`
- `docs/design/work-cards/pr-382-thermo-nuclear-review-corrections-v0.md`
- `docs/design/work-cards/pr-382-thermo-nuclear-review-round-2-acceptance-v0.md`
- `src/daemon/unified.swift`
- `src/daemon/surface-inspector-bundle.swift`
- `packages/toolkit/workbench/context-session.js`
- `shared/schemas/aos-context-session-v0.schema.json`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/context-recording-runtime.js`
- `apps/sigil/renderer/live-modules/selection-mode-runtime.js`
- `apps/sigil/renderer/live-modules/ux-tree-command-registry.js`
- `apps/sigil/renderer/live-modules/ux-tree-readiness.js`
- `tests/surface-inspector-see-bundle.sh`
- `tests/surface-inspector-see-bundle-config.sh`
- `tests/toolkit/context-session.test.mjs`
- `tests/renderer/sigil-ux-tree-command-registry.test.mjs`
- `tests/renderer/sigil-ux-tree-readiness.test.mjs`
- `tests/renderer/annotation-reticle.test.mjs`

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

Only continue live verification if it reports ready. Deterministic code/schema
tests may still run when live checks are blocked.

## Scope And Hard Boundaries

- Keep this as a correction to PR #382, not a new feature slice.
- Do not branch from `origin/main`; start from the required PR head.
- Do not change Selection Mode gestures, target selection semantics, context-menu
  behavior, radial camera behavior, Surface Inspector bundle output names, or
  context schema shape except to enforce the existing external-asset contract.
- Do not reintroduce UX command fallbacks deleted by round 2.
- Do not add external dependencies just to validate Swift payload dictionaries.
- Do not delete unrelated untracked Foreman files.

## Suggested Implementation Areas

These are suggestions after review, not mandatory filenames:

- Add focused Swift helpers near the existing bundle export helpers:
  `rejectEmbeddedContextAssetRefs`, `sanitizeContextPayloadDictionary`, or
  similar.
- Export one shared registry lookup/classification helper from
  `ux-tree-command-registry.js` and import it in `ux-tree-readiness.js`.
- Export `RETICLE_CONTEXT_ASSET_REFS` or a small
  `createReticleContextKeyframeOptions` helper from
  `context-recording-runtime.js`.
- Update `annotation-reticle.test.mjs` only where it currently locks in the
  duplicated `main.js` source shape introduced by this PR.

## Verification

Run focused deterministic checks:

```bash
node --check apps/sigil/renderer/live-modules/main.js
node --check apps/sigil/renderer/live-modules/context-recording-runtime.js
node --check apps/sigil/renderer/live-modules/selection-mode-runtime.js
node --check apps/sigil/renderer/live-modules/ux-tree-command-registry.js
node --check apps/sigil/renderer/live-modules/ux-tree-readiness.js
node --test tests/toolkit/context-session.test.mjs
node --test tests/renderer/sigil-ux-tree-command-registry.test.mjs
node --test tests/renderer/sigil-ux-tree-readiness.test.mjs
node --test tests/renderer/annotation-reticle.test.mjs
git diff --check
```

If Swift files are changed, run the repo's focused daemon build/check command if
one is already documented or obvious from nearby tests. Do not invent a long
live run when deterministic coverage is enough for the sanitizer.

If `./aos ready` passes and screen recording is available, run:

```bash
bash tests/surface-inspector-see-bundle.sh
bash tests/surface-inspector-see-bundle-config.sh
```

If those live tests skip for screen recording or TCC, report the exact skip or
blocker and the deterministic coverage used instead.

## Completion Report

Report:

- changed files;
- how daemon context payload rejection now matches the canonical JS/schema asset
  ref contract;
- how readiness now reuses executor-owned registry lookup;
- how `main.js` duplication was reduced without changing debug API names;
- exact tests/checks run and pass/fail/skip results;
- live `./aos ready` result or the repo-standard human-needed blocker path used;
- unrelated dirty/untracked state observed at handoff completion;
- any remaining follow-up that should be separate from this correction.
