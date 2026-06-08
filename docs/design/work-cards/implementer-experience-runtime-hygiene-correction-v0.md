# Work Card: Implementer Experience Runtime Hygiene Correction V0

## Transfer Classification

- Recipient: Implementer
- Transfer kind: correction round
- Single next goal: fix the runtime hygiene regressions found during Foreman
  review of the Sigil experience branch: experience activation/deactivation must
  not leave stale Sigil canvases or misleading status-item config, and `aos
  clean` must actually clear the stale canvases it reports.
- Source artifact: Foreman review of
  `35a6afbe89269aa72ca5b7247bb094db38afcfeb` on
  `implementer/implementer-sigil-launch-product-boundary-correction-v0`, plus Michael's live
  report that mouse events felt abnormal and an older surface flashed on screen.
- Branch/output expectation: continue from
  `origin/implementer/implementer-sigil-launch-product-boundary-correction-v0`, commit and push
  the corrected Implementer branch. Do not open or merge a PR; Foreman will review.
- Stop conditions: complete, failed, manual_intervention, or blocker only if live
  runtime semantics require a product choice that is not in this card.

## Branch / Base

- branch_from: `origin/implementer/implementer-sigil-launch-product-boundary-correction-v0`
- required_start_ref: `origin/implementer/implementer-sigil-launch-product-boundary-correction-v0`

This is a correction on top of the completed Sigil experience branch.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, status-item, or experience state. Read and rediscover before editing.

## Incident Findings

Foreman reproduced runtime hygiene problems after Implementer's completion report:

1. `./aos status --json` initially reported:

   ```text
   status=degraded
   stale_daemons=1
   stale daemon pid=14364 args="./aos serve --idle-timeout 5m"
   canvases=__log__, avatar-main, sigil-agent-terminal,
     sigil-hit-avatar-main, sigil-radial-menu-avatar-main, surface-inspector
   input_tap_status=active
   input_tap_attempts=1
   ```

   Process inspection showed one stale `./aos serve` wrapper plus the managed
   `aos __serve` daemon. There should be at most one input-tap-owning daemon per
   runtime mode. A wrapper plus one child `__serve` can be normal service shape;
   multiple live `__serve`/input-tap owners or stale daemons are not acceptable.

2. `./aos clean --dry-run --json` reported stale canvases, but
   `./aos clean --json` only killed the stale daemon and returned no canvas
   actions. A later `./aos status --json` still reported stale canvases until
   Foreman manually ran:

   ```bash
   ./aos show remove-all
   ```

   This means `aos clean` is not a reliable one-command hygiene repair despite
   status recommending it.

3. Foreman then ran:

   ```bash
   ./aos experience activate sigil --json
   ```

   `./aos status --json` immediately reported degraded status with stale Sigil
   canvases:

   ```text
   avatar-main
   sigil-agent-terminal
   sigil-hit-avatar-main
   sigil-radial-menu-avatar-main
   ```

   That contradicts the intended status-item-first model. Experience activation
   should make the status item/menu available; it should not automatically dock
   the avatar or recreate hidden screen-saver-level hit/radial surfaces before
   the user clicks the status item.

4. `./aos experience deactivate --json` reported a vanilla AOS status item:

   ```json
   {
     "active_experience": null,
     "status_item": {
       "enabled": true,
       "label": "AOS",
       "icon": "aos",
       "menu": ["avatar-terminal", "graph-wiki", "inspectors"]
     }
   }
   ```

   But live config still contained the Sigil toggle target:

   ```text
   status_item.toggle_id=avatar-main
   status_item.toggle_url=aos://sigil_implementer_implementer_sigil_launch_product_boundary_correction_v0/renderer/index.html?toolkit-root=toolkit_implementer_implementer_sigil_launch_product_boundary_correction_v0
   status_item.toggle_track=union
   ```

   The command output is therefore misleading. Deactivation must leave actual
   runtime config consistent with the reported vanilla/no-active-experience
   state.

5. As a temporary safety measure, Foreman ran:

   ```bash
   ./aos config set status_item.enabled false
   ./aos show remove-all
   ```

   Final local state after the incident:

   ```text
   ./aos status --json => status=ok, stale_daemons=0, canvases=[]
   ./aos show list --json => canvases=[]
   ./aos experience status --json => active_experience=null
   ./aos config get status_item.enabled --json => false
   ```

   This safety disable is not the product answer; it is just a local stopgap to
   prevent stale Sigil surfaces from reappearing during review.

## Required Corrections

### 1. Make experience activation status-item-first in behavior, not just JSON

After:

```bash
./aos show remove-all
./aos experience deactivate --json
./aos experience activate sigil --json
```

the runtime must be coherent:

- `./aos experience status --json` reports `active_experience="sigil"`;
- `./aos status --json` reports `status="ok"` and no stale resources;
- `./aos show list --json` does not contain automatically docked Sigil avatar,
  hit-target, radial, terminal, workbench, inspector, or log canvases unless the
  implementation intentionally models a visible status item surface as a canvas;
- status-item config points at the Sigil experience menu/toggle behavior without
  forcing the avatar visible before user action.

If the native status-item currently persists a "visible" toggle state and
recreates the avatar after activation, reset that state during activation or
make activation explicitly set persistent visibility to hidden.

### 2. Make deactivation honest and coherent

After:

```bash
./aos experience activate sigil --json
./aos experience deactivate --json
```

the command result and live config must agree.

Acceptable V0 outcomes:

- Best: deactivation restores a real vanilla AOS status item/menu config, with
  no Sigil toggle URL or Sigil-specific target left active.
- Acceptable if vanilla menu is not implemented yet: deactivation disables the
  status item and reports that exact state honestly, with a clear follow-up for
  vanilla menu implementation.

Do not report `label=AOS`, `icon=aos`, and vanilla tools while leaving
`status_item.toggle_url` pointed at Sigil.

### 3. Fix `aos clean` so status recommendations are reliable

`./aos clean --json` must clear all stale resources reported by
`./aos clean --dry-run --json` or report why it could not.

Regression target:

1. Start from a runtime with stale canvases.
2. `./aos clean --dry-run --json` reports those canvases.
3. `./aos clean --json` removes them or records failed removal.
4. A follow-up `./aos status --json` reports no stale canvases.

Watch for the stale-daemon restart race Foreman observed: if killing a stale
daemon or wrapper restarts/reparents the managed daemon and repopulates canvases,
`aos clean` needs a post-action verification pass before returning success.

### 4. Tighten input-tap singleton evidence

There should never be more than one input-tap-owning AOS daemon in one runtime
mode.

Add or update deterministic coverage around the evidence AOS can expose:

- `./aos ready --post-permission --json` reports one managed input tap;
- `./aos status --json` reports no stale daemons after cleanup;
- process-level diagnostics, if needed in tests, distinguish normal service
  wrapper + `__serve` from multiple live `__serve`/tap owners.

Do not build a broad process manager. Fix the narrow runtime hygiene failure
that let a stale wrapper/canvas state survive and confuse Foreman/user review.

### 5. Keep the experience branch intent intact

Preserve the good parts of the previous slice:

- canonical activation remains `aos experience activate sigil`;
- `aos launch sigil` can remain a transitional delegate if still desired;
- historical workbench remains explicit only as `legacy-workbench`;
- context menu remains in `apps/sigil/context-menu/` untouched;
- Sigil remains an experience over AOS, not a normal app.

### 6. Do not block future action shortcuts

Michael wants avatar dock/undock to be invokable by shortcut later, and expects
other experience actions to gain shortcuts too. Those shortcuts will also be
used by macOS Vocal Shortcuts to summon the avatar and eventually start a duplex
voice chat with a dock session.

This hygiene correction should not implement the full shortcut/voice path unless
you discover a tiny existing binding that must be updated for lifecycle
correctness. Do keep the data model and command shape from hard-coding
status-click-only behavior:

- treat dock/undock as an experience action that can be triggered by status-item
  click today and by keyboard/voice alias later;
- avoid naming fields or hooks as if the status item is the only invoker;
- if you touch the experience manifest/schema, allow or leave an obvious place
  for future `shortcut`, `voice_alias`, or action-binding metadata on menu/tool
  entries.

Do not broaden into post-MVP voice chat or dock-session duplex work in this
round.

## Read First

- `docs/design/work-cards/implementer-sigil-launch-product-boundary-correction-v0.md`
- `scripts/aos-experience.mjs`
- `scripts/aos-clean.mjs`
- `scripts/aos-launch.mjs`
- `experiences/sigil/aos-experience.json`
- `src/commands/operator.swift`
- `src/daemon/unified.swift`
- status-item lifecycle code found by:

  ```bash
  rg -n "status_item|toggle_id|toggle_url|toggle_track|persistentVisible|visible" src scripts tests apps/sigil
  ```

- `tests/sigil-status-item-lifecycle.sh`
- `tests/input-tap-readiness.sh`
- `tests/ready-ownership-mismatch.sh`
- `tests/external-command-dispatch.sh`
- `tests/schemas/aos-experience-v0.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/implementer/implementer-sigil-launch-product-boundary-correction-v0
./aos status --json
./aos experience status --json
./aos config get status_item.enabled --json || true
./aos config get status_item.toggle_url --json || true
./aos show list --json
./aos clean --dry-run --json
ps -axo pid,ppid,stat,lstart,command | rg 'aos (__serve|serve)|AOS.app' || true
```

Use `./aos` for runtime control. Use raw `ps` only for singleton diagnostics
that AOS does not expose directly.

## Verification

Run the focused suite plus the new/updated regression coverage:

```bash
node --test tests/schemas/aos-experience-v0.test.mjs
bash tests/help-contract.sh
bash tests/external-command-dispatch.sh
bash tests/external-parser-flags.sh
bash tests/ops-contract.sh
bash tests/sigil-workbench-launch.sh
bash tests/sigil-status-item-lifecycle.sh
bash tests/input-tap-readiness.sh
bash tests/ready-ownership-mismatch.sh
./aos show remove-all
./aos experience deactivate --json
./aos clean --json
./aos experience activate sigil --json
./aos status --json
./aos show list --json
./aos experience deactivate --json
./aos status --json
./aos clean --dry-run --json
./aos ready --post-permission --json
git diff --check
```

The live checks must show:

- no stale daemon after cleanup;
- no stale canvases after cleanup;
- activation does not immediately leave `aos status` degraded;
- deactivation result matches actual status-item config;
- exactly one managed input tap according to `ready`/`status`.

If live checks need repo-mode TCC/input-tap repair, run:

```bash
the manual TCC blocker report path
```

Then stop with `manual_intervention`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

## Completion Report

Report:

- branch and head SHA;
- files changed;
- root cause of stale canvas reappearance after experience activation;
- root cause of `aos clean` not clearing canvases;
- final behavior of activate/deactivate/status-item config;
- input-tap singleton evidence;
- tests run and pass/fail status;
- live runtime final state from `./aos status --json`, `./aos show list --json`,
  and `./aos experience status --json`;
- whether the branch was pushed.
