# ADR 0044: Operation Owner Roots, Host Control, And Resource Claims

**Status:** Accepted
**Date:** 2026-08-16
**Program:** `aos-sovereign-capability-substrate-v1`
**Amends:** ADR 0043's mechanically authenticated owner and host-stop clauses
**Accepts:** the two owner bindings left open by the Milestone 1 capability
ledger and first-vertical-slice contract
**Governed by:** ADR 0040's ambient-authority boundary and ADR 0043's
policy-free operation control plane

## Context

ADR 0043 requires every nontrivial AOS-owned operation to be observable,
revocable, attributable, and cleanup-correct without turning the registry into
an authorization layer. Milestone 1 deliberately left two mechanical bindings
open: the maximum ordinary controllable set and admission to host-wide stop.

Those bindings must be settled before operation runtime source is authored.
The first implementation must also define how an AOS adapter admits an
exclusive or multiplexed singleton resource. Otherwise two operations can both
appear prepared while a capability-specific last writer silently steals native
authority, or crash recovery can jump a persisted record directly to a clean
terminal state without proving what happened to the prior generation.

## Decision

### Ordinary owner root and adapter skips

At local socket acceptance AOS binds the immediate Darwin peer through
`LOCAL_PEERTOKEN`: audit token, effective UID, PID, and PID generation. Audit
tokens are available for that immediate socket peer only. Ancestors are bound
instead by double-sampled `proc_bsdinfo` start time, effective UID, a
same-observation child/parent edge, and exact code identity. Both child and
parent start-time samples and the edge must remain stable across the observation
window. AOS does not require or fabricate an ancestor audit token.

AOS walks outward and selects the nearest mechanically verified non-AOS
ancestor. It may skip an AOS node only through one of two closed proofs:

1. an exact registered AOS image proof with generation-bound child and parent,
   stable edge, adapter-registration revision, executable identity, and digest;
   the child audit token is additionally required only when that node is the
   immediate socket peer; or
2. a durable daemon spawn record published before helper authority, bound to
   the operation generation, adapter-registration revision, executable digest,
   and generation-stable child/parent edge. This record is a closed evidence
   union: its immediate-socket-peer variant requires the observed child audit
   token and PID generation, while its verified-ancestor variant uses
   double-sampled public process generation and forbids an unavailable child
   audit token.

For the current external Node microphone route, native external dispatch first
publishes a durable spawn intent and prepares the operation plus exclusive
microphone claim. The returned opaque token is parent-only: it is used for
child admission or abandon and never enters child environment, argv, stdin,
module source, finalization, durable public state, or a receipt. The dispatcher
starts Node blocked on an empty module pipe. Before any reviewed source or
binding material reaches that child, the parent requests admission with the
child PID. AOS verifies the exact authenticated parent generation and parent
edge, the child PID generation, the live mapped main-executable vnode, and the
live SecCode guest. The interpreter must satisfy the Apple generic Developer ID
anchor, signing identifier `node`, Node.js Foundation team `HX7739G8FX`, and
hardened-runtime flag. Dynamic validity plus the exact intent-bound 20-byte
SHA-256 platform CDHash (`sha256_truncated_cdhash_20_bytes`), device, and inode
must match or admission fails closed.

Only after that admission is durable does the dispatcher write a deterministic
in-memory ESM bundle built from the already raw-byte-verified entry script and
two reviewed helper modules. No script/helper pathname or binding token reaches
the child. The child's first operation request is tokenless finalization on its
microphone socket. AOS resolves exactly one admitted record from that live peer
PID generation and parent edge, revalidates executable and argv-shape evidence,
and consumes the record once before microphone authority. A normalized repo-
relative authored identity remains transient resolver input only; durable
intent, admission, finalization, receipt, and proof records retain content-free
digests. Raw script/helper identity, path, basename, argv, or module bytes are
forbidden. Parent-authenticated abandon, a 30-second daemon expiry, and boot
recovery terminalize an unfinalized prepared operation and release its exact
claim. `AOS_EXTERNAL_DISPATCH_PARENT_PID` remains forbidden as authority; a
dispatcher-injected PID may be used only as an immediately deleted, untransmitted
lifecycle assertion so death before module evaluation fails closed.

The existing external-command manifest v0 schema is frozen decision history and
remains byte-exact at revision `7aada1cb4d7a046a2b99b1b24470115eefc82224`
with SHA-256
`246025ae1019fcf188a257da3da5f138773861475ddb904b8337fc4cce22320e`.
M2 publishes a v1 successor instead of amending v0. Authored source fragments
remain schema version 1, while the stable generated aggregate path moves to
wire `schema_version: 2` and permits one closed optional
`spawn_registration`. Exactly the `listen` route carries a closed
`listen_microphone_v1` activation predicate; only an invocation matching that
authority-bearing microphone grammar prepares an operation/resource claim and
enters dynamic child admission. Nonmatching `listen` invocations create no M2
operation intent or claim. The generator validates its source identity, raw entry-script digest,
the exact reviewed dependency set and raw dependency digests, semantic source
revision, argv-shape digest, and native `/usr/bin/env node` resolution policy.
Only the content-free reviewed-dependency-set digest crosses spawn intent,
admission, durable finalization, and receipts. The dispatcher verifies the
exact closed set beneath the canonical AOS root, then launches those already
verified bytes through the admitted child's in-memory module bundle. Swift
dispatch and the help proxy become v1-only in the same
atomic cutover; no dual reader, translation layer, or parallel aggregate is
accepted, and every partial old/new combination fails closed. The browser and
Work Record staging projections are atomic cutover owners too. Both require a
wire-v2 source and output. Browser staging may retain path keys only and must
rehydrate every retained command from the current v2 aggregate; rewrapping a
stale retained command object is forbidden. Work Record staging rejects v0 or
otherwise stale input.

If a node or edge is unverified, stale, or raced, AOS selects the conservative
immediate mechanical boundary or rejects. It never skips uncertainty to widen
the owner root. Caller-asserted client, agent, project, task, run, skill,
target, or capability labels are attribution and intersection filters only;
they never add operations. Every signal, escalation, cleanup, claim release,
or barrier action revalidates the exact generation required by that action.

### Three resource lifecycles and voice non-preemption

Resource admission has three separate durable machines:

- a claim-set transaction records the complete canonical request set and performs the one
  atomic linearization;
- one per-operation/per-resource claim records each admitted lease; and
- one multiplex broker generation records native ownership and its exact
  subscriber-set revision, count, and digest.

At one adapter-registry revision, an adapter publishes a canonical declaration
for each unique stable resource key. The declaration binds adapter id and
registration revision, key, `exclusive` or `multiplexable` mode, declaration
digest, and a positive finite fanout bound only for multiplexable resources.
Changing a key owner, mode, or fanout creates a new registry revision and
declaration digest. Declaration, registered-operation, selected-operation, and
subscriber-set digests use SHA-256 over UTF-8 RFC 8785 canonical JSON with the
closed `aos:<digest-domain>:v1\n` separator, exact member fields, canonical
sort order, lowercase 64-hex output, and a count equal to the member-array
length. A mixed multi-claim set is sorted by canonical resource key and reserves
all claims and required broker generations at one compare-and-swap point using
the barrier generation, adapter-registry revision, declaration-set count and
digest,
every resource generation and declaration digest, and each multiplex
resource's expected broker generation plus subscriber-set revision, count, and
digest.
Success atomically publishes every claim with the committed transaction id and
digest plus the exact registry/declaration snapshot, together with every resulting
broker generation, subscriber revision, count, and digest. Conflict rolls back
every inert provisional record and
retains none. Receipts are content-free and deterministically ordered. Barrier
close wins races. There is no implicit queue, priority, fairness, stealing,
last-writer-wins, or preemption; the caller explicitly retries, cancels, or
kills. The same mechanically derived owner does not bypass exclusivity.
Reattach requires the exact
resource, operation generation, and adapter-declared token.

A nonlast multiplex subscriber release terminals that operation's claim while
the broker records a durable subscriber detach and survives. Last release
enters broker cleanup. Host stop reaches every nonterminal broker state.
Attach, nonlast detach, and last detach each compare-and-swap the exact broker,
resource, declaration, and subscriber-set generations, count, and digest.
Attach additionally requires the current registry/declaration snapshot to
match the committed claim-set transaction; it cannot be admitted as a stale
standalone subscriber. Detach uses the exact snapshot pinned to the claim.
Each mutation then
atomically publish the claim result and resulting subscriber revision, count,
digest, and broker state. Attach cannot exceed the declared fanout; last detach
requires expected count one and publishes count zero plus `stopping` at one
linearization point.
Cleanup releases only the exact resource key and generation after absence proof
or an exact surviving broker/subscriber proof; stale cleanup cannot mutate a
successor.

M2 registers only `microphone-capture-adapter` as an operation-plane owner of
the exclusive `voice_io_native_session` claim. Current speech and audio output
remain legacy reservation sentinels on that same native session: they
participate atomically in microphone admission conflict and cannot preempt or
be preempted, but remain outside registered stop-all coverage until a later
adapter migration. Capture while output is active and output while capture is
active return typed busy conflict. The current implicit
`outputToCancel?.cancel(reason: "barge_in")` behavior must be retired by the
implementation slice; it is not an accepted policy or preemption mechanism.

### Prepared records and prior-generation recovery

Authority or custody cannot precede its durable record. Operation, stream, tap,
claim-set transaction, per-resource claim, and multiplex broker use their
`prepared` state. Artifact uses `transient` before caller custody. Host barrier
uses `boot_reconciling` before admission can open. Recovery uses `idle` before
its scan. Their authority/custody transition keys and durable facts are closed
by the capability ledger and static proof.

Operation, stream, tap, artifact, claim-set transaction, per-resource claim,
multiplex broker, host barrier, and recovery expose explicit prior-generation
transitions from every nonterminal durable state, including
`cleanup_required` and `blocked_unresolved`. Restart never teleports state.
Terminal requires verified absence or exact transferred/retained artifact
custody; uncertainty remains durably nonterminal.

Artifact cleanup and recovery persist the original custody state and one of
three closed dispositions before entering `cleanup_required` or `recovering`:
release verification, retention verification, or removal verification. Each
has its own event, guard, and destination. Release or retention can never be
collapsed into removal. Claim-set recovery likewise persists either
`rollback_pending` or `commit_pending_handoff`. A crash while reserving derives
that field only from the complete atomic commit marker; absent such a marker it
is rollback. Verified rollback terminates `rejected`; only a verified complete
commit handoff terminates `succeeded`.

### Registered-set host control

Host stop-all, passive barrier status, and barrier reopen form a distinct
public same-effective-UID local scope. The predicate is re-evaluated per
request; it is not a durable role, token, executable class, special principal,
presentation privilege, asserted lineage, or human-intent claim.

M2 host operations cover the complete registered operation-plane set at one
exact adapter-registry revision. Stop and status receipts carry that revision
plus registered-set count and digest. M2 registers the microphone adapter; it
does not claim control or zero residuals for unadapted legacy daemon
capabilities. Later adapter milestones atomically advance the revision and
converge coverage toward the complete privileged and managed surface.

Every request has a request id and canonical parameter digest. Expected daemon
generation, connection epoch, caller origin, and caller evidence are attached
by the server after same-socket bootstrap; the CLI does not invent a daemon-
generation flag. Retained dedupe receipts are generation-independent and are
looked up before current generation or compare-and-swap validation. The index
is crash-durable but bounded to 4,096 terminal receipts or 86,400 seconds. That
canonical replay guarantee ends when a receipt is pruned: an evicted id is a
new request and AOS does not pretend it can identify arbitrary pruned ids.
Mutating host requests therefore carry an explicit expected barrier generation;
an old stop-all or reopen request fails the current barrier CAS rather than
repeating its former side effect. Same retained id with another digest returns
an idempotency conflict.

Boot begins admission-closed and reconciles durable records before open.
Stop-all remains always available from `boot_reconciling`: after retained
lookup it validates the exact current daemon/barrier generation and last
durable immutable snapshot, then returns `recorded`,
`reconciliation_in_progress`, or `store_blocked` while the barrier remains
closed. A recorded stop is bound to that snapshot but does not claim cleanup;
the other outcomes claim neither cleanup nor absence. The status-item action
therefore remains available without inventing reconciled or residual-free
state.
Stop-all is itself an observable operation/generation receipt and closes the
barrier before selecting or signaling the registered set. Repeats while
closing, closed, cleanup-required, or recovering return typed idempotent facts.
The close transition captures one immutable barrier snapshot: barrier and stop
operation generations, adapter-registry revision, registered-set count/digest,
selected-operation count/digest, and snapshot digest. Those exact bytes survive
drain, cleanup, restart recovery, passive status, and state-idempotent repeats;
residual and reconciliation progress is separate mutable state. A new registry
revision is only a candidate until a successor open generation. Retained
request lookup precedes generation checks, but every new or pruned request must
pass current daemon and expected-barrier generation CAS before even an
idempotent state result can be published.
Barrier status is passive. Reopen requires an explicit expected barrier-
generation compare-and-swap and zero residuals for the exact registered set and
registry revision, plus reconciliation of the candidate current registry. Its
content-free receipt preserves the complete prior immutable stop snapshot and
separately publishes the resulting open generation, registry revision,
registered-set count/digest, and open-snapshot digest, along with request,
caller-origin, residual, outcome, cleanup, and reconciliation facts.

M2 executable projections are daemon IPC, CLI, the daemon-owned internal status
break-glass host, and an internal Canvas operation view. Status reauthenticates
its exact daemon/status-host generation and effective UID through the same
public stop-all entrypoint; its UI origin creates no extra authority. Ordinary
Canvas control requires a currently live captured peer and becomes display-only
when that connection disappears. A status-opened Canvas may use the
server-injected status-host context for stop-all only and cannot impersonate an
ordinary owner. Public maintained TypeScript and Python SDK projections remain
M6; the M2 daemon IPC is their future canonical programmatic contract.
CLI and direct daemon IPC actions always authenticate the current live transport
peer. Captured-peer continuation applies only to ordinary Canvas controls.

### Command grammar and publication boundary

The reviewed M2 command surface is generation-bound and composable:

- `operation list` and `operation recent` accept optional intersections for
  capability id, client, agent, project, task, run, skill, target, and asserted
  capability label;
- `inspect`, `status`, `cancel`, and `kill` require operation id and generation;
- one `operation kill-owner` accepts the same intersection grammar;
- `operation tap` is observation-only and caller-bounded by operation
  generation, metadata-or-data channel, rate, sampling stride, queue size,
  item count, byte count, idle timeout, duration, and optional follow mode;
- `operation artifact reveal|remove|release|retain` requires artifact id and
  generation; and
- `stop-all --barrier-generation <n>`, passive `barrier-status`, and
  `reopen --barrier-generation <n>` use the host-control contract above.

Every tap requires all seven positive finite numeric bounds. A monotonic clock
starts duration at activation; only a successful enqueue resets idle timeout.
Sampling uses a deterministic one-based stride before rate limiting. Item and
byte limits cannot be exceeded. On the first eligible item observed while the
bounded FIFO is full, AOS stops intake before enqueue, rejects only that newest
item, drains the existing FIFO, and terminates with typed `queue_full`; it does
not backpressure the source, silently drop, or continue dropping. Content-free
receipts publish requested bounds, source/sample/rate counters, enqueue and
delivery counts/bytes, queue high-water, overflow rejection count, and the
persisted terminal bound reason before the tap `expire` transition.

Authored help and route owners are
`manifests/commands/source/aos/41-operation.json` and
`manifests/commands/source/external/49-operation.json`. The external route runs
`$AOS_PATH __operation`; native owners are `src/commands/operation.swift` and
`src/main.swift`. Exactly the two generator-owned aggregate manifests and the
maintained `docs/api/aos.md` and `docs/api/aos-capabilities.md` update atomically
with implementation.

The external-manifest v1 cutover additionally moves the v1 schema, `listen`
source, generator, stable generated aggregate, Swift and help decoders,
command-surface documentation, canonical proof-fragment index, command-surface
proof fragment, workflow rules/router, and affected installed projections at
one publication boundary. The command-surface fragment owns v0 freeze, v1
schema, generation, and broad dispatch proof. The operation-control fragment
owns only the new operation-binding proofs. Frozen v0 remains a baseline proof,
never an active decoder contract. The affected projections include
`scripts/stage-browser-companion-runtime.mjs` and
`scripts/stage-work-record-runtime.mjs`: both require source and staged wire
version 2. Browser retention stores path keys and rehydrates their exact
commands from the current v2 aggregate; it cannot rewrap stale retained command
objects. Work Record staging rejects any non-v2 source.

This accepted packet changes authority and target contracts only. It creates no
operation runtime, command, schema, SDK, Toolkit export, status action, Canvas
action, adapter registration, or proof of live behavior. Current source,
authored manifests, generated aggregates, API docs, package exports, and runtime
readback remain executable truth until the implementation slice lands.

## Consequences

- Immediate peers use the audit token actually available at the socket;
  ancestors use generation-stable public process evidence rather than a
  fictional token.
- External helpers share the caller root only after exact spawn-intent
  finalization, not through an environment parent PID.
- Host receipts are revision-scoped and honest about the M2 registered set;
  unadapted legacy capabilities remain outside M2 control.
- Resource transactions, claims, and brokers can be implemented and recovered
  independently without partial admission or implicit preemption.
- Crash, orphan, replay, barrier, and custody uncertainty remain observable and
  fail closed.
- Authority publication stays distinct from runtime implementation.

## Rejected alternatives

- Requiring ancestor audit tokens is impossible through ordinary libproc and
  would make the accepted owner root unimplementable.
- Immediate-peer-only ownership fragments verified AOS adapters, while trusting
  basename, path, argv, environment, PID, PGID, or asserted lineage widens
  authority without proof.
- A dedicated executable class, durable host token, or UI-origin privilege
  contradicts ambient local authority.
- Treating stop-all as every current daemon subsystem would make M2 receipts
  false; the registered adapter set is the mechanically closed scope.
- Same-owner steal, barge-in cancellation, implicit queues, priorities, or
  automatic preemption add policy and break generation-safe cleanup.
- Unbounded dedupe retention is not a viable durable contract.
- Treating process exit or restart as cleanup makes residual authority and
  custody unobservable.
