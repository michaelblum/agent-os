# Test Suite Contract Audit V0

## Summary

This audit reviewed the active test suite and adjacent Sigil/AOS helper surfaces
after the command-surface, Sigil experience, lifecycle, radial/wiki, and
real-input harness work on `origin/feat/command-surface-extraction`.

Categories found:

- Product compatibility: explicit legacy/dev entrypoints remain where current
  manifests or docs still promise them.
- Diagnostic compatibility: bounded global status-item inventory remains only
  as diagnostic evidence for duplicate menu-bar ownership or live repo status
  item selection.
- Test harness residue: stale Studio/workbench paths and neutral names for
  global menu-bar scans were still present in active tests/docs.
- Deferred findings: broad historical docs and future work cards still contain
  legacy vocabulary, but they are not active test contracts.

## Migrated Or Removed

Migrated:

- `tests/lib/status-item.sh` now names global menu-bar scanning as
  `aos_global_status_item_diagnostic_matches_json`,
  `aos_global_status_item_diagnostic_overlap_json`, and
  `aos_global_status_item_diagnostic_unambiguous_pid`.
- `tests/lib/visual-harness.sh` now calls those diagnostic names and keeps the
  normal real click path PID-scoped through `click_aos_status_item_real`.
- Sequestered Studio unit tests under `tests/studio/*.test.mjs` now import from
  `apps/sigil/_sequestered/studio/...` instead of the removed
  `apps/sigil/studio/...` path.
- `apps/sigil/scripts/launch-common.sh` no longer describes current shared
  launch setup as old-harness compatibility.
- `docs/dev/reports/toolkit-surface-audit.md` now points at the sequestered
  Studio path.

Removed:

- `tests/sigil-workbench-studio-restage.sh` was deleted. It asserted the old
  Sigil Workbench Studio-tab restaging path, while the current workbench marks
  Studio as sequestered and should not expose a Studio tab as the current
  product proof.
- `tests/README.md` no longer recommends the removed restage test.

## Product Compatibility Retained

- `apps/sigil/aos-app.json` retains `legacy-workbench` as an explicit dev-only
  launch entry. Contract: the app manifest declares the entry and the schema
  tests assert that it exists separately from the default avatar entry.
  Removal gate: remove when no accepted dev/test flow requires the historical
  multi-tab surface.
- `tests/sigil-workbench-launch.sh` and `tests/sigil-workbench-kb.sh` remain.
  Contract: they test the explicit `legacy-workbench` entry and Knowledge Base
  behavior, not canonical Sigil activation. Removal gate: delete with the
  `legacy-workbench` manifest entry.
- `tests/studio/*.test.mjs` remain as pure helper tests for the sequestered
  Studio source material. Contract: those modules are retained only for future
  theme/control extraction and are not launch or product activation tests.
  Removal gate: delete or migrate when the future Sigil theme/control work
  extracts the useful helpers or retires the sequestered tree.

## Diagnostic Compatibility Retained

- Global status-item inventory remains because duplicate AOS menu-bar icons can
  contaminate real-input evidence across repo and isolated daemons.
- The global scan is bounded by existing timeouts in `aos_visual_run_bounded`
  and by the helper retry loops; it is not the normal click primitive.
- Normal isolated status-item smokes use PID-scoped owner helpers:
  `aos_status_item_matches_for_pids_json`,
  `aos_status_item_pid_from_matches_json`, and
  `click_aos_status_item_real`.

## Deferred Findings

- Historical work cards and archive/reference docs still contain old
  `aos launch sigil`, Studio, workbench, `ready`, and compatibility vocabulary.
  They are intentionally deferred because the card excludes turning historical
  and archive docs into current product requirements.
- `apps/sigil/_sequestered/studio/` still contains Studio wording internally.
  That is acceptable while the directory is explicitly sequestered and retained
  as source material.
- Some app/toolkit component launch scripts still use remove/create behavior.
  Those are broad lifecycle/product surfaces, not low-risk test-harness residue
  for this audit round.
