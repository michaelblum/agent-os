# GDI Work Card: AOS-Native Compact Record-Primary Smoke v0

## Transfer

- recipient: GDI
- kind: GDI round
- source artifact: accepted commit `e292f0a9 test(sigil): expose compact tabs as native records`
- branch_from: `gdi/post-refactor-real-input-dogfooding-corrections-v0`
- required_start_ref: `gdi/post-refactor-real-input-dogfooding-corrections-v0`
- branch/output expectation: keep work on this branch unless GDI's relay contract requires a temporary output branch; do not reset to `origin/main`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon, canvas, issue, or prior implementation state. Read and rediscover before editing.

## Goal

Tighten the deterministic Sigil fast-travel smoke so compact context-menu tab/control operations fail if they use the broken-contract DOM fallback instead of AOS-native control records.

## Read First

- `AGENTS.md`
- `tests/lib/real_input_surface_primitives.py`
- `tests/sigil-hit-target-drag-fast-travel.sh`
- `apps/sigil/avatar-editor/compact-surface.js`
- `tests/renderer/sigil-avatar-editor-compact-surface.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git log --oneline --decorate -5
```

This is deterministic isolated-daemon work. Do not run live OS pointer scenarios unless `./aos ready` is clean and `AOS_REAL_INPUT_OK=1` is explicitly required. If a live check hits repo-mode TCC/Input Monitoring/input-tap blockers, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`; after the human returns with `finished`, run `./aos ready --post-permission`.

## Existing Code To Inspect

- `tests/lib/real_input_surface_primitives.py` - returns `controlRecord` for segmented/slider and `fallback` for tab readiness.
- `tests/sigil-hit-target-drag-fast-travel.sh` - currently checks operation success but not record-primary proof for every compact interaction.
- `apps/sigil/avatar-editor/compact-surface.js` - source of tab and form control record shape.

## Required Behavior

- The smoke must assert that every compact context-menu tab/control helper result used a populated record path:
  - tab ready/click results should have `controlRecord` present and `fallback` absent/null;
  - segmented and slider ready/click/drag results should have `controlRecord` present;
  - checks should cover both main-display and extended-display branches where those branches execute.
- Failure messages should name the descriptor/tab and include the helper payload.
- Do not remove the broken-contract fallback from the helper yet; this card only proves the normal smoke does not rely on it.

## Scope

Test/helper assertion tightening only. Do not change product behavior unless the new assertion exposes a real contract bug that must be fixed for the smoke to pass.

## Hard Boundaries

- Do not start a new branch.
- Do not commit or rewrite unrelated untracked docs/reports.
- Do not normalize pixel inference for AOS-owned UI.
- Do not add Sigil-private agent APIs.
- Do not use raw daemon HTTP, tmux, or curl for runtime control unless `./aos` is missing or broken and you state why.

## Verification

Run:

```bash
git diff --check
bash -n tests/sigil-hit-target-drag-fast-travel.sh
python3 -m py_compile tests/lib/real_input_surface_primitives.py
bash tests/sigil-hit-target-drag-fast-travel.sh
```

If you touch compact surface/unit contracts, also run:

```bash
node --test tests/renderer/sigil-avatar-editor-compact-surface.test.mjs
```

## Completion Report

Report:

- changed paths;
- exactly which helper payloads now assert record-primary operation;
- whether any broken-contract fallback remains and why;
- exact verification commands and pass/fail results;
- unrelated local-only state;
- next smallest follow-up if one remains.
