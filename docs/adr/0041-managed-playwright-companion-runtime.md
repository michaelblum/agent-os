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

The first public surface consists of:

```text
aos browser companion status --json
aos browser companion install --json
aos browser companion update --json
aos browser companion uninstall --json
aos browser tabs new --session <registered-session> [--url <url>] --json
```

`tabs new` is an untargeted mutation against one exact registered live session.
It returns a bounded typed receipt and does not claim a stable identity for the
new tab.

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
durable before spawn and becomes `active` only after the exact worker is
admitted; cleanup failure remains durable instead of freeing the name or lease.

Session creation, every managed command, cleanup, update, and uninstall hold the
same exclusive store lock while validating the current record and bound runtime.
The random upstream identity and a successful exact-session command provide the
worker liveness proof; numeric PID is evidence only and never signal authority.
Update may activate a new package for future sessions but cannot remove a
version named by any session record. Uninstall cannot begin while any managed
session record remains.

### Browser and extension ownership

An AOS-launched browser session and an attached user browser are different
ownership classes:

- cleanup may close only the exact AOS-launched session it owns;
- cleanup of an attached browser may detach only the exact AOS session;
- AOS never treats the attached browser, profile, or its existing tabs as
  AOS-owned resources.

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
managed MVP.

### Authority and target identity

This surface uses ADR 0040 ambient authority. It adds no AOS authorization
token, allowlist, risk label, mandatory approval, mandatory dry-run, or Work
Record prerequisite.

Mechanical correctness remains mandatory: exact package and session identity,
bounded subprocesses and output, typed failure, atomic activation, ownership-
correct cleanup, and receipts. Managed package provenance does not solve stale
DOM Observation Refs. Browser ref actions remain fail-closed until one backend
operation can atomically bind the original AOS capture generation to current ref
resolution and action.

## Non-Goals

- Public `tabs list` on Playwright CLI 0.1.15.
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
  and deterministic package, resolver, session, and command proofs.

## Verification

Acceptance proceeds without a live browser first:

1. schema and source-descriptor validation;
2. fake/offline package download, integrity, partial-install, activation-failure,
   lease, uninstall, and managed-only resolver tests;
3. fake-session command tests proving registered-session admission, bounded
   output, attach-versus-launched ownership, and continued rejection of tab
   listing and numeric targeting;
4. manifest/help/API/skill/proof-routing drift checks;
5. installed-runtime packaging from an unrelated caller directory.

Any live browser, extension, native, or TCC-sensitive proof is a separate,
explicitly authorized acceptance lane using a disposable AOS-launched profile.
