@../../../AGENTS.md
@../AGENTS.md

# Scene Toolkit

## Purpose

`scene/` is the narrow package facade for product-neutral scene authoring. It
owns the public contracts for the DesktopWorld stage 3D outlet and currently
exposes data-only cartridge contracts, declarative scene contracts,
implementation registration, atomic scene transactions, owner-scoped
affordances, deterministic gesture arbitration, bounded stock interaction
visuals and typed scene events, bounded DesktopWorld DevTools snapshots, a
host-neutral inspector view, and a transport-injected agent SDK, numeric
signal and elapsed-clock animation bindings,
the transport-injected high-level DesktopWorld session,
dependency-injected local/DesktopWorld hosts, the standalone Three adapter,
the bounded generic Three implementation registry/projector,
bounded renderer lifecycle, canvas lifecycle projections, and visual-object
editing contracts. The public `scene-follow` transport leases owner-scoped
resources onto the daemon-backed singleton DesktopWorld stage without exposing
stage internals.

## Ownership

- Runtime implementations remain owned by `runtime/`.
- Visual-object implementations remain owned by `workbench/`.
- This folder owns only the reviewed external package surface and its types.
- Generic scene transactions, leases, rendering, animation, interaction, and
  resource lifecycle belong here or behind this facade. Product representation,
  persisted definitions, semantic state mappings, visual recipes, and editor UX
  remain in the consuming product.
- The daemon-backed stage projects object transforms in global DesktopWorld
  coordinates through one segmented camera view per physical display. Scene
  documents default to the orthographic overlay pass; a bounded perspective
  resource pass uses one consumer-declared global camera profile with disjoint
  per-display view offsets. Both passes share the existing renderer, canvas,
  budgets, lifecycle, and one absolute stage clock derived from each display
  WebView's time origin. The stage clock is continuous across resource
  replacement and explicit play; per-resource playback clocks remain
  independently pausable for declarative animations.
  Every segment applies the same declarative operation and reports an
  origin-attributed internal result. The daemon accepts results only from the
  exact current canvas and topology generation, settles the all-segment
  barrier, and emits one public result to avoid duplicate transport
  acknowledgements.

## Local Contracts

- Export named, dependency-injected primitives only. Do not bundle Three.js or
  expose private toolkit indexes through this facade.
- Keep `index.js`, `index.d.ts`, focused `authoring`, `runtime`, `extensions`,
  and `devtools` entry points, package exports, tests, and the corresponding
  split guides under `docs/api/toolkit/` synchronized.
- Renderer disposal applies only to resources the consumer explicitly gives
  the lifecycle; shared resource ownership remains with the consumer.
- Scene documents and cartridges never carry executable implementation code.
  Browser/Three implementation code executes only through AOS built-ins or a
  separately installed, owner-authorized, digest-pinned trusted projection
  extension. Product geometry, custom shaders, and executable animation code
  remain in that consumer extension; they must not be translated into AOS
  stock-effect parameters.
- A cartridge may carry a bounded data-only native-effect program. AOS owns its
  finite graph vocabulary, validation, trusted Metal templates, compilation,
  capture textures, budgets, and disposal; the consumer owns graph composition,
  parameter presets, geometry locality, and event bindings. V2 may deform an
  AOS-owned tessellated sheet, select a bounded surface, point, route, or
  endpoint geometry region, and declare bounded unlit, Lambert, or standard
  material facts. V3 may add one engine-owned, fixed-step damped height field
  with bounded signed swept-brush lobes. Its logical state is shared across the
  union DesktopWorld plane; display segments sample one immutable generation,
  GPU completion gates texture-slot reuse, gradients use global DesktopWorld
  units, and every field texture and CPU buffer retires with its effect instance.
  Swept emitters default to linear transit and may opt into the engine's bounded
  `ease_out_quart` trajectory to stay synchronized with a route using the same
  easing. A coincident consumer body must use the same easing and duration.
  The toolkit may
  compile the same validated graph into a Three.js-compatible GLSL evaluation
  function for trusted previews. Consumers never create geometry directly;
  AOS resolves the declaration, allocates the bounded mesh, and owns its
  lifecycle. Neither form accepts consumer source, mutates topology, or grants
  capture authority. Unknown operators
  and aggregate program-budget overflow reject before scene dispatch.
  Environmental Metal preparation failure keeps native input admission closed
  and retains the prior prepared pipeline set. It does not invalidate an
  otherwise usable committed browser scene. Failed trusted
  projection-extension preparation still leaves the active document and
  projection unchanged.
- One interaction may bind multiple native-effect programs through the bounded
  `nativeEffects` array so pointer feedback and a later gesture phase can share
  one recognizer. Trigger identity remains unique per affordance. The singular
  `nativeEffect` field is compatibility-only, and both forms may not coexist.
- Native effects are timed unless a gesture-start binding explicitly declares
  `lifecycle.kind: gesture`. Gesture-owned effects reuse one captured frame set,
  sheet, mesh, and pipeline while canonical event uniforms update. End may
  replace the effect with the same interaction's timed end binding; cancel and
  lost ownership dispose it. Product effect names never enter this contract.
- Scene cartridges use the canonical `cartridge.json`, `scene.json`,
  `animations.json`, `interactions.json`, and `assets/` layout. Payload files
  and local assets are digest-bound, budgets are explicit, and the filesystem
  loader belongs in `scripts/lib/aos-scene-cartridge.mjs`; Node filesystem APIs
  must not enter this browser-safe package facade.
- Signal and animation bindings carry finite numeric values only. Text, audio,
  prompts, product state vocabularies, and arbitrary timelines stay outside
  this contract.
- A DesktopWorld `play` with one-shot 2D-affordance transform bindings
  (`position.x/y`, `rotation.z`, or `scale.x/y`) quiesces native affordances
  before movement and atomically activates a fresh region generation at the
  terminal pose. The terminal interaction projection stays separate from the
  authored scene document and revision. Do not add per-frame native region
  updates; moving affordances for loop or ping-pong playback need a future
  atomic batch transport or a stable nonanimated collider ancestor.
- Completed one-shot bindings stop applying until the next explicit play
  generation. Operation suspension, page visibility, and context loss pause
  elapsed animation time.
- Generic implementation parameter validators fail before projection. The
  stock browser outlet uses the pinned local Three module and performs no
  runtime network fetch; the package facade remains dependency-injected.
- A drag recognizer owns only `start`, `update`, `end`, and `cancel` lifecycle.
  Translation, aim-and-commit, drop, and signal graphs are separate declarative
  responses. A product meaning such as fast travel must remain in its cartridge.
- An affordance may request `inherit` or `hidden` system-cursor presentation
  independently for hover and captured pointer phases. AOS derives the active
  region from its global input tap, checks every hide/show result, and restores
  its successful hide exactly once on terminal, cancellation, permission loss,
  ownership loss, and cleanup. Cursor presentation never changes event
  consumption or makes a DesktopWorld window interactive.
- Optional consumer cursor art is a reviewed trusted-extension visual keyed by
  a canonical ID. AOS publishes generation-bound enter/move/leave facts only
  while its native cursor hide is actually applied. Consumer art cannot consume
  input, change cursor policy, or create another window, renderer, or frame loop.
- Tap-open radial menus are AOS-owned transient leases. Their item hit regions,
  pointer-move focus/blur lifecycle, press/select lifecycle, Escape
  cancellation, suspension, topology cleanup, and stock rendering stay in the
  stage. Cartridges provide bounded item IDs, semantic labels, and visual data;
  labels identify native hit regions but remain absent from scene events.
  Product commands and product-specific hover art remain in the consumer.
- Interaction visuals are deterministic models advanced by the existing host
  clock. They must not create a renderer, frame loop, unbounded history, or
  per-frame resource allocation. Cartridge values may theme registered stock
  visuals but may not supply executable render code.
- DesktopWorld DevTools use the stage's existing frame loop. Disabled
  instrumentation creates no timer, RAF, stage read, or per-frame allocation.
  `desktop-world-devtools-stage-probe.js` owns the segment-local sampling,
  identity readiness, event retention, and publication lifecycle behind the
  public `desktop-world-devtools.js` facade.
  The daemon owns revisioned session and host-lease state; consumers may host
  the public view but never own or fork its telemetry. Each display segment
  reports its own render performance; the daemon publishes a topology-complete
  per-display set and does not sum rates, timings, DPR, or backing dimensions.
  A segment sample window is bound to its exact canvas generation, topology
  generation, display ID, and display index and resets synchronously whenever
  any member of that identity changes. Topology receipt closes sample readiness
  before queued renderer reconfiguration; no frame or refresh snapshot is
  accepted until the complete segment work has settled for the new identity.
- Native-effect DevTools facts are content-free lifecycle state and bounded
  counters only. Presentation means every display segment reported an actual
  Metal drawable presentation; attempts to present are not counted as visible
  output. Parameters, coordinates, pixels, native handles, and product state
  remain outside the snapshot.
- Native-effect program identity uses the public
  `aos.scene.native-effect-program-digest.v1` canonical binary contract in both
  toolkit JavaScript and daemon Swift. Consumers call the toolkit digest helper;
  they do not hash implementation-specific JSON serialization.
- Trusted extensions may expose only the exact synchronous
  `inspectInteractionRoute()` contract to DesktopWorld DevTools. AOS validates
  and stamps these engine-defined route facts. Product state, text, audio,
  source objects, object IDs, arbitrary diagnostics, and extension-owned
  snapshot schemas must not enter this boundary.
- DevTools display facts use `bounds` for DesktopWorld-local geometry and
  optional `nativeBounds` for native global geometry. A consumer translating
  scene coordinates into native input must require the latter rather than
  infer an origin from DesktopWorld-local bounds.
- Focused compatibility panels consume the canonical DevTools snapshot through
  `components/desktop-world-devtools/compat.js`. They must not introduce a
  second DesktopWorld sampler or competing session model.
- Agent SDK methods inject request/subscription transport. They must not import
  Node socket APIs, discover runtime paths, auto-start daemons, or create a
  second snapshot model. One-shot reads use headless DevTools sessions, require
  a daemon-received stage snapshot correlated to that session's explicit
  refresh request, and close in `finally`; monitor state is connection-scoped.
- `createDesktopWorldSceneSession()` is the ordinary consumer lifecycle owner.
  It serializes operations, commits only authoritative all-segment results,
  ignores old connection generations, and may reconnect exactly once. Recovery
  remounts committed state and subscriptions but never replays transient
  signals, animation plays, or an uncertain operation. Consumers must not add
  a competing recovery loop.
- Only the primary DesktopWorld segment registers native hit regions or emits
  typed gesture events. Every segment applies the same visual response, and a
  failed region activation must restore the previous scene or fail closed with
  no active resource.
- Candidate input-region generations remain inactive until the daemon can
  atomically activate every candidate and retire the complete prior generation.
  Input delivery continues through the old generation until that switch; an
  ambiguous switch fails closed rather than exposing mixed ownership.
- The stage resumes only after every physical display segment reports ready for
  the exact canvas and topology generation. A topology change or segment fault
  retires that complete stage generation and its scene leases; consumers recover
  by remounting canonical state, never by preserving a partially healthy scene.
- Resource admission is cumulative across every projection in one display
  segment. Runtime extension audits are sampled on a bounded cadence and reuse
  cached metrics between audits; do not add a per-frame scene-tree allocation
  pass.
- A perspective trusted projection may return one separate `overlayObject`
  subtree for screen-aligned interaction art. AOS renders the perspective
  subtree first and the orthographic overlay last, audits both subtrees under
  one aggregate budget, and disposes them through the projection's single
  lifecycle. Extensions must not create a renderer, canvas, context, or RAF.
- Trusted projections may expose one synchronous `renderDamage()` optimization
  in global DesktopWorld coordinates. AOS unions current and prior bounds,
  intersects them with each display segment, and owns scissored clear/render.
  Invalid or absent declarations render the full stage. Full-stage declarations
  are for explicit bounded effects; ordinary continuous projection should
  conservatively include geometry, aura, and effect padding.
- Visual-only transactions whose interaction descriptors and transform
  projection are unchanged retain the live native input generation. Any
  hierarchy, transform, affordance, recognizer, or response change continues
  through atomic generation replacement.
- Trusted extension factories receive AOS's canonical synchronous
  factory-scoped `inspectProjectionResources(object)` callback for adaptive
  pool admission. V1 extension source treats the capability as optional for
  compatibility with older hosts. The callback expires when factory creation
  returns and does not replace the host's authoritative initial and sampled
  resource audits.
- Desktop-frame texture access is an explicit digest-bound trusted-extension
  capability. AOS owns capture, stage-window exclusion, the expiring in-memory
  one-shot handle, exact stage/WebView generation binding, decode, and source
  disposal. One request creates a bounded all-display capture set; decoded
  segments remain private until the all-display presentation barrier commits,
  and every exact consumer must acknowledge presentation before the aggregate
  settles. Partial presentation fails closed by clearing every segment.
  One-shot captures may have bounded temporal skew. Public scene transport,
  DevTools, diagnostics, and product processes remain pixel-free.
  Consumer extensions own distortion, blur, redaction, masking, and other
  visual recipes. A capture backend change must not widen this lease.
- Framebuffer proofs are optional digest-bound trusted-extension predicates
  evaluated only through the mounted resource's owning scene session. Callers
  select a named proof but cannot supply coordinates, colors, thresholds, or
  another resource identity. Each segment performs one bounded readback and
  the all-segment barrier returns content-free aggregate facts. A mismatch is a
  normal failed assertion; context loss, throttling, stale authority, or GPU
  readback failure is an operation error. Fixture markers and product visuals
  remain in the consumer repository and never become AOS rendering vocabulary.

## Verification

- `node --test tests/toolkit/desktop-world-client.test.mjs tests/toolkit/desktop-world-session.test.mjs tests/toolkit/desktop-world-devtools-compat.test.mjs tests/toolkit/desktop-world-devtools-model.test.mjs tests/toolkit/desktop-world-devtools-view.test.mjs tests/toolkit/desktop-world-surface-three.test.mjs tests/toolkit/desktop-world-scene-extension-projection.test.mjs tests/toolkit/desktop-world-scene-interaction-runtime.test.mjs tests/toolkit/desktop-world-scene-interaction-three.test.mjs tests/toolkit/desktop-world-scene-operation-coordinator.test.mjs tests/toolkit/scene-cartridge.test.mjs tests/toolkit/scene-document.test.mjs tests/toolkit/scene-extension.test.mjs tests/toolkit/scene-historical-fast-travel-reference.test.mjs tests/toolkit/scene-host.test.mjs tests/toolkit/scene-interaction.test.mjs tests/toolkit/scene-interaction-visual.test.mjs tests/toolkit/scene-public-contract.test.mjs tests/toolkit/three-render-lifecycle.test.mjs tests/toolkit/toolkit-api-docs-contract.test.mjs tests/scene-cartridge-cli.test.mjs tests/scene-extension-cli.test.mjs tests/scene-scaffold-cli.test.mjs tests/scene-agent-tooling-cli.test.mjs tests/scene-agent-authoring-acceptance.test.mjs`
- `bash tests/daemon-desktop-world-devtools-session.sh`

## Child DOX Index
