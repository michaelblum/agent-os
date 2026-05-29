# PR 382 Thermo-Nuclear Review — Round 2 Acceptance

Reviewer: Foreman (thermo-nuclear bar).
PR: https://github.com/michaelblum/agent-os/pull/382
Correction reviewed: `f1d9db6f8ea31fb8f8ee5b869c0413ef2b89c33a`
("fix(sigil): make ux command dispatch authoritative"), parent
`6d4f94f9` (the state round-2 reviewed). Base: `main`.

## Verdict: ACCEPT (deterministic), pending the live smoke the correction card itself scopes.

All four round-2 findings are genuinely resolved — not relocated. The fix made
the UX-tree command adapter the single authoritative owner of dispatch and
deleted every duplicated fallback, which is the cleaner direction round 2 asked
for. Blocker 2 (asset refs) was untouched and remains clean.

Foreman follow-up on 2026-05-28: the pending live gate passed. `./aos ready`
reported `ready=true mode=repo daemon=reachable tap=active`, and
`bash tests/sigil-avatar-interactions.sh` completed with `PASS` against an
isolated repo-mode daemon. The verdict is now ACCEPT for merge-readiness, subject
to the normal PR publication/merge decision.

## Finding-by-finding

### 1. Adapter + same-behavior fallback (gating) — RESOLVED

- Command bodies now exist exactly once, in the registry handlers built by
  `createSigilUxTreeCommandRuntime` (`ux-tree-command-registry.js:344-395`).
- Every call site calls the authoritative runtime with **no fallback**:
  `main.js:2980-3015` (`executeAvatarPressBegin`, `executeSelectionModeEnter`,
  `executeAvatarGotoBegin`), `:3093` (`executeAvatarRadialBegin`), `:1588-1590`
  (`executeRadialItem`, no `dispatch` fallback), `:3190-3205` (right-click).
- `selection-mode-runtime.js` dropped `fallbackForRoute`; `handleInput`
  (`:382-396`) calls `executeCommand(route.command, …)` with no fallback.
- Authoritative dispatch does not silently no-op real gestures: every
  registry key has a matching tree binding → allowlisted command. Verified by
  cross-referencing `ux-tree.js` `commandList()` (`:121-138`, all 15 commands
  `safety.execution:'allowlisted'`, `handler_ref:id`) and `bindingList()`
  (`:251-292`) against `SIGIL_*_COMMAND_INPUTS`
  (`ux-tree-command-registry.js:3-98`): press→idle/left.press,
  goto→press/left.release, radial→press/drag_threshold,
  selectionModeEnter→goto/double_click, escape/commit/tab/arrow/acquire,
  context-menu open/toggle, and per-item radial release all match on
  `{node_id, mode, gesture}`.
- **Readiness-confirmed, not just source-eyeballed:** a passing test
  (`sigil-ux-tree-readiness.test.mjs:34-47`) asserts on the real
  `createSigilUxTree()` with the complete registry that `audit.ok === true`,
  `bindings_routed === tree.bindings.length` (100% of tree bindings are
  adapter-owned), and `bindings_unclassified === 0`. A future binding/tree
  regression would flip this red in CI.
- Escape remains the canonical fail-closed pattern; it now applies uniformly.

### 2. main.js still owns command behavior behind wrappers — RESOLVED (substantially)

- The inline `sigilUxCommandRegistry` instance and all five `execute*Command`
  wrappers are gone from `main.js`. It now constructs
  `sigilUxCommandRuntime = createSigilUxTreeCommandRuntime({…})`
  (`main.js:1565-1587`) with injected dependencies and calls typed methods.
- Registry construction, the single command runner, and the typed execute
  methods now live in `ux-tree-command-registry.js`
  (`createSigilUxTreeCommandRunner:294`, `createSigilUxTreeCommandRuntime:322`).
- `main.js` 4,411 → 4,281 (−130). Still large, but the command-ownership
  problem is gone; the residual size is legitimate renderer integration
  (projection, lifecycle, debug API, recording wiring). The card explicitly did
  not request a broad renderer rewrite.

### 3. Readiness false-certifies routing — RESOLVED

- `ux-tree-readiness.js` now imports `createSigilUxTreeCommandRouteCatalog`
  (`:2`) and derives routed coverage from actual tree+registry resolution
  (`:263`), tagging `route_source: 'command_route_catalog'` (`:171`). The
  hand-maintained `DEFAULT_ROUTED_BINDING_IDS` mirror is removed.
- Tests assert the new contract: "readiness audit does not certify bindings
  outside the adapter route catalog" and "fails closed for unregistered commands
  and unclassified bindings" (both pass).

### 4. right_mouse_down grew more conditional — RESOLVED

- `main.js:3190-3205`: one command path. The nested `result.executed` checks and
  the duplicated `contextMenu.close`/`cancelInteraction`/`openContextMenuAt`
  fallbacks are removed; close/open behavior now lives in the command handlers.

## Verification run

- `node --test` on the six focused renderer suites: **39/39 pass**
  (command-registry, readiness, selection-mode-runtime, selection-mode-input,
  context-menu-input, radial-item-action-dispatch).
- **Test-diff audit (tests were not weakened to go green):** the correction
  edited two suites with deletions. `sigil-selection-mode-runtime.test.mjs` only
  replaced the now-dead `commandOptions.fallback?.()` line with a faithful mock
  that routes `acquire/commit/cycle` to the real runtime methods (matching the
  registered handlers) — state-transition coverage preserved.
  `sigil-ux-tree-readiness.test.mjs` deleted only the single-line import and
  **added** a fail-closed test (drop a binding from the route catalog → that
  binding is `unclassified` → `ok:false`). `sigil-ux-tree-command-registry.test.mjs`
  is additions-only (+33).
- `node --check` passes on `main.js`, `selection-mode-runtime.js`,
  `ux-tree-command-registry.js`, `ux-tree-readiness.js`, `context-menu-input.js`.
- No lingering `radialItemActionDispatcher.dispatch` fallback or removed
  `execute*Command` references in `main.js`.
- Dependency wiring complete: all 20 runtime deps passed; none left to no-op
  defaults.
- No TDZ from moving the runtime construction earlier (to `:1565`): all by-value
  deps (`contextMenu:797`, `fastTravel:1490`, `radialItemActionDispatcher:1541`)
  precede it; function-reference deps are hoisted declarations;
  `radialGestureMenu` is accessed lazily; `sigilUxCommandRuntime` is `let` at
  `:233`.

## Residual risk (non-blocking)

1. **Tree-validity is now load-bearing.** With no fallback, the whole avatar
   input surface (press/goto/radial/selection/context-menu) no-ops if the UX
   tree ever fails validation or a binding regresses. This is the sanctioned
   design (matches Escape and the correction card's "fail closed with trace/debug
   evidence"); the tree is static, and a build-time regression is already caught
   by the readiness positive test (`:34-47`, `ok:true` +
   `bindings_routed === tree.bindings.length`). The narrower remaining gap is
   runtime defense-in-depth: recommend (follow-up, not a blocker) a boot/readiness
   gate that surfaces a non-`ok` `sigilUxTreeReadiness()` loudly (warn/telemetry),
   so a regression that escapes CI presents as a visible readiness failure rather
   than "clicks silently stopped working." Confirm `./aos ready` surfaces this.
2. **Live smoke completed after this review note was drafted.** `./aos ready`
   passed in repo mode and `bash tests/sigil-avatar-interactions.sh` returned
   `PASS`. No remaining live-smoke blocker is known.
3. **Minor:** `createSigilUxTreeCommandRuntime` has a ~20-dependency surface —
   acceptable as the single DI seam, but it is the new concentration point to
   watch as more bindings are added.

## Routing

Accept the structural correction. Remaining actions are the correction card's own
bounded live smoke and (optional) the readiness-gate hardening in Residual Risk 1
— neither blocks the structural verdict.
