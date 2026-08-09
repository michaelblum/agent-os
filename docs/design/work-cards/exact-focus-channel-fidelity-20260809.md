# Work Card: Exact Native Focus-Channel Fidelity

Status: implementation in validation
Branch: `wip/observation-fidelity-runtime-20260809`
Authored: 2026-08-09 course-correction implementation

## Purpose

A native focus channel must not label display-cropped pixels or whole-app AX
elements as evidence from one selected window. This slice makes channel raster,
window identity, and AX membership converge on the same current fact.

## Required behavior

- Resolve exactly one current layer-zero window by channel window ID and owner
  PID. Use its live bounds, not stored channel geometry.
- Require the complete window to fit exactly one non-mirrored display. Fail
  closed for cross-display windows until a multi-display scale contract exists.
- Send the daemon a closed target containing display ID, window ID, owner PID,
  expected bounds, and `fallback=none`.
- For `fallback=none`, prepare and stream only a matching
  `desktopIndependentWindow` still. Preserve `fallback=display` for ordinary
  `--window` capture.
- Resolve exactly one AX window root and, when requested, exactly one subtree.
  Traverse only that membership scope. Missing or ambiguous roots do not create
  or refresh channel evidence.
- Reject caller PID mismatch and live owner drift. Preserve the last good
  channel publication on a rejected refresh. Depth is bounded from 0 through
  15, evidence must be non-empty, and a second live window observation after AX
  traversal must match owner, integral bounds, display, and scale.
- Serialize candidate commit, atomic channel-file replacement, removal, and
  callbacks. Poll refreshes remain bound to the channel instance that was
  observed; revisions advance monotonically within that instance, and rejected
  candidates are never exposed or rolled back through shared state.

## Acceptance

1. Hermetic exact-plan coverage includes missing, duplicate, owner-mismatched,
   non-layer-zero, invalid-bounds, mirrored, ambiguous-display, cross-display,
   and invalid-scale cases.
2. Daemon controller and native lifecycle coverage proves `fallback=none`
   cannot emit a display frame while best-effort `fallback=display` remains.
3. Executable helper tests prove observation-drift rejection and publication
   serialization under an interleaving. Static SpatialModel integration checks
   pin owner/root/subtree/empty gates before candidate commit and pin atomic
   file, memory, and callback ordering. The later native proof completes the
   live failure-path evidence.
4. Runtime typecheck, routed focused gates, exact authority drift checks, and a
   fresh strict review pass before commit.
5. A later native proof uses a deterministic same-process overlapping-window
   fixture. No private application screenshot is acceptance evidence.

## Deferred by design

Cross-display exact-window scaling, compound windows such as sheets/popovers,
generic `--window` fallback removal, content transformations, and application
permission policy are not part of this slice.
