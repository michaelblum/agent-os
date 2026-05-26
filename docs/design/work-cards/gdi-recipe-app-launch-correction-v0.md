# Work Card: GDI Recipe App Launch Correction V0

## Transfer Classification

- Recipient: GDI
- Transfer kind: correction round
- Single next goal: correct the recipe ladder foundation so app startup is
  driven by one generic app-launch contract, exposed as `aos launch <app>`,
  with Sigil represented by app-owned config/manifests and optional hooks rather
  than a second competing launcher.
- Source artifact: Foreman review of
  `edc68639d4937eb909248c76d8df1449cfcc170d` plus Michael's clarification:
  launching an app should be a shell over one AOS launcher with the app name
  passed in; ultimately `aos launch sigil` should work; avoid two launchers, one
  generic and one Sigil, with duplicated behavior.
- Branch/output expectation: continue from `origin/gdi/recipe-ladder-foundation-v0`,
  commit and push the corrected GDI branch. Do not open or merge a PR; Foreman
  will review.
- Stop conditions: complete, failed, human_needed, or a product-direction
  blocker if a top-level `launch` command is impossible for a concrete reason.

## Branch / Base

- branch_from: `origin/gdi/recipe-ladder-foundation-v0`
- required_start_ref: `origin/gdi/recipe-ladder-foundation-v0`

This is a correction on top of the completed recipe ladder branch, not a restart
from `origin/main` or `origin/feat/command-surface-extraction`.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, app launch state, or prior review context. Read and rediscover before
editing.

## Review Finding To Correct

The foundation slice added useful recipe/block machinery, but Sigil launch is
still shaped as Sigil-specific recipes calling Sigil-specific launch scripts and
a Sigil-specific status helper:

- `recipes/sigil/start.json`
- `recipes/sigil/start-agent-terminal.json`
- `apps/sigil/workbench/launch.sh`
- `apps/sigil/agent-terminal/launch.sh`
- `apps/sigil/scripts/launch-common.sh`
- `scripts/recipes-sigil-configure-status-item.sh`

That risks creating two launch systems: a generic recipe engine plus app-specific
launcher scripts that duplicate content-root setup, daemon readiness, status
item setup, surface verification, and entry selection.

There is also a concrete branch-scope bug in the current helper:
`apps/sigil/scripts/launch-common.sh` hardcodes canonical `content.roots.sigil`
and `content.roots.toolkit`, while topic worktrees must use branch-scoped roots
from `scripts/aos-content-scope.sh`.

## Goal

Make this true:

```bash
./aos launch sigil
./aos launch sigil workbench
./aos launch sigil agent-terminal
./aos launch sigil --json
./aos launch sigil --dry-run --json
```

If implementation inspection proves top-level `aos launch` has a hard conflict,
choose the cleanest existing command family and report the reason. Do not use
`recipe run sigil/start` as the human-facing app launch answer; that remains the
composition engine, not the product launch surface.

## Required Design

### 1. One app launch contract

Add an agreed source-owned app launch manifest format and schema. Prefer:

```text
apps/<app>/aos-app.json
shared/schemas/aos-app-v0.schema.json
```

If you choose different names, keep them generic and app-scoped, not
Sigil-specific.

The manifest should cover at least:

- app id, title, version/schema version;
- default launch entry;
- content roots needed by the app, with branch-scoped root support;
- entries such as `avatar`, `workbench`, and `agent-terminal`;
- status item behavior when the app wants one;
- launch hooks only for app-specific behavior that cannot be expressed as
  generic AOS launch blocks;
- verification surfaces/canvases expected after launch.

Sigil should become data over this contract:

```text
apps/sigil/aos-app.json
```

Do not put generic launch policy in `apps/sigil/scripts/launch-common.sh`.

### 2. One command surface

Add the launch command to the AOS command registry/help surface:

```bash
./aos launch <app> [entry] [--json] [--dry-run]
```

Required behavior:

- discover source apps under `apps/*/aos-app.json`;
- validate the manifest against the schema;
- resolve branch-scoped content roots using the existing
  `scripts/aos-content-scope.sh` behavior or an equivalent shared function;
- configure content roots without overwriting canonical `sigil`/`toolkit` roots
  from a topic worktree;
- start/restart the daemon only when needed to make roots/status item live;
- configure status item from manifest when declared;
- launch the requested app entry;
- verify declared surfaces;
- emit useful JSON for dry-run and run.

### 3. Collapse Sigil launch duplication

After `aos launch sigil` exists, Sigil launch scripts should not duplicate the
generic launch path.

Acceptable end states:

- best: old `apps/sigil/workbench/launch.sh` and
  `apps/sigil/agent-terminal/launch.sh` become thin compatibility wrappers that
  delegate to `./aos launch sigil workbench` and
  `./aos launch sigil agent-terminal`;
- acceptable if Agent Terminal bridge startup is still too app-specific:
  `aos launch` owns discovery, content roots, daemon readiness, status item,
  entry selection, and verification, while a small app hook starts only the
  bridge/provider-specific substrate. The hook must not repeat generic launch
  setup.

Retire or rewrite `apps/sigil/scripts/launch-common.sh` if it remains
Sigil-shaped. Move reusable status item/content-root behavior into the generic
launch command or shared launch library.

### 4. Recipe relationship

Recipes should compose the app launch command, not duplicate app launch.

Good:

```json
{
  "id": "sigil/start",
  "steps": [
    { "kind": "aos_command", "command": { "path": ["launch"], "form_id": "launch-app" }, "argv": ["sigil"] }
  ]
}
```

Also acceptable: retire `recipes/sigil/start*.json` if `aos launch sigil` is the
better canonical entry and the recipe adds no value. Preserve only one real
source of truth.

### 5. Naming boundary

- `launch` is for app/product surfaces.
- `recipe` is for executable composition.
- `show` is for primitive canvas lifecycle.
- Sigil is an app using the launch contract, not a launch framework.

## Read First

- `AGENTS.md`
- `docs/design/work-cards/gdi-recipe-ladder-foundation-v0.md`
- `scripts/aos-ops.mjs`
- `manifests/commands/aos-external-commands.json`
- `manifests/commands/aos-commands.json`
- `scripts/aos-help-proxy.mjs`
- `scripts/aos-content-scope.sh`
- `apps/sigil/AGENTS.md`
- `apps/sigil/workbench/launch.sh`
- `apps/sigil/agent-terminal/launch.sh`
- `apps/sigil/scripts/launch-common.sh`
- `recipes/sigil/start.json`
- `recipes/sigil/start-agent-terminal.json`
- `tests/ops-contract.sh`
- `tests/sigil-workbench-launch.sh`
- `tests/renderer/agent-terminal-chrome.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/gdi/recipe-ladder-foundation-v0
./aos help launch || true
./aos recipe explain sigil/start --json || true
./aos dev recommend --json --paths \
  manifests/commands/aos-external-commands.json,manifests/commands/aos-commands.json,scripts/aos-help-proxy.mjs,scripts/aos-ops.mjs,scripts/aos-content-scope.sh,apps/sigil/AGENTS.md,apps/sigil/workbench/launch.sh,apps/sigil/agent-terminal/launch.sh,apps/sigil/scripts/launch-common.sh,recipes/sigil/start.json,recipes/sigil/start-agent-terminal.json,tests/ops-contract.sh,tests/sigil-workbench-launch.sh,tests/renderer/agent-terminal-chrome.test.mjs
```

If live AOS checks are needed and `./aos ready` reports repo-mode TCC/input-tap
blockers, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

Do not loop on permission repair.

## Suggested Implementation Areas

Inspect first, then choose the smallest clean layer. Likely areas:

- new `scripts/aos-launch.mjs` or equivalent command implementation;
- new `shared/schemas/aos-app-v0.schema.json`;
- new `apps/sigil/aos-app.json`;
- `manifests/commands/aos-external-commands.json`;
- `manifests/commands/aos-commands.json`;
- `scripts/aos-help-proxy.mjs` only if help aliasing requires it;
- `recipes/sigil/start*.json`, either reduced to `aos launch` calls or retired;
- Sigil launch scripts reduced to thin wrappers or app-specific hooks;
- tests for parser/help/dispatch/schema/launch dry-run.

## Hard Boundaries / Non-Goals

- Do not build a TUI.
- Do not implement a full workflow scheduler.
- Do not add a second generic launcher script plus Sigil-specific launcher
  scripts that duplicate it.
- Do not hardcode canonical `content.roots.sigil`/`content.roots.toolkit` for
  topic worktrees.
- Do not migrate all toolkit component launchers in this correction unless a
  tiny shared helper naturally falls out.
- Do not run live providers or AFK sessions.
- Do not mutate GitHub state.

## Verification

Run focused deterministic tests from `./aos dev recommend`, plus at minimum:

```bash
node --test tests/schemas/*.test.mjs
bash tests/help-contract.sh
bash tests/external-command-dispatch.sh
bash tests/external-parser-flags.sh
bash tests/ops-contract.sh
bash tests/sigil-workbench-launch.sh
git diff --check
```

Add or update focused tests proving:

- `./aos help launch` exposes the command;
- `./aos launch sigil --dry-run --json` validates and resolves the Sigil app
  manifest without side effects;
- `./aos launch sigil workbench --dry-run --json` and
  `./aos launch sigil agent-terminal --dry-run --json` resolve distinct entries;
- topic worktree root names remain branch-scoped;
- old Sigil launch scripts, if retained, delegate instead of duplicating
  generic launch setup.

If live readiness passes, run:

```bash
./aos ready --post-permission
./aos launch sigil --dry-run --json
./aos launch sigil --json
./aos show list --json
```

If live readiness is blocked, report deterministic verification and the blocker.

## Completion Report

Report:

- branch, head SHA, base SHA, and whether pushed;
- chosen command shape, expected to be `aos launch <app> [entry]`;
- app manifest path/schema path and key fields;
- how Sigil workbench/agent-terminal launch duplication was collapsed;
- whether `recipes/sigil/start*.json` were reduced, retained, or removed, with
  rationale;
- exact verification commands and pass/fail results;
- live smoke result or readiness blocker;
- any remaining follow-up needed for toolkit component launchers or workflow
  graph integration.

For reused GDI CLI sessions, clear completed goal state with `/goal clear`
before retiring the session or starting unrelated work.
