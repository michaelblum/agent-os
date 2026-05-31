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
- Test harness residue: stale legacy config/workbench paths and neutral names for
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
- Retired avatar-configuration helper tests were removed with the decommissioned
  surface.
- `apps/sigil/scripts/launch-common.sh` no longer describes current shared
  launch setup as old-harness compatibility.
- `docs/dev/reports/toolkit-surface-audit.md` now points at the retired
  configuration surface.

Removed:

- `tests/sigil-workbench-restage.sh` was deleted. It asserted the old Sigil
  workbench restaging path, while the current workbench marks the legacy
  configuration surface as sequestered and should not expose it as the current
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
- No dedicated helper-test loop remains for the retired avatar configuration
  surface. Contract: any future helper coverage should live with the current
  product surface or toolkit owner that actually consumes it.

## Diagnostic Compatibility Retained

- Global status-item inventory remains because duplicate AOS menu-bar icons can
  contaminate real-input evidence across repo and isolated daemons.
- The global scan is bounded inside
  `aos_global_status_item_diagnostic_matches_json`, and visual failure
  snapshots consume that bounded diagnostic helper. It is not the normal click
  primitive.
- Normal isolated status-item smokes use PID-scoped owner helpers:
  `aos_status_item_matches_for_pids_json`,
  `aos_status_item_pid_from_matches_json`, and
  `click_aos_status_item_real`.

## Deferred Findings

- Historical work cards and archive/reference docs still contain old
  `aos launch sigil`, workbench, `ready`, and compatibility vocabulary.
  They are intentionally deferred because the card excludes turning historical
  and archive docs into current product requirements.
- The retired avatar configuration surface no longer has live repo paths.
- Some app/toolkit component launch scripts still use remove/create behavior.
  Those are broad lifecycle/product surfaces, not low-risk test-harness residue
  for this audit round.
