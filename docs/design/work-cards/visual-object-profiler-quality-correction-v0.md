# Visual Object Profiler Quality Correction V0

## Transfer Classification

- Recipient: Implementer
- Transfer kind: correction round
- Single next goal: apply the code-quality corrections from Foreman review to
  the profiler-backed visual-object proof without changing the accepted
  bootstrap behavior.
- Source artifact: Thermo-nuclear review of
  `implementer/selection-mode-cursor-ancestor-ladder-v0` at `ff53130a` over
  `2716f5e4`.
- Branch/base: continue from current branch
  `implementer/selection-mode-cursor-ancestor-ladder-v0` at or after `ff53130a`.
- Branch/output expectation: one focused correction commit on the same branch.
- Stop conditions: complete, failed, or blocker if live AOS readiness is needed
  and `./aos ready --json` reports a repo-mode TCC/input blocker.

## Fresh Context

Read:

- `apps/sigil/renderer/index.html`
- `apps/sigil/renderer/live-modules/main.js`
- `packages/toolkit/workbench/visual-object-resource-lifecycle.js`
- `tests/renderer/stellation-no-rebuild.test.mjs`
- `tests/toolkit/visual-object-resource-lifecycle.test.mjs`
- `docs/design/work-cards/visual-object-profiler-backed-leak-proof-v0.md`

Rediscover:

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse 2716f5e4
./aos ready --json
```

Known unrelated dirty state may include `.codex/config.toml`; leave it
untouched.

## Preserve

The bootstrap fix in `apps/sigil/renderer/index.html` is accepted in shape:

- keep the top-level `await import()` path that resolves the lifecycle helper
  through the configured toolkit content root in live AOS;
- keep `await boot()` and rethrow behavior;
- do not revert the live renderer bootstrap fix while doing this cleanup.

## Required Corrections

### 1. Extract profiler sample reduction

In `apps/sigil/renderer/live-modules/main.js`, pull the inline profiler sample
reduction out of `runPrimaryStellationResourceSmoke()`.

Add a named helper with this shape or an equivalent local name:

```js
reduceProfilerSamples(samples, proofDurationMs)
```

It should return the current `profilerMeasurement` shape. The smoke loop should
record samples, compute `proofDurationMs`, then call the helper.

Keep this scoped. Do not introduce broad renderer architecture or move unrelated
Sigil behavior.

### 2. Fix duplicated proof-window kind

`runPrimaryStellationResourceSmoke()` currently returns one `proofWindow.kind`
on the top-level result and a different hardcoded kind inside
`evidence.proof_window`.

Compute the live proof-window kind once:

```js
const proofWindowKind = minDurationMs > 0 ? 'live_runtime_duration' : 'live_edit_loop';
```

Use that value in both places. The profiler-specific label belongs in
`profilerMeasurement.kind`, not in `proofWindow.kind`.

Add or update a live-smoke-adjacent assertion where practical so this cannot
drift again. If there is no focused live unit seam, report why and rely on the
existing smoke evidence path.

### 3. Standardize profiler measurement input to snake_case

`normalizeProfilerMeasurement()` should accept the canonical input keys only:

- `window_ms`
- `sample_count`
- `resource_counts.draw_calls`

Remove camelCase aliases for:

- `windowMs`
- `sampleCount`
- `drawCalls`

Update current tests and call sites to pass snake_case input. Do not keep
defensive aliases unless you find a real external caller that cannot be updated;
if so, report the caller and removal gate.

### 4. Rename nullable number helper

Rename `profilerMeasurementValue()` in
`packages/toolkit/workbench/visual-object-resource-lifecycle.js` to a name that
states the null-preserving behavior, such as:

```js
nullableNumberValue()
```

The helper must preserve `null`/`undefined` as the fallback instead of coercing
`null` to `0`.

### 5. Add nullable boolean helper

Replace the repeated nullable-boolean normalization pattern with a small helper,
for example:

```js
nullableBooleanValue(value, fallback = null)
```

Use it for `available` and `within_limit`.

## Verification

Run at minimum:

```bash
node --test tests/renderer/stellation-no-rebuild.test.mjs tests/renderer/tesseron.test.mjs
node --test tests/toolkit/visual-object-resource-lifecycle.test.mjs tests/toolkit/visual-object-contract.test.mjs tests/toolkit/visual-object-form-binding.test.mjs tests/toolkit/panel-form.test.mjs
git diff --check
```

If `./aos ready --json` is green and the live proof remains cheap, rerun the
bounded Sigil live smoke from
`docs/design/work-cards/visual-object-profiler-backed-leak-proof-v0.md`.
Otherwise report the exact readiness blocker.

## Completion Report

Return:

- commit SHA and parent;
- files changed;
- whether the bootstrap fix was preserved;
- summary of each correction above;
- exact tests run and results;
- live proof result or readiness blocker;
- final `git status --short --branch`.
