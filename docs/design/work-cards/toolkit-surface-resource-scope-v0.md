# Toolkit Surface Resource Scope V0

## Tracker

- Epic: #223 AOS Surface System
- Primary issue: #122 Toolkit-owned DesktopWorld hit-region controller
- Related issues: #304 stage-backed minimized chips, #120 input identity,
  #123 lifecycle warming, #261 panel/window placement
- Follows:
  `docs/design/work-cards/toolkit-stage-affordance-extraction-v0.md`
  and
  `docs/design/work-cards/toolkit-stage-affordance-subscription-cleanup-correction-v0.md`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Add a small toolkit resource-scope helper that makes setup and cleanup ownership
explicit for toolkit surface resources: child canvases, stage layers, input
regions, event subscriptions, bridge handlers, and custom cleanup callbacks.

The immediate reason is StageAffordance: it now works, but it had to learn the
hard way that canvas subscriptions are shared, while regions and stage layers
are owned resources. The next primitive should encode that distinction so future
surface code does not repeat it.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `docs/design/aos-canon-surface-boundary-alignment-plan.md`
- `docs/design/work-cards/toolkit-stage-affordance-extraction-v0.md`
- `docs/design/work-cards/toolkit-stage-affordance-subscription-cleanup-correction-v0.md`
- `docs/api/toolkit.md`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready
./aos dev recommend --json
gh issue view 122 --json number,title,state,url,body,labels
gh issue view 223 --json number,title,state,url,body,labels
```

If `./aos ready` reports the known repo-mode TCC blocker, do not run live
pointer smoke. Use deterministic tests and report the blocker.

## Existing Code To Inspect

- `packages/toolkit/panel/stage-affordance.js` - current resource owner and the
  first client to migrate.
- `packages/toolkit/runtime/input-region.js` - request/response helpers for
  region register/update/remove.
- `packages/toolkit/runtime/canvas.js` - child canvas create/remove helpers.
- `packages/toolkit/runtime/subscribe.js` - canvas-wide subscription helper.
- `packages/toolkit/runtime/bridge.js` - current bridge handler registration
  model.
- `packages/toolkit/panel/drag-transfer.js` - stage layer upsert/remove pattern.
- `tests/toolkit/stage-affordance.test.mjs` - first regression target.
- `tests/toolkit/runtime-input-region.test.mjs` - runtime helper coverage.

## Required Behavior

### Resource Scope Primitive

- Provide one small reusable helper for tracking owned resources and cleanup
  callbacks.
- It should be deterministic and idempotent: cleanup can be called multiple
  times and should return stable cleanup state.
- It should distinguish owned resources from shared claims:
  - input regions and stage layers are owned and should be removed on cleanup;
  - child canvases are owned only when the scope created or explicitly adopted
    them;
  - event subscriptions are shared by canvas unless explicitly marked exclusive,
    so default cleanup must not unsubscribe shared events;
  - bridge handlers may remain installed if the current bridge has no unregister
    API, but the scoped handler must be inactive after cleanup.
- It should expose state useful to future Surface Inspector work: scope id,
  owner canvas id, child canvas ids, stage layer ids, input region ids,
  subscription events retained/unsubscribed, cleanup status, and active state.

### StageAffordance Migration

- Rebuild `createStageAffordance` on the resource-scope helper.
- Preserve current minimized-chip behavior and public API.
- Preserve the accepted subscription behavior: retain shared lifecycle
  subscriptions by default, support explicit exclusive unsubscribe only when
  requested.
- Keep failure cleanup behavior for partial setup.

## Scope

This is toolkit/runtime plus toolkit/panel integration. A small generic helper
may belong in `packages/toolkit/runtime/` if it only tracks resources and wraps
generic daemon primitives. Stage-specific policy and minimized-chip behavior
must remain in `packages/toolkit/panel/`.

## Hard Boundaries / Non-Goals

- no daemon changes;
- no Sigil migration;
- no full runtime ref-counting system unless the narrow helper genuinely needs
  a tiny local count for its own scopes;
- no Surface Inspector UI in this slice;
- no panel/windowing redesign;
- no live smoke while repo-mode TCC is blocked.

## Suggested Implementation Areas

- Add `packages/toolkit/runtime/resource-scope.js` or a similarly narrow helper
  if inspection confirms runtime is the right home.
- Add focused tests such as `tests/toolkit/runtime-resource-scope.test.mjs`.
- Update `packages/toolkit/panel/stage-affordance.js` to use the helper.
- Export the helper from `packages/toolkit/runtime/index.js` only if it is a
  stable toolkit runtime API; otherwise keep it panel-local and explain why.
- Update `docs/api/toolkit.md` with the ownership model if a public helper is
  exported.

## Verification

Run:

```bash
node --test tests/toolkit/stage-affordance.test.mjs
node --test tests/toolkit/runtime-input-region.test.mjs
node --test tests/toolkit/panel-chrome.test.mjs
git diff --check
```

If you add a runtime resource-scope test, run it explicitly. If the helper is
exported publicly or touches broader toolkit helpers, also run:

```bash
node --test tests/toolkit/*.test.mjs
```

## Completion Report

Include:

- files changed;
- helper name, path, and whether it is public API;
- exact owned-resource vs shared-subscription cleanup model;
- how StageAffordance uses the helper;
- deterministic tests run with exact result;
- live smoke result or exact readiness blocker;
- remaining follow-up, especially whether Surface Inspector visibility should
  consume the new scope state next.

## Foreman Review Status

Accepted. `packages/toolkit/runtime/resource-scope.js` is the public helper,
exported from `packages/toolkit/runtime/index.js`, and StageAffordance now uses
it. The accepted cleanup model is:

- input regions and stage layers are owned and removed during cleanup;
- child canvases can be tracked and removed when owned/adopted;
- subscriptions are retained by default because daemon subscriptions are
  canvas-wide shared claims;
- exclusive subscriptions can opt into unsubscribe;
- bridge handlers stay registered but become inactive after cleanup;
- cleanup is idempotent and exposes inspector-friendly state.

Live smoke remains blocked by repo-mode `daemon_tcc_grant_stale_or_missing`.
The next GDI slice should document and lightly enforce the surface interaction
decision tree before Sigil migration.
