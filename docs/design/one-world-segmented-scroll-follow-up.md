# One-World Segmented Scroll Follow-Up

Status: follow-up after anchored Avatar controls initial placement.

The Avatar controls embedded panel now opens from a toolkit anchored placement
plan that keeps the initial frame on the avatar display when the panel fits
there. That avoids the normal right-click path that could open the panel across
DesktopWorld display segments.

The reported split-scroll symptom is not fully solved by initial placement.
Current evidence still classifies later drag-induced straddled scroll as
One-World/toolkit logical-state work:

- Embedded Avatar controls scroll mutates the compact surface DOM directly via
  `scrollTop` and `scrollLeft` in `apps/sigil/avatar-controls/surface.js`.
- A manually dragged panel can still straddle display segments through the
  existing union drag work area.
- Straddled panels may expose per-segment DOM or layout divergence when each
  segment hosts its own renderer state.
- `computeBaseScale()` in the Avatar controls path still derives scale from
  `window.innerHeight`, which can differ by display segment.
- The remaining fix belongs in the shared One-World/toolkit segmented logical
  state layer, not in detached panel migration or Sigil-only DPI math.

Acceptance for a future fix should prove that a manually straddled embedded
panel has one logical scroll state across segments after wheel input on either
fragment.
