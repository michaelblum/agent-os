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
  coordinates through one orthographic camera per physical display segment.
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
- Scene documents and cartridges never carry implementation code. Only AOS
  built-ins or separately installed, owner-authorized, digest-pinned trusted
  projection extensions may execute. Product geometry, shader, effect, and
  animation vocabulary remains in the consumer extension; it must not be
  translated into AOS stock-effect parameters. Failed preparation must leave
  the active document and projection unchanged.
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
- Tap-open radial menus are AOS-owned transient leases. Their item hit regions,
  focus/select lifecycle, Escape cancellation, suspension, topology cleanup,
  and stock rendering stay in the stage. Cartridges provide bounded item IDs
  and visual data only; product commands remain in the consumer.
- Interaction visuals are deterministic models advanced by the existing host
  clock. They must not create a renderer, frame loop, unbounded history, or
  per-frame resource allocation. Cartridge values may theme registered stock
  visuals but may not supply executable render code.
- DesktopWorld DevTools use the stage's existing frame loop. Disabled
  instrumentation creates no timer, RAF, stage read, or per-frame allocation.
  The daemon owns revisioned session and host-lease state; consumers may host
  the public view but never own or fork its telemetry.
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

## Verification

- `node --test tests/toolkit/desktop-world-client.test.mjs tests/toolkit/desktop-world-session.test.mjs tests/toolkit/desktop-world-devtools-compat.test.mjs tests/toolkit/desktop-world-devtools-model.test.mjs tests/toolkit/desktop-world-devtools-view.test.mjs tests/toolkit/desktop-world-surface-three.test.mjs tests/toolkit/desktop-world-scene-interaction-runtime.test.mjs tests/toolkit/desktop-world-scene-interaction-three.test.mjs tests/toolkit/desktop-world-scene-operation-coordinator.test.mjs tests/toolkit/scene-cartridge.test.mjs tests/toolkit/scene-document.test.mjs tests/toolkit/scene-historical-fast-travel-reference.test.mjs tests/toolkit/scene-host.test.mjs tests/toolkit/scene-interaction.test.mjs tests/toolkit/scene-interaction-visual.test.mjs tests/toolkit/scene-public-contract.test.mjs tests/toolkit/three-render-lifecycle.test.mjs tests/toolkit/toolkit-api-docs-contract.test.mjs tests/scene-cartridge-cli.test.mjs tests/scene-extension-cli.test.mjs tests/scene-scaffold-cli.test.mjs tests/scene-agent-tooling-cli.test.mjs tests/scene-agent-authoring-acceptance.test.mjs`
- `bash tests/daemon-desktop-world-devtools-session.sh`

## Child DOX Index
