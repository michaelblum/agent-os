# Work Card: shared-textarea-export

## Goal

Add a shared `<textarea>` primitive to the shared control layer and wire it into its three known consumers.

## Background

The toolkit surface audit (`docs/dev/reports/toolkit-surface-audit.md`) identified a gap in the shared control layer: there is no shared `<textarea>` export. Three components are currently hand-rolling inline textarea implementations:

- `markdown-workbench`
- `work-record-workbench`
- `test-console`

## Deliverables

1. New shared textarea component under `packages/toolkit/components/shared/controls/` following existing shared control conventions (structure, props, exports)
2. Export added to the shared control layer index
3. `markdown-workbench`, `work-record-workbench`, and `test-console` refactored to consume the new shared component instead of inline implementations
4. Toolkit tests green (817+/817)

## Branch

`gdi/shared-textarea-export`

## Active Workflow Profile

`agentic_relay` — GDI branches `gdi/<slug>`, commits, pushes, reports branch + HEAD SHA + `git show --stat HEAD`. Relay partner merges via PR.

## References

- Surface audit report: `docs/dev/reports/toolkit-surface-audit.md`
- Shared control layer: `packages/toolkit/components/shared/controls/`
