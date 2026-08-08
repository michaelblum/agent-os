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
- Core Target Handle V1 acceptance tests use isolated state roots, fake Playwright/AOS
  executables, and pure Swift selection harnesses. They must prove original-pair
  validation plus fail-closed browser no-dispatch, independently verified
  minting-backend implementation-closure identity, V0 byte-preserving rejection,
  exact-one Locator behavior, one-shot and native-session state rejection, and
  schema-valid native handle emission or omission, and the absence of
  reacquisition or first-match helpers without executing `./aos`.
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
  transfers with both newly written and already-existing replacement records.
  Finalizer proofs also mutate the replacement during supersession publication
  and require the post-publication re-read to block success, and inject malformed published
  index readback to require a receipted partial result instead of an exception.
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
  activity after temp unlink, and replace the temp name immediately before
  cleanup to prove the unrelated replacement is preserved.
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
  `target-handle-runtime.test.mjs`, `agent-workspace-v1.test.mjs`, and
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
