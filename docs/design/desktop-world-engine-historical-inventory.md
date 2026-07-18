# DesktopWorld Engine Historical Inventory

Status: implementation evidence, not a public contract. Public ownership lives
in `docs/api/toolkit/scene.md`, accepted ADRs, schemas, manifests, and source.

## Reference Lock

The embedded Sigil comparison point is immutable commit
`27058618dc08c2b36d22d599109fb81f2f658b49`. It is visual and behavioral
evidence only; active Sigil product authority remains external to AOS.

| Historical source | SHA-256 | Disposition |
| --- | --- | --- |
| `apps/sigil/renderer/live-modules/fast-travel.js` | `a6b5a8b50dff00513392221758150ca8402272f895cc161e18f3071498615774` | Retired product fixture; line/wormhole reference |
| `apps/sigil/renderer/live-modules/interaction-overlay.js` | `07a3a5644e866f2b9bac73a7fc023aa59e19a741a0c9edc20d2a9091d3542071` | Retired product fixture; aim-arrow geometry and color reference |
| `apps/sigil/renderer/live-modules/radial-gesture-menu.js` | `ab274d88b2019239a9f8d302c2d239ba20d4cd201d9c5634c1efdfd92e4e8ee2` | Retired product fixture; interaction composition reference |
| `apps/sigil/renderer/live-modules/radial-gesture-runtime.js` | `2087192e25559afa1fb1a1cefa3245cd5ff7c2524d17ed2f4ed880810feafe11` | Compatibility wrapper; product semantics remain retired |
| `apps/sigil/renderer/live-modules/radial-gesture-visuals.js` | `ca55121e4af04a04a378f7c9b2511da040ebbe59c9463703eeea4e9d3ac97d63` | Retired product fixture; visual reference |
| `packages/toolkit/runtime/gesture-stream.js` | `b42583dd559d886de64fbd484da72a1e128bc68740660076a45d1fdec98858e0` | Engine-core input stream candidate |
| `packages/toolkit/panel/stage-affordance.js` | `a02575914d6f0796a29935cb3ff194bbd086e2d2d549e66f509bac74fb325262` | Engine-core affordance candidate |
| `packages/toolkit/runtime/render-performance-sampler.js` | `69e8208d999808159ba0f3f76f9a950a98cc6241d74cd33f3bdd904cd31746fe` | Engine instrumentation candidate |
| `packages/toolkit/components/surface-inspector/index.js` | `c3b80458972e48bdc01b7ee9b09a3f5f3b91b7fa88eb9a661498b6d4289a0c5b` | DevTools view and resource-model evidence |
| `packages/toolkit/components/spatial-telemetry/model.js` | `fda63cb4a8d0f45e6705c0728b1cafd3803a9305a2ed63b2e86f162eef882fc7` | Reusable telemetry model candidate |

## Initial Tranche

| Surface | Classification | Target owner |
| --- | --- | --- |
| Gesture stream, pointer capture, coordinate frames | Engine core | `@agent-os/toolkit/scene` plus daemon input routing |
| StageAffordance and managed hit regions | Engine core | AOS scene engine |
| Minimap layout and display/resource projection | Reusable utility | AOS DevTools model |
| Surface Inspector minimap and resource browser | DevTools view | AOS detachable inspector |
| Render performance sampler | Engine instrumentation | AOS scene host |
| Render performance panel | DevTools view | AOS detachable inspector |
| Spatial telemetry model | Reusable utility | AOS DevTools session |
| Spatial telemetry panel | Focused compatibility view | Shared DevTools model |
| Historical Sigil fast travel and radial menu | Retired fixture | Sigil cartridge parity evidence only |

## Fast-Travel Reference Matrix

Parity requires fixed-clock captures for horizontal, vertical, diagonal, and
cross-display routes, plus release and Escape cancellation. Each fixture must
record origin, pointer samples, destination, display topology, route vector,
phase timings, arrow geometry, colors, trails, easing, and resource-disposal
evidence. The current bounded CSS travel animation is explicitly a degraded
fallback and is not a reference implementation.

The source-derived reference is locked at
`tests/fixtures/scene/historical-fast-travel/reference.json`. It records the
horizontal, vertical, diagonal, cross-display, release, and Escape-cancel
vectors; fixed-time line trace; arrow geometry; colors; trail behavior; and
wormhole timing. Its contract test verifies the historical source digests.

Historical screenshots were not present in the sealed fixture and have not
been fabricated. Fixed-view captures from the rebuilt engine remain explicitly
`pending_michael_signoff`; neither this inventory nor the generic renderer is
evidence of completed Sigil visual parity.
