# DesktopWorld Three.js Spike

Throwaway validation surface for the segmented `DesktopWorldSurface` primitive.

The spike loads one web view per display through:

```bash
./aos set content.roots.toolkit packages/toolkit
./aos set content.roots.sigil apps/sigil
./aos set content.roots.dws-three-spike _dev/spikes/desktop-world-three-spike
./aos show create --id dws-three-spike --surface desktop-world --url aos://dws-three-spike/index.html
```

Each segment uses `DesktopWorldSurface2D` only for topology and primary
election. Rendering is Three.js:

- primary segment mutates the shared scene state once per frame
- state is replicated through `BroadcastChannel`
- every segment renders the same world with a segment-carved
  `THREE.OrthographicCamera`
- segment metrics are posted as `dws_three_spike.metric` canvas messages for
  external collection

This directory is non-canonical and should not become a production dependency.

