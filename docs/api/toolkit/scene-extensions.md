# Scene Extensions

Use `@agent-os/toolkit/scene/extensions` for the reviewed trusted projection
ABI. A trusted extension is first-party same-realm executable code, not a
sandbox, cartridge, or distribution format.

## Scaffold And Validate

```bash
mkdir -p ./scene-work
aos scene extension scaffold ./scene-work/renderer \
  --owner example.consumer --id companion-renderer \
  --template basic-three --json
aos scene extension validate ./scene-work/renderer --json
```

Scaffolding is deterministic, create-new, and owner-only. It statically
validates in staging, reserves the destination with an exclusive atomic
directory creation, copies only validated bytes, and publishes
`extension.json` last as the activation barrier. Readers must treat a
destination without that manifest as inactive. Existing paths are never
overwritten. Scaffolding does not install, authorize, mount, import, or execute
the extension. Output omits local paths and source text.

The neutral runnable artifact is under
`packages/toolkit/scene/extension-examples/basic-three/`. Its projection owns
one Three subtree and demonstrates activation, numeric signal and animation
application, frame ticking, suspend/resume, context loss, explicit budgets,
and idempotent GPU disposal.

## Artifact Contract

The manifest contract is `aos.scene.extension.v1`.

An extension contains exactly:

```text
extension.json
projection.js
```

`projection.js` is the body of `createProjection(context)`. It may define local
helpers and must synchronously return one projection with an Object3D subtree
and `applySignal`, `applyAnimation`, `tick`, `suspend`, `resume`,
`contextLost`, `contextRestored`, and `dispose` methods. Promise-like hook results fail admission
or the active operation.

`tick(playbackElapsedMs, stageClockMs)` receives two distinct AOS-owned clocks.
The first restarts on explicit `play` and pauses with the resource. The second
is absolute, comparable across display segments, and continuous across
replacement and `play`; use it for ambient motion that must not reset or split
at a display bezel.

An optional synchronous `renderDamage()` hook may return `full_stage` or up to
eight bounded rectangles in the global DesktopWorld coordinate plane plus at
most 512 points of padding. AOS unions the current and previous bounds, clips
that one global damage region independently into each display segment, and
uses WebGL scissoring for clear and render. Missing, malformed, or throwing
hooks fall back to a full-stage frame so an optimization can never leave stale
pixels. Consumer effects that intentionally affect the desktop may request
`full_stage` for their bounded lifetime; ordinary ambient projections should
report conservative object, aura, and effect bounds.

An optional synchronous `applyInteraction(event)` hook may render
consumer-specific aim, route, and radial-menu visuals. Return `true` or
`{ handled: true }` after applying a visual update. A committed route may also
return `{ handled: true, routeStarted: true }` so AOS does not snap the object
before the extension's route animation begins. AOS has already committed the
canonical destination and remains responsible for recognition, native hit
regions, cancellation, event delivery, and recovery.

An extension that owns route rendering may also implement
`inspectInteractionRoute()`. The hook returns either `null` or one exact
bounded route with only `active`, `kind`, `origin`, `destination`, and
`progress`. Origin and destination are two-number points in the global
DesktopWorld coordinate plane. AOS samples it only while inspection is enabled,
stamps the resource identity itself, and uses the result for `scene inspect`,
`scene monitor`, and DevTools snapshots. Product state, text, audio, scene
source, object IDs, and arbitrary extension diagnostics are not part of this
boundary. Invalid inspection output is omitted and reported as
`SCENE_EXTENSION_INSPECTION_FAILED` without faulting the scene.
When a committed route reports `routeStarted`, AOS emits one immediate
DevTools snapshot after the extension has established this state. Periodic
progress remains bounded by the normal DevTools sampling cadence.

The manifest binds owner, extension ID, sorted implementation IDs, scene ABI,
AOS's pinned Three revision, finite resource budgets, and the projection body
SHA-256. `serializeSceneExtensionDigestMaterial()` is the digest authority.
An optional sorted `capabilities` array is part of the same digest authority.
The current capability registry contains:

```json
["aos.scene.desktop_frame_texture", "aos.scene.framebuffer_proof", "aos.scene.native_sheet_effect"]
```

`aos.scene.native_sheet_effect` authorizes a committed cartridge to use the
bounded native effect-program lane described in the authoring guide. The
program remains cartridge data and is not part of the extension body.
V2 programs may select a bounded surface, event-point, event-segment, or
event-endpoint geometry policy and deform the resulting AOS-owned native sheet.
They may use unlit, Lambert, or bounded standard material lighting. Trusted browser
previews can use the toolkit's deterministic GLSL compiler for the same graph;
the extension still receives no desktop pixels or native graphics handles.

An extension declaring `aos.scene.framebuffer_proof` may also declare up to
four uniquely sorted `framebufferProofs`. Each proof fixes one normalized
anchor, a region no larger than 32 by 32 pixels, one RGBA range, and an
inclusive matching-pixel range. These bytes are part of the extension digest:

```json
{
  "id": "surface-visible",
  "matchingPixels": [4, 256],
  "rgbaMax": [255, 255, 255, 255],
  "rgbaMin": [240, 240, 240, 220],
  "sampleSize": [16, 16],
  "uvPermille": [500, 500]
}
```

Only the connection that owns the mounted scene lease can call
`session.assertFramebuffer("surface-visible")`. AOS requires the exact current
scene revision, extension digest, proof ID, and display topology before one
bounded readback per segment. The two-per-second stage limit is shared across
resources. Predicate mismatch is a successful operation with `passed=false`;
context loss, throttling, or readback failure is an explicit operation error.
Assertions return no pixels or per-pixel values and are not exposed as a
standalone command that can inspect another connection's scene.

The context contains only AOS's pinned `THREE` namespace, the canonical scene
document, lowered budgets, and
an optional `inspectProjectionResources(object)` capability. The synchronous,
factory-scoped inspector returns AOS's canonical bounded resource metrics for
an Object3D subtree so an extension can adapt optional pools before returning
its projection. Extensions that also support older V1 hosts must fail closed on
optional allocations when the callback is unavailable. Retaining the callback
and invoking it after factory return is rejected. AOS still performs the
authoritative admission audit and sampled runtime audits. Extension-local asset
loading is not part of V1. Procedural geometry and data already admitted by the
document are supported.

An extension declaring `aos.scene.desktop_frame_texture` also receives
`desktopFrame`. Each display projection owns one stable Three texture plus
`request()`, `clear()`, and `snapshot()` operations. One `request()` asks AOS
for a bounded all-display capture set and returns immediately. Every authorized
segment stages its frame from the same daemon-owned warm-source generation, and
AOS commits the stable textures only after all exact display consumers decode
successfully. The aggregate remains active until every exact consumer
acknowledges presentation; a missing acknowledgement, authorization change, or
topology change clears all staged and visible segments. The retained per-display
samples may have bounded temporal skew.
`snapshot()` exposes
only bounds, dimensions, generation, epoch, capture duration, readiness, and a
redacted error code. The extension should render the texture only after
`status` becomes `ready` and call `clear()` when its effect finishes.
Before the current daemon has been explicitly primed with
`aos permissions prime screen-capture --json`, `request()` returns normally but
its snapshot settles at `status="consent_required"` with
`errorCode="DESKTOP_FRAME_CONSENT_REQUIRED"`. It does not invoke
ScreenCaptureKit or macOS permission UI. Extensions must treat that state as an
optional-effect degradation and keep unrelated interactions available.

AOS excludes a qualified app-hosted capture process. Raw and otherwise
unqualified hosts use complete exact-stage-window exclusion and fail before
capture when that set is incomplete. Each decoded frame is capped at 1,048,576 pixels. It
binds each opaque handle to the exact display WebView, stage generation,
and scene revision, consumes it once, and expires native and GPU state within
five seconds. Projection disposal also clears the source. No screenshot bytes, local
path, native capture handle, or public transport operation enters the extension
contract. The reviewed extension runs in the same stage realm and can inspect
the Three objects it receives; this capability is not a sandbox for untrusted
code. V1 freezes one frame set from daemon-owned prewarmed ScreenCaptureKit
streams, then performs one encoded GPU upload. It is not a continuous or
zero-copy desktop stream; future transport optimization does not change the
extension contract.

An optional synchronous `applyPointerVisual(event)` hook receives a bounded
passive `down` notification for an admitted affordance. It may start a visual
effect but cannot consume input, select a recognizer, publish a gesture, or
commit state.

## Review And Installation

Validation parses the source as one strict function body and parses the exact
generated ES-module wrapper with V8 without linking or evaluating either. The
wrapper carries the body as an inert string, preventing consumer source from
escaping into module scope. The DesktopWorld host performs a fresh WebKit
module import before registry admission; that is the authoritative runtime
syntax gate. A failed import leaves the active scene unchanged.

After independent review, install exactly the validated digest:

```bash
validation_json="$(aos scene extension validate ./scene-work/renderer --json)"
reviewed_digest="$(node -e 'const value=JSON.parse(process.argv[1]);process.stdout.write(value.digest)' "$validation_json")"
aos scene extension install ./scene-work/renderer \
  --expected-digest "$reviewed_digest" --json
aos scene extension list --json
```

Installation writes immutable owner-only bytes plus an AOS-generated
authorization record into the current runtime mode's store. Only this explicit
command grants executable authority. A mount carries only the exact
`ownerId`, `id`, `digest`, `sceneAbi`, and `threeRevision` reference.

## Runtime Boundary

AOS retains the renderer, camera, frame loop, multi-display projection,
transactions, input, inspection, allocation reservations, context-loss
handling, and disposal enforcement. The extension owns its model, materials,
shaders, effects, and per-frame visual implementation.

Radial menus use one atomic native-region generation for all items plus a
non-consuming outside-dismiss backdrop. Extensions render the menu but never
register their own hit regions or arbitrate input. The bounded, deeply frozen
interaction event includes the engine-resolved `radialLayout`; extensions must
render those exact centers rather than independently recomputing edge
placement. Product art appears only after the full input generation activates.
If retirement is temporarily unavailable, the art remains visible but cannot
dispatch until AOS confirms cleanup.

At creation, extension limits are lowered to unallocated segment headroom.
Replacement accounts for old and candidate projections concurrently. Commit
activates and audits the candidate before publishing it. Sampled audits remain
bounded, while lifecycle boundaries force complete audits. Failed disposal is
retryable until the hook succeeds.

The same-UID account and reviewed extension are in the trust base. Arbitrary
heap behavior and realm-global access are trusted code-review concerns, not
sandbox-enforced guarantees. Use isolated standalone WebGL instead when that
trust is inappropriate.
