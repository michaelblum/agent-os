# Active Sigil Canvas Clean Ownership Correction V0

## Recipient

GDI correction round.

## Branch / Base

- branch_from: `origin/feat/command-surface-extraction`
- required_start_ref: `origin/feat/command-surface-extraction`
- expected output branch: `gdi/active-sigil-canvas-clean-ownership-correction-v0`

## Source

Foreman review of PR #378 at `292af4fb0f085f399b9e1910d3d20c3d5e5b6b8a`.

The latest radial/wiki rehab now opens `sigil-wiki-workbench`, but `scripts/aos-clean.mjs` still classifies active Sigil ownership with a narrow hard-coded list:

- `avatar-main`
- `sigil-hit-avatar-main`
- `sigil-radial-menu-avatar-main`
- `sigil-agent-terminal`
- `aos-desktop-world-stage` only when parented to `sigil-agent-terminal`

That misses `sigil-wiki-workbench` and likely other Sigil-owned warm/utility surfaces, so `./aos clean` can remove a valid active Sigil surface even while `active_experience` is `sigil`. Existing regression coverage only proves that `avatar-main` is preserved.

## Goal

Make `./aos clean` and the stale-resource view used by `./aos status` preserve valid Sigil-owned active/warm canvases when Sigil is the active experience, while still removing unrelated stale canvases.

## Required Read-First Files

- `scripts/aos-clean.mjs`
- `tests/aos-clean-canvas-regression.sh`
- `apps/sigil/renderer/live-modules/main.js`
- `experiences/sigil/aos-experience.json`
- `apps/sigil/aos-app.json`
- `src/commands/operator.swift` only if status/clean wiring needs confirmation

## Requirements

1. Replace or extend the current `sigilOwnedCanvas()` classifier so it covers the Sigil-owned canvases that can exist after normal Sigil use.
2. At minimum, active Sigil ownership must preserve:
   - `avatar-main`
   - `sigil-hit-avatar-main`
   - `sigil-radial-menu-avatar-main`
   - `sigil-agent-terminal`
   - `sigil-wiki-workbench`
   - `sigil-render-performance`
   - `sigil-interaction-trace`
   - `aos-desktop-world-stage` when parented to a Sigil-owned parent that should preserve it
3. Decide explicitly whether `surface-inspector` and `__log__` are daemon/vanilla utilities or Sigil-owned utilities. Preserve them only if the current product contract says active Sigil owns them.
4. Add regression coverage that creates an active Sigil state plus multiple owned and unowned canvases in an isolated daemon:
   - `./aos clean --dry-run --json` must not report owned canvases as stale.
   - `./aos clean --json` must remove the unowned canvas and leave owned canvases present.
   - when `active_experience` is cleared, the same Sigil canvas IDs must become stale/removable unless another ownership contract protects them.
5. Keep behavior deterministic. Do not require real mouse input or live status-item clicks.

## Boundaries

- Do not expand this into a Sigil product redesign.
- Do not run real-input desktop scenarios.
- Do not preserve every canvas with a `sigil-` prefix unless that is a deliberate, tested ownership contract.
- Do not leave the correction as documentation only.

## Verification

Run:

```bash
bash tests/aos-clean-canvas-regression.sh
bash tests/sigil-status-item-lifecycle.sh
bash tests/help-contract.sh
bash tests/external-parser-flags.sh
git diff --check
```

If implementation touches shared status plumbing, also run the smallest focused status/ready test that covers stale-resource reporting.

## Completion Report

Include:

- branch
- head SHA
- files changed
- exact ownership contract chosen for Sigil canvases
- tests run and pass/fail
- whether live AOS state was touched
- any remaining risk
