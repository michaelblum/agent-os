# Implementer Sigil Status Item Stale Root Recovery V0

## Transfer Classification

- Recipient: Implementer
- Transfer kind: correction round
- Single next goal: make an active Sigil status item recover from stale
  branch-scoped content roots and broken warm avatar canvases, so clicking the
  menu bar icon reliably summons the avatar after branch/worktree changes.
- Source artifact: Foreman live diagnosis on `feat/command-surface-extraction`
  after Michael reported that the menu status icon did not make the avatar
  emerge.
- Branch/output expectation: start from
  `origin/feat/command-surface-extraction`, create a focused Implementer branch, commit
  and push the correction. Foreman will review and fold it into PR #378.
- Stop conditions: complete, failed, manual_intervention, or blocker only if the
  correction requires a product decision outside this card.

## Branch / Base

- branch_from: `origin/feat/command-surface-extraction`
- required_start_ref: `origin/feat/command-surface-extraction`
- expected output branch: `implementer/sigil-status-item-stale-root-recovery-v0`

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, status-item, or experience state. Read and rediscover before editing.

## User-Visible Incident

Michael reported:

> the menu status icon is not working. when I click it, I'm not seeing the
> avatar emerge.

Foreman found AOS was nominally healthy:

```text
./aos status --json => status=ok, active repo daemon, input_tap active
./aos ready --json => ready=true
./aos experience status --json => active_experience=sigil
```

But the status item target was stale:

```text
./aos config get status_item.toggle_url --json
=> aos://sigil_implementer_sigil_warm_surface_lifecycle_performance_v0/renderer/index.html?toolkit-root=toolkit_implementer_sigil_warm_surface_lifecycle_performance_v0
```

The live `avatar-main` canvas also pointed at that stale branch-scoped root:

```text
location.href
=> http://127.0.0.1:<port>/sigil_implementer_sigil_warm_surface_lifecycle_performance_v0/renderer/index.html?toolkit-root=toolkit_implementer_sigil_warm_surface_lifecycle_performance_v0

document.body.innerText
=> Unknown content root: sigil_implementer_sigil_warm_surface_lifecycle_performance_v0

window.__sigilDebug
=> missing
```

So `status` and `ready` were green while the user-facing status item was wired
to a broken warm target.

Foreman's manual recovery was:

```bash
./aos experience activate sigil --json
./aos show remove --id avatar-main || true
```

After that, a real status-item click created the current branch-scoped avatar:

```text
href=http://127.0.0.1:<port>/sigil_feat_command_surface_extraction/renderer/index.html?toolkit-root=toolkit_feat_command_surface_extraction
avatarVisible=true
hitTargetInteractive=true
runtime.contentRoots.sigil=sigil_feat_command_surface_extraction
runtime.contentRoots.toolkit=toolkit_feat_command_surface_extraction
```

## Goal

Make the Sigil status-item path self-healing and diagnosable when active
experience config, branch-scoped content roots, and warm retained canvases drift
apart.

After this correction:

- `aos experience activate sigil` rewrites the status-item target to the current
  content roots and does not leave an existing broken `avatar-main` canvas in
  place;
- `aos status` and/or `aos ready` detects active Sigil status-item target drift
  instead of reporting healthy while the configured target URL references an
  unknown content root;
- clicking the status item after activation either reuses a valid warm avatar or
  recreates a fresh current-root avatar;
- stale branch-scoped Sigil/toolkit roots and canvases are either reconciled by
  activation or reported with an actionable repair command.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `docs/design/work-cards/implementer-experience-runtime-hygiene-correction-v0.md`
- `docs/design/work-cards/implementer-sigil-warm-surface-lifecycle-performance-v0.md`
- `docs/design/work-cards/implementer-test-suite-contract-audit-v0.md`
- `scripts/aos-experience.mjs`
- `scripts/aos-clean.mjs`
- `scripts/aos-show-client.mjs`
- `experiences/sigil/aos-experience.json`
- `apps/sigil/scripts/launch-common.sh`
- `apps/sigil/renderer/live-modules/main.js`
- `packages/toolkit/runtime/canvas.js`
- `tests/sigil-status-item-lifecycle.sh`
- `tests/sigil-warm-surface-lifecycle.sh`
- `tests/aos-clean-canvas-regression.sh`
- status-item/native readiness code found by:

  ```bash
  rg -n "status_item|toggle_id|toggle_url|toggle_track|Unknown content root|content.roots|persistent target|warm canvas" src scripts tests apps packages
  ```

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/feat/command-surface-extraction
./aos status --json
./aos ready --json
./aos experience status --json
./aos config get status_item.enabled --json || true
./aos config get status_item.toggle_id --json || true
./aos config get status_item.toggle_url --json || true
./aos content status --json
./aos show list --json
./aos clean --dry-run --json
```

If `./aos ready` reports a repo-mode TCC/input-tap blocker, do not loop. Run:

```bash
the manual TCC blocker report path
```

Stop with `manual_intervention`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

## Required Behavior

### 1. Activation Repairs Status-Item Target Drift

When Sigil is activated on the current branch, the stored status-item target
must match the current manifest/content-root resolution.

Regression shape:

1. In an isolated state root, seed a stale Sigil status-item URL such as:

   ```text
   aos://sigil_old_branch/renderer/index.html?toolkit-root=toolkit_old_branch
   ```

2. Optionally create or simulate an `avatar-main` canvas whose loaded URL uses
   the same stale root or whose body reports `Unknown content root`.
3. Run:

   ```bash
   ./aos experience activate sigil --json
   ```

4. Assert:

   - `status_item.toggle_url` uses the current resolved Sigil/toolkit root keys;
   - old branch-scoped Sigil/toolkit roots for the same manifest paths are not
     left as active roots;
   - a stale/broken `avatar-main` is removed, recreated, or otherwise updated so
     the next status click cannot post intents into an unknown-root page.

Prefer putting this invariant in shared experience/status-item code, not a
private Sigil one-off, if the same drift can affect future experiences.

### 2. Status/Ready Exposes Broken Active Experience Targets

Green runtime status must not hide a broken active experience entrypoint.

If active experience is `sigil` and `status_item.enabled=true`, then status or
ready should catch at least these cases:

- `status_item.toggle_url` references a content root key not present in
  `./aos content status --json`;
- `status_item.toggle_url` does not match the current active experience
  manifest resolution;
- `avatar-main` exists but is loaded at a URL whose root differs from the
  configured current status-item URL;
- `avatar-main` exists but its renderer is the daemon's `Unknown content root`
  error page rather than the Sigil runtime.

The result should provide a clear next action, for example:

```text
./aos experience activate sigil
```

or, if a bad canvas must be cleared:

```text
./aos show remove --id avatar-main
```

Do not add noisy live WebView checks to the default fast path if there is a
cheaper config/root invariant that catches the drift. Use bounded renderer
checks only where they are already part of a targeted lifecycle command or test.

### 3. Warm Canvas Lifecycle Remains Retained, Not Regressed

Do not "fix" this by deleting warm canvases on every status click or by making
Sigil cold-start on every interaction. The desired lifecycle is still:

- valid warm/hidden/suspended avatar and wiki surfaces can be retained while AOS
  runs;
- stale warm canvases from old branch roots are invalid and should be repaired
  or removed;
- close/reopen of retained panels should preserve the warm advantage.

### 4. Branch-Scoped Roots Are Allowed, Silent Staleness Is Not

Branch-scoped roots are useful for Implementer branches and local worktrees. The bug is
not that roots are branch-scoped. The bug is that a committed/active experience
can leave old branch-scoped root keys in config/canvas state after the active
branch changes and still report ready.

## Scope

Likely ownership boundary:

- experience activation/config reconciliation;
- AOS status/ready runtime hygiene;
- canvas lifecycle cleanup for broken status-item targets;
- deterministic tests around content-root drift.

Suggested implementation areas:

- `scripts/aos-experience.mjs`
- `scripts/aos-clean.mjs`
- `scripts/aos-show-client.mjs`
- `src/commands/operator.swift`
- `src/display/status-item.swift`
- `tests/sigil-status-item-lifecycle.sh`
- `tests/sigil-warm-surface-lifecycle.sh`
- a new focused test if the existing shell tests are too live-heavy.

Inspect first. These are suggestions, not permission to broaden the slice.

## Hard Boundaries

- Do not remove branch-scoped content roots as a concept.
- Do not make every `aos status` call perform long WebView evals.
- Do not break warm/suspend/resume semantics for valid warm Sigil surfaces.
- Do not add a second status-item launcher or a Sigil-specific launcher path.
- Do not rebuild AOS unless Swift/native changes require it.
- Do not broaden into radial-menu, wiki graph, voice shortcuts, or duplex chat.
- Do not run unbounded real-input loops. Live status-item proof is optional and
  must be bounded.

## Verification

Run focused deterministic checks covering the changed area. At minimum:

```bash
git diff --check
bash tests/sigil-status-item-lifecycle.sh
bash tests/sigil-warm-surface-lifecycle.sh
bash tests/aos-clean-canvas-regression.sh
bash tests/help-contract.sh
bash tests/external-parser-flags.sh
```

Add and run a new regression that explicitly seeds stale branch-scoped
`status_item.toggle_url`/content-root drift and proves activation or status
repairs/reports it.

If native Swift changes are made, run the repo-standard build once and avoid
rebuilding repeatedly:

```bash
./aos dev build
```

If `./aos ready` passes and no human input is needed, run a bounded live smoke:

```bash
./aos experience activate sigil --json
./aos show remove --id avatar-main || true
./aos status --json
./aos ready --json
```

Real status-item click proof is optional for this correction. If attempted, use
the bounded PID-scoped helpers from `tests/lib/status-item.sh`, not global menu
bar scans.

Final hygiene:

```bash
./aos status --json
./aos ready --json
./aos show list --json
./aos clean --dry-run --json
git status --short --branch
```

## Completion Report

Report:

- branch and head SHA;
- files changed;
- root cause of the stale status-item target;
- whether the fix repairs activation, status/ready diagnostics, cleanup, or all
  three;
- exact regression added for stale branch-scoped root drift;
- tests run with pass/fail status;
- live runtime hygiene and whether a real status-item click was attempted;
- any local-only state that Foreman cannot see from the pushed branch;
- remaining follow-up if status/ready can only report rather than repair one of
  the broken states.
