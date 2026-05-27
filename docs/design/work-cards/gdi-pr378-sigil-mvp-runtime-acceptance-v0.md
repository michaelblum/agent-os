# GDI PR378 Sigil MVP Runtime Acceptance V0

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI validation / bounded correction round.
- Single next goal: run a current-head Sigil MVP runtime acceptance pass using
  the canonical AOS/Sigil command and test harness surfaces, fixing only bounded
  defects required for that path and reporting any broader product/performance
  risk with evidence.
- Source artifact: PR #378 command-surface/Sigil experience stack after
  `0c933013` (`fix(sigil): stabilize radial live cleanup`).
- Branch/output expectation: start from
  `origin/feat/command-surface-extraction`, create or update
  `gdi/pr378-sigil-mvp-runtime-acceptance-v0`, and push it.
- Stop conditions: complete, failed, human_needed, or blocker. Stop with
  `human_needed` instead of looping if repo-mode AOS permissions/TCC block live
  verification.

## Branch / Base

- branch_from: `origin/feat/command-surface-extraction`
- required_start_ref: `origin/feat/command-surface-extraction`
- expected output branch: `gdi/pr378-sigil-mvp-runtime-acceptance-v0`
- routed from PR stack checkpoint: `0c933013`
  (`fix(sigil): stabilize radial live cleanup`)

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, daemon, canvas,
status item, input state, content roots, wiki content, or prior Foreman
observations. Rediscover before editing.

## Goal

Verify the current PR #378 Sigil MVP runtime path as a user/agent would use it:

1. AOS repo runtime is ready and clean.
2. Sigil is active as the AOS experience via `aos experience activate sigil`.
3. The menu/status icon is present, points at current branch content roots, and
   summons the avatar.
4. The avatar is visible, interactive, and can open its radial menu.
5. The radial `Graph Wiki Brain` path opens the graph-first wiki browser
   (`sigil-wiki-workbench`).
6. The wiki graph has real seeded content, not only `Default` / `entity`.
7. Closing and reopening the wiki browser demonstrates retained/warm behavior
   or reports exact timing evidence if the warm advantage is absent.
8. Cleanup leaves runtime clean: no stale daemons, no orphaned diagnostic
   canvases, no duplicate status items, and `./aos clean --dry-run --json`
   reports clean.

This is an acceptance pass, not a redesign round. Fix bounded defects that
block or invalidate the acceptance path. If the remaining problem is broad
product behavior or performance architecture, stop after evidence and recommend
the next focused card.

## Read First

- `AGENTS.md`
- `tests/README.md`
- `docs/recipes/test-harness-ladder-and-prep.md`
- `docs/design/work-cards/gdi-sigil-status-item-stale-root-recovery-v0.md`
- `docs/design/work-cards/gdi-sigil-warm-surface-lifecycle-performance-v0.md`
- `docs/design/work-cards/gdi-radial-live-ipc-cleanup-correction-v0.md`
- `docs/api/aos.md`
- `experiences/sigil/aos-experience.json`
- `apps/sigil/aos-app.json`
- `scripts/aos-experience.mjs`
- `scripts/aos-clean.mjs`
- `tests/sigil-status-item-lifecycle.sh`
- `tests/sigil-warm-surface-lifecycle.sh`
- `tests/sigil-real-input-status-avatar.sh`
- `tests/scenarios/sigil/radial-menu/real-input.sh`
- `tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh`
- `tests/lib/visual-harness.sh`
- `tests/lib/status-item.sh`
- `tests/lib/sigil/radial-menu.sh`

## Rediscover State

Run from repo root:

```bash
git status --short --branch
git rev-parse HEAD origin/feat/command-surface-extraction
./aos ready --json
./aos status --json
./aos show list --json
./aos clean --dry-run --json
./aos dev recommend --json --paths experiences/sigil/aos-experience.json,scripts/aos-experience.mjs,scripts/aos-clean.mjs,tests/sigil-status-item-lifecycle.sh,tests/sigil-warm-surface-lifecycle.sh,tests/sigil-real-input-status-avatar.sh,tests/scenarios/sigil/radial-menu/real-input.sh
```

If `./aos ready` reports a repo-mode TCC/input-tap blocker, do not loop on
permission repair. Run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Stop with `human_needed`. After the human returns with `finished`, run exactly:

```bash
./aos ready --post-permission
```

## Required Acceptance Work

### 1. Start Clean And Activate Sigil

Use AOS first:

```bash
./aos ready --json
./aos clean --dry-run --json
./aos experience activate sigil --json
./aos experience status --json
./aos status --json
./aos show list --json
```

If activation has to repair stale branch roots, report that as expected only if
the final state is current-root and clean.

### 2. Deterministic Contract Checks

Run the focused deterministic checks that cover this path:

```bash
git diff --check
node --test tests/schemas/aos-experience-v0.test.mjs
bash tests/sigil-status-item-lifecycle.sh
bash tests/sigil-warm-surface-lifecycle.sh
bash tests/help-contract.sh
bash tests/external-parser-flags.sh
```

Add adjacent focused tests only if you touch adjacent files.

### 3. Real-Input MVP Path

If `./aos ready --json` is true, run:

```bash
bash tests/sigil-real-input-status-avatar.sh
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input.sh
```

If the base path passes and runtime remains clean, optionally run the
DesktopWorld path once:

```bash
AOS_REAL_INPUT_OK=1 bash tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh
```

Do not run unbounded live pointer loops. If the machine shows input jank, stop
live input and collect `./aos status --json`, `./aos show list --json`, and
`./aos clean --dry-run --json`.

### 4. Wiki Content And Warm Behavior

Verify wiki graph content after Sigil activation:

```bash
./aos wiki graph --json
```

Acceptance:

- graph has multiple nodes;
- graph has multiple node types beyond a lone `entity`;
- Sigil namespace content and base AOS wiki content are both represented.

Verify warm/retained wiki behavior using existing harnesses first. Prefer
`tests/sigil-warm-surface-lifecycle.sh`. If you add a direct timing probe,
report:

- cold open / first open timing;
- close-to-suspend or hidden state;
- reopen/resume timing;
- whether the same canvas id is retained;
- whether `./aos clean --dry-run --json` treats the retained canvas correctly.

### 5. Runtime Hygiene

Final state must include:

```bash
./aos status --json
./aos ready --json
./aos show list --json
./aos clean --dry-run --json
git status --short --branch
```

If cleanup fails, fix the bounded cleanup defect or report the exact stale
resource and failed command.

## Boundaries

- Do not redesign Sigil, radial menu, wiki browser, or toolkit lifecycle in
  this round.
- Do not disable warm/suspend/resume to make cleanup easier.
- Do not hide product latency by skipping the real-input radial path.
- Do not treat noisy diagnostics as acceptance failure if the scenario passes,
  final runtime is clean, and the diagnostic is already actionable.
- Do not add Sigil-private test tricks when a reusable AOS/toolkit harness
  primitive is the right level.
- Do not use raw daemon HTTP, state-file surgery, or process kills unless an
  `./aos` command is broken; if bypassing AOS is necessary, report why.
- Do not run `./aos dev build` unless the changed files or router require it.

## Completion Report

Include:

- files changed;
- whether this was validation-only or included bounded fixes;
- exact deterministic checks and live checks run;
- status item summon result and split timing if available;
- radial wiki result and opened surface id;
- wiki graph node/link/type counts;
- warm wiki close/reopen evidence;
- final `status`, `ready`, `show list`, and `clean --dry-run` summaries;
- any duplicate status-item, stale canvas, input-jank, or performance risk;
- recommended next card only if a concrete follow-up remains.
