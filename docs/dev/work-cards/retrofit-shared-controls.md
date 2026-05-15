# Work Card: retrofit-shared-controls

## Goal

Retrofit the highest-value toolkit components to consume the shared control layer instead of hand-rolling inline controls.

## Background

The toolkit surface audit (`docs/dev/reports/toolkit-surface-audit.md`) identified 11 components hand-rolling inline controls — retrofit candidates for the shared control layer. With the shared textarea now exported (PR #322), the control layer is complete enough to begin the retrofit sweep.

## Prioritized Candidates (Start Here)

1. **`surface-inspector`** — highest-value; the primary inspection surface, recently renamed from canvas-inspector (PR #318)
2. **`wiki-kb`** — inline controls, good shared-layer fit
3. **`wiki-subject-browser`** — inline controls; test already touched in PR #322, likely already partially aware of shared layer

Remaining 8 candidates from the audit are lower priority and can follow in a subsequent card.

## Deliverables

1. Each of the three prioritized components refactored to consume shared controls in place of inline implementations
2. No behavioral changes — retrofit only
3. Toolkit tests green (820+/820)
4. `bash tests/help-contract.sh` passes

## Branch

`gdi/retrofit-shared-controls`

## Active Workflow Profile

`agentic_relay` — GDI branches `gdi/<slug>`, commits, pushes, reports branch + HEAD SHA + `git show --stat HEAD`. Relay partner merges via PR.

## References

- Surface audit report: `docs/dev/reports/toolkit-surface-audit.md`
- Shared control layer: `packages/toolkit/controls/`
- Shared textarea (reference implementation): `packages/toolkit/controls/textarea.js` (added PR #322)
