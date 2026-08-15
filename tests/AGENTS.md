@../AGENTS.md

# Tests

## Purpose

`tests/` contains repo verification assets: shell smokes, Node tests, Python
helpers, fixtures, browser checks, daemon checks, toolkit checks, and scenario
tests.

## Ownership

- Root-level tests cover cross-cutting `./aos` and runtime behavior.
- Subdirectories group tests by surface or fixture type.
- Test helpers belong in `tests/lib/`.

## Local Contracts

- Keep tests deterministic by default. Live input, daemon, or TCC-dependent
  checks must advertise prerequisites through env vars or scenario docs.
- Keep deterministic canvas lifecycle stress and guarded concurrent-input
  stress in separate scenario drivers over shared lifecycle support.
- Do not weaken assertions to match stale behavior; update the owning contract
  or source when behavior intentionally changes.
- Core Target Handle V1 acceptance tests use isolated state roots, injected
  managed workers/fake AOS executables, and pure Swift selection harnesses.
  They must prove generation-bound path-free backend identity plus fail-closed
  browser-ref no-dispatch, V0 byte-preserving rejection,
  exact-one Locator behavior, one-shot and native-session state rejection, and
  schema-valid native handle emission or omission, and the absence of
  reacquisition or first-match helpers without executing `./aos`.
- Managed browser-companion lifecycle proofs use isolated state roots and fake
  in-memory tarballs through the injected downloader seam. They must cover
  exact descriptor/closure/entrypoint checks, complete no-replace authority
  record publication with orphan/pair/short-write recovery, private-store and lock rejection,
  intent-backed activation ordering and observed cleanup, empty and whole-lock
  recovery, claimed journaled whole-store removal with provenance-complete
  partial phases, cooperative quarantine identity checks, transition capacity,
  lease-aware update/uninstall, content-free schema-valid runtime receipts, and
  executable dispatcher-route help/staging from an unrelated caller. They clean every temporary root and use bounded
  subprocesses without network, package scripts, browser binaries, `./aos`,
  daemon, browser, native UI, or TCC.
- Managed session tests use only fake in-process workers and installed staging
  routes. The command proof executes the staged public focus lifecycle and
  narrow broker from an unrelated cwd against a fake descriptor-bound worker.
  They cover explicit system-Chrome launch argv, launched/CDP/extension ownership, conservative
  extension-profile admission with malformed/over-cap blocked classification,
  exact focus grammar/backend removal, exact close versus detach, 128-record preflight,
  creation-intent/starting/operating/committed/cleanup-required durability,
  fully validated acknowledgement before complete-Guardian retirement,
  ordered consume-last evidence progress across sequential subworkers,
  actual-spawn authority latching, no-replay recovery, final-lease version
  retirement, lock-cleanup recovery receipt truth, whole-list stable reads,
  lease retention, exact worker
  envelopes and liveness, fixed operations, private environment/workspace drift, legacy
  registry retirement/blocking, content-free receipts, consumer cutover,
  installed unrelated-cwd agent-workspace inspection, and the absence of
  upstream list, runtime fallback, browser execution, or network.
  `managed-session-recovery.test.mjs` owns deterministic publication-fault,
  durable rollback-no-authority, intent-last present/absent partial-workspace
  recovery, evidence journal/outcome recovery matrices, and no-replay
  transition seams. `managed-worker-acknowledgement.test.mjs` owns real
  start/liveness/operation/cleanup acknowledgement-before-retirement faults
  and live-release outcome transfer; `managed-worker-sequential.test.mjs` owns
  every intermediate/final evidence boundary and journal-consume-last seams.
  These proofs distinguish returned acknowledgement records from unknown
  callback failure and require public mutation/operation/broker projections to
  remain schema-valid and free of private pending-signal state.
  `managed-worker-guardian.test.mjs` owns real disposable subprocess proof of
  inert pre-reservation behavior, parent-published PID-bound arming,
  activate/request/execute ordering, request/control failure, exact aggregate
  raw-stream caps, pre-request parent loss, sentinel-held process-group identity,
  nonce-bound self-group SIGKILL exit plus untruncated control and raw EOF
  witnesses, outer and inner transport-loss draining, cessation of
  TERM-ignoring descendant user-code authority, negative ACK/exit/EOF cases,
  and intended detached-daemon lifetime.
  `managed-guardian-state.test.mjs` owns byte- and name-invariant status/list/
  dry-run inspection of publication residue. Guardian recovery proofs require
  an exact durable lock/session/generation/nonce/operation outcome before stale
  lock authority is removed, then consume that outcome only after the bound
  rollback or cleanup-required transition is durable. Fixture and screenshot
  size limits are exercised without a real package or browser.
  `managed-browser-swift-contract.test.mjs` statically binds the narrow Swift
  broker/adapter/daemon graph; full compile coverage routes to
  `bash tests/swift-runtime-typecheck.sh`.
- Policy drift guards must name the exact active source surfaces and prohibited
  doctrine they protect. Do not globally ban mechanically valid terms such as
  `dry-run`, `authorization`, `allowlist`, `redaction`, Gate, or Work Record.
- Work Record V1 and Step Descriptor V1 proofs are direct schema/model/command-
  adapter tests. They must keep V0 bytes frozen and unsupported, reject exact
  legacy authority symbols on scoped active surfaces, and never invoke the repo
  `./aos`, daemon, native UI, or TCC state. Any Work Record proof subprocess
  must pass schema instances through stdin or private fixture files, never argv
  or environment, so Work Record bytes stay out of process metadata.
  Repair-finalization proofs must require exact caller evidence and
  source-bound candidate-patch payloads,
  preserve raw path/URI carriers, prove the single atomic patch/operation chain
  and unique evidence identities, require every planned evidence requirement,
  bind standalone Artifacts to the complete claimed Attempt Plan payload, and
  prove missing patch outcomes fail closed. Schema and model proofs reject
  nested authority-policy keys across all plan mechanics and their Artifact mirrors;
  caller command, cleanup, and rollback receipts bind exact planned bytes and
  reference tuples, reject duplicates/extras, and reference only present evidence;
  malformed proposed execution maps must fail before Proposal construction;
  re-digested Attempt Plans still reject operation boundaries or requirement
  references that differ from canonical Repair Plan-derived mechanics;
  zero-patch planned Repair Plans must not produce a `ready` Attempt Plan, and
  unsupported-profile command payloads must stay schema-shaped while exiting
  nonzero. Finalizer, Guide, and
  supersession proofs must reject same-byte source clones at a different path;
  writer proofs must inject create-if-absent races and prove different
  destination bytes are never overwritten while partial bundle writes remain
  receipted. Inject failed transfers and post-transfer invalidation, then
  require exact scrubbed temp or destination leftovers through Writer,
  supersession, bundle, and finalizer results. Capture
  proofs preserve repeated whitespace in raw command/target/state carriers,
  adapter and recovery projections preserve raw labels and command bytes, and
  verifier proofs reject whitespace-only target or state-identity drift.
  Replacement proofs preserve raw source labels plus every historical source
  evidence item and reject reserved provenance-key collisions without
  overwriting caller metadata. Writer proofs require exact caller evidence
  metadata and caller timing rather than generated timestamps.
  Step Descriptor capture proofs must reject internally incoherent descriptors
  and unrelated simulation or execute-adapter evidence before record emission.
  Postcondition state identity drift from the bound after perception must fail
  before Work Record emission or browser-workbench opening.
  Verifier proofs must reject hollow verified Claim Results and any duplicate,
  missing, extra, or mismatched advertised Claim digest.
  Supersession lookup proofs must reject persisted entries whose entry or
  relationship status is not the canonical active state and must reject
  unbound Writer-result provenance fields, including Proposal identity fields
  that differ from the replacement record's embedded Writer provenance.
  Structured-record and serialized-output digests are checked independently;
  an exact supersession identity with different serialized index bytes is a
  conflict rather than an idempotent existing publication.
  Supersession lookup rejects entries whose claimed root or deterministic path
  does not match the exact physical file being scanned.
  Replacement readback rejects same-byte record clones whose physical path
  differs from the path committed by the supersession entry.
  persisted Proposal and Writer mirrors are covered by entry identity and
  replacement readback; added status or temporary-output receipt fields fail
  validation instead of remaining unbound. Workbench proofs reject V0, unknown
  schemas, and malformed V1 at both initialization and open boundaries.
  Subject-catalog and wiki-browser active fixtures use Work Record V1; V0
  fixtures appear only in explicit unsupported-input proofs.
  Supplied Proposal type/status tampering
  fails before supersession publication, while persisted Proposal provenance is
  the closed id/digest/schema projection. Successful write receipts bind the
  serialized index-file digest separately from the structured entry identity.
  Finalizer scrub-receipt proofs cover failed replacement and supersession
  transfers with both newly written and already-existing replacement records,
  plus successful finalization after an idempotent raced publication.
  Finalizer proofs also mutate the replacement during supersession publication
  and require the post-publication re-read to block success, and inject malformed
  published index readback to require a receipted partial result instead of an exception.
  Writer and supersession proofs mutate their bound source identities during
  publication and require a published-side-effect receipt with success
  downgraded; serialized replacement-byte drift must fail independently of its
  canonical structured digest. Supersession proofs also race two distinct
  replacements for one exact source and admit only one canonical active entry,
  while index disappearance or scan failure after publication returns typed
  receipts. Inject source raw-digest read failures after replacement and index
  publication and require Writer, supersession, and finalizer side-effect
  receipts; post-replacement supersession-plan scans and replacement-root
  containment failures must also return typed finalizer/lookup results.
  Existing replacement-output read errors and pre-publication supersession
  index-scan errors must return typed Writer/planner results rather than throw.
  Writer proofs reject a regular-file output root in dry-run and write modes,
  and reject symlink or non-file deterministic destination leaves before
  idempotency even when a symlink target contains identical bytes. Race proofs
  exercise the production descriptor-relative native primitive through its
  content-free deterministic fault seam. They swap and restore the held parent
  or explicit root, replace leaves with identical symlink clones, create an
  external hard link to the temp inode before any Work Record write, restore a
  leaf during pinned inspection or publication readback, race hard-link
  activity after atomic transfer, and replace the temp name immediately before
  rollback to prove the unrelated replacement is preserved.
  Packaging proof stages and loads the installed Work Record command/native
  resource projection, then resolves its manifest entry from an unrelated
  caller directory without invoking `./aos`. Every
  route must fail closed through directory-event, no-follow,
  inode/type/link-count, and digest checks; external hard-link artifacts must
  contain zero Work Record bytes. Supersession/finalizer readback races must not
  produce a successful receipt.
  Successful Artifact proofs reject a produced candidate patch whose exact
  planned candidate-patch operation was skipped;
  lookup proofs reject symlinked index trees, and command proofs require a
  nonzero exit for typed malformed-index results.
  Root proofs also reject requested roots nested under regular-file ancestors
  and non-system symlink ancestors plus a symlinked explicit index root, and
  inject root-containment I/O failures through the public Writer and planner.
  Lookup must reject an explicit symlink root even when its index tree is empty.
  Artifact/proposal command build failures must exit nonzero. Finalizer proofs inject both
  pre-publication source digest failures. Bundle proofs inject later artifact
  I/O after an earlier publication and require accumulated receipts.
  Partial-finalization
  guidance must not emit a supersession-write
  command without the required successful Writer Result path. Step Descriptor workbench proofs
  reject V0, unknown, malformed, or evidence-mismatched inputs before ready
  state.
  Proposal/Writer proofs must preserve every source-owned field outside the
  single `execution_map` patch and reject extra/duplicate/missing evidence or
  postcondition mappings. Repair Guide proofs must reject a valid Artifact from
  another source or Attempt Plan.
- Preserve cleanup for canvases, daemon state, temporary files, and live
  resources.
- Proofs that exercise global process cleanup must fail fast while an unrelated
  raw repo daemon is live; they may never stop that runtime as test setup.
- Artifact-producing proof harnesses under `tests/manual/` must write stable
  machine-readable summaries and explicit cleanup evidence when they create
  `/tmp` proof roots.
- Voice transport unit tests must use disposable Swift or fake-socket harnesses
  by default. Live microphone, global-hotkey, and audio-output proof is a
  separate manual/TCC-sensitive gate and must not rebuild `./aos` implicitly.
- DesktopWorld gesture and scene-follow tests must use deterministic clocks,
  fake input-region bridges, disposable sockets, and schema fixtures. Static
  scene contract work must not execute the repo AOS binary or require TCC.
- The desktop-pixel native baseline compares a standalone control with the
  DesktopWorld-hosted AOS sheet increment. It proves that the native sheet
  reuses the stage topology and windows, resolves by exact identity, bounds its
  deformable geometry, and leaves no installed sheet, geometry buffer, texture,
  or shared GPU resource after cleanup. It has source, full Swift integration,
  and runtime Metal-shader compilation coverage plus a supervised TCC-sensitive
  proof. Its focused lifecycle harness must reject blank/stale frames, prove
  producer advancement, compensate partial startup through the production
  coordinator, and keep the development-probe gate closed by default. Static
  verification must never invoke capture or treat these checks as native
  presentation evidence.
- Public-capture ownership proofs remain offline and TCC-free. They must cover
  warm quiesce/still/restore ordering, current and stale terminal callbacks,
  public explicit-exclusion policy, callback deadline quarantine, strict IPC,
  and ordered digest-verified transfer above the normal 32 MiB socket budget by
  compiling focused production owners rather than copied algorithms.
- Public-capture reader proof must use the production `DaemonSession` over
  disposable socketpairs to cover partial valid frames, byte-drip deadline
  exhaustion, and bounded oversized-frame rejection. It must also exercise the
  production event-stream read and reconnect loops so an oversized unterminated
  frame cannot wedge a subscription.
- Exact focus-channel native acceptance is a separate explicitly approved
  manual proof against the already-running repo daemon. It must use two
  deterministic overlapping windows from one synthetic AppKit process, passive
  public status/service/permission/build-attestation preflights, public `focus`
  and `see capture --channel` evidence routes, an owner-bounded process-group
  watchdog, and content-free output. Every admitted group must have durable
  exact ownership before retirement and bounded descendant reaping; every
  lifecycle receipt and process-outcome normalization must be singly owned by
  an import-safe protocol module consumed by the process-owning helper and
  `exact-focus-channel-proof-protocol-contract.test.mjs` and
  `exact-focus-channel-supervision-contract.test.mjs`;
  `exact-focus-channel-supervision-record-contract.test.mjs` owns private
  lifecycle-record framing and signal-time PID-identity reuse proofs. The detached exact-token
  guardian must lead and remain live in its process group from admission through
  descendant retirement, hold INT/TERM before publishing ownership, emit one
  exact validated payload outcome only after admission commits, and be awaited
  before group absence is accepted. Deterministic crash coverage must kill the
  supervisor after that outcome while a TERM-ignoring descendant remains, then
  require the outer shell to authenticate the live guardian command, token, and
  PGID before bounded reaping without touching an unrelated live group. Never
  act on a dead numeric ownership record. Command execution,
  executable offline self-test payloads, pure proof modeling, and live proof
  operations must remain separate import-safe helpers, with stdout/tempfs
  effects owned by `exact-focus-channel-native-proof-self-test.mjs`.
  `exact-focus-channel-private-records.mjs` owns bounded held-file opening,
  exact JSON-line parsing, purpose shape validation, and recovery publication;
  it may depend on the model but not the runtime or driver.
  `exact-focus-channel-private-records.swift` owns the matching pure Swift
  publisher, and its non-AppKit harness owns deterministic publication proofs.
  Supervision owner, supervisor-ready, and progress records must use the shared
  bounded supervision-protocol reader and exact CLI projections; shell cleanup
  may consume those projections but must never reopen the record pathname.
  The five lifecycle destinations, including the derived admission acknowledgment,
  must be distinct by absolute lexical path plus the real path of the existing
  parent and the leaf basename; never resolve the leaf itself. Null, unresolvable,
  or aliased identities must reject before payload admission or record writes.
  Grouped owner cleanup must authenticate every present sibling and require
  exact identity agreement; ready cleanup must match the expected supervisor PID.
  Supervisor failures use a per-sequence private no-replace receipt, never
  payload stderr; readers require the exact canonical one-line serialization
  and remove only a revalidated valid receipt. Direct supervisor and fixture
  signals must reauthenticate their exact process identity immediately before
  TERM and again before KILL so a reused PID is never signal authority.
  Direct supervisor identity also binds a shell-minted cryptographic per-run
  32-hex token, present exactly once before `--` and retained until quiescence.
  Broken record symlinks are present-invalid lifecycle state, never absence;
  reconciliation and quiescence must retain them and fail closed.
  Private recovery,
  fixture-result, close-ack, and cleanup-report JSON readers must use held
  no-follow/nonblocking descriptors with exact owner-only mode, UTF-8, byte,
  and one-line bounds, retrying bounded concurrent producers until readiness.
  Private writers serialize once, create the final destination exclusively at
  mode `000`, verify its held/name identity and durability, then make `0600`
  the final readiness transition. Never delete a pathname on writer failure.
  This is a cooperative private-root protocol, not adversarial linearizability:
  arbitrary same-UID mutation after the final preactivation ownership check is
  out of scope and is equivalent to mutation after publication.
  Keep each purpose maximum aligned and prove pathname/growth races, boundaries,
  special-file rejection, and replacement preservation through named offline tests. Keep
  an acyclic driver-to-runtime-to-private-record/model dependency; every capture must bind
  contemporaneous stable target/sibling geometry
  to coherent public surface, segment, perception, and decoded-pixel facts. It
  must reject a sibling-window subtree,
  prove the occluded target's pixels and AX membership, preserve and recapture
  the last good publication after a rejected refresh, fail closed when the
  target is missing, remove all channel/window/temp state, preserve every
  stable public identity/configuration field of unrelated channels while
  tolerating documented native refresh metadata, and preserve the shared
  daemon. Any recovery-root comparison material must contain only ephemeral-key
  digests, never raw channel entries, URLs, or session identifiers. It must
  never use a private
  application, `--base64`, a direct daemon socket or channel-file read, daemon
  lifecycle commands, an implicit rebuild, or a new TCC permission request.
- Status-item host contract tests must use disposable fake sockets and schema
  fixtures, model startup admission ordering, and prove registration output
  precedes initial events. Fake sockets must emit the complete daemon envelope
  and complete invocation result so tests also prove the CLI's canonical public
  projection. Concurrency, exhaustion, dry-run, and failed-delivery admission
  proofs must exercise the focused production admission component used by the
  native manager, not a copied fake allocator. A static AppKit harness may
  exercise production menu rendering and callback binding without opening a
  status item; native menu-bar acceptance remains a separate build/runtime gate.
- Display-topology identity proof must compile the focused production Swift
  helper with `-Onone`, remain offline and daemon/TCC-free, and cover raw
  enumeration permutations, every mapping fact, UUID fallback, invalid inputs,
  direct and saved explicit/interactively selected region response wiring,
  `state_id` separation, and the single-observation source guard. It must also
  reject missing/duplicate live NSScreen sources, selected/provider membership
  drift, UUID/runtime-ID swaps, fallback-ID drift, provider frame/point size and
  production filter-scale drift,
  fractional/unrepresentable pixel dimensions, and captured full-display pixel
  mismatch. Saved region and interactive summaries must validate through the
  common workspace validator with the canonical sibling topology schema
  registered by `$id`. Static guards must prove interactive selection uses only
  frozen bounds and rejoins the validated region path with no screen
  re-enumeration, filter recreation, or external image capture. Native region
  capture remains a separate permission-sensitive test.
- PNG file comparison proof must compile only its focused Swift source and
  disposable harness with explicit `-Onone`, generate fixed fixtures under a
  private temporary root, reject special files under a bounded watchdog, and
  prove exact identical, sparse-change, and dense-change metrics plus optional
  grayscale change-map/mask samples, hashes, target validation, expectation
  retention, parent-identity drift rejection, checked-receipt rollback, normal
  rollback, explicit cleanup-failure reporting, unrelated-file preservation,
  and bounded 3840x2160 artifact output. It must render direct text help so
  malformed required-group topology cannot self-pass, and exercise the
  production runtime-path helper, dispatcher, and comparator through absolute,
  PATH, and relative executable invocations from an external caller directory.
  It must not execute the repo AOS binary, capture pixels, start services, or
  require TCC.
- `tests/dev-workflow-router.sh` runs its public `./aos` rejection checks by
  default. Use `AOS_SKIP_LIVE_CLI_CHECKS=1` only for explicit static-only
  validation while the repo artifact is absent or waiting at ADR 0023's human
  TCC checkpoint; the live checks remain required after readiness recovers.

## Work Guidance

- Name tests after the behavior or contract they protect.
- Prefer existing harness helpers in `tests/lib/`.
- Keep agent workspace fixture helpers split by domain under
  `tests/lib/agent-workspace-fixtures/`; `tests/lib/agent-workspace-fixtures.sh`
  is only the compatibility shim that sources those files.
- Keep Target Handle V1 deterministic coverage in
  `target-handle-runtime.test.mjs`, `agent-workspace-v1.test.mjs`,
  `agent-workspace-v1-actions.test.mjs`, and
  `native-target-locator-selection.sh`; guarded legacy live proofs are not V1
  acceptance evidence.

## Verification

- Run the focused test for the changed path.
- Use `git diff --check` for test-only edits when no executable check is
  relevant.

## Child DOX Index

- `browser/` contains browser adapter tests.
- `content/` contains content/wiki tests.
- `daemon/` contains daemon and gate tests.
- `design/` contains design-contract fixture tests.
- `fixtures/` contains test fixtures; `fixtures/legacy-sigil/product/AGENTS.md`
  governs the frozen historical Sigil payload.
- `gateway/` contains gateway tests.
- `lib/` contains shared test harness helpers.
- `manual/` contains manual or environment-sensitive checks.
- `renderer/` contains renderer/module tests.
- `scenarios/` contains scenario tests.
- `schemas/` contains schema tests.
- `toolkit/` contains toolkit tests.
