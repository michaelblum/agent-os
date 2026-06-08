# Surface Inspector Native AX Scope Root Kind Correction V0

## Tracker

- Parent epic: https://github.com/michaelblum/agent-os/issues/295
- Active adapter issue: https://github.com/michaelblum/agent-os/issues/297
- Builds on native AX slice: `04198c9 Add native AX annotation candidates`
- Builds on crash fix: `853cb0e Guard annotation hit layer frames`

## Fresh Context Contract

Implementer starts from a fresh context window. Work in `/Users/Michael/Code/agent-os`.
Do not revert the landed native AX candidate adapter or hit-layer crash fix.
Amend the native AX scope bug with the smallest safe patch.

## Goal

Fix scoped native AX element candidates after a native window root is pinned.

Live smoke now proves the native window root path works:

- Surface Inspector launches.
- Annotation Mode enables without crash.
- Hovering VS Code creates a native root candidate:
  `native-window:51:Visual-Studio-Code`.
- The candidate uses `adapter_id: "macos-ax"`,
  `root_kind: "native_window"`, and `can_reveal=false`.

But after clicking the native root pin action, the scope frame/pin loses the
native root kind:

```json
{
  "adapter_id": "macos-ax",
  "subject_id": "native-window:51:Visual-Studio-Code",
  "root_kind": "surface_root",
  "source_metadata": {
    "root_kind": "native_window",
    "source_metadata": {
      "window_id": "51",
      "app_name": "Visual Studio Code",
      "pid": 823,
      "bundle_id": "com.microsoft.VSCode"
    }
  }
}
```

Then `nativeAxCandidateForAnnotation()` refuses to build an AX child candidate
because it checks:

```js
if (scope?.adapter_id !== 'macos-ax' || scope.root_kind !== 'native_window') return null
```

At the same time, `./aos see cursor` sees a bounded AX element under the cursor.
So the remaining blocker is scope/pin metadata preservation, not AX perception
availability.

## Likely Code Seam

Inspect:

- `packages/toolkit/workbench/surface-inspector-annotations.js`
  - `pinSurfaceInspectorFrame(...)`
  - `normalizePinRecord(...)`
  - `scopeFrameFromPin(...)`
  - `normalizeScopeFrame(...)`
- `packages/toolkit/components/surface-inspector/index.js`
  - `nativeAxCandidateForAnnotation()`
  - `pinHoverCandidate(...)`

Current suspicion from Foreman review:

- `pinSurfaceInspectorFrame(...)` passes `source_tree_node_metadata: node` to
  `normalizePinRecord(...)`, but does not pass `root_kind: node.root_kind`.
- `normalizePinRecord(...)` derives `node` from `pin.source_node_metadata` or
  `pin.node`, not from `pin.source_tree_node_metadata`.
- As a result, the pin defaults `root_kind` to `surface_root`, and
  `scopeFrameFromPin(...)` propagates that wrong root kind into the scope stack.

## Required Behavior

When a native window root candidate is pinned:

- the resulting pin preserves `root_kind: "native_window"`;
- the resulting scope frame preserves `root_kind: "native_window"`;
- `nativeAxCandidateForAnnotation()` can build a scoped AX child candidate when
  current window evidence still matches the selected root;
- mismatched/stale root behavior still reports the existing explicit blockers;
- browser DOM/CDP remains deferred.

The fix should be general enough to preserve future adapter root kinds. Avoid a
one-off check that only patches `macos-ax` after normalization.

## Tests

Add deterministic coverage proving:

- `pinSurfaceInspectorFrame(...)` preserves `root_kind` from a normalized native
  window candidate;
- `scopeFrameFromPin(...)` / the annotation scope stack also preserves
  `native_window`;
- a scoped native AX element candidate can be built from the pinned scope and
  matching current window evidence;
- browser `browser_dom_cdp_deferred` coverage remains intact.

If you add tests in `tests/toolkit/surface-inspector-annotations.test.mjs`, use
the existing native window and native AX helper tests as the starting point.

## Verification

Run:

```bash
node --test tests/toolkit/surface-inspector-annotations.test.mjs
node --test tests/toolkit/surface-inspector.test.mjs
node --test tests/toolkit/surface-inspector-ax.test.mjs
node --test tests/toolkit/annotation-projection.test.mjs
git diff --check
./aos ready
```

If readiness passes, rerun the bounded native AX live smoke:

1. Relaunch Surface Inspector.
2. Enable Annotation Mode.
3. Hover a native app window and verify a `macos-ax` native window root
   candidate appears.
4. Pin/select that root.
5. Hover inside the selected native window.
6. Verify a scoped AX element candidate appears when `./aos see cursor` reports
   a bounded AX element for the same window evidence.
7. Verify the AX element candidate does not claim reveal support.
8. Clean up Surface Inspector smoke canvases.

## Completion Report

Report back with:

- changed files;
- exact preservation fix;
- deterministic tests;
- live smoke result;
- any remaining native AX blocker.
