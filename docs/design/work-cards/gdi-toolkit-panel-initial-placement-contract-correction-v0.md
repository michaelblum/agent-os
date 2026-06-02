# GDI Correction Work Card: Toolkit Panel Initial Placement Contract V0

## Recipient

GDI correction round.

## Branch / Base

- `branch_from`: `gdi/toolkit-panel-placement-final-frame-contract-v0`
- `minimum_code_start_ref`: `cfdda350f346a5d1f5c46b9c55cd2b65de70ca47`
- `required_start_ref`: the Foreman correction-routing checkpoint containing
  this work card, descendant of
  `cfdda350f346a5d1f5c46b9c55cd2b65de70ca47`
- `expected_output_branch`: `gdi/toolkit-panel-placement-final-frame-contract-v0`

Do not restart from `origin/main`. This is a correction to the accepted-start
placement contract branch.

## Source Artifact

Foreman review of `cfdda350f346a5d1f5c46b9c55cd2b65de70ca47` found that
drag/maximize/restore placement metadata and daemon audit plumbing exist, but
initial panel open does not yet use the new contract.

Live reproduction after activating the current branch Sigil content roots:

```bash
./aos show remove-all
./aos show create --id toolkit-panel-placement-edge --at 1400,80,420,260 --interactive --focus --url aos://toolkit/components/aos-action-demo/index.html
./aos show wait --id toolkit-panel-placement-edge --manifest aos-action-demo --timeout 5s
./aos show audit --json --point 1102,91
./aos show list --json
```

Observed problem:

- `aos-action-demo` is a real `mountPanel()` surface.
- `show audit` reported
  `placement_unavailable_reason="canvas has not reported toolkit placement metadata"`.
- `requested_frame`, `at`, and `actual_native_frame` all remained
  `[1400,80,420,260]` / `{x:1400,y:80,w:420,h:260}`.
- No `requested_frame -> policy_adjusted_frame/final_settled_frame ->
  actual_native_frame` evidence existed for the initial panel open path.

The current `tests/canvas-window-placement.sh` proves the daemon can store
manually injected `canvas.update` placement metadata, but it does not prove a
real toolkit panel applies/reports initial placement policy.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
display layout, content-root, or prior live state. Read and rediscover before
editing. Leave unrelated untracked work cards and reports alone.

## Goal

Make real `mountPanel()` / `mountChrome()` surfaces apply and report the
toolkit placement contract during initial panel boot/settle, so an edge-opened
panel exposes requested, policy-adjusted, final settled, and actual native
frames without manual metadata injection.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `src/AGENTS.md`
- `docs/design/work-cards/gdi-toolkit-panel-placement-final-frame-contract-v0.md`
- `docs/design/aos-panel-window-placement-contract.md`
- `packages/toolkit/panel/placement.js`
- `packages/toolkit/panel/chrome.js`
- `packages/toolkit/panel/mount.js`
- `packages/toolkit/panel/drag-transfer.js`
- `packages/toolkit/runtime/canvas.js`
- `src/display/canvas.swift`
- `src/display/protocol.swift`
- `tests/toolkit/panel-chrome.test.mjs`
- `tests/canvas-window-placement.sh`

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
git merge-base --is-ancestor cfdda350f346a5d1f5c46b9c55cd2b65de70ca47 HEAD; echo "placement_contract_head_ancestor=$?"
./aos ready --json
./aos status --json
./aos show list --json
./aos dev recommend --json --paths packages/toolkit/panel/placement.js,packages/toolkit/panel/chrome.js,packages/toolkit/panel/mount.js,packages/toolkit/runtime/canvas.js,src/display/canvas.swift,src/display/protocol.swift,tests/toolkit/panel-chrome.test.mjs,tests/canvas-window-placement.sh
rg -n "mountPanel|mountChrome|createPanelWindowController|createPlacementPlan|viewportOverflowPolicy|placement_unavailable_reason|placement:" packages/toolkit src tests
```

If `./aos ready` reports a repo-mode TCC, Accessibility, Input Monitoring, or
inactive input-tap blocker, do not loop. Run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `finished`,
continue in the same GDI session and run:

```bash
./aos ready --post-permission
```

## Required Behavior

### 1. Initial Panel Settle Uses Toolkit Placement Contract

When a real `mountPanel()` / `mountChrome()` surface boots, it must produce
placement metadata for the initial settled frame, without requiring a test to
inject `canvas.update` by hand.

The initial placement record must include:

- `requested_frame`: the frame observed/requested before toolkit policy
  applies;
- `policy_adjusted_frame`: the frame after toolkit overflow policy;
- `final_settled_frame`: the frame sent back to the daemon as the settled panel
  frame;
- `viewport_overflow_policy`: the effective policy;
- a clear cause such as `placement.initial` or another codebase-consistent
  name.

If the initial frame needs no movement, still report the placement metadata so
`show list` / `show audit` can distinguish "policy chose same frame" from
"panel has not reported toolkit placement metadata".

### 2. Default And Opt-In Policy Are Real On Open

Default initial panel policy must remain conservative `clamp`, consistent with
the existing contract branch. Provide a narrow opt-in path for `allow`, `shift`,
and `flip` where appropriate, preferably through `mountPanel()` /
`mountChrome()` options rather than ad hoc app code.

Do not move layout policy into Swift daemon code. Swift should store/report
placement metadata and native truth; toolkit should decide the placement plan.

### 3. Live Proof Must Exercise Real Panel Code

Update or add tests so the live edge-panel proof no longer passes by manually
sending placement metadata from the test harness.

The proof should open a real toolkit panel, wait for its manifest, then assert
through AOS-visible state that:

- `placement.requested_frame` reflects the pre-policy edge frame;
- `placement.final_settled_frame` and `placement.policy_adjusted_frame` reflect
  the toolkit-settled frame;
- `actual_native_frame` comes from window-server truth and matches the settled
  frame within tolerance;
- `placement_unavailable_reason` is absent for that panel.

Use `aos://toolkit/components/aos-action-demo/index.html` or another simple
first-party `mountPanel()` component. Do not rely on screenshots alone.

## Scope

Toolkit panel boot/initial placement, placement options, daemon
storage/reporting only if the initial path needs metadata plumbing, and focused
tests.

## Hard Boundaries / Non-Goals

- Do not resume live drag correction.
- Do not implement Sigil avatar avoidance.
- Do not migrate `sigil.avatar_panel.*`.
- Do not introduce a new store or daemon layout policy.
- Do not weaken the accepted drag/maximize/restore placement metadata.
- Do not rewrite unrelated work cards or reports.

## Verification

Minimum:

```bash
git diff --check
./aos dev recommend --json --paths packages/toolkit/panel/placement.js,packages/toolkit/panel/chrome.js,packages/toolkit/panel/mount.js,packages/toolkit/runtime/canvas.js,src/display/canvas.swift,src/display/protocol.swift,tests/toolkit/panel-chrome.test.mjs,tests/canvas-window-placement.sh
node --test tests/toolkit/panel-chrome.test.mjs tests/toolkit/panel-drag-transfer.test.mjs
bash tests/canvas-window-placement.sh
bash tests/canvas-visible-surface-audit.sh
```

If Swift files change, also run:

```bash
./aos dev build
bash build.sh --no-restart
```

Live proof when `./aos ready --json` is ready:

```bash
./aos experience activate sigil --json
./aos show remove-all
./aos show create --id toolkit-panel-placement-edge --at 1400,80,420,260 --interactive --focus --url aos://toolkit/components/aos-action-demo/index.html
./aos show wait --id toolkit-panel-placement-edge --manifest aos-action-demo --timeout 5s
./aos show audit --json --point <inside-final-frame>
./aos show list --json
./aos show remove-all
./aos status --json
./aos clean --dry-run --json
```

Adapt coordinates to the active display geometry. The live proof must show
placement metadata generated by the real panel boot path, not by a hand-written
`canvas.update` injected by the test.

## Completion Report

Include:

- files changed;
- how initial `mountPanel()` / `mountChrome()` placement is triggered;
- default and opt-in initial overflow policies;
- exact deterministic tests and live proof results;
- the observed requested/final/actual frames from the live edge-panel proof;
- cleanup result from `./aos show list --json` and
  `./aos clean --dry-run --json`;
- whether any follow-up remains before Sigil avatar avoidance or live drag can
  resume.
