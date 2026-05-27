# Test Harness Ladder Prep Protocol V0

## Summary

This report inventories the current foundational AOS test harness ecosystem
after `origin/feat/command-surface-extraction` and records where the new ladder
and prep recipe should guide future Foreman/GDI/Operator choices.

The target is not a mandatory design phase for every task. The target is faster
harness choice with fewer fake fixtures that erase the variable under test.

## Foundational Harness Inventory

- Model/unit tests: `tests/renderer/*.test.mjs`, `tests/toolkit/*.test.mjs`,
  `tests/daemon/*.test.mjs`, `tests/browser/*.test.sh`, package-local tests,
  and `tests/schemas/*.test.mjs`.
- Toolkit/component contracts: toolkit runtime, workbench subject, radial/menu,
  annotation, and schema-backed component tests under `tests/toolkit/` and
  `tests/schemas/`.
- Isolated daemon tests: shell smokes that allocate `AOS_STATE_ROOT` and often
  source `tests/lib/isolated-daemon.sh` for socket, temp-root, content-root, and
  cleanup ownership.
- Shared repo-daemon live canvas tests: semantic target, ref-click, xray, and
  capture scenarios guarded by `tests/lib/live-canvas-serial.sh`.
- Visual harness tests: `tests/lib/visual-harness.sh` plus
  `tests/visual-harness-content-preflight.sh` and related Surface Inspector,
  Sigil, and display diagnostic smokes.
- Status-item owner/click harnesses: `tests/lib/status-item.sh`,
  `tests/sigil-status-item-lifecycle.sh`,
  `tests/sigil-real-input-status-avatar.sh`, and
  `tests/sigil-context-menu-real-input.sh`.
- Real-input scenarios: `tests/lib/real-input-surface-harness.sh`,
  `tests/lib/real-input-surface-primitives.mjs`,
  `tests/lib/real_input_surface_primitives.py`, and named scenarios gated by
  `AOS_REAL_INPUT_OK=1`.
- Supervised/HITL harnesses: `tests/lib/supervised-run*.sh`,
  `tests/lib/supervised-run-artifact.py`, `tests/run-puck-hitl-plan.sh`, and
  `tests/manual/tcc-reset-agent-user-path.sh`.

## High-Value Shared Primitives

- `tests/lib/isolated-daemon.sh` owns isolated runtime roots, daemon startup,
  content-root waits, socket waits, permission setup when already granted, and
  cleanup.
- `tests/lib/live-canvas-serial.sh` owns repo-daemon canvas serialization so
  live tests do not overlap shared canvas mutations.
- `tests/lib/visual-harness.sh` owns common visual workspace launch, content
  root preflight, Sigil launch helpers, phase snapshots, and bounded diagnostics.
- `tests/lib/status-item.sh` separates PID-scoped status-item clicks from
  bounded global duplicate diagnostics.
- `tests/lib/real-input-surface-harness.sh` and real-input primitives own
  readiness checks, Surface Inspector visibility, DesktopWorld/native
  conversion, semantic-target capture, and real pointer delivery.
- `tests/lib/supervised-run*.sh` and `tests/lib/supervised-run-artifact.py`
  produce supervised-run artifacts, response sidecars, event timelines, and
  schema validation for human-in-the-loop scenarios.

## Residue And Migration Candidates

- Sequestered Studio unit tests remain useful as pure helper coverage, but they
  should not be promoted as current Sigil product activation proof.
- `legacy-workbench` Sigil tests remain tied to the explicit dev-only manifest
  entry. Delete or migrate them only with that manifest boundary.
- Global status-item inventory remains diagnostic residue. Keep it bounded and
  subordinate to PID-scoped owner/click helpers.
- Shell tests still contain many local `show create` and `show eval` snippets.
  Leave existing focused tests alone, but migrate repeated canvas setup,
  semantic-target parsing, and cleanup into `tests/lib/` when a second caller or
  platform boundary appears.
- Inline HTML canvases are still valid cheap fixtures for DOM assertions. They
  are blind spots for URL identity, content-root, and `aos://` resolution
  defects and should be called out when those variables are at risk.

## Candidate Artifact Disposition

- Promote later: repeated canonical-path representative canvas setup, repeated
  status-item owner assertions, and repeated real-input DesktopWorld target
  resolution that appears outside the current shared helpers.
- Keep local: one-off product assertions and Sigil-specific radial/menu
  expectations that do not encode platform knowledge.
- Delete later: retired compatibility smokes only when the manifest or product
  surface they protect is removed in the same slice.

## Gaps

- `./aos dev recommend` can now point users toward the ladder, but it still
  routes by changed paths rather than by defect variable. Foreman should keep
  naming the risk under test in runtime-heavy work cards.
- No machine-readable registry of test helpers exists yet. A registry may be
  useful later, but the current docs layer is lighter and adequate for this
  governance slice.
- Future GDI reports for runtime/canvas/input/status/lifecycle/cross-layer work
  should include `harness_selection`, `fixture_blind_spots`,
  `new_test_artifact_candidates`, or `why_no_harness_prep_needed` when relevant
  so Foreman can decide whether to promote, keep local, or delete artifacts.
