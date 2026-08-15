# ADR 0041: Managed Playwright Companion Runtime

**Status:** Accepted
**Date:** 2026-08-14
**Amends:** ADR 0018's Playwright CLI companion boundary
**Governed by:** ADR 0040's ambient-authority and target-identity contract

## Context

AOS already adapts Playwright CLI for browser sessions, observation, navigation,
typing, keys, scrolling, and internal browser helpers. The repo wrapper currently
invokes exact `@playwright/cli@0.1.15` through `npx`, while the runtime resolver
also accepts an explicit override, a repo package, and `PATH` installations.
That is runtime discovery, not an AOS-owned installation lifecycle.

The existing `aos skills companion` surface is intentionally narrower. It
detects Playwright-owned skill packages and can describe a dry-run upstream
skill installation; it does not install the Playwright CLI package, browser
binaries, or browser extension.

Playwright CLI 0.1.15 exposes tab operations, but its list result carries only
mutable array index, title, URL, current state, and crashed state. Select and
close consume the mutable index without a stable tab identity or expected
revision. Its `tab-list` path also calls `ensureTab()`, which may create a blank
tab or close a crashed current tab. AOS therefore cannot expose that operation
as read-only or treat its ordinal as a public target handle.

## Decision

### Capability names and owners

The product capability is the **AOS-managed Playwright companion**.

- The installed npm package closure is the **managed tool/runtime**.
- AOS command validation and result translation form the **browser adapter**.
- A long-lived Playwright-owned process is a **session worker**, not the
  package lifecycle itself.
- The official Playwright browser extension is an **extension bridge**.

“Sidecar” names only an actual long-lived companion process. It does not name
the package manager, browser adapter, or extension.

### Public MVP

The staged public surface is atomic by checkpoint. Checkpoint 2A added only:

```text
aos browser companion status --json
aos browser companion install --json
aos browser companion update --json
aos browser companion uninstall --json
```

Checkpoint 2B adds managed session creation/list/removal through `aos focus`,
the existing session-only `aos do navigate|type|key|scroll` consumers,
whole-session `see` capture, path-free internal page identity, and Toolkit
evidence capture. It does not admit browser-window locality, DOM hit testing,
browser anchors, ref actions, or any tab command. A later checkpoint may add
`aos browser tabs new` as an
untargeted mutation against one exact registered live session; that future
receipt must not claim a stable identity for the new tab.

Public tab listing is deferred until the reviewed upstream runtime supplies a
genuinely non-mutating structured operation. Numeric-index select and close are
prohibited. Future targeted tab operations must use an ADR 0040 Observation Ref
or action-time Locator with mechanical stale, missing, and ambiguous rejection;
they must not introduce an index-handle target model.

### Managed package lifecycle

A source-owned descriptor fixes the reviewed package version, every package
tarball integrity, required dependency closure, Node requirement, and executable
entrypoint. Install and update never resolve an unreviewed `latest` version.

The managed runtime lives at
`$AOS_STATE_ROOT/{repo|installed}/browser/companion/`. The browser-companion
store module is its sole writer. The root and every stored directory are owned
by the current user at mode `0700`; records are mode `0600`. An owner sentinel
binds the store to the exact mode-scoped AOS state root. One exclusive store
lock serializes package installation, activation, session admission and
cleanup, update, and uninstall. Symlinked, mismatched, unlocked, or
group/world-accessible state fails closed.

A package change is downloaded as the exact descriptor-listed tarballs into a
private staging directory. No package lifecycle script runs. Extraction rejects
absolute or traversing names, symlinks, hard links, special files, unexpected
packages or dependencies, and entries outside staging. Package count, file
count, aggregate bytes, subprocess time, and captured output are bounded.
Browser downloads are disabled, and download cache and temporary output remain
inside the AOS-owned staging root. The entrypoint, installed package manifests,
tarball integrities, and closure digest are revalidated before activation.

Activation is one atomic pointer update after the staged version is complete.
The previously active pointer remains unchanged on every preactivation failure.
Leased immutable versions remain until their exact sessions are cleaned up;
other superseded versions are removed after activation. The MVP has no public
rollback operation. Uninstall removes only a sentinel-validated AOS-owned store
and only while no managed session lease exists.

All AOS browser execution uses a descriptor-matching managed runtime. The
current `AOS_PLAYWRIGHT_CLI`, repo package, `npx` wrapper, and `PATH` fallbacks
are retired atomically with the managed-runtime migration. Users may still run
their own Playwright CLI directly as an external escape hatch, but AOS does not
consume or attest it. Missing, corrupt, stale, or ambiguous managed state fails
closed rather than falling through to another executable.

Each managed session record binds a public session id, random 128-bit ownership
generation, separate random upstream worker-session id, AOS-owned workspace,
session state, attached-versus-launched ownership, exact managed package
version, descriptor digest, closure digest, and package-relative executable.
The public id is never passed directly to Playwright. A `starting` record is
bound to a durable creation intent and private workspace before spawn and
becomes `active` only after the exact worker is admitted. An observed child
`spawn` event latches possible upstream authority even if a later process error
arrives; cleanup failure remains durable instead of freeing the name or lease.
Public backend identity V2 is path-free and binds descriptor digest, closure
digest, bounded package version, package-relative entrypoint, and the random
session generation. Each retained older lease keeps its own exact immutable
binding after a newer runtime becomes active; no executable path becomes
identity authority.

Session creation, every managed command, cleanup, update, and uninstall hold the
same exclusive store lock while validating the current record and bound runtime.
Creation rejects a 129th durable record before creating a workspace, lease, or
worker process. `focus list` is a stable, bounded read-only inspection: it does
not create the store, acquire a writer lock, or retire even an empty legacy
registry.
The random upstream identity and one fixed, non-mutating exact-session eval
provide the worker liveness proof. AOS never calls upstream `list`. Missing or
ambiguous liveness changes the durable session to `cleanup_required`; numeric
PID is neither stored authority nor a cleanup signal handle.
Update may activate a new package for future sessions but cannot remove a
version named by any session record. Uninstall cannot begin while any managed
session record or creation intent remains. Removing the final lease on a
superseded immutable version retires that version under the same store lock and
merges any cleanup residue into the public recovery result.

### Browser and extension ownership

An AOS-launched browser session and an attached user browser are different
ownership classes:

- cleanup may close only the exact AOS-launched session it owns;
- cleanup of an attached browser may detach only the exact AOS session;
- AOS never treats the attached browser, profile, or its existing tabs as
  AOS-owned resources.

Launched sessions are nonpersistent by default. `--persistent` admits only the
profile rooted inside that AOS-owned session generation workspace; caller-
selected profile paths are unsupported. The workspace, daemon/session state,
cache, temporary output, and browser-download path are private and generation-
scoped. Browser downloads stay disabled. Launched sessions select the reviewed
system Chrome channel explicitly (`open --browser=chrome`), so Chrome must
already be installed and remains an external prerequisite rather than a
companion installation side effect. Initial and navigation URLs admit only
`http`, `https`, `data`, and `about`; local `file:` navigation is unsupported.

The official Playwright extension remains a separately installed,
user/profile-controlled dependency. AOS may report its prerequisite and
observed connection state, but it must not silently install, enable, configure,
or claim visibility across profiles, incognito contexts, restricted pages, or
other browsers.

A custom AOS browser extension is outside this decision. It would require a
separate protocol, permission minimization, signing/update model, and threat
review.

Official extension attachment uses the reviewed upstream channel form
`attach --extension=chrome`. AOS does not accept a custom extension path in the
managed MVP. Before mutation AOS conservatively inspects only the login user's
ordinary system-Chrome `Default` and `Profile N` layouts for the reviewed
extension. Missing evidence is unavailable; unsafe, changing, linked, or
unbounded profile state is blocked. An extension-id directory alone is not
evidence: at least one bounded ordinary version directory must contain a
bounded ordinary manifest whose declared version matches that directory. AOS
inspects the complete bounded ordinary profile/version set before reporting
installed; any malformed or over-cap member makes the result blocked. The
complete relevant Chrome/profile/extension/version tree is scanned twice and
must produce one stable bounded identity snapshot; bounded retries that remain
unstable are blocked rather than reported unavailable. The private worker
`HOME` remains isolated,
and only `PWTEST_EXTENSION_USER_DATA_DIR` receives the proven system-Chrome
root. The upstream handshake may launch or focus Chrome and open the
extension bridge page. Those are visible handshake effects, not an ownership
transfer: the browser, profile, and tabs remain external user-owned resources,
and cleanup uses only exact-session `detach`.

### Authority and target identity

This surface uses ADR 0040 ambient authority. It adds no AOS authorization
token, allowlist, risk label, mandatory approval, mandatory dry-run, or Work
Record prerequisite.

Mechanical correctness remains mandatory: exact package and session identity,
bounded subprocesses and output, typed failure, atomic activation, ownership-
correct cleanup, and receipts. Workers run only the descriptor-bound entrypoint
with a sanitized environment, private cwd/cache/temp/daemon roots, browser
downloads disabled, `umask 077`, one bounded JSON success envelope, nested
`isError` rejection, bounded artifacts/output/deadlines, and a fixed operation
allowlist. Start and cleanup require their operation-specific exact top-level
envelopes and exact random upstream-session binding; fixed tools require their
exact result envelope rather than accepting nested decoy status. Upstream
stdout, stderr, paths, URLs, endpoint text, and PIDs never
enter public receipts.

Every real worker is supervised by a detached Node guardian bound to the exact
store ID, current lock token, public session ID, random session generation,
operation, and guardian nonce. The guardian starts inert. After observing its
real PID, the lock-owning parent exclusively publishes and fsyncs the exact
PID-bound `armed` reservation; only then may it send `activate`. The guardian
revalidates the lock identity and reservation before acknowledging. It durably
publishes `request_accepted` before acknowledging the exact bounded request and
cannot spawn until the parent then sends `execute`. Loss before execute becomes
durable `complete/no_spawn`.

Worker stdout and stderr remain separate raw streams but share one aggregate
operation cap no wider than the immutable descriptor's 65,536-byte captured-
output bound. The small control fd carries only spawned/terminal metadata;
separate activation and lifetime fds remain open through terminal acknowledgement.
Parent loss, raw-stream sink or control-pipe loss, timeout, or output overflow retires the
whole one-shot CLI process group with bounded TERM-to-KILL escalation. A
detached Node sentinel is the stable group leader and ignores TERM. The
guardian sends an exact nonce-bound `retire`; after the sentinel synchronously
acknowledges `term_armed`, the sentinel sends TERM to its own current group.
After the grace period, an exact `kill_group` makes the sentinel synchronously
acknowledge `pre_kill` and immediately send SIGKILL to its own current group,
including itself. Forced completion requires that exact acknowledgement, the
sentinel's exact `{code:null, signal:"SIGKILL"}` exit witness, untruncated
control EOF, both bounded raw-stream EOF witnesses, and aggregate-cap compliance.
Raw relay backpressure is bounded; transport loss switches both streams to
drain/discard so it cannot suppress the terminal witnesses.
The guardian performs no later numeric-PGID signal or probe. This establishes
no continuing supervised user-code authority even if an early CLI leader has
closed. The claim is scoped to the cooperative same-UID private-runtime
boundary. The CLI may intentionally detach its
long-lived upstream daemon; that daemon remains managed session authority and
is retired only by the exact later close/detach operation. `complete` is not
published until the forced completion witnesses are exact. A dead guardian whose last
durable phase is `armed` or `request_accepted` has not established group
authority and may transfer `no_authority`; after `group_armed`, exact group
absence is required and the outcome remains conservative `authority_possible`.
PID is never later signal authority. Stale-lock recovery first requires the
guardian PID to be dead. A validated `complete` record is then clear without a
numeric group probe; only an incomplete `group_armed` or `worker_spawned`
record receives a conservative, non-signaling group-liveness probe.

Status, list, and dry-run inspect guardian authority publication without
repairing fixed slots, link pairs, records, or directory names. Only the lock
owner or exact dead-owner stale-lock recovery may mutate that publication.
Before stale recovery removes a guardian record, it durably publishes a closed
pending outcome bound to the store, retired lock token, public session,
generation, guardian nonce, and operation. A proven pre-spawn outcome permits
`rollback_no_authority`; a spawned or otherwise unproven outcome requires
`cleanup_required`. Recovery consumes the outcome last, after the corresponding
session/intent transition and directory sync, so interruption cannot erase the
only durable authority classification. If interruption lands after that
transition but before outcome consumption, recovery admits only the exact
already-applied generation, operation, authority, and terminal-state matrix;
every mismatched combination remains corrupt. Inner sentinel requests and outer
guardian requests are accepted only after EOF closes one exact final-newline
JSON frame; prefixes, trailing bytes, and second frames never reach worker
spawn. A delayed request-write failure after the exact acceptance control is
non-authoritative, while the same failure before acceptance is terminal.

Every mutating worker request first publishes a generation-bound operation
nonce. `operating` recovers to `cleanup_required`; an exact acknowledged
operation first becomes `operation_committed` and recovers to `active` without
replay. Cleanup similarly advances through `closing`, `cleanup_committed`, and
`closed`, so an acknowledged close or detach is never repeated after a record-
publication interruption. Public receipt variants bind status, public session
state, cleanup requirement, and recovery state exactly; non-authoritative lock
cleanup residue is merged as recovery pending without falsely requiring session
cleanup. A proven pre-spawn liveness or cleanup failure durably restores the
session to `active` and returns the typed worker failure; only spawned or
otherwise ambiguous authority requires cleanup. The only checkpoint-2B
browser dry-run is session-only scroll: it performs grammar and stable record
validation without liveness, worker dispatch, lock creation, or state writes.

Acknowledgement precedes Guardian retirement. The runner first validates the
operation-specific envelope and any bounded artifact, then durably publishes
`acknowledged`, `operation_committed`, or `cleanup_committed`, and only then
retires the exact complete Guardian. A retirement interruption never rewrites
that acknowledgement: live lock release transfers the bound complete outcome,
and recovery converges state before consuming the outcome. Evidence capture
uses one bounded private journal keyed by session, generation, and outer
operation nonce. Each validated navigate, query, or screenshot step is appended
and fsynced before that subworker Guardian retires. Progress without final
acknowledgement recovers `cleanup_required`; final acknowledged evidence plus
`operation_committed` recovers `active`. The journal is consumed last, so a
successor never starts across an unrecorded or incompletely retired boundary.
The runner distinguishes an acknowledgement callback that failed or returned
no record from a validated result whose exact acknowledgement record was
returned. Only the latter travels through a private, non-enumerable pending
signal. Creation, accepted cleanup, ordinary operations, liveness, and final
evidence then project schema-valid `recovery_pending` results while retaining
the Guardian for outcome transfer. Unknown acknowledgement remains a typed
failure and cannot manufacture success. Intermediate evidence progress remains
cleanup-required and starts no successor.

For creation, the intent precedes both the private workspace and starting
lease. A provably pre-spawn failure first durably changes that intent to
`rollback_no_authority`, then idempotently closes a present starting lease,
validates and retires a present bounded partially-created workspace, retires a
present closed lease, and clears/fsyncs the intent last. Already-absent rollback
resources are admissible. Every interruption before that last step retains the
intent as recovery authority; post-unlink directory-sync uncertainty remains
an explicit recovery-pending result.

Decoded screenshots are limited to 32 MiB; the Swift broker accepts at most a
48 MiB combined JSON envelope so base64 expansion fits without weakening the
decoded artifact bound. Toolkit file and relative-fixture inputs are limited to
exactly 3000 bytes before data-URL projection, which keeps their complete data
URL within the worker's 4096-byte URL admission. Installed staging carries a closed command
registry containing only the help forms routed by the staged external manifest.

Managed package provenance and generation identity do not make browser refs an
admitted action surface. Browser ref actions remain fail-closed in checkpoint
2B; no generic eval/run-code/install command, arbitrary upstream command,
runtime fallback, or ref-reacquisition path exists.

## Non-Goals

- Public `tabs list` on Playwright CLI 0.1.15.
- Public `tabs new` in checkpoints 2A or 2B.
- Public numeric-index tab select or close.
- Stable identity or cleanup ownership for a newly opened tab.
- A custom AOS browser extension.
- Browser binary, skill package, or extension installation.
- Global npm installation, implicit update, or dynamic `latest` resolution.
- Storage, cookie, network interception, tracing, video, PDF, arbitrary code,
  or broad process-kill wrappers.
- Repairing browser DOM ref actionability.

## Consequences

- ADR 0018 continues to own installable AOS skills and external Playwright-owned
  skill content. This ADR owns the separate Playwright CLI runtime lifecycle.
- Public commands, source manifests, generated help, schemas, API/capability
  docs, browser skill guidance, and proof routing must land atomically with the
  implementation they describe.
- Package, browser binary, AOS skill, official extension, and any future custom
  extension remain distinct supply-chain assets.
- A reviewed Playwright CLI version change requires a source descriptor change
  and deterministic package, lifecycle, managed-session, and command proofs.

## Verification

Acceptance proceeds without a live browser first:

1. schema and source-descriptor validation;
2. fake/offline package download, integrity, partial-install, activation-failure,
   lease, uninstall, and managed-only runtime tests;
3. fake-session command tests proving durable registered-session admission,
   bounded output and workspace containment, exact close-versus-detach
   ownership, cleanup ambiguity retention, installed consumer staging, and
   continued rejection of ref actions and every tab operation;
4. real disposable Node subprocess tests proving inert guardian activation,
   parent-published PID-bound arming, mutation-free publication inspection,
   identity-bound stale-lock outcome recovery, aggregate descriptor output
   caps, pre-request parent loss, raw/control transport-loss draining,
   sentinel-owned TERM-to-KILL retirement with exact exit and three EOF
   witnesses, no continuing supervised user-code authority, and intentional detached-daemon preservation until
   exact session cleanup;
5. manifest/help/API/skill/proof-routing drift checks;
6. installed-runtime packaging from an unrelated caller directory.

Any live browser, extension, native, or TCC-sensitive proof is a separate,
explicitly authorized acceptance lane using a disposable AOS-launched profile.
