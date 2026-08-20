# ADR 0045: Complete AX Observation, Notification, And Coordinate Contract

**Status:** Accepted
**Date:** 2026-08-20
**Program:** `aos-sovereign-capability-substrate-v1`
**Amends:** ADR 0043's Milestone 4 target and delivery boundary
**Depends on:** ADR 0044's operation owner, control, recovery, and resource
contracts and the landed M3 recording-geometry core
**Governed by:** ADR 0040's ambient-authority, raw-observation, and distinct
Observation Ref/Locator contracts

## Context

ADR 0043 accepts complete mechanically supportable Accessibility exposure but
does not freeze enough detail to make Milestone 4 implementation or proof
mechanically decidable. The prior milestone ledger names only part of the
current production surface, treats static proof as if it could prove future
production behavior, conflates traversal bounds with response paging, and uses
a coordinate prerequisite that could be read as requiring the complete AX
observation that M4 itself must implement.

Apple Accessibility and ScreenCaptureKit also have important negative facts.
`AXObserver` does not supply a source-event timestamp. ScreenCaptureKit does not
publish a generation token or stable platform identity for a retained source or
filter. AOS must not fill either gap with invented platform truth.

This decision freezes the M4 architecture only. It changes no executable
command, schema, daemon route, SDK, native behavior, or current `see --xray`,
`focus`, `graph`, or `do` form.

## Decision

### Milestone boundary

M4 owns complete native AX observation and raw AX action semantics through the
CLI and daemon IPC. It also owns the AX notification resource lifecycle and the
display-topology facts required to bind AX coordinates to the already-landed M3
recording geometry.

The boundary is deliberately narrow:

- M4 does not own general application lifecycle, window/menu lifecycle, or
  CoreGraphics input posting. Those capability rows belong to M6.
- M5 may project the stable M4 AX event family into its unified stream plane,
  but it does not own the AX subscription resource or recovery lifecycle.
- Maintained TypeScript and Python SDK parity belongs to M6. M4 must not claim
  SDK completeness merely because CLI and IPC schemas exist.
- Live native, TCC, packaging, and release acceptance belongs to M10.
- Existing convenience observation and action forms remain current executable
  truth until a later command-producing slice changes implementation, schemas,
  authored command sources, generated projections, docs, and proof together.

### Exact AX root taxonomy

One M4 observation request selects exactly one root from this closed taxonomy:

1. **Native system-wide root** — the platform system-wide AX element.
2. **Native application root** — an AX application element bound to an exact
   PID process generation.
3. **Exact window root** — one window element resolved under an exact current
   application process generation.
4. **Arbitrary native element root** — admitted only from a current native AX
   Observation Ref in one retained snapshot.
5. **AOS display-composite root** — an explicitly AOS-owned composition of
   display topology and per-application AX observations.

The AOS display composite is not an Apple AX platform root. It reports the
constituent native roots, their individual outcomes, and display-topology
identity. It may not manufacture a system-wide platform tree or hide an
unsupported or unavailable constituent behind a successful composite label.

### Immutable observation snapshot

Each observation attempt creates a fresh immutable snapshot with a fresh
`state_id`, even when the selected root or returned values equal a prior
observation. The snapshot binds:

- the exact root kind and root identity;
- the application PID generation where applicable;
- one stable per-snapshot ref for every admitted AX element;
- the traversal request, bounds, filters, deadline, and projection selection;
- deterministic traversal order and all traversal-accounting facts;
- the exact display-topology identity used by any coordinate projection;
- creation and expiry times plus the finite retention limits that govern pages;
  and
- the terminal observation outcome.

Refs never cross a `state_id`. A snapshot is never mutated by paging, filtering,
readback, or later machine changes. Expiry returns typed snapshot-expired truth;
it never triggers re-observation.

Within the captured platform values, traversal is deterministic: parent nodes
precede descendants; relationship attribute names use Unicode-scalar lexical
order; element arrays preserve the platform-returned order; and the first visit
assigns the ref while later cycle or duplicate edges record that existing ref
without re-enqueueing it. These ordering rules affect projection only and do
not normalize raw attribute values.

### Traversal bounds, accounting, and frontier

Traversal bounds and response page size are separate facts. A request binds
positive finite limits for depth, visited-node breadth, emitted-node count,
deadline, recursive array depth, per-array items, and aggregate representable
value cost. The root has depth zero.

Every result separately reports:

- visited nodes;
- matched nodes;
- emitted nodes;
- cycle edges;
- duplicate edges;
- elapsed time;
- the exact bound or platform condition that stopped expansion; and
- every unvisited frontier entry with parent ref, relationship name, child
  position when known, depth, and typed reason.

The terminal observation outcome is exactly one of `complete`, `truncated`,
`unsupported`, or `unavailable`. `complete` means no unvisited frontier remains
inside the selected root and contract. A partial list must never be labeled
complete.

An opaque page token is a snapshot-bound cursor over already retained results.
It binds the `state_id`, request digest, projection digest, and next retained
position. It cannot cross a snapshot, change filters or projection, expand the
traversal, or re-observe. Page size limits only the current response; it does
not change traversal accounting or completeness.

### Filters

Filters are raw caller-selected mechanical predicates over admitted facts,
including role, subrole, identifier, title, geometry, enabled/focused/selected
state, raw attribute outcomes, and relationship membership. A filter never
adds product classification, fuzzy matching, normalization, redaction, or
retention policy.

Filtering does not prune traversal unless a future distinct traversal-control
field explicitly owns that behavior. Visited, matched, emitted, and frontier
counts therefore remain independent. An unmatched visited node may still lead
to matched descendants.

### Raw AX attributes and values

Attribute enumeration preserves each platform attribute name and produces one
typed outcome per name. The closed outcome set is:

- `value`;
- `no_value`;
- `unsupported`;
- `platform_error`;
- `deadline_exceeded`;
- `recursion_bound`;
- `array_bound`; and
- `unrepresentable_type`.

Representable values use a closed tagged union:

- `null`, `boolean`, `signed_integer`, `unsigned_integer`, and
  `floating_point`;
- `string`, `data`, `date`, and `url`;
- AX `point`, `size`, `rect`, and `range` values;
- `element_ref`, always referencing an element in the same snapshot;
- recursively bounded `array`; and
- a bounded `dictionary` only when every key is exactly representable as a
  string, with keys projected in Unicode-scalar lexical order.

Unknown CF/AX types, non-string dictionary keys, conversion failures, and
platform errors remain typed attribute outcomes rather than coerced strings.
Arrays retain platform order and expose the bound that prevented complete
projection. Strings and other admitted content are never normalized or
silently truncated.

Parameterized-attribute names, ordinary attribute names, per-attribute
settable facts, and supported action names are four distinct projections.
Their presence never implies that a read, parameterized read, set, or action
will succeed against later machine state.

### Observation Ref and Locator remain distinct

A native AX **Observation Ref** is exactly `(state_id, ref)` into one retained
immutable snapshot. It either resolves that exact captured element while the
snapshot remains current for the requested operation or returns typed stale,
expired, missing, or incompatible-target truth. It is never silently
reacquired.

A native AX **Locator** is a declarative current-machine query. It re-resolves
at action time and must produce exactly one action-compatible target. Zero and
multiple matches return typed missing and ambiguous outcomes. Locator
resolution creates current observation evidence; it never pretends that a
prior Observation Ref remained current.

### Generic raw AX actions

Generic raw AX mutations accept exactly one target type: a current native AX
Observation Ref or a native AX Locator. They expose raw `perform_action` and
`set_attribute` mechanics without replacing platform names with an AOS semantic
allowlist.

Every admitted mutation enters ADR 0044's operation plane before native
authority. Its terminal receipt records operation identity and generation,
the target type used, exact ref or Locator-resolution evidence, action or
attribute name, typed input value, platform result, selected readback, terminal
outcome, blame, cleanup, and residual truth. A requested readback is performed
against the exact post-action target evidence and reports staleness or target
loss rather than silently resolving another element.

Existing convenience actions may later delegate to this owner. They must not
retain a second resolver, raw-action implementation, or competing action truth.

### Per-PID AX notification lifecycle

One continuing AX notification subscription is an M4 operation and stream
resource bound to:

- exact PID process generation;
- one subscription operation and stream generation;
- the requested notification set;
- per-name registration outcome (`registered`, `unsupported`, or typed
  failure);
- a monotonically increasing AOS callback sequence;
- an AOS monotonic callback-receipt timestamp;
- bounded delivery accounting, loss count, and event frontier;
- exact cancellation, owner-kill, host-stop, target-process-exit, and recovery
  transitions; and
- zero-residual observer, run-loop-source, registration, queue, and claim
  cleanup.

`AXObserver` exposes no source-event timestamp. M4 records only the AOS callback
receipt monotonic time and sequence; it must not label either as a source time.
Queue overflow, callback/delivery loss, target exit, and transport loss are
typed and create a frontier rather than implied continuity.

Recovery terminalizes the lost prior-generation subscription with an exact
outcome and residual truth. It never replays absent events, silently resurrects
an observer, or claims continuity. A caller may explicitly create a new
subscription with a new operation and stream generation.

### Coordinate spaces and ScreenCaptureKit identity

Accessibility global coordinates are named `ax_global_points`. Canonical
target-local coordinates are named `target_local_points` and remain points.
The following pixel spaces are distinct:

- `display_backing_pixels`;
- `composite_output_pixels`; and
- `encoder_output_pixels`.

Every transform names its source and destination spaces, dimensions, origins,
scale factors, display membership, clipping, resampling, rounding, and any
even-dimension encoder adjustment. No field called merely `local_pixels` may
stand for more than one of these spaces.

The transform prerequisite is the landed M3 recording-geometry core carried
through M3 closeout `53bcbd67`, including canonical display topology, observed
source bounds, point/pixel dimensions, scale, crop validation, and encoder
adjustment. It is not complete AX re-observation; that would make M4 depend on
itself.

ScreenCaptureKit exposes no public generation token or stable platform identity
for a retained source or filter. AOS may keep an internal object-lifetime
custody identity, but the public binding contains only observable facts: exact
source and display facts, frame in points, point dimensions, pixel dimensions,
scale, and canonical display-topology identity. AOS must not publish a
fictional SCK generation or platform identity.

### Repository owners and proof classes

Current executable truth remains distributed across these actual owners until
later atomic cutovers:

- observation: `src/perceive/ax.swift`, `src/perceive/capture-pipeline.swift`,
  and `src/perceive/daemon.swift`;
- raw AX action and resolution: `src/act/actions.swift`,
  `src/act/targeting.swift`, and `src/act/session.swift`;
- display binding: `src/perceive/display-topology.swift`,
  `src/perceive/spatial.swift`, and `src/perceive/models.swift`;
- current public CLI and IPC routing: `src/main.swift`,
  `scripts/aos-see-native.mjs`, `scripts/aos-see-observe.mjs`,
  `scripts/aos-focus-graph.mjs`, `scripts/aos-do-native.mjs`, and
  `scripts/aos-do-ref.mjs`;
- current closed-contract inputs: `shared/schemas/aos-target-handle-v1.schema.json`,
  `shared/schemas/daemon-request.schema.json`,
  `shared/schemas/daemon-response.schema.json`,
  `shared/schemas/daemon-event.schema.json`, and
  `shared/schemas/display-topology-v1.schema.json`;
- current authored observation grammar:
  `manifests/commands/source/aos/03-see-01-capture.json`,
  `manifests/commands/source/external/11-see.json`,
  `manifests/commands/source/aos/16-graph.json`, and
  `manifests/commands/source/external/36-graph.json`;
- current authored action grammar:
  `manifests/commands/source/aos/07-do-03-controls.json` and
  `manifests/commands/source/external/07-do-03-controls.json`; and
- current generated and maintained projections:
  `manifests/commands/aos-commands.json`,
  `manifests/commands/aos-external-commands.json`, `docs/api/aos.md`, and
  `docs/api/aos-capabilities.md`.

The exact proposed production allocations are
`src/perceive/ax-observation-engine.swift`,
`src/perceive/ax-snapshot-store.swift`, `src/perceive/ax-value-codec.swift`,
`src/perceive/ax-coordinate-binding.swift`,
`src/daemon/ax-observer-adapter.swift`, `src/daemon/ax-action-adapter.swift`,
and `src/commands/ax.swift`. The exact proposed closed contracts are
`shared/schemas/aos-ax-observation-v1.schema.json`,
`shared/schemas/aos-ax-action-v1.schema.json`, and
`shared/schemas/aos-ax-notification-v1.schema.json`. The exact proposed
authored grammar owners are
`manifests/commands/source/aos/43-ax-complete.json` and
`manifests/commands/source/external/51-ax-complete.json`; they project through
the two generated aggregates named above and both maintained API documents.
None of these proposed paths exists in the accepted authority slice. Their
`proposed` ledger kind is an allocation, not implementation evidence; a later
atomic implementation must create each selected owner and change its kind with
the corresponding executable truth.

Behavioral acceptance must execute production owners or a production-attached
injected abstraction. Static text/schema proof alone cannot prove traversal,
paging, target resolution, observer cleanup, loss accounting, action readback,
or coordinate behavior. `tests/m4-ax-contract-foundation.test.mjs` is the
current static authority proof. The proposed production-attached fake proof is
`tests/ax-complete-surface.test.mjs`. M10 separately owns live native/TCC
evidence.

### Dependency-ordered M4 delivery

M4 is delivered in this order:

1. **M4A authority contract** — this ADR, corrected capability/authority maps,
   and focused static drift proof.
2. **M4B observation engine** — injectable production-owned root resolution,
   traversal, raw-value projection, snapshot retention, paging, bounds, and
   deterministic fake/platform-error proof; no public command claim.
3. **M4C public observation** — closed CLI/IPC schemas and authored/generated
   routes over the production engine, with production-attached proof.
4. **M4D coordinate binding** — AX/display/SCK/still/recording transform binding
   over the landed M3 geometry core, with drift and resampling proof.
5. **M4E subscription lifecycle** — per-PID observer operation/stream resource,
   loss/frontier, recovery, and zero-residual production-attached proof.
6. **M4F raw actions and integrated closeout** — generic raw action adapter,
   terminal readback, convenience-owner convergence, full offline integration,
   and separate M10 native acceptance debt.

Each later item begins on the exact landed predecessor. A command-producing
item changes implementation, public schemas, authored sources, reviewed routes,
generated aggregates/docs, maintained API docs, capability ledger, and
registered proofs atomically.

## Publication Boundary

This authority slice adds no M4 public command or schema and proves no M4
runtime behavior. Current CLI/IPC/runtime truth is unchanged. The new focused
proof establishes only that target authority and executable-owner allocation
remain coherent and do not regress into circular prerequisites, fictional
platform identity, premature SDK claims, or static-only behavioral proof.

## Consequences

- M4 implementation can proceed without reopening its root, snapshot, paging,
  raw-value, target, observer, or coordinate contracts.
- Non-AX lifecycle and CoreGraphics input rows move to M6 without changing
  current behavior.
- M5 consumes a stable AX event family but does not inherit observer lifecycle.
- M6 remains the maintained SDK boundary.
- M10 remains the native/TCC acceptance boundary.

## Rejected Alternatives

- Treating the AOS display composite as an Apple AX platform root is false.
- Re-observing on every page breaks immutable snapshot and ref identity.
- Using one limit for traversal and response page size hides frontier truth.
- Silently reacquiring an Observation Ref collapses it into a Locator.
- Publishing a ScreenCaptureKit generation invents unavailable platform truth.
- Calling the AOS callback timestamp an AX source-event timestamp invents
  unavailable event truth.
- Deferring AX observer cleanup to M5 leaves M4-owned native authority orphaned.
- Claiming TypeScript/Python parity in M4 preclaims M6.
- Treating static contract tests as behavioral acceptance does not execute the
  production projector or lifecycle owners.

## Verification

```bash
node --test tests/m4-ax-contract-foundation.test.mjs
node --test tests/sovereign-capability-active-authority.test.mjs
node --test tests/schemas/aos-privileged-capability-ledger-v1.test.mjs
node --test tests/schemas/dev-test-proof-registry.test.mjs
git diff --check
```
