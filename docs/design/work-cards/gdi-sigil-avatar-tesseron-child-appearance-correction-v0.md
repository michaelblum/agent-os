# GDI: Sigil Avatar Tesseron Child Appearance Correction V0

> **Historical status:** Closed Phase 2 correction slice. It remains useful as
> evidence for primary/tesseron appearance behavior, but current architecture
> guidance is the accepted visual-object descriptor/resource-lifecycle closure.

## Tracker

- Source report: `docs/dev/reports/aos-visual-object-architecture.md`
- Review finding from Phase 2 performance pass:
  `ae38212219f072199c6ac5705fe7d57adf58bffc`
- Branch/output branch: `gdi/selection-mode-cursor-ancestor-ladder-v0`
- required_start_ref: `origin/gdi/selection-mode-cursor-ancestor-ladder-v0`

## Fresh Context Contract

Start from a fresh context. Read and rediscover before editing. Known unrelated
dirty state may include `.codex/config.toml`; leave it untouched.

## Goal

Correct the primary appearance minimal-update helper so tesseron child
appearance overrides remain intact when `state.avatar.shape.tesseron.matchMother`
is false.

The Phase 2 performance pass correctly moved primary appearance controls off the
full rebuild path, but review found a behavior regression: changing mother
opacity, edge opacity, or specular through `updatePrimaryAppearance()` also
mutates child tesseron materials even when the child is configured not to match
the mother.

## Review Finding

Deterministic proof from review:

```json
{
  "before": {
    "childOpacity": 0.8,
    "childWireOpacity": 0.7,
    "childShininess": 80
  },
  "after": {
    "childOpacity": 0.2,
    "childWireOpacity": 0.1,
    "childShininess": 0
  }
}
```

That conflicts with the old rebuild path in
`apps/sigil/renderer/avatar-shape-composition.js`, where `childConfig` uses
`tesseron.child.*` when `matchMother` is false.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/work-cards/gdi-sigil-avatar-phase2-performance-pass-v0.md`
- `apps/sigil/renderer/geometry.js`
- `apps/sigil/renderer/avatar-shape-composition.js`
- `tests/renderer/stellation-no-rebuild.test.mjs`
- `tests/renderer/tesseron.test.mjs`

## Required Behavior

- For non-tesseron primary avatars, the accepted appearance minimal-update
  behavior must remain unchanged.
- For tesseron-enabled primary avatars with `matchMother: true`, primary
  appearance updates may continue to update child materials in place.
- For tesseron-enabled primary avatars with `matchMother: false`, primary
  appearance updates must preserve existing child override material state for:
  - child face opacity;
  - child edge opacity;
  - child mask/interior visibility where child overrides exist;
  - child specular state.
- The correction should keep mesh, geometry, and material identity stable where
  the Phase 2 pass already made it stable.
- `state.avatar` must remain JSON-serializable.

## Scope

This is a correction round. Keep it focused on tesseron child appearance
override semantics and tests.

## Hard Boundaries

- Do not revert the broader Phase 2 appearance minimal-update work.
- Do not implement full tesseron proportion/link buffer minimal updates in this
  correction.
- Do not change tesseron enable/disable structural semantics.
- Do not create GitHub issues or PRs.
- Do not commit unrelated dirty files such as `.codex/config.toml`.

## Verification

Run:

```bash
node --test tests/renderer/stellation-no-rebuild.test.mjs
node --test tests/renderer/tesseron.test.mjs
node --test tests/renderer/context-menu-hit-test.test.mjs
git diff --check
```

Use `./aos dev recommend --json` after edits and run any additional focused
checks it recommends.

## Commit And Push

Use path-scoped `git add`. Make one scoped commit and push:

```bash
git commit -m "fix: preserve tesseron child appearance overrides"
git push origin gdi/selection-mode-cursor-ancestor-ladder-v0
```

## Completion Report

Include:

- final HEAD;
- files changed;
- exact tests run and results;
- deterministic evidence that `matchMother: false` child opacity, edge opacity,
  visibility semantics, and specular survive primary appearance updates;
- confirmation that non-tesseron appearance minimal updates still avoid full
  rebuilds;
- any local-only state left untouched.
