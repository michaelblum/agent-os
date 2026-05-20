# Work Card: zag-tabs-wiki-kb-adoption

## Status

Superseded. Wiki KB no longer treats the graph projections as sibling tab
panels. The current contract is one graph canvas with layout modes:

- `graph` renders the force-directed graph layout.
- `radial-graph` renders the Radial Graph layout over the same graph payload.

The default chrome uses a segmented layout-mode control from
`packages/toolkit/controls/`, and embedded chrome keeps the compact select
path. `createAosZagTabs` remains appropriate for true sibling content panels
such as Integration Hub surfaces, but it is not the right control for Wiki KB
layout selection.

## Current References

- Implementation: `packages/toolkit/components/wiki-kb/index.js`
- Radial layout implementation:
  `packages/toolkit/components/wiki-kb/views/radial-graph.js`
- Focused contract test: `tests/toolkit/wiki-kb-layout-modes.test.mjs`
- API docs: `docs/api/toolkit/components.md`

## Current Verification

Use the current layout-mode checks instead of this superseded tab-adoption
slice:

```bash
node --test tests/toolkit/wiki-kb-layout-modes.test.mjs
node --test tests/toolkit/wiki-kb.test.mjs
node --test tests/toolkit/wiki-kb-semantics.test.mjs
git diff --check
```
