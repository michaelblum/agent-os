# GDI Work Card: AOS-Native Compact Tab Records v0

## Transfer

- recipient: GDI
- kind: GDI round
- source artifact: Foreman checkpoint `2182aa29 test(sigil): expose compact controls as agent records`
- branch_from: `gdi/post-refactor-real-input-dogfooding-corrections-v0`
- required_start_ref: `gdi/post-refactor-real-input-dogfooding-corrections-v0`
- branch/output expectation: keep work on this branch unless GDI's local contract requires an output branch; do not reset to `origin/main`

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon, canvas, issue, or prior implementation state. Read and rediscover before editing.

## Goal

Make Sigil compact context-menu tab operation use the same AOS-native control-record contract as compact form controls, instead of using a DOM selector in the real-input helper.

## Read First

- `AGENTS.md`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/panel/AGENTS.md`
- `apps/sigil/avatar-editor/compact-surface.js`
- `apps/sigil/context-menu/menu.js`
- `packages/toolkit/panel/form.js`
- `tests/lib/real_input_surface_primitives.py`
- `tests/sigil-hit-target-drag-fast-travel.sh`

## Rediscover State

Run:

```bash
git status --short --branch
git log --oneline --decorate -4
```

This is deterministic helper/surface work. Do not run live OS pointer scenarios unless `./aos ready` is clean and the test explicitly requires `AOS_REAL_INPUT_OK=1`. If repo-mode Accessibility, Input Monitoring, or inactive input-tap blockers appear during a live check, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`; after the human returns with `finished`, run `./aos ready --post-permission`.

## Existing Code To Inspect

- `apps/sigil/avatar-editor/compact-surface.js` - now exposes `getControlRecords()` and should be the right place to add tab records.
- `apps/sigil/context-menu/menu.js` - publishes compact records through `snapshot().contextMenu.controls`.
- `packages/toolkit/panel/form.js` - generic form control-record shape to mirror for tab fields where applicable.
- `tests/lib/real_input_surface_primitives.py` - helper still uses `[data-aos-tabs-trigger]` for tabs.
- `tests/renderer/sigil-avatar-editor-compact-surface.test.mjs` - add deterministic coverage for tab records.
- `tests/sigil-hit-target-drag-fast-travel.sh` - isolated-daemon smoke that should continue passing.

## Required Behavior

- Compact surface records include tab controls with:
  - `ref` like `aos.tab:<tab-key>`;
  - role `AXTab`;
  - stable `id`/`value`, name/label, selected/current state, enabled state, bounds, and actions.
- `snapshot().contextMenu.controls` includes those tab records after the compact surface is mounted.
- `tests/lib/real_input_surface_primitives.py` uses those records in `tabReady`/`clickTab` instead of querying `[data-aos-tabs-trigger]` as the primary path.
- Keep DOM selector fallback only if it is explicitly labeled as broken-contract forensics or temporary helper fallback; do not make it the normal operating path.

## Scope

Toolkit/Sigil compact surface and deterministic test helpers only. This is not a daemon primitive implementation and not a live input/TCC repair task.

## Hard Boundaries

- Do not start a new branch.
- Do not commit or rewrite the older untracked reports/work cards unless this card directly needs a new committed artifact.
- Do not normalize pixel inference for AOS-owned UI.
- Do not add Sigil-private agent APIs when a compact surface/toolkit control record is the right layer.
- Do not use raw daemon HTTP, tmux, or curl for runtime control unless `./aos` is missing or broken and you state why.

## Verification

Run at minimum:

```bash
git diff --check
bash -n tests/sigil-hit-target-drag-fast-travel.sh
python3 -m py_compile tests/lib/real_input_surface_primitives.py
node --test tests/toolkit/panel-form.test.mjs tests/renderer/sigil-avatar-editor-compact-surface.test.mjs
bash tests/sigil-hit-target-drag-fast-travel.sh
```

If you touch broader toolkit primitives, also run:

```bash
node --test tests/toolkit/real-input-surface-primitives.test.mjs
```

## Completion Report

Report:

- changed paths;
- exact record fields added for tabs;
- whether the helper still has any tab DOM selector fallback and why;
- exact verification commands and pass/fail results;
- any local-only state, including unrelated untracked work cards/reports;
- the next smallest follow-up if one remains.
