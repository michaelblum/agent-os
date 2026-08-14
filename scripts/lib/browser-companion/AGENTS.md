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

## Work Guidance

- Keep each module at or below 350 lines and the public CLI at or below 200.
- Tests must use fake local tarball bytes through the injected downloader seam;
  no lifecycle test may use the network.

## Verification

- Run `node --test tests/browser/companion-authority-publication.test.mjs tests/browser/companion-lifecycle.test.mjs tests/browser/companion-recovery-transitions.test.mjs tests/browser/companion-removal-validation.test.mjs tests/browser/companion-staging.test.mjs` and
  `node --test tests/schemas/aos-browser-companion-v1.test.mjs`.

## Child DOX Index
