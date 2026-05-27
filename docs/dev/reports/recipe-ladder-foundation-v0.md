# Recipe Ladder Foundation V0 Report

Date: 2026-05-26

## Classification

- `scripts/aos-ops.mjs`: recipe engine implementation. It now backs the canonical `aos recipe` surface and the temporary `aos ops` compatibility alias.
- `recipes/**/*.json`: source-backed executable recipes. The current foundation supports `aos_command` and static repo-owned `shell` blocks; `recipe_call`, `signal`, `gate`, `condition`, and `loop` are reserved vocabulary until workflow orchestration needs them.
- `scripts/recipes-runtime-clean-restart.sh`, `scripts/recipes-sigil-configure-status-item.sh`, and `scripts/recipes-sigil-verify-surfaces.sh`: recipe block helpers. They keep live runtime/Sigil details out of manifests while avoiding inline shell text.
- `apps/sigil/*/launch.sh`: product launch helpers reused by recipes. Shared status-item/content-root setup now lives in `apps/sigil/scripts/launch-common.sh`.
- `tests/lib/visual-harness.sh`: test helper. It delegates Sigil status-item product setup to the shared helper instead of owning that policy.
- Employer Brand scripts and fixtures: workflow/domain fixtures for future recipe/workflow adoption. No full migration was attempted in this slice.

## Follow-Up Groups

- Retire `aos ops` once repo docs, scripts, generated indexes, and external callers no longer use the old noun.
- Add executable `recipe_call` after a second recipe wants shared nested composition instead of shell helper reuse.
- Promote `signal` and `gate` blocks when workflows need human or session checkpoints; do not fake them inside recipe execution.
- Split long-lived runtime cleanup semantics from one-shot recipe receipts if future recipes create resources that are neither canvases nor surfaces.
