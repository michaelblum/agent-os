@../../AGENTS.md

# Browser Companion Runtime

## Purpose

`scripts/lib/browser-companion/` owns the managed Playwright companion package
lifecycle defined by ADR 0041.

## Ownership

- `descriptor.mjs` validates the source-owned package descriptor and identity.
- `download.mjs` performs exact, bounded tarball acquisition through an
  injectable offline-test seam.
- `archive.mjs` verifies SRI and validates tar entries before extraction.
- `store-*.mjs` collectively own every write beneath the mode-scoped companion
  store, including its sentinel, lock, staging, immutable versions, leases,
  activation pointer, pending publication records, retired cleanup state, and
  uninstall cleanup.
- `store-records.mjs` and `store-publication-slots.mjs` own private record
  reads, atomic replacement, and the fixed-slot stage-full-then-exclusive-link
  protocol shared by authority records.
- `lifecycle.mjs` composes status, install, update, and uninstall without
  owning filesystem writes.
- `session-model.mjs`, `session-store.mjs`, `session-intent.mjs`,
  `session-transitions.mjs`, `session-create.mjs`, `session-operations.mjs`,
  `session-evidence-ack.mjs`, `session-evidence-operation.mjs`,
  `session-worker-pending.mjs`, `session-runner.mjs`, and the
  `session-lifecycle.mjs` facade own the closed
  managed-session records, durable creation/operation intents, private
  generation workspaces, ordered evidence progress, fixed worker allowlist,
  and public session receipts.
- `worker-guardian-state.mjs`, `worker-guardian-outcome.mjs`,
  `worker-guardian-client.mjs`, `worker-guardian.mjs`,
  `worker-process-group.mjs`, and `worker-group-sentinel.mjs` own durable
  lock-bound worker supervision, pure publication inspection, stale-lock
  outcome transfer, the activation/control protocol, aggregate-bounded raw
  worker streams, and sentinel-owned nonce-bound TERM-to-KILL proof of no
  continuing supervised user-code authority
  after parent loss. `session-guardian-recovery.mjs` consumes a bound outcome
  only after the corresponding durable session transition. `package-version.mjs` owns bounded version and
  package-relative entrypoint syntax shared by leases and target identity.
- `extension-profile-scan.mjs` owns the complete bounded stable Chrome
  extension-tree observation; `extension-profile.mjs` owns its trivalent public
  prerequisite classification.
- `session-target.mjs`, `snapshot-parser.mjs`, and `evidence-query.mjs` own
  focused bounded parsing and fixed query programs;
  caller-provided code is never admitted.
- `errors.mjs` owns content-free public error projection.

## Local Contracts

- The exact store is
  `$AOS_STATE_ROOT/{repo|installed}/browser/companion`; stored directories are
  mode `0700`, records are mode `0600`, and links or ownership/mode drift fail
  closed. A missing state root is created one normalized component at a time
  from an exact real existing ancestor; each created component and the shared
  mode/browser scaffold is validated and parent-fsynced before advancing.
- One exclusive lock serializes lifecycle mutations. Recovery requires an
  exact valid store sentinel. Empty interrupted-creation locks are recoverable;
  release and stale recovery atomically rename the whole lock to fixed
  `.lock-recovery`. Once authority is retired, exact cleanup residue is
  `partial` and cannot suppress a committed mutation receipt; active or
  ambiguous owners remain typed busy state.
- Store, lock, and removal-claim authority records are complete and fsynced
  before one no-replace link. Eight fixed purpose-named slots make admission
  filesystem-atomic; no pre-link slot is removed while the final is absent.
  Exact empty roots join owner bootstrap through exclusive directory creation.
  Bounded pre-link orphans and exact
  final-plus-same-inode pending pairs are visible recovery state; retry removes
  no pre-link name while the final is absent. Contenders race the exclusive
  link; after one final exists, retry removes only non-authoritative pending
  names and admits the final at link count one. Malformed finals and mismatched
  pairs fail closed.
- Acquisition uses descriptor URLs only, executes no package manager or
  lifecycle script, disables browser downloads, and keeps archive/cache/temp
  state in private staging.
- Validate every archive entry before materialization, verify the exact package
  manifests, dependency closure, entrypoint, inventory, and closure digest,
  then fsync the immutable version before one intent-backed atomic pointer
  replacement, and classify intent cleanup from its observed final presence.
  Uninstall journals the installed binding and acquires one exact dead-owner-
  recoverable browser-level cleanup claim before retiring the whole store. The
  still-journaled marker is atomically moved to a non-authoritative completed
  tombstone after store cleanup. Tombstone deletion first validates its journal,
  cleanup record, claims, and any exact short fixed publication slots carried by
  a late contender; every remaining public `partial` phase retains provenance,
  while tombstone cleanup cannot turn public `missing` back into partial state.
- Recursive cleanup runs only after quarantine and one final exact root
  identity check. This is a cooperative same-UID private-root protocol: it
  rejects preexisting/root links and never claims adversarial same-UID
  linearizability during the recursive system call.
- Public output never includes paths, URLs, package bytes, or captured tool
  output.
- A managed session is a lease on one immutable version. Publish a durable
  creation intent before the workspace and `starting` lease, all before spawn;
  publish
  `active` only after one bounded non-error JSON result. The actual child
  `spawn` event latches possible upstream authority. Mutations advance through
  `operating`/`operation_committed`; cleanup advances through
  `closing`/`cleanup_committed`, so recovery never replays an acknowledged effect.
  A fully validated worker result is durably acknowledged before its exact
  complete Guardian is retired. If retirement does not finish, normal lock
  release first transfers the complete Guardian outcome and public recovery
  remains pending without overwriting the acknowledgement. Evidence capture
  durably journals each validated navigate/query/screenshot boundary before
  retiring that subworker; only a final acknowledged journal plus
  `operation_committed` may recover active, and the journal is consumed last.
  A private non-enumerable pending signal carries only a validated worker value
  and the exact returned acknowledgement to its owning caller. Known
  acknowledgement or retirement uncertainty projects schema-valid
  `recovery_pending` without exposing the signal; a thrown or absent
  acknowledgement remains typed ambiguity and is never upgraded to success.
  Reject a 129th durable record before workspace, lease, or worker creation;
  public list is a bounded, noncreating, nonrepairing stable read.
  Post-spawn ambiguity and cleanup without exact close/detach acknowledgement
  remain `cleanup_required` with their record and private workspace retained.
  A provably pre-spawn failure first publishes `rollback_no_authority`, then
  idempotently closes any starting lease, validates and retires a present
  bounded partial workspace, retires a present closed lease, and clears/fsyncs
  the intent last. Already-absent rollback resources are admissible; intent
  publication or cleanup uncertainty remains explicit recovery state.
  Validate every lease and creation
  intent against its immutable version even when `active.json` is absent.
  Attached CDP/extension sessions are external-owned and use only `detach`;
  launched sessions select already-installed system Chrome with exact
  `--browser=chrome` and use `close`. Browser installation is never part of the
  managed closure. Extension attach conservatively proves the reviewed
  extension id through a bounded version directory and matching manifest in
  the login user's ordinary system-Chrome profile and passes only
  `PWTEST_EXTENSION_USER_DATA_DIR`; empty sets are unavailable while malformed
  or over-cap layouts are blocked. The worker `HOME` remains private. Never infer cleanup from PID state or call
  upstream list.
- Worker execution uses the descriptor-bound entrypoint, private cwd/cache/temp/
  daemon roots, `umask 077`, browser downloads disabled, sanitized environment,
  bounded output/artifacts/deadlines, operation-specific exact envelopes, and
  fixed operation argv. Browser locality, anchors, DOM hit testing, env paths,
  global packages, `npx`, generic eval/code, ref actions, or tab operations may
  not be added without a later ADR checkpoint.
- Default worker execution is mediated by one detached Node guardian bound to
  the exact store ID, lock token, public session, random generation, operation,
  and guardian nonce. The guardian is inert until the parent observes its real
  PID, exclusively publishes/fsyncs the exact `armed` reservation, and sends
  `activate`; worker spawn additionally requires an acknowledged exact request
  plus `execute`. Worker stdout/stderr remain separate raw streams under one
  aggregate operation cap no wider than the immutable descriptor's 65,536-byte
  capture bound. A small independent control fd reports authority and terminal
  metadata, while separate activation and lifetime fds make pre-execute loss
  finish `no_spawn`. A second detached Node sentinel is the stable group leader:
  it ignores TERM, supervises the one-shot upstream CLI and descendants, and
  remains alive until the forced path sends exact `retire`/`kill_group`
  controls. It synchronously acknowledges `pre_kill`, immediately sends
  SIGKILL to its own current group including itself, and the guardian accepts
  only that nonce-bound ACK plus exact sentinel SIGKILL exit, untruncated
  control EOF, both raw EOF witnesses, and the aggregate cap. Sink loss switches
  both raw relays to bounded drain/discard. It performs no later numeric-PGID
  signal or probe on that forced path. This is scoped to the same
  cooperative same-UID private-runtime boundary. Upstream daemons intentionally
  detached by the CLI are excluded and remain session authority.
  Upstream daemons intentionally detached by the CLI remain session authority
  and are later retired only by exact close/detach. Guardian publication
  inspection is byte- and name-preserving; only lock-owner transitions recover
  publication residue. Before stale-lock cleanup, the dead guardian's exact
  terminal or conservative authority result is durably transferred to a
  lock/session/generation/nonce/operation-bound pending outcome. Session
  recovery consumes that outcome last after rollback or cleanup-required is
  durable. Leader close cannot cancel escalation. A dead guardian at `armed` or
  `request_accepted` has no group authority; a dead validated `complete` record
  is clear without a group probe, while incomplete `group_armed` or
  `worker_spawned` records require conservative non-signaling group absence and
  recovery remains `authority_possible`.
  PID is liveness evidence only, never later signal authority.

## Work Guidance

- Keep each module at or below 350 lines and the public CLI at or below 200.
- Tests must use fake local tarball bytes through the injected downloader seam;
  no lifecycle test may use the network.

## Verification

- Run `node --test tests/browser/companion-authority-publication.test.mjs tests/browser/companion-lifecycle.test.mjs tests/browser/companion-recovery-transitions.test.mjs tests/browser/companion-removal-validation.test.mjs tests/browser/companion-staging.test.mjs` and
  `node --test tests/schemas/aos-browser-companion-v1.test.mjs`.
- For managed-session changes, also run
  `node --test tests/browser/managed-session-preflight.test.mjs tests/browser/managed-session-lifecycle.test.mjs tests/browser/managed-session-recovery.test.mjs tests/browser/managed-session-command.test.mjs tests/browser/managed-session-consumers.test.mjs tests/browser/managed-browser-swift-contract.test.mjs`
  plus `node --test tests/browser/managed-worker-request-framing.test.mjs tests/browser/managed-worker-guardian.test.mjs tests/browser/managed-worker-sequential.test.mjs tests/browser/managed-guardian-state.test.mjs` for exact EOF framing, guardian supervision, and per-invocation complete-record retirement, and
  `node --test tests/browser/managed-worker-acknowledgement.test.mjs` for
  acknowledgement-before-retirement and live-release recovery, and
  `bash tests/browser/target-parser.test.sh`.

## Child DOX Index
