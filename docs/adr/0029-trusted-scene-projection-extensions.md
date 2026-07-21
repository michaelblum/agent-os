# ADR 0029: Trusted Scene Projection Extensions

- Status: Accepted
- Date: 2026-07-20
- Supersedes: the executable-implementation restriction in ADR 0026

## Context

ADR 0026 established safe data-only scene cartridges and correctly rejected
cartridge-supplied code. It also made AOS-owned implementation registries the
only executable boundary. The first rich reference consumer demonstrated that
this second decision is too restrictive: translating a consumer's geometry,
shaders, effects, and animation logic into stock AOS effects either loses
fidelity or moves product vocabulary into the platform.

The scene toolkit already models trusted implementation registries and
dependency-injected projection factories. The local host can use a
consumer-owned projector, but the singleton DesktopWorld outlet currently
hardcodes the generic AOS registry and projector. A reviewed consumer therefore
cannot use the same renderer in its editor and on DesktopWorld.

## Decision

AOS adds `aos.scene.extension.v1` as a distinct trusted projection-extension
contract. It does not change `aos.scene.cartridge.v1`: cartridges remain
data-only and may not contain scripts, functions, shader source, executable
URLs, or extension bundles.

A trusted extension consists of:

```text
extension.json
projection.js
```

The manifest binds owner, extension ID, scene ABI, pinned Three revision,
declared implementation IDs, budgets, and one artifact SHA-256. That digest is
computed from canonical manifest authority fields plus the factory-body SHA-256, so
neither executable bytes nor declared capability and resource limits can change
without changing identity. Implementation IDs must belong to the owner's
namespace.

Installation is an explicit state mutation and the supported authorization
workflow. The operator supplies
the exact reviewed digest, and AOS requires that the source directory and files
belong to the current user and are not group- or world-writable. AOS validates
the manifest and bytes, compiles but never executes the factory body, and copies
the artifact atomically into an owner-only immutable extension store.
The installed directory also contains an `authorization.json` installation
marker bound to the exact owner, ID, digest, ABI, and Three revision. AOS
generates that marker during the supported install workflow and revalidates it
before loading. It is not non-forgeable proof that only the CLI could have
created the artifact: the declared trust base includes other same-UID local
processes, which can reproduce owner-only bytes. Copying only the two source
files into the store does not satisfy the marker contract.
The command manifest classifies install as a state mutation. Agent hosts must
apply their normal explicit operator-approval policy; scene transport and
cartridge activation cannot authorize or install code.
Mounting a cartridge may reference only an already installed, authorized,
owner-matched extension digest. `scene-follow` cannot install or replace
executable code.

`projection.js` is the body of `createProjection(context)`, not an ECMAScript
module. It may declare local helpers and must return the projection object.
Extension authors target the conservative ES2022 language baseline and avoid
proposal-stage or engine-specific syntax. A memory- and time-bounded child
process uses V8's ES-module parser to compile the body inside the exact
host-generated wrapper without linking or evaluating it. That is a preliminary,
non-executing installation check, not proof of parser parity with WebKit. Before
registry admission or projection preparation, the DesktopWorld stage imports a
fresh generation of the exact wrapper through WebKit. This runtime import is the
authoritative syntax/link compatibility gate; failure leaves the active scene
aggregate unchanged. Evaluating the wrapper only materializes and freezes the
factory export and does not call the consumer's factory body. Module-scope
consumer execution remains impossible because no consumer module scope is
served. The DesktopWorld host revalidates
`extension.json`, the authorization record, and the body digest, then embeds
the immutable body in a host-generated wrapper served from one dedicated local
scheme URL. The mutable content server is not executable-code authority.
WebKit module imports cannot be canceled once started. A logically timed-out
import therefore remains charged against a fixed unresolved-import capacity
until its underlying promise actually settles; repeated timeouts cannot create
unbounded physical imports behind the logical timeout surface.

The DesktopWorld outlet resolves the extension before projection preparation.
AOS supplies:

- its pinned Three namespace;
- the canonical scene document;
- lowered scene and extension budgets;
- numeric signal and animation callbacks;
- elapsed stage time and lifecycle calls.

The extension synchronously returns one bounded Object3D subtree plus
synchronous `applySignal`, `applyAnimation`, `tick`, `suspend`, `resume`,
`contextLost`, `contextRestored`, and `dispose` operations. Optional activation is synchronous as
well. Promise-like factory, lifecycle, update, or disposal results are rejected.
AOS owns the renderer, camera, RAF, multi-display replication,
interaction routing, scene transactions, context recovery, inspection, and
observable render-tree accounting. Initial creation and every rendered tick
enforce cached object, resource, draw-call, texture, triangle, and attached
working-set limits. A complete render-tree audit runs at least every 30
projection ticks rather than allocating a traversal every frame. Activation
and lifecycle boundaries force a fresh complete audit before the projection is
exposed again. A disposal attempt is marked complete only after its hook
succeeds, so failed cleanup remains retryable. Rejected
projections are disposed before admission; cleanup or runtime-budget faults
retire the exact stage generation so consumers can remount canonical state
without preserving a partially healthy scene.

Extension creation receives the lower of its declared limits and the segment's
currently unallocated headroom. Replacement admission counts the active and
candidate projections concurrently because both allocations exist until the
atomic commit retires the prior projection. Prepared candidates reserve both
their measured segment allocation and any new logical resource slot before
asynchronous preparation can overlap another candidate. Commit invokes the
candidate activation hook and repeats the complete resource audit before
publishing the aggregate. Renderer suspend, resume, topology reconciliation,
replacement, and page teardown share one serialized stage lane. Input admission
remains closed during stage resume until every native region generation has
been restored successfully.

The formal extension context exposes no renderer, camera, RAF, asset loader,
DOM input, filesystem, network, process, TCC, or native-bridge handle. Browser
extensions still execute in the stage realm and are therefore fully privileged,
trusted AOS-equivalent code rather than a sandbox. Admission requires an exact
installation marker under the explicitly trusted same-UID local account; the
marker is integrity metadata within that trust boundary, not an authentication
boundary against it. Untrusted or community executable extensions require a
separate process or composited surface and remain unsupported.

Candidate document, projection, controller, interaction regions, and extension
identity commit as one resource aggregate. Failed preparation or activation
leaves the prior aggregate active; failed input replay or cleanup retires the
whole resource aggregate. A render-loop or accounting fault retires the exact
stage generation and all of its resource aggregates before the daemon publishes
the terminal fault. Once a candidate and its buffered input have committed,
event delivery failure is diagnostic and does not roll the scene back after
observable state has already become authoritative.

Historical consumer implementations remain visual and interaction references,
not performance baselines. DesktopWorld performance acceptance uses the public
`DESKTOP_WORLD_PERFORMANCE_ACCEPTANCE_THRESHOLDS`: a prewarmed transition starts
within 250 ms and is projection-ready within 750 ms; input-to-visual P95 is at
most 50 ms; 60 Hz frame P95 remains within 1.1 times the frame budget and no
steady frame exceeds 100 ms. Each display segment is capped at 2,097,152
backing pixels. Cross-display projection may not disappear for more than two
frames. After 100 warmed summon/travel/park cycles, RSS growth is at most 16
MiB and resource counts return to baseline. P95 evidence requires at least 20
dense finite input-to-visual samples and 120 dense finite frame samples; fewer
than 100 warmed cycles is invalid acceptance evidence. Parked, hidden, and context-lost
segments own no RAF. Absolute WebKit RSS and cold-load time are diagnostic
because they vary by OS and hardware.

## Consequences

- Consumers can own bespoke models, shaders, visual effects, and update logic
  without adding their vocabulary to AOS or rebuilding AOS for each visual
  revision.
- AOS remains the reusable game-engine-style host and never learns product
  concepts such as companion states, tesserons, stellation, wobble, or moods.
- The generic AOS projector remains the no-extension fallback and sample
  implementation.
- Stock effects that encode reference-consumer behavior must be deprecated or
  reduced to genuinely neutral primitives; new product-specific parameters are
  prohibited.
- Extension digest changes require explicit reauthorization. Ordinary data-only
  cartridge edits do not.
