# AOS Sovereign First Vertical Slice Contract

Program: `aos-sovereign-capability-substrate-v1`

Status: Milestone 1 design and implementation-routing contract. Nothing in this
document is implemented merely because it is specified here. Current source,
command-source manifests, generated help, IPC schemas, API docs, Toolkit, tests,
and runtime readback remain executable truth.

Authority: ADR 0043 owns the target. The current/target inventory is
`docs/dev/aos-privileged-capability-ledger-v1.json`. The paired Sigil authority
is landed ADR 0021 at revision
`227382c1bcbdab56f551a85a69b0609eebbdfa0c` under the shared program id.

## Scope and non-goals

The flagship workflow remains find, center, and record screen video. It is a
composition proof, not a product-shaped native primitive. AOS must expose
reusable observation, target, input, recording, managed-tool, operation,
stream, artifact, and lineage atoms. The caller composes them and owns
transforms and product interpretation.

A product primitive named `record-video-element` does not exist and is not
proposed. The flagship composes reusable atoms; neither branch creates that
shortcut.

Milestone 1 adds only this design, the closed capability ledger and its schema,
and static routing. It adds no runtime, command, runtime protocol schema,
generated help, SDK method, recording operation, managed Playwright grammar,
permission change, daemon behavior, or native UI.

## Proposed contract owners

The first implementation slice should propose and review these schema owners
together before runtime code lands:

- `shared/schemas/aos-operation-v1.schema.json`: current operation state,
  identity, mechanically authenticated owner root, bounded progress, terminal
  outcome, blame, cleanup, and residual-authority facts.
- `shared/schemas/aos-operation-event-v1.schema.json`: ordered content-free
  lifecycle and progress events.
- `shared/schemas/aos-operation-lineage-v1.schema.json`: exact parent/child
  operation ancestry plus separately typed mechanically bound and
  caller-asserted attribution.
- `shared/schemas/aos-stream-v1.schema.json`: stream identity, source,
  transport, byte/time/queue bounds, sequence/loss/frontier, tap state, and
  terminal cleanup.
- `shared/schemas/aos-operation-tap-v1.schema.json`: optional
  observation-only metadata/data tap identity, byte/rate/time bounds,
  revocation, and the no-retention default.
- `shared/schemas/aos-artifact-v1.schema.json`: exact artifact identity,
  custody state, containment, size/digest/media facts, reveal/remove/release/
  retain transitions, and cleanup receipt.
- `shared/schemas/aos-host-stop-barrier-v1.schema.json`: host-operator
  authentication, barrier generation, admission state, residual count, and
  reopen receipt.
- `shared/schemas/aos-operation-recovery-v1.schema.json`: boot generation,
  durable record version/checksum, exclusive recovery lock, retry/backoff,
  corruption, orphan, and residual disposition.

These names are proposals, not bootstrap files in Milestone 1. Each future
schema must be closed, content-free where it describes control metadata, and
paired with its implementation, API, CLI, SDK, test, and proof owners in one
atomic slice.

Proposed public CLI projections are:

```text
aos operation list [owner filters] --json
aos operation inspect <operation-id> --json
aos operation status <operation-id> --json
aos operation recent [owner filters] --json
aos operation cancel <operation-id> --json
aos operation kill <operation-id> --json
aos operation kill-owner [mechanically admitted owner filters] --json
aos operation stop-all --json
aos operation tap <operation-id> --max-bytes <n> --timeout <duration> --follow --json
aos artifact reveal|remove|release|retain <artifact-id> --json
aos record screen <source-and-geometry-options> --json
```

Exact nouns and forms remain subject to command-source review. The upstream
managed Playwright grammar is not copied into one AOS manifest entry per
operation; AOS owns a raw argv/stdio/artifact transport command over the
reviewed pin. That transport is exactly `argv`/`stdin`/`stdout`/`stderr`/
`artifact`; AOS validates executable/environment identity, lifecycle,
bounds, ownership, and custody without interpreting upstream grammar.

Maintained TypeScript and Python SDKs must project the same operation, stream,
artifact, lineage, and capability shapes. Toolkit may provide status and
surface bindings over those SDK contracts, but it must not become the daemon
transport owner or add product policy.

## Operation lifecycle

### Prepared before authority

An operation record must be durably `prepared` before AOS acquires continuing
privileged or managed authority. `prepared` contains the immutable operation
id, capability id, requested bounds, initiating authenticated peer facts,
caller attribution, proposed child/resource identities, and cleanup plan. It
contains no live child PID, process group, stream, native capture object,
device, or artifact authority.

The operation lifecycle is a finite lifecycle machine: `machine_kind` is
`finite_lifecycle`, `prepared` is the `initial_state`, `terminal` is its only
terminal sink, and it has no quiescent state. Every transition carries a typed
transition kind, guard id, guard, trigger, and optional terminal outcome. The
stream, tap, artifact, and recovery machines use the same structural fields.
The host barrier is different: it is a cyclic control machine with no terminal
state and with `open` and `closed` as its quiescent states.

The operation lifecycle is closed:

Transition choice is deterministic. Within one machine, `(from, event)` is a
unique dispatch key; conditional alternatives must be expressed by one guard
and one transition, never by duplicate event rows. The M1 semantic validator
reports `TRANSITION_EVENT_DUPLICATE` when that invariant is broken. Cross-
machine and workflow references use the exact transition tuple
`(machine, from, event, to)` and must resolve both their event key and
destination.

| From | Event | To | Required guard |
| --- | --- | --- | --- |
| `prepared` | authorize | `starting` | authenticated owner, bounds, and adapter-selected `capability_id` validate before acquisition |
| `prepared` | reject, cancel, kill, or host stop | `terminal` | no authority, stream, child, tap, or artifact was acquired |
| `starting` | started | `active` | adapter acknowledges exact live identity |
| `starting` | fail clean | `terminal` | adapter mechanically proves nothing was acquired |
| `starting` | fail residual | `cleanup_required` | any uncertain child, source, tap, or artifact is residual authority |
| `starting` | cancel, kill, host stop, deadline, parent stop, peer loss, or transport loss | `stopping` | authority may already exist, so intent is durable before teardown |
| `active` | complete, cancel, kill, owner kill, host stop, deadline, parent stop, peer loss, transport loss, permission revocation, or adapter failure | `stopping` | terminal intent and trigger are recorded before cleanup or escalation |
| `stopping` | clean | `terminal` | no residual exists except explicitly retained custody |
| `stopping` | residual | `cleanup_required` | uncertainty prevents a terminal-clean claim |
| `cleanup_required` | recover | `recovering` | one generation-scoped durable recovery claim holds the exclusive lock |
| `recovering` | recovered | `terminal` | residual absence or exact retained custody is proved |
| `recovering` | retry | `cleanup_required` | retry/backoff and blame are durably updated |

- `starting` begins only after the prepared record is durable and the exact
  capability adapter receives authority.
- `active` requires the adapter's exact acknowledgement of the live identity,
  not a numeric PID, path, or inferred platform state.
- `stopping` owns revocation and cleanup. It may be entered by normal
  completion, cancel, kill, owner kill, host stop, peer loss, deadline,
  transport loss, or recovery.
- `cleanup_required` is durable nonterminal authority. It is used whenever
  acquisition, execution, acknowledgement, or cleanup is ambiguous.
- `recovering` is a bounded cleanup attempt after exact resource identity and
  authority are re-established. It may reach `terminal` only with a complete
  cleanup receipt; otherwise it returns to `cleanup_required` with updated
  residual and retry facts. Recovery never guesses from a reused PID, path, or
  caller-asserted label.
- `terminal` is allowed only after the outcome and cleanup receipt prove that
  no executable, stream, tap, lease, device, native object, process group, or
  untransferred transient artifact remains under the operation's authority.

Terminal outcomes are closed to `succeeded`, `cancelled`, `killed`,
`rejected`, `failed`, `crashed`, `timed_out`, and `orphaned`. Cleanup failure is
never a terminal outcome. It remains `cleanup_required`, `recovering`, or the
durable `blocked_unresolved` recovery state until mechanical absence or exact
transferred/retained custody is verified. Triggers and blame are separate:
adapter complete, caller cancel, exact kill, owner kill, host stop, start
rejection/failure, deadline, signal, peer or transport loss, daemon crash, boot
recovery, platform/permission/adapter/external-tool failure, and artifact
failure must not collapse into one generic unsuccessful result. Recovery
attempt results are separately closed to `recovered`, `retry_scheduled`, and
`blocked_unresolved`.

Streams use `prepared -> starting -> active -> stopping -> terminal`, with
direct `prepared|starting -> terminal` routes only when no source or buffer
was acquired. An uncertain source, buffer, child, or custody record goes to
`cleanup_required -> recovering -> terminal|cleanup_required`. Production
stops before buffers are drained or discarded. Default transient bytes never
enter recent history.

| Stream from | Event | Stream to | Required guard |
| --- | --- | --- | --- |
| `prepared` | authorize, reject, cancel, kill, or host stop | `starting|terminal` | source/transport/bounds validate, or no source/buffer was acquired |
| `starting` | opened | `active` | exact source and stream identity are live |
| `starting` | fail clean | `terminal` | no source, queue, transport, or sink was acquired |
| `starting` | fail residual | `cleanup_required` | uncertain source, queue, transport, or sink requires cleanup |
| `starting` | stop, cancel, kill, host stop, deadline, parent stop, peer loss, or transport loss | `stopping` | source authority may already exist |
| `active` | stop, cancel, kill, owner kill, host stop, deadline, parent stop, source/peer/transport loss, permission revocation, or adapter failure | `stopping` | production closes before drain/discard |
| `stopping` | drained or residual | `terminal|cleanup_required` | transient buffers are gone, or residual is explicit |
| `cleanup_required` | recover | `recovering` | one generation-scoped recovery claim owns cleanup |
| `recovering` | recovered or retry | `terminal|cleanup_required` | absence is proved, or bounded retry metadata is durable |

### Terminal and residual rule

A process exit, EOF, callback, or success response is not by itself terminal.
Every resource declared by the prepared record must be one of:

- proved absent and cleaned;
- explicitly transferred to another exact AOS operation;
- released to the caller with an exact custody receipt; or
- retained as an exact artifact whose custody is no longer execution
  authority and whose later removal owner is explicit.

Any unresolved resource produces `cleanup_required` plus typed residual facts.
Recent history keeps content-free terminal outcome, blame, duration, cleanup,
and artifact identities for a bounded window. It never accumulates raw stream
bytes, pixels, audio, page data, trace bodies, or artifact contents.

## Identity, lineage, and owner filters

The operation id is random, immutable, and never a PID or caller label. Native
children additionally bind Darwin audit-token facts, PID generation, executable
identity, and exact parent/ancestor observations. Managed children retain the
current guardian/session/generation/nonce/process-group identities appropriate
to their owner.

The registered adapter selects canonical `capability_id`; callers cannot
supply or relabel it for admission, routing, status grouping, or mechanically
bounded owner filtering. A caller may supply `capability_label`, but that
label is attribution and optional narrowing only.

Lineage separates three classes:

1. mechanically authenticated peer and operation ancestry;
2. a scope mechanically bound by a reviewed adapter to that peer or ancestry;
3. caller-asserted client, agent, task, project, capability, run, skill, retry,
   or other labels.

The authenticated peer/owner root establishes the controllable set. A caller
may request a canonical `capability_id` filter, but that filter reads the
adapter-bound operation field and cannot supply or relabel it. Caller-asserted
client, agent, task, project, run, skill, target, and `capability_label`
filters are likewise intersected with the established set. A filter can remove
operations from a result; it can never add an operation, widen control, become
signal authority, or manufacture a bulk-kill scope. A mechanically bound scope
may establish a stronger owner boundary only when the binding is part of the
operation's immutable authenticated lineage.

List, inspect, status, recent, cancel, kill, and owner kill all use the same
intersection algorithm. Displaying an asserted label does not upgrade it.

## Cancel, kill, and host-stop semantics

| Control | Scope | Effect | Authentication rule |
| --- | --- | --- | --- |
| cancel | one operation | cooperative stop, terminal payload, bounded cleanup | exact operation is inside the authenticated peer's controllable set |
| kill one | one operation | record intent, force adapter termination, recover any residual | operation id, generation, and owner match; PID/PGID alone is insufficient |
| owner kill | an intersection | kill only operations in `peer set ∩ asserted filters` | task/agent/client/project/capability values remove members but cannot add any |
| host stop all | every AOS-owned active/residual operation | close admission, stop, recover, and hold the barrier | separate mechanically authenticated host operator only |

Cancel is not kill. Kill is not proof of cleanup. Owner kill is not a label
query promoted to signal authority. Host stop is not an ordinary owner filter.

## `owner_decision_required_before_m2`

Two owner decisions remain intentionally unresolved. No implementation may
silently choose either one.

### Ordinary owner root

Recommended: derive the root from the Darwin audit token and PID generation,
then walk to the nearest verified non-AOS ancestor. This groups nested AOS
adapters under the real invoking host without treating a caller label as
authority.

Alternatives and impact:

- Immediate peer only is simpler but fragments one caller into multiple
  uncontrollable islands when AOS adapters call other AOS adapters.
- An AOS-minted connection/lease root is explicit but adds credential-like
  durable state, handoff, expiry, and recovery obligations that ambient
  authority otherwise avoids.

The decision fixes the maximum ordinary controllable set and must be accepted
before M2 operation registry or kill behavior lands.

### Host operator

Recommended: admit host-wide control only when the immediate peer is the exact
reviewed AOS control executable, has the same effective UID, and connects over
an owner-, mode-, type-, and symlink-validated control socket. This is separate
from ordinary peer ownership.

Alternatives and impact:

- Any same-UID process is materially broader and makes the dedicated emergency
  boundary indistinguishable from ambient local callers.
- A launchd or Mach-service code-identity boundary may be stronger but adds
  packaging, installation, signing, and deployment work before the first
  reusable slice needs it.

The decision must be accepted before `stop-all` or post-stop admission lands.

SDK package roots are deliberately not a third pre-M2 decision. Before M6,
the owner must choose whether existing Toolkit plus new language packages or
dedicated TypeScript/Python/optional-Swift packages own maintained imports.
That publication choice does not block M2 control semantics.

## Host stop barrier

Host stop is not an owner filter. An authenticated host operator closes an
admission barrier, advances its generation, and snapshots every nonterminal
operation whose prepared/active authority predates the barrier. New acquisition
is rejected while the barrier is closed. Each snapshotted operation is stopped
through its exact capability owner, and the barrier remains closed until every
operation is terminal or durably `cleanup_required` with a bounded recovery
owner. A residual keeps the barrier in `cleanup_required` or `recovering`
and cannot reopen. Reopening is a separate exact host-operator transition after
zero residuals are verified and the barrier generation advances. Ordinary
peers, asserted lineage, or completion of one child cannot reopen it.

The barrier is `machine_kind: cyclic_control`, has `terminal_states: []`, and
declares `open` and `closed` as quiescent. `closing`, `cleanup_required`, and
`recovering` all reject new acquisition. `open` can never be reached from a
residual state: reopen requires a separately authenticated host operator, a
new generation and receipt, and mechanically verified zero residuals.

| Barrier from | Event | Barrier to | Required guard |
| --- | --- | --- | --- |
| `open` | host stop all | `closing` | separate host-operator authentication closes admission first |
| `closing` | drained | `closed` | every operation is terminal and residual-free |
| `closing` | residual | `cleanup_required` | admission remains closed |
| `cleanup_required` | recover | `recovering` | exclusive durable recovery claims residual records |
| `recovering` | recovered or retry | `closed|cleanup_required` | residual absence is verified, or admission remains closed |
| `closed` | reopen | `open` | host operator verifies zero residuals and advances generation |

At daemon boot, recovery advances generation, validates durable record version
and checksum, takes one exclusive lock per claim, and scans prior-generation
active/residual records. A reused PID, path, or caller label never proves
identity. Corruption fails closed with content-free blame and no conflicting
admission. Retry uses durable deadline/backoff and cannot create two cleanup
owners. Crash, SIGKILL, power loss, and orphan recovery terminate only after
process/stream/tap/artifact absence or explicit retained custody is verified.

| Recovery from | Event | Recovery to | Required guard |
| --- | --- | --- | --- |
| `idle` | boot | `scanning` | generation advances; version/checksum and lock validate |
| `scanning` | none found | `terminal` | no prior-generation active/residual record exists |
| `scanning` | orphan found | `recovering` | one exclusive claim owns exact orphan cleanup |
| `scanning` | corruption found | `cleanup_required` | fail closed with content-free blame |
| `recovering` | recovered or retry | `terminal|cleanup_required` | absence is proved, or retry/backoff is persisted |
| `cleanup_required` | retry due | `recovering` | the same or mechanically transferred generation claim resumes |
| `cleanup_required` | `operator_acknowledge` | `blocked_unresolved` | acknowledgement records awareness but never proves cleanup |
| `blocked_unresolved` | `operator_acknowledge` | `blocked_unresolved` | repeated acknowledgement remains durable and keeps admission closed |
| `blocked_unresolved` | retry authorized | `recovering` | authenticated retry acquires the exact generation lock |
| `blocked_unresolved` | mechanical absence verified | `terminal` | only absence or exact transferred/retained custody clears the block |

`cleanup_required --operator_acknowledge--> blocked_unresolved` records operator
intervention and awareness; it does not prove cleanup, release custody, or
establish mechanical absence. `blocked_unresolved` survives restart. An operator
acknowledgement cannot turn it into success, clear custody, or reopen the host
barrier. `blocked_unresolved --mechanical_absence_verified--> terminal` is
permitted only when mechanical absence or explicit transferred or retained
custody proves that no AOS cleanup authority remains. Recovery uses a
versioned checksummed record, atomic generation advance, one exclusive lock,
bounded idempotent retries, and corruption-fails-closed behavior. It never
publishes false terminal cleanup because a process disappeared or a path was
reused.

## Tap semantics

A tap is an explicit child observation operation bound to one exact live parent
operation and one declared channel. It is observation-only and separately
bounded by bytes, time, queue, sampling, and output transport. It grants no
mutation, cancellation, signal, artifact-custody, or owner-kill authority.

The control plane exposes live content-free metadata without a tap. Raw data is
available only while the explicit tap is active. AOS does not add tap output to
recent history and does not persist it unless the caller explicitly requests a
separate retained artifact under exact custody.

| From | Event | To | Meaning |
| --- | --- | --- | --- |
| `prepared` | open | `active` | exact parent/channel and byte/rate/time bounds validate |
| `prepared` | reject or cancel | `terminal` | no observation channel opened |
| `active` | expire | `expired` | deadline or byte/rate budget reached |
| `active` | revoke, cancel, kill, host stop, or parent stop | `revoked` | observation closes without granting operation control |
| `expired|revoked` | close clean | `terminal` | observer, descriptor, queue, and buffers are absent |
| `expired|revoked` | close failed | `cleanup_required` | any observer, descriptor, queue, or buffer residual is durable |
| `cleanup_required` | recover | `recovering` | one generation-scoped recovery claim owns cleanup |
| `recovering` | recovered or retry | `terminal|cleanup_required` | absence is proved, or bounded retry remains |

## Artifact custody

The artifact lifecycle is:

```text
transient -> offered -> released
                    -> retained
transient|offered|retained -> removed
```

| Artifact from | Event | Artifact to | Required guard |
| --- | --- | --- | --- |
| `transient` | validate, validation failed, or remove failed | `offered|cleanup_required` | integrity/bounds/type/custody validate, or cleanup remains nonterminal |
| `offered` | reveal | `offered` | bounded read-only reveal changes no custody state |
| `offered` | retain, release, remove, or remove failed | `retained|released|removed|cleanup_required` | caller selects custody, or cleanup failure stays nonterminal |
| `retained` | reveal | `retained` | bounded read-only reveal changes no custody state |
| `retained` | release, remove, expire, or remove failed | `released|removed|cleanup_required` | exact identity and retained owner revalidate |
| `released|removed` | finish | `terminal` | only content-free custody metadata remains |
| `cleanup_required` | recover | `recovering` | generation-scoped claim owns cleanup |
| `recovering` | recovered or retry | `removed|cleanup_required` | absence is verified, or bounded retry remains |

Validation failure routes `transient -> cleanup_required -> recovering`.
Recovery reaches `removed` only after absence is verified; otherwise it
returns to `cleanup_required` with durable retry/blame. `released`,
`retained`, and `removed` are distinct custody outcomes with distinct
receipts.

- `transient` is the default for AOS-produced screenshots, recordings, traces,
  raw outputs, and temporary media.
- `offered` means production and digest/size validation succeeded but custody
  has not transferred.
- `reveal` discloses the exact bounded artifact handle/path metadata to the
  mechanically entitled caller; it is read-only and does not change custody.
- `release` transfers the exact artifact to the caller and receipts the end of
  AOS cleanup ownership.
- `retain` is an explicit bounded caller request that keeps AOS custody under a
  named expiry/removal rule.
- `remove` revalidates exact identity and publishes a cleanup receipt.

Failed or canceled production must not publish a successful artifact. A
partial artifact remains transient cleanup authority and keeps the operation
nonterminal until removed or explicitly receipted as residual. A remove or
expiry failure enters `cleanup_required -> recovering`; it cannot be relabeled
terminal until recovery mechanically verifies absence.

## Screen recording contract

ScreenCaptureKit video is public on macOS 12.3. Its system-audio output
(`SCStreamOutputType.audio` plus `capturesAudio`) is macOS 13.
ScreenCaptureKit microphone capture and `SCRecordingOutput` are macOS 15
paths. `AVAssetWriter` is the public custom multitrack alternative when
deployment floor, separate tracks, codecs, timing, or custody requires a
writer AOS owns. The implementation decision must remain explicit and
compiler-verified; no row in the M1 ledger claims that AOS currently records
screen video or system audio.

A recording request identifies:

- exact display/window/region source and canonical topology observation;
- video dimensions, scale, frame-rate/time bounds, codec/container choice, and
  maximum output bytes;
- independently selected system-audio and microphone tracks plus exact TCC
  facts;
- geometry mode;
- transient stream and artifact ownership;
- operation owner, lineage, status, cancellation, blame, cleanup, and residual
  rules.

### Fixed geometry

Fixed geometry freezes the validated source rect and topology identity before
capture authority starts. The recording does not silently chase a moved target.
Topology, source membership, scale, or geometry drift produces a typed stop or
failure according to the request's explicit mechanical drift behavior.

### Caller-followed geometry

Caller-followed geometry is a separate mode. The caller supplies a sequence of
fresh, state-valid geometry updates. AOS validates each update against the live
recording source and declared bounds. Missing, stale, ambiguous, off-source, or
out-of-bounds updates are rejected; AOS never turns an old Observation Ref into
a Locator or invents target tracking. The caller owns the tracking algorithm
and any smoothing/cropping transform.

An accepted `active -> active` update is named `follow_update_accepted` and is
one atomic six-step rebind:

1. obtain a fresh caller observation;
2. verify that immutable target identity is unchanged;
3. bind the new observation, state, navigation, frame, topology, scale, window,
   and source identities;
4. validate the new source rectangle against the current topology and source;
5. increment `geometry_generation`; and
6. update the crop only after every preceding validation succeeds.

Movement with the same immutable identity is expected in followed mode. An
identity, topology, session, navigation, frame, scale, window, or source
discontinuity is not movement: it stops the operation through normal cleanup.

### Browser geometry binding

A browser element box is page/frame/navigation/session-generation state, not
desktop geometry. Binding it to screen recording requires all of:

- the exact managed browser session generation and page/frame/navigation
  identity that produced the box;
- current browser viewport/device-scale/scroll facts from the reviewed pinned
  upstream grammar;
- an exact current native browser window identity and content-area-to-screen
  transform;
- the canonical display topology used by the recorder; and
- a validation result that rejects drift before capture or before each
  caller-followed update.

If AOS cannot prove that transform, the box remains browser-local and cannot be
used as a screen-region target. The flagship workflow may instead record a
validated browser window or a caller-supplied fixed screen region. No silent
coordinate inference or stale reacquisition is permitted.

## Dedicated internal operation status item

The operation projection uses a reserved AOS-internal owner/item namespace and
does not borrow, mutate, or infer authority from consumer status-item leases.
It renders only neutral active/recording counts, exact selected operation
metadata, cleanup-required state, and mechanically available control actions.
Its actions call the same operation-control contracts as CLI/SDK and therefore
cannot widen the current operator's controllable set.

The projected mechanical fields are operation id, adapter-selected capability
id, state, generation, authenticated owner root and peer, terminal outcome,
trigger, blame, and cleanup/residual facts. Client, agent, project, task, run,
skill, target, and `capability_label` fields are asserted unless an adapter has
mechanically bound one; display never upgrades them to authority.

The immutable adapter registry sets `status_indicator_class` when the
operation generation becomes prepared. Requests, raw argv, asserted lineage,
and `capability_label` cannot set or change that class. The recording class is
assigned to `microphone-capture-adapter`, `screencapturekit-screen-video`,
`screencapturekit-system-audio`, and
`screencapturekit-microphone-recording-output`. The current
`avassetwriter-custom-multitrack` and `managed-playwright-runtime` rows, plus
the proposed M7 Playwright, OpenCLI, and FFmpeg adapters, are neutral. The
registry provenance is `adapter_registry` and is mechanically projected.

The recording indicator applies only to adapter-selected recording
`capability_id` values. It is red if and only if any mechanically classified
recording operation is in `starting`, `active`,
`stopping`, `cleanup_required`, and `recovering`; it clears only after
every recording operation is terminal with no residual. The dedicated internal
action is admitted only from
the mechanically authenticated AOS status host with exact item generation,
descriptor revision, and action sequence. Display text, asserted lineage, and
ordinary same-UID presence never authenticate that action.

That authenticated status action origin grants no control. An ordinary action
is re-admitted against the mechanically authenticated peer's controllable owner
set. A host-wide action is re-admitted only through the separate host-operator
boundary. The status item is neutral observation and action input, not an
authorization source.

AOS owns this neutral projection and status-item mechanics. Sigil owns product
labels, grouping, prominence, and action policy in any product surface it
composes. A Sigil label never becomes AOS kill authority.

## Sigil and Simulation Author seams

Sigil consumes reviewed AOS CLI/IPC/SDK contracts and supplies project, run,
task, skill, agent, retry, and capability attribution. Those values are useful
for filtering and product display but remain asserted until an exact adapter
mechanically binds one. Sigil owns workflow sequencing, result interpretation,
budgets, retries, memory, transforms, and evidence policy.

Simulation Author is the first follow-on flagship consumer after the find,
center, and record-video composition proves the substrate. Its future seam is
Sigil workflow composition over reviewed AOS capability and operation schemas.
Its independent documents and implementation are outside this program slice
and must not be joined, read, or modified without later explicit owner
direction.


## Flagship workflow: find, center, re-observe, record

The machine-bound success path is:

```text
surface_observed
  -> target_selected
  -> center_planned
  -> center_action_terminal
  -> target_reobserved
  -> geometry_bound
  -> recording_prepared
  -> active
  -> stopping
  -> artifact_offered
  -> artifact_released|artifact_retained|artifact_removed
  -> terminal
```

The caller selects and centers the target. After the center action is terminal,
the caller discards the old snapshot, refs, and geometry and performs a fresh
observation. Only the fresh result may bind recording geometry.

| Branch | Selection and center | Required re-observation | Geometry binding | Recording |
| --- | --- | --- | --- | --- |
| native AX | complete AX roots/depth/breadth/paging/raw attributes plus caller-selected AX/window/CG action | fresh AX/window/display state after the terminal center receipt | exact AX-to-display-to-ScreenCaptureKit pixel transform and topology identity | M3 video/system audio with optional microphone |
| managed DOM | pinned Playwright snapshot/box plus caller-selected raw upstream action | fresh snapshot/box after navigation/frame stability | exact browser session/navigation/frame/window/display/backing-scale transform | AOS ScreenCaptureKit pixels for the bound browser geometry |

Fixed mode freezes post-action geometry and every source identity.
Caller-followed mode is explicit and bounded by caller-selected cadence and
deadline; each fresh observation is rebound before crop changes. It stops on
disappearance, ambiguity, timeout, or target/topology/session/navigation/frame/
scale/window drift.

Every one of the 27 declared outcomes has one or more structured emissions.
Each emission names the exact transition tuple, workflow source state,
authority phase, execution-path id, trigger, blame, and typed terminal or
nonterminal destination. An execution path closes an aggregate state vector:
it declares an entry state for every involved machine, ordered exact transition
references, the exact final state vector, and one typed destination. Validation
first applies the outcome emission to that entry vector, then executes every
path transition in order. A step whose `from` is not the current machine state,
an emission whose workflow source is not the entry workflow state, or a final
vector/destination mismatch fails the static proof.

The catalog has exactly 12 execution paths. Six pre-authority paths have no
continuation after their clean direct workflow-terminal emission: surface
selection, stale target, center, re-observation, geometry, and preparation
rejection. Post-authority cleanup is split by actual aggregate entry state:
`post_authority_starting_validated_custody` starts with operation/stream
`starting`, while `post_authority_active_validated_custody` starts with both
`active`. After the workflow emission enters `stopping`, the internal
`parent_stop` transition moves the operation to `stopping`, then moves and
drains the stream. Only after the stream is terminal may the transient artifact
validate, be offered, released, and finished; the operation may then take
`stopping --clean--> terminal`, and the workflow becomes terminal last.
`parent_stop` is target-contract coordination inside that executable aggregate
route, not a claim that an M1 runtime operation plane exists.

Relative order alone is insufficient. Whenever an execution path reaches an
operation-terminal state, every included stream, tap, and recovery machine must
also be terminal; an included artifact must be terminal or already in the
mechanically verified `released` or `retained` custody state. Every
post-authority workflow-terminal destination additionally requires a terminal
operation and the same closed child/custody/recovery vector. Deleting a drain or
parent-clean transition cannot be hidden by editing the declared final vector.

The validation-recovery path begins with the stream already terminal. It
recovers and finishes the artifact and global recovery machine before cleaning
the parent operation, then terminates the workflow through
`stopping --cleanup_resolved_without_offer--> terminal`. Three separate
artifact-cleanup-unresolved paths bind the actual workflow/artifact pairs
`stopping/transient`, `artifact_offered/offered`, and
`artifact_retained/retained`. They preserve the operation in `stopping` and the
workflow in its current custody state while recovery becomes durable
`blocked_unresolved`. Each ordinary remove-failure route uses
`scanning --orphan_found--> recovering --retry--> cleanup_required` before
operator acknowledgement records the unresolved block. It does not use
`corruption_found`: that event is reserved for an explicitly identified corrupt
record/custody outcome and guard. An offered or retained failure cannot reuse
the transient route, and a terminal parent can never move backward to stopping.

Selection, stale-state, center, and bounds failures before recording authority
terminate directly only after proving that no authority or artifact was
acquired. Any failure, cancel, kill, or host stop after `recording_prepared`
routes through `stopping` and then artifact custody or recovery. Outcomes that
can occur in both phases use the phase-dependent rule: clean direct terminal
before authority, stopping/recovery after authority.

Closed outcomes cover success; not found, ambiguous, and stale selection;
rejected/failed center action; disappeared/moved/follow-timeout and topology/
session/navigation/frame/scale/window drift; unavailable screen, system audio,
microphone, bounds, encoder, and tracks; blank/withheld content; artifact
validation/cleanup failure; cancel, kill, and host stop.
`CONTENT_BLANK_OR_WITHHELD` reports the observed result only. No supported
public API attributes protected-content cause, so AOS must not infer it.
`ARTIFACT_VALIDATION_FAILED` begins only with
`artifact: transient --validation_failed--> cleanup_required`. It enters
artifact and recovery cleanup after the child stream is terminal; after
verified removal and recovery completion it
uses `stopping --cleanup_resolved_without_offer--> terminal`, so invalid bytes
are never offered and the operation cannot become terminal early.
`ARTIFACT_CLEANUP_FAILED` is explicitly nonterminal: every remove-failed
emission ends in `cleanup_required`, its state-specific execution path reaches
durable `blocked_unresolved` without terminating the parent operation, and it
cannot finish until absence or exact custody is mechanically proved.

M2 owner paths are eight proposed schemas (operation, operation event, lineage,
stream, tap, artifact, host barrier, and recovery), five daemon owners
(registry, control, recovery, microphone adapter, and internal status
projection), the reviewed proposed AOS command source and external route, and
their generated aggregates/help. M3 owner paths are the current desktop-pixel
source and lifecycle plus proposed recording schema, adapter, encoder, geometry
owner, AOS command source, external route, and generated aggregates/help. A
`proposed` path is not claimed to exist in M1.

M2 and M3 each have five exact proof owners: schema static, contract static,
fake, native compile, and separately authorized native live. Static proof binds
schemas/source/manifests. Fake proof
covers lifecycle, failure, control, custody, and recovery. Native compile proof
acquires no live authority and is not TCC acceptance. Live scripts cover actual
peer/signal/status/microphone or recording/TCC/artifact/crash behavior only
after explicit owner authority.

### M1 protective static proof and portability boundary

The ledger's JSON Schema closes shape, enum, conditional, and cardinality
rules. Independent semantic validators—not schema copies or whole-object
hashes—enforce graph reachability, terminal sinks, cyclic quiescence, durable
blocked recovery, exact outcome-transition resolution, milestone ref closure,
exposure reachability, proof attribution, and current-path truth.

The command snapshot contains exactly 101 functional binding occurrences and
107 functional selector occurrences. A reverse-closure scan parses authored
AOS help and external route manifests, then requires the unique authored tuple
set on every bound route to equal the disjoint union of functional selectors
and six explicit fail-closed selectors. Prefix dispatch requires a literal
dialect in authored usage or examples; ambiguous `do` routes cannot fall back
to arbitrary-string acceptance. Generated aggregates remain outputs only.

TypeScript and Toolkit reachability is closed against
`packages/toolkit/package.json`. `selected_symbols` bindings must be declared
by both the runtime and type entrypoints. A `complete_entrypoint` names the
whole revision-local entrypoint and therefore enumerates no selected symbols.
The complete DesktopWorld scene surface binds `./scene`, `./scene/authoring`,
`./scene/runtime`, `./scene/extensions`, and `./scene/devtools`; the status-item
surface is also a complete entrypoint. "Package export" here proves
revision-local import reachability, not npm publication. An independent
hardcoded snapshot closes all 15 non-absent TypeScript/Toolkit surfaces across
state, reachability, owners, internal support, forms, and exact runtime/type
export bindings. Complete-entrypoint closure derives the expected subpath
family from the package export map itself, not from mutable ledger owners.

Availability evidence is a reviewed, portable SDK snapshot rather than a
runtime host-compatibility or TCC-grant claim. SDK-header tuples cite
`apple-macosx-26.5` or `apple-driverkit-25.5` and use SDK-root-relative header
locators. The static proof closes each evidence source's id, kind, platform,
canonical SDK name, version, locator base, and identity locator and requires
each SDK-header tuple's platform to equal its source platform. The ordinary
static test never invokes ambient `xcrun`. An optional exact-SDK audit may
separately compare those 96 tuples against the named SDK versions; that audit
is environment-sensitive and is not native-live or TCC acceptance.

Tracked-source discovery begins with every `git ls-files` entry. Exact rules
classify production source, tests, fixtures, documentation, schemas, generated
outputs, vendor/build state, privilege metadata, managed descriptors, data, and
binary assets. Generated filename patterns such as `*.generated.js` classify
as generated before their source extension can make them production source.
Exact authored packaging plist/entitlement files and exact companion
descriptors are searchable privilege surfaces; generated command aggregates
remain excluded. Source extensions are recognized in any current or future
root. Extensionless executables require a readable shebang; source-like
symlinks must resolve to readable regular source; binary source fails closed.
Large source is streamed without a size cap and with boundary-safe matching.
The 32-row disposition map assigns each current implemented/partial row named
positive probes, each absent row named negatives, and unsupported/unverified
rows their exact platform or private boundary. Private-family pattern ids bind
test-owned call regexes for real `CGS*(`, `SLS*(`,
`IOHIDEventSystemClient*(`, and `IOHIDServiceClient*(` call families across
production source and searchable privilege metadata/descriptors. This is
named-family boundedness, not proof that arbitrary undiscovered APIs are
absent.

## Milestone sequence

1. **M1 — ledger and contract:** land the exact 32-row current/target inventory,
   design contract, schema proof, registry, and routing. No runtime or generated
   command/help change.
2. **M2 — smallest reusable control slice:** decide the two owner questions;
   implement peer identity, operation/lineage/stream/tap/artifact/barrier/
   recovery schemas, prepared registry, list/inspect/status/recent, cancel,
   kill-one, owner-intersection kill, host stop, terminal/residual behavior, the
   existing microphone adapter, and dedicated internal red status projection.
3. **M3 — recording vertical slice:** add video, independently selectable
   system-audio and microphone tracks, multitrack encoder, fixed and
   caller-followed geometry, transient streams/artifacts, controls, fake proof,
   and separately authorized native recording proof.
4. **M4 — complete AX surface:** complete roots, depth, breadth, paging, raw
   attributes, actions, filters, AX notifications, and exact
   AX/display/ScreenCaptureKit/pixel transforms with target, state,
   completeness, and frontier truth.
5. **M5 — unified privileged streams:** converge video, system audio,
   microphone, input, focus, window, display, AX notifications, canvas, native
   lifecycle, and clipboard on one stream identity, loss/frontier, tap,
   cancel/kill, transient-data, and cleanup contract.
6. **M6 — canonical protocol and SDKs:** publish CLI, IPC, maintained TypeScript
   and Python SDKs, optional Swift SDK, one-shot/stream control parity, and
   retire AOS consent/priming doctrine in favor of exact platform facts.
7. **M7 — managed external tools:** land one grammar-agnostic raw external-tool
   runner and descriptor schema with operation/artifact integration, then land
   sequential reviewed descriptors and exact pins for Playwright, OpenCLI, and
   FFmpeg. Every descriptor uses complete raw `argv`, `stdin`, `stdout`,
   `stderr`, and `artifact` transport with lifecycle, identity, bounds, and
   custody only; managed-live acceptance remains separately authorized.
8. **M8 — installable skills:** organize tool, technique, and workflow layers
   for AOS, Playwright, OpenCLI, and FFmpeg after executable truth. M8 changes
   skills only, references only executable M7 descriptors, and changes no
   command grammar.
9. **M9 — Sigil workflows and flagships:** compose arbitrary Python,
   TypeScript, or shell workflows, active-operation links, and native/managed
   browser flagship branches. The later consumer seam joins only under
   explicit owner direction and no protected workstream path is included.
10. **M10 — acceptance:** verify signed/notarized identity, update integrity,
    crash, SIGKILL, power loss, orphan, concurrency, kill, artifact, and exact
    pin behavior through static/fake and separately authorized native gates.

Authority publication and runtime implementation are distinct. Every command
slice in M2 through M7 changes implementation, authored AOS/external command
sources, generated aggregates/help, schemas/API/SDK projection, tests, proof
registry, and workflow routing atomically. Generated command/help work is never
deferred to M8. M8 reorganizes skills only. M9 may compose existing CLI/IPC/SDK
atoms from arbitrary Python, TypeScript, or shell; any new command still follows
the same atomic rule.

## M2 proof design

M2 starts offline and deterministic:

- schema tests reject unknown fields, invalid transitions, forged lineage,
  asserted-filter widening, stale operation/artifact identity, terminal state
  with residual authority, and host-stop admission races;
- pure model tests prove prepared-before-authority, one durable terminal owner,
  filter intersection, bounded recent history, stop-barrier generation, tap
  observation-only behavior, and artifact custody transitions;
- fake peer/process/socket tests prove audit-token/PID-generation bindings and
  exact reauthentication immediately before signal or cleanup;
- the existing microphone authorization/capture harness proves the first real
  adapter with injected authorization and fake audio buffers, without touching
  live microphone, TCC, native UI, or the shared daemon;
- static source/manifests/API/SDK/skill convergence tests prove no target claim
  outruns current executable truth.

The M3 ladder adds static ScreenCaptureKit/AVAssetWriter/schema and generated-
grammar binding, fake video/system-audio/microphone/encoder/geometry/custody/
failure tests, native compile proof with no capture authority, and separately
authorized live screen/audio/microphone/TCC/status/artifact/crash acceptance.

Live microphone, screen capture, browser, native UI, TCC, build, packaging, and
installation proof remain separately gated by later owner authority.
