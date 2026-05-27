# GDI Sigil Warm Surface Lifecycle Performance V0

## Tracker

- User report: 2026-05-26 Sigil feels degraded after the experience/launcher
  and radial/wiki rehab work.
- PR stack: #378 `feat/command-surface-extraction`.
- Current head at card creation: `f366211f` (`fix(runtime): block readiness on
  stale daemons`).
- Related contracts:
  - `docs/design/work-cards/canvas-lifecycle-warm-suspend-resume-contract-v0.md`
  - `docs/design/work-cards/sigil-render-performance-regression-v0.md`
  - `docs/design/work-cards/sigil-status-item-summon-latency-v0.md`
  - `docs/design/work-cards/radial-wiki-toolkit-test-rehab-v0.md`
  - `docs/design/work-cards/gdi-active-sigil-canvas-clean-ownership-correction-v0.md`

## Branch / Base

- branch_from: `origin/feat/command-surface-extraction`
- required_start_ref: `origin/feat/command-surface-extraction`
- output_branch: `gdi/sigil-warm-surface-lifecycle-performance-v0`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, daemon, canvases,
content roots, permissions, or root cause. Work in `/Users/Michael/Code/agent-os`,
not in `.docks/`.

This is a product lifecycle/performance correction, not another test-only rehab
slice. Preserve the current product direction: AOS is the platform, Sigil is the
active experience layer, activation is status-item-first, and the avatar is the
entry point.

## Goal

Make Sigil's status-item/avatar/radial/wiki path use warm retained surfaces
instead of cold remove/recreate loops.

The end state should feel and behave like this:

- clicking the AOS status item while Sigil is active summons an already-warm
  avatar path after the first setup, without stale input-tap or orphan-process
  side effects;
- selecting the radial `Graph Wiki Brain` item opens or resumes the same
  `sigil-wiki-workbench` surface instead of racing duplicate creates;
- ordinary close/hide of the wiki browser parks or suspends the retained panel
  while AOS/Sigil remains active;
- reopening the wiki browser proves a warm/resume advantage over cold create;
- repeated open/close/reopen cycles do not lock the wiki DB, restart the daemon,
  leave stale daemons, or leave unowned input/canvas residue;
- stale branch-scoped Sigil/toolkit content roots from prior GDI branches do not
  keep accumulating in normal Sigil activation.

## User-Visible Symptoms

The user reported:

- avatar summon from the status icon is slow;
- radial menu responsiveness is janky;
- selecting the radial wiki/browser item has noticeable delay;
- closing and reopening the wiki browser shows no pre-warmed advantage;
- after several wiki browser open/close cycles, the wiki panel or runtime
  appeared to crash.

## Foreman Baseline Evidence

Foreman captured this before writing the card:

```bash
./aos status --json
./aos ready --json
./aos show list --json
./aos clean --dry-run --json
./aos experience status --json
./aos content status --json
```

Results:

- AOS was otherwise clean: `status=ok`, `ready=true`, input tap active,
  stale daemon count `0`.
- Sigil was active.
- `./aos show list --json` returned `canvases=[]`, which means no visible or
  warm Sigil surfaces were retained after the user's close/open cycle.
- `./aos content status --json` showed current roots plus stale branch-scoped
  roots such as `sigil_gdi_*` and `toolkit_gdi_*`.

Daemon log evidence around the user's clicks showed:

- status-item click: `target=avatar-main exists=false visible=false`, then
  `missing persistent target=avatar-main; recreating via warm canvas path`;
- avatar boot then prewarmed `sigil-agent-terminal`, but there was no comparable
  wiki workbench prewarm;
- radial wiki activation created `sigil-wiki-workbench`, then immediately hit
  `canvas-mut create fail ... code=DUPLICATE_ID`;
- `sigil-wiki-workbench` was later removed with `orphan=true`;
- repeated cycles attempted to create `aos-desktop-world-stage` again and hit
  duplicate stage creation;
- the crash path included `WIKI_DB_ERROR SQLite error: database is locked SQL:
  PRAGMA journal_mode=WAL`, followed by a daemon restart.

Treat this as a lifecycle/state-machine bug until disproved. Do not chase input
tap hygiene first unless rediscovery shows stale daemons or blocked readiness.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/runtime/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `src/AGENTS.md`
- `src/display/status-item.swift`
- `src/display/canvas.swift`
- `apps/sigil/renderer/live-modules/main.js`
- `apps/sigil/renderer/live-modules/radial-menu-activation.js`
- `apps/sigil/renderer/live-modules/menu-activation-runtime.js`
- `apps/sigil/renderer/live-modules/radial-menu-target-surface.js`
- `packages/toolkit/runtime/canvas.js`
- `packages/toolkit/panel/chrome.js`
- `packages/toolkit/panel/mount.js`
- `packages/toolkit/panel/drag-transfer.js`
- `packages/toolkit/components/wiki-subject-browser/index.html`
- `packages/toolkit/components/wiki-subject-browser/index.js`
- `packages/toolkit/workbench/wiki-subject-opening.js`
- `scripts/aos-experience.mjs`
- `scripts/aos-clean.mjs`
- `tests/lib/status-item.sh`
- `tests/lib/sigil/radial-menu.sh`
- `tests/sigil-status-item-lifecycle.sh`
- `tests/scenarios/sigil/radial-menu/real-input.sh`
- `tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh`
- `tests/toolkit/runtime-canvas-lifecycle.test.mjs`
- `tests/toolkit/panel-chrome.test.mjs`
- `tests/toolkit/wiki-subject-browser.test.mjs`

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
./aos content status --json
tail -n 220 ~/.config/aos/repo/daemon.log
```

If `./aos ready` reports a repo-mode TCC/input-tap blocker, do not loop. Run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Stop with `human_needed`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

## Required Behavior

### Warm Surface Ownership

Active Sigil should have an explicit bounded warm-surface policy. At minimum,
cover:

- `avatar-main`;
- `sigil-hit-avatar-main`;
- `sigil-radial-menu-avatar-main`;
- `sigil-agent-terminal`;
- `sigil-wiki-workbench`;
- `aos-desktop-world-stage` only when it is a valid child/utility resource of
  an owned warm or active surface.

Do not make the daemon hard-code Sigil. Daemon/toolkit should provide lifecycle
primitives; the Sigil experience, launcher, or renderer should declare and use
the policy.

### Status Item / Avatar

Status-item-first activation is still correct: activation may create the menu
icon before showing the avatar. But first visual summon should not require
rebuilding the entire avatar stack if the experience is already active and a
warm retained canvas can exist hidden/suspended.

Allowed outcomes:

- prewarm `avatar-main` during Sigil activation/status-item setup; or
- create it on first summon, then retain/suspend it for subsequent summon; or
- another explicit lifecycle path that proves equivalent warm reuse.

### Radial Wiki Activation

The radial wiki action must be idempotent:

- if `sigil-wiki-workbench` already exists and is active, focus/raise/update it;
- if it exists suspended/warm, resume it and update the requested subject;
- if it is missing, create it once;
- concurrent/double activation should not issue duplicate `canvas.create` calls;
- activation should not create a duplicate `aos-desktop-world-stage`.

### Panel Close / Hide Semantics

Ordinary user close of the Sigil wiki browser should park/suspend/hide the
surface, not remove it, while Sigil is active. Use toolkit-owned panel lifecycle
hooks if they exist; add the smallest generic opt-in if they do not.

Keep an explicit hard-remove path for cleanup/deactivation/test teardown. Do not
turn every toolkit panel into a permanent warm surface by default.

### Wiki DB / Crash Path

Repeated open/close/reopen must not produce:

- `WIKI_DB_ERROR`;
- SQLite `database is locked` during `PRAGMA journal_mode=WAL`;
- daemon restart;
- stale daemons;
- duplicate canvas IDs;
- stuck input regions.

Investigate whether the lock comes from duplicate browser creation, graph/index
startup, or DB connection setup. Fix the actual lifecycle/concurrency cause
rather than masking it with sleeps.

### Content Roots

Sigil activation should not keep accumulating stale branch-scoped content roots
from old GDI branches. Prefer a narrowly scoped cleanup/reconciliation strategy
for roots owned by the current Sigil/toolkit experience. Do not delete unrelated
user content roots.

## Scope

Likely implementation areas:

- Sigil experience activation hooks or manifest warm-surface declarations;
- Sigil renderer activation/runtime surface lifecycle;
- toolkit panel chrome close policy opt-in for suspend-on-close;
- toolkit runtime canvas helper usage, not a new private Sigil trick;
- content-root reconciliation during Sigil activation;
- focused lifecycle tests and one bounded live smoke if readiness passes.

## Hard Boundaries

- Do not resurrect the legacy Sigil workbench as the solution.
- Do not rebuild the sequestered context menu.
- Do not solve perceived latency with arbitrary long sleeps.
- Do not hide the avatar animation or disable expected radial behavior as a
  performance fix.
- Do not run destructive global cleanup as normal user-facing behavior.
- Do not add unbounded warm canvas pools.
- Do not make GDI self-accept architectural review findings; bring them back to
  Foreman if the surface/lifecycle ownership question expands beyond this card.

## Suggested Implementation Path

1. Reproduce the current path from logs or isolated live smoke and capture
   before timings for status summon and wiki open/resume.
2. Identify where `sigil-wiki-workbench` is removed on close and where duplicate
   creation is triggered.
3. Add or use a generic lifecycle opt-in so a panel can close-to-suspend when
   launched as a retained experience surface.
4. Make radial wiki activation use an idempotent warm/resume/create controller.
5. Make Sigil activation or first summon retain the warm avatar path.
6. Reconcile current Sigil/toolkit content roots without deleting unrelated
   roots.
7. Add regression coverage before broad live checks.

## Required Tests / Evidence

Add at least one regression that proves repeated wiki browser open/close/reopen
uses warm retention and does not duplicate-create. A good shape is an isolated
daemon shell test such as:

```bash
bash tests/sigil-warm-surface-lifecycle.sh
```

It should verify, as applicable:

- activate Sigil;
- create/summon avatar path;
- open wiki from the radial activation path or the same runtime action code;
- close/hide the wiki browser;
- `sigil-wiki-workbench` remains warm/suspended rather than removed;
- reopen resumes the same canvas ID;
- repeating the cycle three times leaves daemon status OK;
- logs for that isolated run do not include `DUPLICATE_ID`, `WIKI_DB_ERROR`, or
  stale daemon findings.

Focused deterministic checks:

```bash
node --test tests/toolkit/runtime-canvas-lifecycle.test.mjs
node --test tests/toolkit/panel-chrome.test.mjs
node --test tests/toolkit/wiki-subject-browser.test.mjs
node --test tests/renderer/radial-menu-activation.test.mjs tests/renderer/radial-menu-target-surface.test.mjs
bash tests/sigil-status-item-lifecycle.sh
bash tests/sigil-workbench-kb.sh
bash tests/ready-fast-healthy-path.sh
git diff --check
```

If Swift changes:

```bash
./aos dev build
```

If `./aos ready --json` passes, run one bounded live smoke in repo mode:

```bash
./aos status --json
./aos ready --json
./aos experience activate sigil --json
./aos show list --json
```

Then use the existing radial/status helpers or real-input scenario to open,
close, and reopen the wiki browser. Capture:

- first summon latency;
- cold wiki open latency;
- warm wiki reopen latency;
- final `./aos status --json`;
- final `./aos clean --dry-run --json`;
- final `./aos show list --json`;
- any relevant daemon log excerpt.

## Completion Report

Include:

- files changed;
- confirmed root cause(s);
- whether avatar, radial menu, wiki browser, and DesktopWorld stage now use
  warm/suspend/resume or why a different lifecycle was chosen;
- before/after timing evidence for status summon and wiki open/reopen if live
  checks were available;
- proof that repeated wiki open/close no longer produces duplicate creates,
  wiki DB locks, or daemon restart;
- content-root cleanup/reconciliation result;
- deterministic tests run;
- live AOS readiness result or TCC/human-needed blocker;
- remaining risks and whether they require Foreman review, Operator live proof,
  or another GDI round.
