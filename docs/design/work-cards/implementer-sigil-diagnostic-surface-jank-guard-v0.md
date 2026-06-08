# Implementer Sigil Diagnostic Surface Jank Guard V0

## Recipient

Implementer correction round.

## Branch / Base

- branch_from: `origin/feat/command-surface-extraction`
- required_start_ref: `origin/feat/command-surface-extraction`
- expected output branch: `implementer/sigil-diagnostic-surface-jank-guard-v0`

## Source

Foreman follow-up after PR #378 reached `263c7b01`
(`fix(sigil): retain warm wiki surfaces`).

The previous warm surface correction improved the intended wiki retain/resume
path, but the resumed performance proof stalled and exposed another live safety
problem:

- `./aos status --json` returned `ok`;
- `./aos ready --json` returned `ready=true`;
- stale daemons were `0`;
- `avatar-main` was absent, so no real status-icon summon proof had happened;
- the only active canvases were `sigil-render-performance` and child
  `aos-desktop-world-stage`;
- the user reported mouse input jank again while those diagnostic surfaces were
  active.

Foreman stabilized the live session by removing:

```bash
./aos show remove --id sigil-render-performance
./aos show remove --id aos-desktop-world-stage
```

After removal, `./aos show list --json` returned `canvases=[]`,
`./aos status --json` returned `status=ok`, `./aos ready --json` returned
`ready=true`, and `./aos clean --dry-run --json` returned `status=clean`.

## Goal

Make diagnostic/performance surfaces safe to use during Sigil proof runs:
they must not leave pointer-affecting stage state around, must not be preserved
as normal Sigil warm user surfaces, and must be easy to clean up deterministically
without harming the real warm Sigil surfaces.

This is not a request to retry the live real-input status icon proof. Implementer should
fix the deterministic lifecycle/cleanup contract first. The real status-icon and
radial-menu proof remains a supervised AOS real-input step after this correction:
it may be driven by `aos see`/`aos do` through the same input channel a human
uses, but only once input jank has been removed and the run has explicit
permission to move the pointer/click the menu bar.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `src/AGENTS.md`
- `apps/sigil/renderer/live-modules/main.js`
- `packages/toolkit/components/render-performance/index.html`
- `packages/toolkit/components/render-performance/index.js`
- `packages/toolkit/panel/mount.js`
- `packages/toolkit/panel/chrome.js`
- `packages/toolkit/panel/drag-transfer.js`
- `scripts/aos-clean.mjs`
- `tests/aos-clean-canvas-regression.sh`
- `tests/sigil-warm-surface-lifecycle.sh`
- `tests/toolkit/panel-chrome.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/feat/command-surface-extraction
./aos status --json
./aos ready --json
./aos experience status --json
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

### Diagnostics Are Not Core Warm Sigil Surfaces

Active Sigil should preserve core user surfaces, but diagnostic surfaces should
not be treated like always-owned warm user state.

Preserve the core warm lifecycle for:

- `avatar-main`;
- `sigil-hit-avatar-main`;
- `sigil-radial-menu-avatar-main`;
- `sigil-agent-terminal`;
- `sigil-wiki-workbench`.

Treat diagnostic utility canvases such as `sigil-render-performance` as
ephemeral unless there is an explicit runtime/debug lease. If no such lease
exists today, do not invent a large lease system in this slice. Prefer the
smallest deterministic contract that makes diagnostics cleanable and prevents
them from being silently preserved after a proof attempt.

### Render Performance Must Not Prewarm Stage By Default

The toolkit `render-performance` panel currently mounts through the generic
panel shell. Generic panels may prewarm `aos-desktop-world-stage` through the
minimize/stage-chip path.

For this diagnostic panel, that is not acceptable by default. A performance
observer should not create a full DesktopWorld stage unless the user explicitly
uses a feature that needs it.

Acceptable fixes include:

- disabling minimize/stage-chip prewarm for `render-performance`;
- adding a small generic `mountPanel`/`mountChrome` option that preserves the
  current panel behavior for ordinary panels while allowing diagnostic panels
  to opt out of automatic stage prewarm;
- making stage prewarm lazy on actual minimize rather than panel mount, if that
  is smaller and already aligned with local toolkit direction.

Do not add a Sigil-only special case when the issue is generic panel/stage
behavior.

### Clean/Status Must See Leftover Diagnostics

If `sigil-render-performance` and an `aos-desktop-world-stage` child remain
after a proof attempt, `./aos clean --dry-run --json` and the stale-resource view
used by `./aos status` should classify them as cleanable diagnostic residue
unless an explicit active debug lease protects them.

Do not regress the prior correction that preserves real active Sigil canvases.
The distinction should be:

- core active experience surfaces are retained;
- diagnostic surfaces left behind by a proof are cleanable;
- stage canvases parented only to diagnostic surfaces are cleanable with their
  parent;
- stage canvases parented to a retained core surface remain governed by that
  core surface's policy.

### No Unsupported Live Completion Claim

Do not claim the status-icon/radial-menu proof is complete unless the run
actually performed the status icon click and radial menu sequence in the same
live session. That interaction can be performed by a human or by AOS real-input
commands such as `aos see ...` plus `aos do click ...`; either way, the evidence
must show the real input path, not a direct `show post`, `show eval`, or
state-file shortcut. For this Implementer correction, deterministic proof is enough.

If live proof is still the next step, return an Operator-ready note in the
completion report. Do not keep looping on Implementer waiting for an unsupervised live
input sequence while the machine is showing mouse/input jank.

## Verification

Run the focused deterministic suite:

```bash
bash tests/aos-clean-canvas-regression.sh
bash tests/sigil-warm-surface-lifecycle.sh
node --test tests/toolkit/panel-chrome.test.mjs
bash tests/sigil-status-item-lifecycle.sh
bash tests/help-contract.sh
bash tests/external-parser-flags.sh
git diff --check
```

If you touch render-performance model/view code, also run:

```bash
node --test tests/toolkit/render-performance-model.test.mjs tests/toolkit/passive-component-semantics.test.mjs
```

If you touch shared lifecycle/runtime helpers, add the smallest focused runtime
test that proves the new contract.

## Completion Report

Include:

- branch;
- head SHA;
- files changed;
- exact diagnostic lifecycle/cleanup contract chosen;
- whether `render-performance` still creates `aos-desktop-world-stage` on mount;
- tests run and pass/fail;
- final `./aos status --json`, `./aos ready --json`, `./aos show list --json`,
  and `./aos clean --dry-run --json` summaries;
- whether any live AOS real-input or human status-icon proof was attempted;
- the next Operator/human proof needed, if any.
