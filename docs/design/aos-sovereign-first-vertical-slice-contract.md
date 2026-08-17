# AOS Sovereign First Vertical Slice Contract

Program: `aos-sovereign-capability-substrate-v1`

Status: Milestone 2 executable control-plane candidate and implementation-routing
contract. Current source, command-source manifests, generated help, IPC schemas,
API docs, Toolkit, tests, and runtime readback own executable truth; later M3-M10
sections remain target design merely because they are specified here.

Authority: ADR 0043 owns the target; accepted ADR 0044 amends its mechanical
owner-root, same-effective-UID host-control, prior-generation recovery, and
resource-claim clauses. The current/target inventory is
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

Milestone 2 implements the shared operation registry/control plane, exact owner
root and same-UID host barrier, resource claims, durable recovery, daemon IPC and
CLI, one microphone adapter, and internal status/Canvas projections. It adds no
public SDK root, recording producer, managed Playwright grammar, or TCC policy
change; those remain later milestones.

## Contract owners

The M2 executable candidate lands these schema owners together:

- `shared/schemas/aos-operation-v1.schema.json`: current operation state,
  identity, mechanically authenticated owner root, bounded progress, terminal
  outcome, blame, cleanup, residual-authority facts, and closed exclusive or
  multiplexable resource-claim records.
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
- `shared/schemas/aos-host-stop-barrier-v1.schema.json`: live per-request same-
  effective-UID caller facts, barrier generation, admission state, residual
  count, and reopen receipt.
- `shared/schemas/aos-operation-recovery-v1.schema.json`: boot generation,
  durable record version/checksum, exclusive recovery lock, retry/backoff,
  corruption, orphan, and residual disposition.

These names are proposals, not bootstrap files in Milestone 1. Each future
schema must be closed, content-free where it describes control metadata, and
paired with its implementation, API, CLI, test, and proof owners in one atomic
slice. Maintained public SDK projections remain M6; M2 daemon IPC is the
canonical programmatic contract they will consume.

Proposed public CLI projections are:

```text
aos operation list [--capability-id|--client-id|--agent-id|--project-id|--task-id|--run-id|--skill-id|--target-id|--capability-label ...] --json
aos operation inspect <operation-id> --generation <n> --json
aos operation status <operation-id> --generation <n> --json
aos operation recent [the same optional intersection filters] --json
aos operation cancel <operation-id> --generation <n> --json
aos operation kill <operation-id> --generation <n> --json
aos operation kill-owner [the same optional intersection filters] --json
aos operation tap <operation-id> --generation <n> --channel <metadata|data> --rate <items-per-second> --sample-every <n> --max-queue-items <n> --max-items <n> --max-bytes <n> --timeout <milliseconds> --duration-ms <milliseconds> [--follow] --json
aos operation artifact reveal|remove|release|retain <artifact-id> --generation <n> --json
aos operation stop-all --barrier-generation <n> --json
aos operation barrier-status --json
aos operation reopen --barrier-generation <n> --json
aos record screen <source-and-geometry-options> --json
```

The first fifteen operation forms above are closed by the M2 ledger and must
publish through 41/49 with runtime, generated aggregates, API, and proof. The
screen-recording form belongs to M3. Expected daemon generation is attached by
the server after same-socket bootstrap for the current connection epoch, not by
a public CLI flag. The upstream
managed Playwright grammar is not copied into one AOS manifest entry per
operation; AOS owns a raw argv/stdio/artifact transport command over the
reviewed pin. That transport is exactly `argv`/`stdin`/`stdout`/`stderr`/
`artifact`; AOS validates executable/environment identity, lifecycle,
bounds, ownership, and custody without interpreting upstream grammar.

Maintained TypeScript and Python SDKs must eventually project the same
operation, stream, artifact, lineage, and capability shapes in M6. M2 includes
an internal Toolkit Canvas projection only; it is not a public SDK root and
must not become the daemon transport owner or add product policy.

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
| host stop all | complete registered operation-plane set at one exact adapter-registry revision | close admission, stop, recover, and hold the barrier for that registered set | live mechanically authenticated local caller whose effective UID equals the daemon effective UID; status break-glass uses the exact daemon/status-host generation |

Cancel is not kill. Kill is not proof of cleanup. Owner kill is not a label
query promoted to signal authority. Host stop is not an ordinary owner filter.
In M2 the registered set contains the microphone adapter only; unadapted legacy
daemon capabilities are not implicitly controlled, and later adapter
milestones advance the exact registry revision.

## Accepted M2 owner bindings

ADR 0044 accepts both pre-source decisions.

### Ordinary owner root

On connection acceptance AOS binds the immediate Darwin peer through
`LOCAL_PEERTOKEN`: audit token, effective UID, PID, and PID generation. Public
libproc provides no equivalent audit token for ancestors. Ancestor verification
therefore uses double-sampled `proc_bsdinfo` start times, effective UID, a stable
same-observation child/parent edge, and exact code identity. An exact-image skip
requires the immediate token only when the skipped node is that socket peer.
A durable daemon spawn record may retain a child token when it was actually
observed there. An unverified or raced node stops the walk conservatively;
basename, path, argv, environment, numeric PID/PGID, or asserted lineage can
never justify skipping it.

The current external Node microphone route requires native durable intent,
dynamic child-image admission, and tokenless same-socket child finalization
before microphone authority. The closed `listen_microphone_v1` activation
predicate is invocation-scoped; nonmatching `listen` invocations prepare no
operation, claim, token, or dynamic admission. External dispatch treats
`/usr/bin/env node` as a host-variable resolution policy, but accepts only a
live interpreter with Apple generic Developer ID trust, signing identifier
`node`, Node.js Foundation team `HX7739G8FX`, and hardened runtime. Intent stores
only content-free path/identity/file digests, device/inode, signing identifiers,
and the platform's 20-byte SHA-256 CDHash. The opaque intent token stays with
the exact authenticated parent and is used only for admission or abandon.

The child starts blocked with no token, script path, helper path, or reviewed
source. AOS dynamically validates the running SecCode guest and mapped main-
executable vnode against the intent and durably binds the child PID generation
plus parent edge. Only then does the dispatcher send a deterministic in-memory
ESM bundle built from the raw-byte-verified entry script,
`scripts/lib/aos-daemon-client.mjs`, and
`scripts/lib/aos-voice-follow.mjs`. Tokenless finalization resolves exactly one
admitted record from the authenticated child socket, revalidates executable and
canonical argv-shape evidence, and consumes it once. Only content-free identity,
script, dependency-set, executable, and argv-shape digests remain durable or
public. Parent abandon, 30-second expiry, and boot recovery terminalize the
prepared operation and release its claim when finalization never succeeds. A
dispatcher-injected parent PID is lifecycle-only, deleted at module start, never
sent to the daemon, and never authority; `AOS_EXTERNAL_DISPATCH_PARENT_PID`
cannot bless an executable, script, helper, child, or argv shape.

That immutable connection evidence establishes the maximum ordinary
controllable set. Caller-asserted client, agent, project, task, run, skill,
target, or capability values remain attribution and may only intersect with
that set. Signal, escalation, cleanup, and generation release revalidate the
exact mechanical identity required by the action.

### Same-effective-UID host control

Host stop-all, barrier status, and reopen are distinct public operations
admitted through a live per-request local-caller predicate: the caller is
mechanically authenticated by the current transport and its effective UID
equals the daemon effective UID. The predicate is never a durable role, token,
special principal, executable class, asserted lineage value, or claim about
human intent.

M2 daemon IPC, CLI, native status item, and internal Canvas invoke the same
public host-control entrypoint. Expected daemon generation and caller evidence
are server-attached after same-socket bootstrap for the current connection
epoch. Ordinary Canvas controls require a currently live captured peer and
become display-only when that connection disappears. The status item remains always-
available break-glass: the daemon-owned status host binds its exact daemon/
status-host generation and effective UID, reauthenticates that mechanical local
caller for each action, and invokes the same entrypoint. UI origin and action
sequence authenticate input into the host but create no ordinary owner
authority or special principal. A status-opened Canvas may reuse only the
server-injected status-host context for stop-all; it cannot impersonate an
ordinary owner.

The server injects exactly four origin variants: `live_transport_peer` may use
ordinary and host control; `ordinary_canvas_captured_peer` may use ordinary
control only while its captured connection remains live;
`status_item_host` may invoke stop-all only; and
`status_opened_canvas_host`, bound to both Canvas and parent status-host
generations, may invoke stop-all only. Caller payloads cannot select or collapse
these origins, and an ordinary captured peer never gains a host action.

CLI and direct daemon IPC actions authenticate their current live transport
peer. Captured-peer continuation is exclusive to ordinary Canvas controls and
cannot be substituted for a disconnected CLI transport.

Requests use a durable request id and canonical digest. Retained receipts are
looked up generation-independently before current generation and CAS checks.
Deduplication is bounded to 4,096 terminal receipts or 86,400 seconds, and its
canonical replay guarantee ends at pruning: an evicted id becomes a new
request, not a magically identifiable expired replay. Stop-all and reopen both
carry the expected barrier generation, so an evicted old mutation fails CAS
after a later reopen instead of repeating its former effect.

SDK package roots are deliberately not a third pre-M2 decision. Before M6,
the owner must choose whether existing Toolkit plus new language packages or
dedicated TypeScript/Python/optional-Swift packages own maintained imports.
That publication choice does not block M2 control semantics.

## Singleton resource claims

At one adapter-registry revision, each adapter publishes a declaration for one
unique stable resource key and one closed mode: `exclusive` or
`multiplexable`. The declaration binds adapter id/revision, key, mode, digest,
and a positive finite fanout bound only for multiplexable resources. A key,
owner, mode, or fanout change advances both registry revision and declaration
digest. Declaration, registered-operation, selected-operation, and
subscriber-set digests are SHA-256 over UTF-8 RFC 8785 canonical JSON with the
closed `aos:<digest-domain>:v1\n` separator, exact member fields and sort order,
lowercase 64-hex output, and count equal to the canonical member-array length.
An operation may require multiple claims. AOS
canonical-sorts the complete claim set by resource key and reserves all claims
or none at one serialized linearization point. Failed admission retains no
claim, so partial authority cannot deadlock another operation. Conflict and
fan-out-exhaustion receipts are typed, content-free, and deterministically
ordered by canonical resource key and stable attempt sequence.

Exclusive mode admits one exact resource-key/resource-generation and operation-
id/operation-generation tuple. It returns busy on conflict and never waits,
steals, replaces, or preempts. Multiplexable mode owns one AOS broker generation
and exact per-operation subscriber leases within adapter-declared bounded fan-
out. The same mechanically derived owner does not bypass exclusivity. Only an
exact adapter-declared idempotency/reattach token bound to the same resource and
operation generations may rebind.

AOS supplies no implicit queue, priority, fairness, retry, or preemption policy;
the caller explicitly chooses retry, cancel, or kill. Barrier close wins a race
ordered before the claim-set linearization point and leaves no partial claims.
The complete transaction CAS includes the expected barrier generation,
adapter-registry revision, declaration-set count/digest, every resource generation
and declaration digest, and for each multiplexed key the expected broker
generation and subscriber-set revision, count, and digest. A successful commit
atomically publishes every claim with the committed transaction id/digest and
exact registry/declaration snapshot, plus the resulting broker generation and
subscriber revision/count/digest with the complete claim set.
Subscriber attach, nonlast detach, and last detach separately CAS the exact
resource/declaration/broker generations and prior subscriber revision,
count/digest. Attach additionally verifies the current registry/declaration
snapshot against the committed claim-set transaction and rejects a stale
standalone attach; detach uses the exact snapshot pinned to the claim. Their
one atomic publication updates the claim result and
resulting broker revision/count/digest/state. Attach cannot exceed declared
fanout; last detach requires expected count one and publishes zero plus
`stopping`.
Cleanup releases only the exact resource key and generation after mechanical
absence or the surviving broker/subscriber set is proved. Stale cleanup cannot
release or decrement a successor generation.

Three finite machines own separate facts:

| Machine | Core route | Separation rule |
| --- | --- | --- |
| claim-set transaction | `prepared -> reserving -> committed` or `rolling_back -> terminal` | mixed exclusive/multiplex requests publish together or roll back every inert provisional record |
| per-operation resource claim | `prepared -> active -> releasing|terminal -> cleanup_required|recovering -> terminal` | one exact operation/resource generation; nonlast subscriber release terminals this claim |
| multiplex broker | `prepared -> starting -> active -> stopping -> cleanup_required|recovering -> terminal` | subscriber attach/detach persists exact revision/count/digest; last release enters cleanup |

Claim-set `cleanup_required` and `recovering` records carry a closed persisted
disposition. `rollback_pending` may finish only as `rejected` after every
provisional claim is proven absent. `commit_pending_handoff` may finish only as
`succeeded` after the complete atomic commit marker and every per-resource and
broker handoff are mechanically verified. A crash in `reserving` selects the
latter only from that complete commit marker; otherwise it is rollback.

Host stop has an explicit route from every nonterminal broker state. A daemon
generation change has an explicit prior-generation transition from every
nonterminal state of all three machines, including `cleanup_required`; no
restart may teleport a claim or broker to terminal.

M2 registers only `microphone-capture-adapter` for the exclusive
`voice_io_native_session` claim. Existing speech and audio output remain legacy
reservation sentinels: output activity participates atomically in microphone
admission and returns typed busy conflict, but the output itself is outside the
registered stop-all set until a later adapter migration. Neither side may
preempt the other. In particular, M2 retires implicit
`outputToCancel?.cancel(reason: "barge_in")`; callers explicitly retry, cancel,
or kill.

## Host stop barrier

Host stop is not an owner filter. A live same-effective-UID local caller closes
the admission barrier, advances its generation, and snapshots the complete
registered operation-plane set at one exact adapter-registry revision. The
receipt carries that revision plus set count/digest, selected-operation
count/digest, outcome, residual digest, and cleanup result. M2's registered set
is the microphone adapter; stop-all does not claim unadapted legacy subsystem
control. Later adapter milestones advance the revision.

The close transition persists one immutable snapshot containing barrier and
stop-operation generations, adapter-registry revision, registered and selected
set count/digests, and a snapshot digest. Those exact bytes survive drain,
cleanup, recovery, restart, passive status, and state-idempotent repeats;
residual progress is separate. A new registry revision is only a candidate for
the next open generation. Reopen preserves the prior closed snapshot while
separately publishing the reconciled resulting open snapshot.

New acquisition is rejected while the barrier is closed. A residual in the
registered set keeps the barrier in `cleanup_required` or `recovering` and
cannot reopen. Reopen is a separate request with an explicit expected barrier-
generation compare-and-swap and server-attached daemon generation/connection
epoch. It succeeds only after zero residuals for the exact registered set are
verified. Ordinary peers, asserted lineage, or completion of one child cannot
reopen it.

The barrier is `machine_kind: cyclic_control`, starts in
`boot_reconciling`, has `terminal_states: []`, and declares `open` and `closed`
as quiescent. Boot stays admission-closed until durable store, prior-generation,
registered-set, and zero-residual reconciliation succeeds. `closing`,
`cleanup_required`, and `recovering` reject new acquisition. `open` can never
be reached from a residual state.

Stop-all remains available while the barrier is `boot_reconciling`. Retained
lookup precedes exact current daemon/barrier-generation validation; the request
then binds the last durable immutable snapshot without synthesizing zero
residuals. It returns content-free `recorded`,
`reconciliation_in_progress`, or `store_blocked` while remaining admission-
closed. `recorded` durably binds a stop operation to that snapshot but defers
all cleanup claims until reconciliation owns exact residuals. The other two
outcomes claim no cleanup or absence. The status-item action stays enabled
through this route.

| Barrier from | Event | Barrier to | Required guard |
| --- | --- | --- | --- |
| `boot_reconciling` | host stop all | `boot_reconciling` | retained lookup, expected daemon/barrier-generation CAS, and exact durable-snapshot binding yield `recorded`, `reconciliation_in_progress`, or `store_blocked`; admission remains closed and no cleanup is inferred |
| `boot_reconciling` | open verified | `open` | durable store and every prior snapshot reconcile; zero residuals and one separately bound open registry snapshot are durable |
| `open` | host stop all | `closing` | fresh same-effective-UID authentication plus exact expected-generation CAS atomically closes admission and captures the immutable stop-operation/registered/selected-set snapshot |
| `closing` | stop repeat | `closing` | retained replay precedes validation; any new or pruned request passes current-generation CAS and reuses the original stop generation and byte-identical snapshot |
| `closing` | drained | `closed` | the immutable selected set is terminal or in exact custody, with zero residual count/digest and no newer-registry substitution |
| `closing` | residual | `cleanup_required` | immutable snapshot is preserved; only residual and reconciliation progress changes |
| `cleanup_required` | recover | `recovering` | one recovery generation owns cleanup while the immutable snapshot remains byte-identical |
| `recovering` | recovered or retry | `closed|cleanup_required` | selected-set absence is verified against the preserved snapshot, or that snapshot stays closed with residual progress |
| `closed` | reopen | `open` | expected-generation CAS reconciles the immutable prior selected set and candidate current registered set, preserves the prior snapshot, and publishes a separate successor open snapshot |

Stop-all is itself an observable operation and generation and takes an explicit
expected barrier generation. Same retained request id and
digest return the canonical receipt; another digest conflicts. Repeats while
closing, closed, cleanup-required, or recovering return typed idempotent facts.
Barrier status is a passive read. Dedupe survives crash but is bounded to 4,096
terminal receipts or 86,400 seconds. After pruning, the id is a new request;
the exact current daemon generation and expected-barrier CAS are re-evaluated.
The reopen response echoes request/digest, caller-origin evidence, expected,
prior, and resulting barrier state/generation, daemon generation, registry
revision, registered-set and residual count/digests, outcome, cleanup, and
reconciliation facts.

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

### Prior-generation transition closure

A daemon generation change never teleports a persisted record to terminal.
Each authority- or custody-bearing machine has an exact
`prior_generation_orphan -> cleanup_required` transition from every applicable
state:

| Machine | Required source states |
| --- | --- |
| operation | `prepared`, `starting`, `active`, `stopping`, `cleanup_required`, `recovering` |
| stream | `prepared`, `starting`, `active`, `stopping`, `cleanup_required`, `recovering` |
| tap | `prepared`, `active`, `expired`, `revoked`, `cleanup_required`, `recovering` |
| artifact | `transient`, `offered`, `retained`, `released`, `removed`, `cleanup_required`, `recovering` |
| claim-set transaction | `prepared`, `reserving`, `committed`, `rolling_back`, `cleanup_required`, `recovering` |
| per-resource claim | `prepared`, `active`, `releasing`, `cleanup_required`, `recovering` |
| multiplex broker | `prepared`, `starting`, `active`, `stopping`, `cleanup_required`, `recovering` |
| host barrier | `boot_reconciling`, `open`, `closing`, `closed`, `cleanup_required`, `recovering` |
| recovery | `idle`, `scanning`, `recovering`, `cleanup_required`, `blocked_unresolved` |

Boot recovery must consume those durable obligations through the recovery
machine. Process disappearance, EOF, a missing artifact pathname, an empty
subscriber observation, or a new daemon generation is not absence proof.
Terminal still requires mechanically verified absence or exact transferred or
retained custody.

## Tap semantics

A tap is an explicit child observation operation bound to one exact live parent
operation and one declared channel. It is observation-only and separately
bounded by bytes, time, queue, sampling, and output transport. It grants no
mutation, cancellation, signal, artifact-custody, or owner-kill authority.

All seven numeric bounds are mandatory and positive: rate, max items, max
bytes, max queue items, one-based sample stride, idle timeout, and duration.
Duration starts on a monotonic activation clock; only successful enqueue resets
idle timeout. Sampling precedes rate admission. Item/byte totals never exceed
their request. If the first eligible new item finds the FIFO at its queue
bound, intake stops before enqueue, only that newest item is rejected, existing
FIFO entries drain, and the tap records `queue_full`; the source is not
backpressured and no silent or continuing drop is allowed. Before `expire`, the
record persists the exact terminal reason and content-free requested-bound,
source, skip, enqueue, delivery, high-water, and overflow counters.

The control plane exposes live content-free metadata without a tap. Raw data is
available only while the explicit tap is active. AOS does not add tap output to
recent history and does not persist it unless the caller explicitly requests a
separate retained artifact under exact custody.

| From | Event | To | Meaning |
| --- | --- | --- | --- |
| `prepared` | open | `active` | exact parent/source generations, channel, rate, max items, max bytes, max queue items, one-based sampling stride, idle timeout, and duration all validate |
| `prepared` | reject or cancel | `terminal` | no observation channel opened |
| `active` | expire | `expired` | exactly one persisted `max_items_reached`, `max_bytes_reached_or_would_exceed`, `queue_full`, `idle_timeout`, or `duration_elapsed` reason stops intake before bounded FIFO drain |
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
| `recovering` | released custody verified, retained custody verified, absence verified, or retry | `released|retained|removed|cleanup_required` | only the persisted original-custody disposition may resolve, or bounded retry remains |

Every entry into artifact `cleanup_required` or `recovering` persists original
custody plus exactly one disposition: release verification, retention
verification, or removal verification. Validation/removal failure selects
removal; a prior released or retained record preserves its corresponding
custody disposition; interrupted cleanup preserves the existing field.
Recovery reaches `removed` only after absence is verified, `released` only
after the exact transfer receipt is reverified, and `retained` only after exact
identity/bounds/custody are reverified. Otherwise it returns to
`cleanup_required` with durable retry/blame. These outcomes can never collapse.

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
Its actions call the same public M2 daemon-IPC entrypoints as CLI and internal
Canvas; maintained public SDK projections remain M6. Ordinary actions cannot
widen a live captured peer's controllable set. The status host invokes stop-all
only; barrier status and reopen remain live transport-peer operations.

The projected mechanical fields are operation id, adapter-selected capability
id, state, generation, authenticated owner root and peer, adapter-registry
revision, registered-set count/digest, terminal outcome, trigger, blame, and
cleanup/residual facts. Client, agent, project, task, run,
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
action is admitted only from the mechanically authenticated daemon-owned status
host with exact daemon/status-host and item generations, effective UID,
descriptor revision, and action sequence. Display text, asserted lineage, and
an unbound same-UID claim never authenticate that action.

That authenticated UI origin grants no control. An ordinary action is re-
admitted against the mechanically authenticated peer's controllable owner set.
For always-available break-glass, the daemon-owned status host binds its exact
current generation and effective UID as the live local caller and invokes the
same public host-control entrypoint used by daemon IPC, CLI, and Canvas. The status item is
neutral observation and authenticated action input, not an authorization source,
durable role, special principal, or human-intent class.

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

The canonical M2 milestone closes 19 deliverables, 15 exit gates, 70 path refs,
and 23 proof refs. Its path union includes the eight current operation/stream/
tap/artifact/barrier/recovery schemas; registry/control/recovery/store/state;
split claim transaction, per-resource claim, and broker owners; microphone,
status, and Canvas adapters; current daemon request/response/event schemas and
IPC docs; native `$AOS_PATH __operation` command and main dispatch; 41/49
authored owners; exactly two generated aggregates; maintained
`docs/api/aos.md` plus `docs/api/aos-capabilities.md`; internal Toolkit
runtime/component/model owners; and proof
registry/workflow routing.

The union also closes the current microphone dispatch seam:
`src/shared/external-command-dispatch.swift`, authored external 15-listen route,
authored AOS 12-listen help, `scripts/aos-tell-listen.mjs`,
`scripts/lib/aos-voice-follow.mjs`, `scripts/lib/aos-daemon-client.mjs`,
`src/daemon/voice-transport.swift`, segmented capture, microphone
authorization, audio playback, the v1 external-command manifest schema,
generator, Swift and help decoders, stable generated aggregate,
command-surface documentation/skill/DOX, canonical proof index and fragment,
workflow router, active authority map, and affected installed projections.
Frozen v0 remains byte-exact baseline evidence. The aggregate alone moves to
wire schema version 2; source fragments remain version 1; exactly listen gains
the optional spawn registration. The affected owners explicitly include
`scripts/stage-browser-companion-runtime.mjs` and
`scripts/stage-work-record-runtime.mjs`. Both require source and staged wire
version 2. Browser staging retains path keys only and rehydrates exact command
objects from the current v2 aggregate, while Work Record staging rejects any
non-v2 source; neither may preserve or rewrap stale command objects. No dual
reader or parallel aggregate exists.

The operation schema owns the closed resource records; no ninth M2 schema is
implied. M3 owner paths are the current desktop-pixel
source and lifecycle plus proposed recording schema, adapter, encoder, geometry
owner, AOS command source, external route, and generated aggregates/help. A
Later-milestone `proposed` paths are not claimed to exist in current truth.

M2 has 23 exact proof refs: the five-lane schema/static/fake/native-compile/
separately-authorized-native-live ladder plus focused owner-root, external-
dispatch binding, resource-claim, voice no-preemption, host-control, Canvas,
and internal Toolkit runtime/model/component proofs, plus frozen-v0 and active-
v1 manifest schema, generation, broad-dispatch, proof-index, workflow-router,
and installed-projection proofs. The command-surface proof fragment owns the
manifest schema/generation/dispatch group; the operation-control fragment owns
only operation-binding proofs. M3 retains its five-lane
ladder. Static proof binds schemas/source/manifests. Fake proof covers
lifecycle, failure, control, custody, and recovery. Native compile proof
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
2. **M2 — smallest reusable control slice:** use the ADR 0044 accepted ordinary
   owner root and same-effective-UID host-control bindings; implement peer
   identity, operation/lineage/stream/tap/artifact/barrier/recovery schemas,
   closed exclusive/multiplexable resource claims, explicit prior-generation
   transitions, prepared registry, list/inspect/status/recent, cancel, kill-one,
   one composable owner-intersection kill, bounded tap and artifact custody,
   host stop/barrier-status/reopen, terminal/residual behavior, the existing
   microphone adapter, dedicated internal red status projection, and internal
   Canvas operation view. Complete the external Node microphone spawn binding,
   retire implicit voice barge-in preemption, and scope host receipts to the
   exact registered-set revision. Status break-glass binds the daemon/status-
   host generation and calls the same public stop-all entrypoint; public SDKs
   remain M6.
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
sources, generated aggregates/help, schemas/API and any milestone-owned SDK projection, tests, proof
registry, and workflow routing atomically. Generated command/help work is never
deferred to M8. M8 reorganizes skills only. M9 may compose existing CLI/IPC/SDK
atoms from arbitrary Python, TypeScript, or shell; any new command still follows
the same atomic rule.

## M2 proof design

M2 starts offline and deterministic:

- schema tests reject unknown fields, invalid transitions, forged lineage,
  asserted-filter widening, stale operation/artifact identity, terminal state
  with residual authority, missing prior-generation transitions, partial claim-
  set admission, successor-generation release, unbounded request dedupe,
  registered-set drift, and host-stop admission races;
- pure model tests prove prepared-before-authority, one durable terminal owner,
  filter intersection, bounded recent history, stop-barrier generation, tap
  observation-only behavior, artifact custody transitions, canonical all-or-
  nothing claim reservation, deterministic content-free conflict receipts, and
  exclusive/multiplexable fan-out semantics, including microphone busy conflict
  without voice-output preemption;
- fake peer/process/socket tests prove immediate-peer audit-token/PID-generation
  bindings, double-sampled proc-generation ancestor edges, exact image and
  spawn-record skips, external Node parent-only intent, official signed-image
  admission, post-admission in-memory module delivery, tokenless peer
  finalization, abandon/expiry cleanup, and nearest
  verified non-AOS ancestry stopping at unverified nodes; they also prove live same-
  effective-UID reauthentication immediately before signal/cleanup/host
  control, and the daemon/status-host break-glass caller binding;
- the existing microphone authorization/capture harness proves the first real
  adapter with injected authorization and fake audio buffers, without touching
  live microphone, TCC, native UI, or the shared daemon;
- static source/manifest/schema/generator/API convergence tests prove the
  optional external-dispatch registration and 41/49 command packet move
  atomically and that no target claim outruns current executable truth. M2
  claims no maintained public SDK or skill implementation.

The M3 ladder adds static ScreenCaptureKit/AVAssetWriter/schema and generated-
grammar binding, fake video/system-audio/microphone/encoder/geometry/custody/
failure tests, native compile proof with no capture authority, and separately
authorized live screen/audio/microphone/TCC/status/artifact/crash acceptance.

Live microphone, screen capture, browser, native UI, TCC, build, packaging, and
installation proof remain separately gated by later owner authority.
