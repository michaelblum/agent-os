# GDI: Sigil Wiki Base Seed Activation Correction V0

## Transfer

- recipient: GDI
- kind: correction round
- branch_from: `origin/feat/command-surface-extraction`
- required_start_ref: `origin/feat/command-surface-extraction`
- source artifact: user live report, Foreman local diagnosis

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## User Report

After opening the Sigil graph/wiki surface, the graph showed only one node:
`Default`. The graph key had only one item: `entity`.

Foreman diagnosed the live repo-mode wiki store before repair:

- `~/.config/aos/repo/wiki` contained only `sigil/agents/default.md` plus
  `wiki.db`.
- `./aos wiki graph --json` returned the one Sigil default agent node.
- Running `./aos wiki seed --json` repaired the live store.
- After repair, `./aos wiki graph --json` summarized as 36 nodes, 99 links, and
  node types `concept`, `entity`, `reference`, and `workflow`.

This is not primarily a graph renderer bug. It is a startup/activation seed
contract gap: Sigil startup can seed the Sigil namespace without ensuring the
base AOS wiki seed exists.

## Goal

Make canonical Sigil activation/startup ensure the base AOS wiki seed exists
before the user can open the graph/wiki surface, while preserving Sigil's
namespace seed and without overwriting user-authored wiki content by default.

## Read First

- `AGENTS.md`
- `apps/sigil/AGENTS.md`
- `scripts/aos-experience.mjs`
- `scripts/aos-launch.mjs`
- `scripts/aos-wiki-seed.mjs`
- `apps/sigil/sigilctl-seed.sh`
- `experiences/sigil/aos-experience.json`
- `apps/sigil/aos-app.json`
- `apps/sigil/renderer/live-modules/radial-menu-activation.js`
- `tests/wiki-seed.sh`
- `tests/wiki-graph-external.sh`
- `tests/sigil-status-item-lifecycle.sh`
- `tests/lib/visual-harness.sh`

## Rediscover State

```bash
git status --short --branch
./aos ready
./aos content status --json
./aos wiki graph --json
./aos show list --json
```

If live AOS readiness hits repo-mode Accessibility/Input Monitoring or inactive
input-tap blockers, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

## Required Behavior

- `aos experience activate sigil` is the canonical activation path and must not
  leave a fresh repo-mode wiki with only `sigil/agents/default.md`.
- If the wiki has no base `aos/plugins`, `aos/entities`, or `aos/concepts`
  content, Sigil activation/startup must seed the platform `wiki-seed/` content
  idempotently.
- Existing base wiki content must not be force-overwritten during ordinary
  activation/startup.
- Sigil's own namespace seed, currently `sigil/agents/default.md`, must still be
  present after activation/startup.
- The graph/wiki surface should have enough indexed content to show multiple
  typed nodes, not just `Default`.
- The fix should work from the recipe/delegate path as well:
  `aos recipe run sigil/start` -> `aos experience activate sigil`.

## Scope

Likely ownership boundary: experience activation/startup plus Sigil seed
governance and tests. Prefer the narrowest durable layer after reading the code.

## Hard Boundaries

- Do not force overwrite or delete user wiki content as part of normal Sigil
  activation.
- Do not treat this as a visual graph layout bug unless new evidence proves the
  renderer still misbehaves after the wiki store is populated.
- Do not revive the legacy Sigil workbench as the primary launch path.
- Do not add another human-facing command surface if an existing activation or
  seed helper can own the contract cleanly.
- Do not route around `./aos` with direct daemon HTTP/state-file inspection
  unless an `./aos` command is broken; if you must bypass, explain why.

## Suggested Implementation Areas

Inspect before editing; these are likely candidates, not mandates:

- `scripts/aos-experience.mjs` may need a manifest-backed activation hook or a
  Sigil-specific seed step before marking the experience active.
- `experiences/sigil/aos-experience.json` may need to declare startup hooks if
  the schema already supports or should support them.
- `apps/sigil/sigilctl-seed.sh` may need to compose the base wiki seed before
  the Sigil namespace seed, if that is the cleanest existing reusable unit.
- `tests/sigil-status-item-lifecycle.sh` or a new focused test should cover the
  fresh-state case where only Sigil's namespace seed would have existed before
  the fix.

## Verification

Run focused deterministic coverage first:

```bash
bash tests/wiki-seed.sh
bash tests/wiki-graph-external.sh
bash tests/sigil-status-item-lifecycle.sh
bash tests/sigil-workbench-kb.sh
bash tests/help-contract.sh
bash tests/external-parser-flags.sh
git diff --check
```

Add or update at least one regression that proves a fresh runtime activation path
does not leave `./aos wiki graph --json` with only the `Default` entity node.

If `./aos ready` passes, run a bounded live smoke:

```bash
./aos experience activate sigil --json
./aos wiki graph --json
./aos show list --json
```

Optional live smoke, only if it will not disrupt the desktop:

1. Click the Sigil status item to show the avatar.
2. Open the radial Wiki Graph item.
3. Confirm the graph key has multiple node types and the graph has multiple
   nodes.

## Completion Report

Report:

- files changed;
- the chosen ownership layer for base wiki seeding;
- exact regression added or updated;
- exact tests run and pass/fail result;
- live smoke result or readiness blocker;
- local-only state, especially live wiki/canvas/daemon state;
- remaining follow-up slices, if any.
