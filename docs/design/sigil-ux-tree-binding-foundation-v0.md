# Sigil UX Tree Binding Foundation V0

This slice adds a read-only `aos_ux_tree` projection for Sigil avatar
interactions. It makes avatar, radial menu, Selection Mode, annotation reticle,
annotation camera, commands, bindings, and radial settings inspectable as data
while preserving the current handwritten runtime router.

Runtime state remains:

- `main.js` still owns live input routing.
- `sigil-radial-menu.json` and the radial config resolver remain the radial
  menu source of truth.
- `settings.radial` in the UX tree is a projection of that source, not a
  replacement model.
- `window.__sigilDebug.snapshot().uxTree`, `window.__sigilDebug.uxTree()`, and
  `window.__sigilDebug.uxTreeShadow(input)` expose read-only parity evidence.

Future cutover phases:

1. Add an execution adapter that maps command IDs to an allowlisted command
   registry.
2. Cut over low-risk bindings from hardcoded router branches to UX tree lookup.
3. Add radial settings override patches while preserving resolved radial config
   as source input.
4. Add user editor and persistence.
5. Remove duplicated hardcoded binding logic after parity and rollback paths are
   proven.
