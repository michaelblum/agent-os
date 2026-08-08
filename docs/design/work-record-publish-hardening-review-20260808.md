# Review: Work Record Publish-Path Hardening

Reviewed: 2026-08-08, Perplexity-side (per `agent-filter-resilience` Phase 4:
open-ended review of this code class does not survive the target stack's
automated filter — see skill registry, thread 019fe29a).
Commits under review: `3c788dee` (addon hardening), `fdb9bd21` (catalog
validation). Reviewer bar: fresh full review, xhigh-equivalent depth.
Credit: the second-order caller surface was first flagged by review thread
019fe29a before its session ended early; this review confirms and completes it.

## Verdict summary

| Component | Verdict |
|---|---|
| Addon hardening (`3c788dee`) | **PASS** — faithful to the contract, well-constructed |
| Catalog V1 validation (`fdb9bd21`) | **PASS** |
| Higher-level caller chain | **FAIL** — 11 failing tests across 4 suites; caller contract needs alignment |
| **Landing readiness** | **NOT YET** — one bounded remediation task first |

## 1. Addon hardening — PASS

Verified against the work-card contract, reading the full diff plus the
resulting `RollbackContent` implementation:

- **Atomic no-replace transfer.** `renameatx_np(parent, temp, parent, leaf,
  RENAME_EXCL | RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH)` replaces the
  former create-if-absent link. The staged inode moves under one name
  transition; nlink stays 1 throughout — every subsequent stability check is
  simplified and the whole remove-staged-entry phase is gone (128 lines
  deleted, zero residuals of `RemoveOwnedEntry`/`DiscardTempContent`).
- **Single continuous observer.** One `linkWatcher` on the staged descriptor,
  registered before content write and held through final readback. The former
  per-phase re-registrations (`tempLinkWatcher`, `publishedLinkWatcher`,
  `finalLinkWatcher`) are eliminated, closing the observation gaps.
- **Scrub-and-preserve rollback.** `RollbackContent` scrubs via the held
  descriptor (`ftruncate`+`fsync`), receipts `temp_file_leftover` /
  `destination_file_leftover` / `content_scrubbed`, and never removes a
  path-named entry. Notably: post-transfer failure scrubs the held descriptor
  — the published inode — while a third-party replacement at the destination
  path is a different inode and is untouched. Exactly the required semantic.
- **Descriptor readback.** Final readback reads the held staged descriptor
  (`O_RDWR` now), proving the bytes of the inode at the destination rather
  than whatever the path currently names. Destination-path identity is
  verified separately via `fstatat` + the retained `publishedEntryWatcher`.
- **Platform capability handling.** `EINVAL`/`ENOTSUP` from the transfer map
  to `DESCRIPTOR_RELATIVE_RENAME_UNSUPPORTED` — fail-closed capability
  detection, no silent fallback.
- Result contract: success is unconditionally `status: 'published'`,
  `temp_file_leftover: false`. The former published-with-`cleanup_failed`
  compound state no longer exists (see §3 Class B).
- Legacy suite edits are contract-driven and strengthen assertions; both
  owning AGENTS.md contracts were updated in the same commit.

No findings.

## 2. Catalog V1 validation — PASS

`createWorkRecordSubjectCatalogEntry` now rejects non-V1 records at
construction with a `TypeError` via `isValidWorkRecordV1`. Historical V0
bytes can no longer be wrapped into catalog entries. Matches the migration
doctrine. No findings.

## 3. Caller chain — FAIL (the remediation task)

`node --test` over the four caller suites yields **11 failures**
(replacement-writer 3, supersession-index 2, repair-bundle 3, repair-
finalizer 3), plus dead code and receipt drift confirmed by inspection:

**Class A — tests asserting the retired deletion model (8 tests).**
Tests named "…temp cleanup fails" (6) construct their scenario through the
removed staged-removal phase; "…never overwrites a destination created
during publication" (2) inject at `before_publish_link` (which still exists)
but assert `existsSync(temp_file) === false`. Under the hardened contract the
temp is scrubbed and *preserved* as an empty receipt. The behavior is
correct; the assertions model the old world. Fix: rework to scrub-and-
preserve receipt assertions (`content_scrubbed === true`, leftover exists,
zero length).

**Class B — caller receipts and operator guidance drift (2+ tests and live code).**
- `work-record-repair-finalizer.js` (lines ~232, ~248): recommends operator
  actions `inspect_published_*_and_cleanup_temp` — instructing cleanup of a
  receipt that is now intentionally preserved and already scrubbed. Actively
  wrong guidance post-hardening; reword to receipt inspection.
- `work-record-supersession-index.js` (lines ~365–372, ~396–397) and
  `work-record-repair-bundle.js` (line ~655): branches keyed on
  `published === true && status === 'cleanup_failed'` are unreachable — the
  addon no longer produces that compound state. Remove or realign.
- `work-record-replacement-writer.js` (lines ~816–830): receipts carry
  `temp_file_leftover` but not `destination_file_leftover` /
  `content_scrubbed`; the `REPLACEMENT_WRITER_TEMP_CLEANUP_FAILED` diagnostic
  describes the retired deletion-based cleanup. Propagate the new fields and
  reword.

**Class C — DECIDED 2026-08-08 (owner): idempotent-accept.**
"Replacement Writer treats identical bytes created during publication as
idempotent" injects identical content at the destination at
`before_publish_link`. Under `RENAME_EXCL` the transfer fails `EEXIST` and
flows through conflict inspection. Decision: the EEXIST inspection path must
map identical digests to the idempotent `already_exists` result, preserving
the existing consumer-facing behavior — repair/finalizer flows retry by
design, and a retry racing its own earlier attempt must finalize cleanly
rather than receipt a conflict. The change belongs in the JS-layer mapping of
the inspection result, not the addon.

## 4. Remediation dispatchability

The entire remediation is JS-layer receipt/vocabulary alignment plus test
rework — no sensitive-domain immersion required. It is suitable for a bounded
Codex session dispatched against this report: "align the caller chain with
the hardened publication contract per
`docs/design/work-record-publish-hardening-review-20260808.md`; Classes A and
B are mechanical; Class C is decided: idempotent-accept (see §3)." Acceptance: all four
caller suites green, plus the four original suites staying green.

## 5. Landing recommendation

Hold the landing until the caller-chain remediation lands and the full suite
set (4 original + 4 caller) is green in one run. The core hardening itself is
sound and needs no further changes.
