# AOS Sovereign Capability Remodel Disposition Ledger

Program: `aos-sovereign-capability-substrate-v1`

Status: Milestone 2 executable control plane plus bounded M3A fixed video, M3B
optional system audio, and M3C-V2 optional microphone-track recording candidate
against accepted base `412571e1927c3d76d0c1e2605a559f1a80389f4a`.
The current unpublished M3C-V2 candidate adds four exact track selections, one
shared daemon microphone-session owner, atomic reuse of the existing exclusive
microphone resource, pre-common-epoch callback normalization from final selected
track truth, and exact shared-owner partial-start cleanup without live native
authority.

Canonical target authority is
`docs/adr/0043-sovereign-capability-substrate-and-operation-control-plane.md`,
amended by accepted
`docs/adr/0044-operation-owner-roots-host-control-and-resource-claims.md`.
The schema-backed machine authority is
`docs/dev/aos-sovereign-capability-authority-v1.json`. This ledger is its human
review projection.

## Reading rule

Milestone 2 now changes capability and authority atomically. Current source,
command-source manifests, generated help, schemas, API docs, tests, and runtime
readback are the executable contract; M2 marks only the operation-plane owners
and the microphone/status/Canvas capability rows current. Every unaffected M1
capability row remains byte-for-byte baseline truth.
A row marked Rewrite or Retire is declared burn-down debt; it is not a claim
that the current implementation has already changed.

The paired Sigil authority is ADR 0021 at
`docs/adr/0021-sigil-sovereign-workflow-composition.md`, keyed by the same
program identifier in `https://github.com/Ch-osctrl/sigil`. Its publication
state is `landed` at reviewed Sigil revision
`227382c1bcbdab56f551a85a69b0609eebbdfa0c`; the path is external metadata,
not an AOS-local repository path. The AOS-first paired publication sequence is
complete. The operation plane currently registers microphone plus the bounded
M3A/M3B/M3C-V2 fixed display/window/region adapter with mandatory video and
independently optional system audio and microphone. It does not implement
followed geometry, full M3, M6 SDK, M7
managed-tool, or Sigil workflow capabilities.

## Milestone 1 capability ledger

`aos-privileged-capability-ledger-v1.json` is the closed 32-row current/target
inventory over native primitives, public CLI/IPC/SDK/Toolkit reachability,
snapshot and stream semantics, operation control, artifact custody, platform
limits, and proof. Its schema owner is
`../../shared/schemas/aos-privileged-capability-ledger-v1.schema.json`; its
non-runtime state-machine and vertical-slice contract is
`../design/aos-sovereign-first-vertical-slice-contract.md`. Source presence is
not public reachability, absence proof is not capability proof, and a target
row is not executable truth.

The 32nd row records the existing internal canvas host action bus separately
from Canvas surface lifecycle. The ledger binds every non-absent CLI form to
its authored AOS help source and authored external route source; generated
aggregates are never owners. Proof items declare static, fake, native-compile,
or separately authorized native-live execution and do not conflate compilation
with TCC acceptance. Machine-bound M2/M3 path and proof ladders use typed
`current`, `proposed`, `generated`, and `external` references, so future files
are not falsely required to exist in M1.

## Accepted Milestone 2 authority bindings

ADR 0044 closes the two pre-source owner decisions. Ordinary control binds the
immediate socket peer's Darwin audit token, effective UID, and PID generation.
Nearest mechanically verified non-AOS ancestry uses double-sampled process
generation, effective UID, a stable child/parent edge, and code identity; it
stops conservatively at an unverified node rather than inventing an ancestor
audit token. Exact AOS-image skips require that evidence, or a generation-bound
daemon spawn record. The invocation-scoped microphone route first prepares an
operation and claim, then uses its parent-only token to admit or abandon a
child. Admission binds dynamic Node.js Foundation SecCode identity, platform
CDHash, mapped device/inode, child PID generation, parent edge, the exact
reviewed dependency-set digest, canonical argv shape, and operation generation.
Only after durable admission does the dispatcher write the reviewed in-memory
module bundle; tokenless same-socket child finalization consumes that exact
record before microphone authority. The authored normalized repo-relative
script identity and the two reviewed dependency identities are transient
resolver inputs; durable intent, admission, finalization, receipt, and proof
retain content-free digests and forbid raw script/dependency identity, path,
basename, module bytes, or the parent token. Parent abandon, 30-second expiry,
and boot recovery terminalize unfinalized prepared work and release its claim.
`/usr/bin/env node` is governed by an authored executable-resolution policy and
the exact official signing boundary; its transient absolute path is never
durable or public. Caller-asserted lineage is
attribution and may only filter within the mechanically established set.
The maintained microphone command now supplies the closed nine-field
`asserted_attribution` request object at external-intent creation. Validation
precedes operation, claim, and spawn effects; omission is empty, the value is
invocation-scoped, and no attribution field can supply mechanical authority.

The frozen external-command manifest v0 schema remains byte-exact at the M1
baseline. M2 adds a v1 schema and atomically moves the stable generated
aggregate to wire schema version 2; authored fragments remain version 1.
Exactly external `15-listen` gains the optional microphone spawn registration
with closed `listen_microphone_v1` activation; nonmatching invocations gain no
operation, claim, token, or dynamic admission.
Generator, Swift dispatcher, help proxy, command-surface proof ownership,
canonical proof index, workflow router, and installed projections move
together; no v0 mutation, dual reader, translation, or parallel aggregate is
allowed. Browser and Work Record staging are exact atomic owners: both require
wire v2, browser retention rehydrates path keys from the current v2 aggregate
instead of rewrapping stale command objects, and Work Record rejects non-v2
input.

Host stop-all, passive barrier status, and expected-generation reopen are one
distinct public same-effective-UID local control scope. M2 ships the daemon IPC
and CLI, an internal status-item stop-all/reopen projection, and an internal Canvas
projection. CLI and direct daemon IPC requests authenticate the current live
transport peer. Only ordinary Canvas requests may continue through a currently
live captured peer, and become display-only when it disappears. The always-
available status-item break-glass actions bind the exact
daemon/status-host, item, descriptor, and displayed barrier generations plus
effective UID and an exact lease epoch, then invoke the same public stop-all/
reopen entrypoints serially off AppKit's main thread. Lease retirement rejects
new admissions without waiting for admitted work. Stop All and Reopen
confirmations are presentation only. A status-opened Canvas may reuse that context for host stop-all
only, never ordinary owner control. Its UI origin does not create a role.
Maintained public TypeScript and Python SDK projections remain M6 and consume
the M2 daemon IPC as their canonical programmatic contract.

Host receipts identify the exact adapter-registry revision, registered-set
count, and content-free digest. M2 registers only the microphone adapter; it
does not claim control over unadapted legacy daemon subsystems. Request replay
is durable but bounded to 4096 terminal receipts or 86400 seconds. Retained
receipts replay before current generation/CAS validation. After pruning the id
is a new request; stop-all and reopen require expected-barrier-generation CAS,
so an old mutation cannot repeat across a later reopen.

Stop-all remains available during `boot_reconciling`. It validates the expected
daemon/barrier generation and last durable snapshot and returns `recorded`,
`reconciliation_in_progress`, or `store_blocked` while admission stays closed.
No boot-time result falsely claims cleanup or residual absence; status
break-glass remains enabled.

Barrier close persists an immutable snapshot of barrier and stop-operation
generations, registry revision, registered and selected set count/digests, and
snapshot digest. The same bytes survive drain, cleanup, recovery, restart,
passive status, and repeats. Reopen preserves that prior snapshot and
separately publishes the reconciled next-open snapshot.

At one registry revision, adapters publish unique resource declarations that
bind adapter id/revision, key, mode, declaration digest, and multiplex fanout
bound. Operations may mix `exclusive` and `multiplexable` claims.
Operations canonical-sort their complete claim sets and reserve them all-or-
nothing at one linearization point; failed admission retains none and returns a
deterministically ordered content-free conflict receipt. Claim-set transaction,
per-operation/per-resource claim, and multiplex-broker subscriber lifecycles
remain separate. Multiplex admission compares expected registry/declaration/
resource/broker generations, complete declaration-set count/digest, and
subscriber revision/count/digest. Transaction, claim, and broker records pin
that registry/declaration snapshot plus committed transaction id/digest.
Attach revalidates the current snapshot against that commit; detach uses the
snapshot pinned to the claim. Admission then atomically publishes the resulting generation,
revision, count, and digest. Artifact recovery persists distinct released,
retained, and removed dispositions; claim-set recovery persists rollback-
pending versus committed-handoff disposition and cannot convert rejection into
success. AOS supplies no implicit wait queue, priority, or preemption.
Operation, stream, tap, artifact, claim-set transaction, resource claim,
multiplex broker, host barrier, and recovery machines expose explicit prior-
generation transitions, and cleanup remains exact-key-and-generation bound.
Microphone capture is registered on the exclusive `voice_io_native_session`;
speech and audio output remain legacy admission sentinels, cannot preempt or be
preempted, and stay outside registered stop-all until later adapter migration.
M3A additionally registers fixed screen video on the exclusive
`screen_capture_native_session` resource and reuses the desktop pixel broker's
exclusive producer lease, so warm snapshots and recording cannot overlap.
M3C-V2 conditionally consumes the existing exclusive
`voice_io_native_session` declaration in the same screen-operation claim-set.
Segmented capture and screen recording delegate input-tap lifecycle to one
shared daemon `AVAudioEngine` session owner; no third adapter, resource key, or
registry revision exists. A segmented start attempt that throws still consults
and boundedly retries that shared owner. Neither operation terminalization nor
claim release treats authority as absent until the owner proves exact tap and
engine absence.

The current public tap form remains parameterless apart from transport-added
request identity/digest and returns exact `OPERATION_TAP_UNAVAILABLE`.
Artifact forms require exact artifact id/generation; the recording producer
supports reveal, remove, and same-volume release after owner/file-identity
revalidation, while retain returns exact
`OPERATION_ARTIFACT_RETAIN_UNAVAILABLE`. Producer-less selectors fail closed.
Each artifact action rejects extra keys and wrong types before effects. Release
persists its exact generation, source identity, destination path/parent
identity, and phase before mutation, then deterministically recovers as
released, rolled back, or explicit residual truth. Release/remove admission is
atomic on the same artifact record. Recording startup has a finite generation-
bound native owner handoff under one absolute native-start/common-media deadline;
delayed failure after active evidence still requires one settled stop. Output
registration availability remains distinct from positive-byte first-sample
truth with positive count and bytes. Shared-deadline settlement classifies every
missing selected track. A media callback failure before the common epoch is
normalized from that final selected-track summary in either callback order,
with video then system-audio then microphone terminal precedence; permission,
authorization, setup-unavailable, and resource-conflict failures raised before
native startup preserve their exact typed result. Written-video frame count and
total artifact bytes validate against the exact per-track summary independently,
so ready audio can advance byte progress under video-input backpressure.
Writer-global failure marks every selected track. The generic operation
admission transaction persists recording identity,
requested bounds, zero progress, and the exact request-selected initial track
summary in one save before stream, artifact, claim, broker, native, writer, or
file authority. Preparation failure and boot recovery retain that summary, and
there is no later initial-summary backfill. Stop closes frame admission and
drains only its pre-boundary set, and terminal success requires a nonzero frame
count plus positive bytes on every selected finalized track and a finalized
nonempty artifact with the exact selected-track media identity. Public screen
progress and terminal truth require their exact track summary; failure is typed,
and retained custody remains exactly unavailable through the public response.

## Disposition ledger

| Asset or authority | Current truth | Disposition | Authority action | Later exit gate |
| --- | --- | --- | --- | --- |
| `docs/adr/0015-aos-tcc-capability-broker-boundary.md` | Stable TCC identity and privileged fact/action/stream broker; policy belongs above native code. | Expand | ADR 0043 makes mechanically complete supported privileged exposure the target; hash-preserve the ADR 0015 body. | Native and managed surfaces expose every supported primitive through stable IPC/SDK contracts. |
| `docs/adr/0040-ambient-authority-raw-observation-and-target-handles.md` | Ambient authority, raw admitted facts, caller transforms, exact Observation Ref/Locator mechanics. | Expand | ADR 0043 extends the rule to raw transports and complete managed-tool grammar; hash-preserve the ADR 0040 body. | All admitted channels are fidelity-first and every transform is explicitly caller-owned. |
| `docs/adr/0041-managed-playwright-companion-runtime.md` | Strong pin, integrity, store, session, guardian, cleanup, and receipt model coupled to a fixed public grammar and broad feature non-goals. | Rewrite | Mark partially superseded in the ADR index; hash-preserve the old body as decision history. | Keep lifecycle mechanics while atomically replacing fixed wrappers with raw argv/stdin/stdout/stderr/artifact transport for the pinned upstream executable and environment. |
| `docs/adr/0042-host-and-gateway-move-to-sigil.md` | AOS owns capability-layer packages; Sigil owns orchestration. | Keep | Reuse as the cross-repo ownership boundary. | Reviewed AOS/Sigil pins prove no orchestration returns to AOS. |
| `docs/adr/0044-operation-owner-roots-host-control-and-resource-claims.md` | Accepted amendment to ADR 0043 for the two M2 owner bindings, generation-bound external dispatch, nine-machine prior-generation recovery, registered-set host receipts, bounded replay, and split claim-set/resource/broker mechanics. | Keep | Preserve pre-0044 ADR bodies; publish the executable M2 owners and reviewed-dependency binding under this amendment. | Offline schema, model, fake, and full Swift integration proof close the candidate before separately gated native-live acceptance. |
| `docs/adr/0030-desktop-frame-texture-leases.md` | Owns texture-lease and capture mechanics but also requires an AOS-local process-lifetime direct-capture consent/prime gate. | Rewrite | Mark the gate partially superseded in the ADR index; preserve the old body. | Retain capture mechanics while removing the AOS-local admission gate atomically across native, IPC, help, API, tests, and proofs. |
| `docs/adr/0031-desktop-pixel-broker-and-warm-snapshots.md` | Owns the single pixel broker, warm snapshots, serialization, identity, settlement, and cleanup while retaining explicit direct-capture consent/prime clauses. | Rewrite | Mark only those clauses partially superseded in the ADR index; hash-preserve the old body. | Retain broker/warm-snapshot correctness while removing the AOS-local admission gate atomically across native, IPC, help, API, tests, and proofs. |
| `docs/adr/0018-installable-aos-skills.md` | Owns installable AOS skills and still describes external Playwright as the escape hatch for grammar AOS does not expose. | Repoint | Update only the ADR-index authority note; preserve the old body. | Skills and their governing ADR describe implemented complete managed grammar without a competing ambient runtime path. |
| Root `AGENTS.md`, `CONTEXT-MAP.md`, and `ARCHITECTURE.md` | Root ambient-authority rules align, but the architecture narrative still presents the current minimal/fixed surface without target/current precedence. | Repoint | Add one authority route and temporary transition banner. | Remove the banner after active narrative, implementation, help, schemas, skills, and proofs converge. |
| `README.md`, `CONTEXT.md`, and `docs/api/README.md` | Current implementation and discovery narrative; no Milestone 0 executable change. | Keep | Leave unchanged and route through the root map. | Update only with the atomic public-capability slice that changes their claims. |
| `docs/api/aos.md` and `docs/api/aos-capabilities.md` | Correct current command and capability contract, including fixed browser gaps and explicit screen-capture priming. | Repoint | Add a temporary target/current banner; retain all existing implementation claims. | Rewrite each affected section with source manifests, generated help, schema, implementation, skills, and tests. |
| `manifests/commands/source/aos/` and `manifests/commands/source/external/` | Authorship source for AOS command grammar and help metadata. | Keep | Record ownership; do not edit in Milestone 0. | AOS lifecycle/control commands remain source-authored; upstream Playwright operations pass as raw argv and do not gain one manifest entry per upstream operation. |
| `manifests/commands/aos-commands.json` and `manifests/commands/aos-external-commands.json` | Generated command/help compatibility artifacts. | Keep | Do not hand-edit or regenerate. | Change only as output of `scripts/generate-command-manifests.mjs`; prove with `tests/command-manifest-generation.sh`. |
| Browser command sources, especially `07-do-01-pointing.json`, `07-do-02-text.json`, and their external routes | Browser Observation Ref actions fail with `TARGET_ACTION_UNSUPPORTED`; only a small session grammar is exposed. | Rewrite | Classify in the machine burn-down baseline; do not edit. | Full upstream operation grammar lands with exact lifecycle, bounds, schemas, receipts, help, API, skills, and tests. |
| `scripts/lib/browser-companion/` and `scripts/aos-browser-*.mjs` | AOS-managed reviewed Playwright runtime, private store, exact leases, fixed worker envelopes, guardian, and cleanup. | Expand | Preserve implementation; add nearest-owner authority signage only. | Replace operation-specific envelopes with grammar-agnostic raw argv/stdin/stdout/stderr/artifact transport without weakening pin, environment identity, bounds, guardian, kill, cleanup, or receipts. |
| `src/browser/` | Narrow Swift client for fixed managed browser operations. | Expand | Replace the stale prose-heavy `src/browser/CLAUDE.md` with compatibility pointers; do not edit Swift. | Native bridge supports the mechanically required generic transport without interpreting workflow semantics. |
| Browser schemas under `shared/schemas/aos-browser-*.schema.json`, `shared/schemas/aos-semantic-targets.md`, and Target Handle V1 | Closed current lifecycle/results and fail-closed browser-ref action semantics. | Rewrite | Retain as current executable truth and classify restrictive claims with path-specific markers. | Schema only AOS lifecycle, identity, bounds, raw transport, artifacts, and control; it does not wrap each upstream operation semantically. |
| `docs/design/aos-desktop-playwright-cli-map.md` | Maintained consumer crosswalk that still routes trace/video/PDF to an external escape hatch, says AOS exposes no generic browser runner, and leaves full browser grammar upstream rather than AOS-managed. | Rewrite | Keep the maintained design path active-scanned and add its exact baseline/current markers to the fixed-grammar claim. | Rewrite with the atomic managed-grammar implementation slice so the maintained crosswalk reflects raw pinned-upstream transport rather than a competing external route. |
| Browser tests and `docs/dev/test-proof-registry.d/browser-companion.json` | Prove lifecycle correctness and the absence of upstream list, generic code, ref actions, and tab operations. | Rewrite | Keep all tests; classify the exact enforcing tests and proof source with path-specific required markers. | Replace negative surface proofs with raw-transport and control-plane proofs while retaining lifecycle regressions. |
| `scripts/AGENTS.md`, `scripts/lib/browser-companion/AGENTS.md`, `src/AGENTS.md`, and `tests/AGENTS.md` browser clauses | Closest active DOX requires fixed operations and forbids generic grammar. | Repoint | Add temporary local target/current pointers without deleting executable constraints. | Delete transition banners when local contracts describe the implemented complete grammar. |
| `skills/aos-browser/SKILL.md`, related installable skills, and `skills/registry.json` | Teach the current narrow managed session and unsupported browser-ref boundary. | Repoint | Add local target/current signage; do not claim new commands. | Update installed skill content and registry backing atomically with implemented grammar. |
| `src/daemon/desktop-frame-capture-consent.swift`, direct-capture IPC, and permission command source | Current process-lifetime direct-capture gate requires explicit AOS priming before runtime capture. | Retire | Preserve runtime/source; classify the gate as burn-down baseline. | Remove AOS-local admission only with native code, IPC, manifest/help, API, tests, and proof routing changed together. |
| `src/daemon/AGENTS.md`, `shared/schemas/daemon-ipc.md`, `docs/api/aos.md`, and `docs/api/toolkit/scene-extensions.md` | Accurately document the current consent/prime gate and protected ScreenCaptureKit lifecycle. | Repoint | Add temporary pointers at the active docs/DOX centers; retain current behavior text. | Rewrite when runtime exposes platform permission facts without AOS-local policy. |
| Native-capture tests and `docs/dev/test-proof-registry.d/native-capture.json` | Prove the current broker, topology, callback, permission, and TCC-free harness boundaries. | Rewrite | Leave unchanged; map the exact consent-enforcing tests/proof source and exclude preserved ADR bodies from active stale evidence. | Preserve mechanical capture proofs while replacing consent-gate expectations. |
| Status-item source, schemas, `docs/api/toolkit/status-item.md`, and tests | Product-neutral lease, inspect, update, invoke, dry-run, event, and action-sequence model; not a general operation control plane. | Expand | Add a temporary pointer and classify the exact narrow status-item contract as current baseline. | Keep status-item identity separate while AOS adds its neutral active-operation/recording projection; Sigil owns product labels and action policy. |
| Browser guardian and exact-focus/native process supervision | Strong exact-identity termination mechanics exist in bounded feature-specific owners. | Expand | Keep as reference implementation and current executable truth. | Factor or reuse product-neutral operation control without weakening exact identity or residual-authority receipts. |
| `packages/toolkit/` and `docs/api/toolkit/` | AOS-owned reusable surface layer; selected JS clients are transport-injected, but no comprehensive substrate SDK exists. | Expand | Add ownership pointer at Toolkit/status centers; no package code changes. | Publish maintained CLI/IPC/SDK projections for substrate and control-plane contracts. |
| AOS installable skills | Generic substrate workflow guidance, constrained by current CLI/help. | Expand | Route to ADR/map and retain current command syntax. | Teach complete implemented primitives and optional caller transforms without policy. |
| Current Gate, annotation, and Guided User Signal fidelity gaps listed by ADR 0040 | Some admitted facts still receive default redaction or omission. | Rewrite | Preserve explicit gap accounting. | Migrate each fact with exact schema/API/implementation/test ownership and explicit caller transforms. |
| General operation-control commands and schemas | The M2 executable candidate provides generation-bound list/inspect/status/recent/cancel/kill/kill-owner, stop-all, barrier-status, and reopen through daemon IPC and CLI, with internal status/Canvas projections. Parameterless tap remains typed unavailable. M3A/M3B/M3C-V2 add producer-backed screen-recording artifact reveal/remove/release while retain remains typed unavailable. Adapter-registry revision 2 contains the microphone and screen-recording adapters; a microphone-selected recording atomically consumes the existing microphone adapter's exclusive voice-session declaration beside the screen resource. | Expand | Treat the current plane as the shared substrate; retain tap target and recovery definitions without presenting sampling as current success, preserve the exact screen-recording custody boundary, and do not infer control over unadapted legacy subsystems. | Later adapters join at an exact registry revision. Public SDK projections remain M6; raw managed-tool transport remains M7. Claim-set admission stays complete-set atomic and neither microphone consumer can preempt legacy voice output. |
| Compatibility aliases, fixed-grammar policy, and any competing ambient Playwright resolver | Fixed grammar and old resolver residue are incompatible with the target. | Retire | No runtime retirement in Milestone 0. | Delete atomically under ADR 0039 after all internal consumers migrate. |
| `docs/archive/**` and `docs/dev/reports/**` | Historical evidence, not active authority. | Archive | Preserve unchanged and exclude from stale scans. | None; Git and explicit archive ownership preserve history. |
| Maintained `docs/design/**` notes and current work cards | Active design exploration under `docs/AGENTS.md`; some paths carry executable-current contradiction claims. | Keep | Scan tracked regular files as active authority and classify exact contradictions path-by-path. | Promote stable decisions to ADR/API/schema owners without using a blanket design-tree exclusion. |
| Six exact self-declared historical/retired design notes plus `docs/design/fixtures/**` | Historical research/retired lineage and frozen fixture material, not maintained current design authority. | Archive | Preserve unchanged and exclude only the exact mapped notes and fixture subtree from the tracked stale scan. | None unless a separately authorized migration explicitly reclassifies an exact artifact. |

The historical design-note exclusions are exactly
`2026-05-07-architecture-deepening-audit-triage.md`,
`2026-05-17-platform-debt-map.md`,
`agent-relay-readiness-narrative-ledger-2026-06-04.md`,
`aos-grand-unification-plan.md`,
`aos-surface-stack-v0-checkpoint-hygiene-report.md`, and
`see-do-grammar-trace-connections.md`, all under `docs/design/`. The only
design-tree fixture exclusion is `docs/design/fixtures/**`.

ADR 0015, 0018, 0030, 0031, 0040, and 0041 keep the program dispositions in
their individual rows while their bodies are separately hash-preserved and
excluded from stale-evidence scanning. Preservation does not reclassify active
0015/0040 doctrine as archived or make superseded 0030/0031/0041 clauses
current.

## Active contradiction baseline

The machine map binds exact paths and path-specific required markers for three
current contradiction families:

1. fixed managed-browser grammar and explicit unsupported operations;
2. the AOS-local native-capture consent/prime gate; and
3. narrow status-item control without a general operation control plane.

The static authority test requires every path-specific marker in both the
declared baseline revision and current worktree, so a new Milestone 0 banner
cannot satisfy old implementation evidence. It also scans every Git-tracked
text path classified `active` or `generated` for doctrine-specific matches and
fails when a match lives outside the claim's path-specific baseline. `target`,
`preserved`, `historical`, and `frozen` scopes are explicit exclusions;
generated help is classified separately but remains scanned. Maintained design
notes are active-scanned; only the six exact self-declared historical/retired
notes and `docs/design/fixtures/**` are excluded. Removing a path or claim
therefore requires an explicit map update in the atomic implementation slice.

The baseline is not exhaustive implementation proof. Later milestones must add
their own source/schema/help/API/skill/test/proof convergence and delete each
burn-down entry only when its exit gate is met.

## Generated ownership and proof routing

- Command help authorship: `manifests/commands/source/aos/` and
  `manifests/commands/source/external/`.
- Generated outputs: `manifests/commands/aos-commands.json` and
  `manifests/commands/aos-external-commands.json`.
- Generator: `scripts/generate-command-manifests.mjs`.
- Drift proof: `tests/command-manifest-generation.sh`.
- Authority-map static proof, including the M2 increment 1 amendment:
  `tests/sovereign-capability-active-authority.test.mjs`.
- Proof-worth fragment:
  `docs/dev/test-proof-registry.d/sovereign-capability-authority.json`.
- Workflow route: `sovereign-capability-authority` in
  `docs/dev/workflow-rules.json`.
- Capability-ledger static proof, including accepted M2 bindings and target machines:
  `tests/schemas/aos-privileged-capability-ledger-v1.test.mjs`.
- Capability-ledger proof-worth fragment:
  `docs/dev/test-proof-registry.d/privileged-capability-ledger.json`.
- Capability-ledger workflow route: `privileged-capability-ledger` in
  `docs/dev/workflow-rules.json`.

## Sequencing

1. The AOS authority-only packet landed first at exact landed AOS SHA
   `e4ef13081311596f38d011ab5dfed6bb8cd2d496`.
2. Both reviewed Sigil AOS pin fields, `verifiedRef` and `sourceRevision`, were
   advanced atomically to that exact landed AOS SHA before Sigil authority
   publication at `227382c1bcbdab56f551a85a69b0609eebbdfa0c`.
3. Paired cross-repo authority is landed. The AOS M2 executable candidate now
   follows that authority without changing Sigil workflow ownership.
4. The accepted M2 packet binds the ordinary owner root, generation-bound external
   dispatch, exact registered-set same-effective-UID host control, bounded
   request replay, explicit prior-generation recovery across nine machines,
   and split claim-set/resource/broker contracts. The executable slice owns authored sources
   `manifests/commands/source/aos/41-operation.json` and
   `manifests/commands/source/external/49-operation.json`; generated aggregates
   move only with that executable slice. The same slice publishes the frozen-v0/
   active-v1 external-manifest cutover and exact command/proof/workflow routing,
   while `docs/api/aos.md` and
   `docs/api/aos-capabilities.md` remain maintained current API owners.
5. M2 adapts the existing microphone owner to authenticated peer identity and
   the shared operation registry/control plane; ships daemon IPC and CLI,
   internal status break-glass, and internal Canvas control; and leaves public
   SDK projections for M6. M3A adds fixed H.264 QuickTime screen video; M3B adds
   optional AAC-LC system audio to the same operation, writer, and artifact;
   M3C-V2 adds an independently optional daemon-owned AAC-LC microphone track
   with final-summary startup truth and exact shared-owner absence gating;
   later M3 work adds followed geometry;
   M4 completes AX and input surfaces; M5 unifies privileged streams; M6
   publishes canonical protocols and maintained SDKs; M7 exposes managed
   external tools; M8 converges installable skills; M9 composes Sigil flagship
   workflows; and M10 runs final acceptance.
6. Burn down fixed-grammar and consent-gate claims only as their exact owners
   converge. Join Simulation Author as the first follow-on flagship only under
   later explicit owner direction; do not read or modify its independent
   documents in this program slice.

## Publication and preservation boundary

Milestone 2 publishes the operation registry, operation CLI/IPC,
status/Canvas projections, and microphone adapter described above.
M3A/M3B/M3C-V2 add the bounded fixed mandatory-video producer with independently
optional system-audio and microphone tracks plus producer-backed recording
artifact custody. It does not publish followed geometry, full M3, full
Playwright grammar, a public SDK, or changed TCC policy. Pre-0044 ADR bodies,
archives, reports, the frozen v0 schema, and frozen fixtures remain unchanged.
The deterministic recording proof executes the compiled production adapter,
registry, in-memory durable store, lifecycle/sample admission, multitrack
coordination, terminal truth, custody coordinator, and boot recovery with
injected fake dependencies. Native
capture/writer, filesystem effects, daemon, TCC, MOV, and crash acceptance
remain separately gated.

The future
managed Playwright boundary inherits snapshots, boxes, evaluation, tracing,
video, network, storage, PDF, tabs, input, navigation, and lifecycle from the
reviewed pin through raw transport; none of those target families is claimed as
newly implemented by this ledger.
