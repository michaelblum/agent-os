# Work Card: Work Record Publish-Path Hardening

Status: active dispatch context
Branch: `wip/work-record-v1-migration-checkpoint`
Checkpoint: `1ea8a06f` (safety checkpoint of the V1 migration + hardening start)
Authored: 2026-08-08

## Scope

Finish the descriptor-relative publication hardening for
`packages/toolkit/workbench/work-record-atomic-publish.js` and its native
primitive `src/platform/descriptor-relative-fs-addon.cc`, so the Work Record
V1 authority-excision migration (already validated statically, 215/215 tests)
can land. This card supersedes all prior handoffs for this work item.

## Confirmed defects (review-validated, reproduction complete)

All three findings below were independently reviewed and locally confirmed.
**The confirmation phase is complete. Do not re-derive or re-demonstrate
them.** The remaining work is implementation plus the acceptance tests listed
below.

1. **Rollback can remove an entry it does not own.**
   `RollbackContent`/`RemoveOwnedEntry` in the addon compare a path-named
   entry against a sampled identity and then remove it by name. An entry
   legitimately created at that name between the compare and the remove
   (e.g., a concurrent writer re-creating the destination) is removed along
   with it. Correct behavior: destroy staged content through the held
   descriptor (`ftruncate`+`fsync`), then preserve-or-fail — leave the empty
   staged entry in place with a receipt (`content_scrubbed`,
   `destination_file_leftover`, `temp_file_leftover`) rather than removing any
   path-named entry whose current identity cannot be proven.
2. **Change-observation gaps between observer re-registrations.**
   The addon registers a fresh kqueue observer per phase
   (`tempLinkWatcher`, `publishedLinkWatcher`, `finalLinkWatcher`). A new
   registration cannot observe activity that completed before it, so link
   churn landing in an inter-phase gap is invisible and the final link-count
   checks pass. Correct behavior: one continuous observer on the staged
   entry, registered before content write and held through final readback.
3. **Catalog constructs active entries from historical V0 bytes.**
   `createWorkRecordSubjectCatalogEntry` in
   `packages/toolkit/workbench/subject-catalog.js` accepts frozen V0
   fixtures and returns an openable active entry. Correct behavior: validate
   the record as V1 at construction; V0 bytes are historical-only and must be
   rejected (or produced as a non-openable entry).

## Fix direction (validated)

- Success path: stage under a private temp name, then publish with a single
  atomic no-replace descriptor-relative transfer:
  `renameatx_np(parent, temp, parent, leaf, RENAME_EXCL | RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH)`.
  Platform support is confirmed by
  `tests/toolkit/work-record-publish-platform-contract.test.mjs`.
- Failure path: scrub staged content via the held descriptor, preserve the
  empty staged entry, and receipt exactly what remains. Never remove by name
  during rollback.
- One continuous link-change observer across staging through readback.
- V1 validation at subject-catalog construction.

## Acceptance

Run, in order:

```sh
node --test tests/toolkit/work-record-publish-platform-contract.test.mjs  # passes now; guards the foundation
node --test tests/toolkit/work-record-publish-hardening.test.mjs          # fails now; must pass after the fix
node --test tests/toolkit/work-record-atomic-publish.test.mjs             # existing suite; must stay green
node --test tests/toolkit/subject-catalog.test.mjs                        # existing suite; must stay green
```

The hardening suite's expectations are the contract. Do not weaken them to
match current behavior; change the implementation.

## Working agreements for the implementing session

- **Commit after every validated increment** to
  `wip/work-record-v1-migration-checkpoint`. No more than one step of
  uncommitted work at any time. (See root `AGENTS.md` checkpoint invariant.)
- Use sub-agents freely; all work coordinates on the single shared worktree.
  Never create worktrees that own an `aos` binary/daemon or compete for
  singleton resources (TCC, daemon identity): concurrent `aos` consumers such
  as sigil conflict in insidious ways. Writes are serial by default; parallel
  writer sub-agents are permitted when the orchestrator bounds them
  intelligently within the shared worktree (sub-agents can message/steer each
  other). No `./aos`, daemon, native UI, TCC, Sigil, push, PR, or GitHub
  mutation. Session orchestration method is otherwise intentionally unprescribed.
- All platform facts needed are already verified locally (SDK headers and the
  platform contract probe). **No external research is required** for this
  implementation.
- Rebuild the native primitive after editing the addon:
  `node scripts/build-work-record-native.mjs`.
- Describe the work in correctness terms (publication integrity, rollback
  receipts, observation continuity, version validation) — that is what this
  is.
- The first patch of the hardening is already applied at the checkpoint:
  result fields `destination_file_leftover` and `content_scrubbed` exist in
  the addon source but are not yet populated by rollback logic or compiled
  into the staged binary.

## Follow-up surface (identified 2026-08-08, review thread 019fe29a)

A fresh review verified the acceptance suites green and then identified a
second-order coverage gap before its session ended early (external automated
filter; no technical failure): higher-level callers — Replacement Writer,
supersession, bundle assembly, and finalizer receipts — still encode the
retired staged-entry removal phase and do not carry the new
`content_scrubbed` / leftover receipt fields. RESOLVED as confirmed 2026-08-08:
the completed review (docs/design/work-record-publish-hardening-review-20260808.md)
verifies the addon and catalog changes PASS, and characterizes the caller
gap as 11 failing tests across 4 suites in three classes (mechanical test
rework, receipt/operator-guidance alignment, and identical-bytes-during-
publication idempotency — DECIDED 2026-08-08 as idempotent-accept).
Remediation is dispatchable as a bounded JS-layer task per that report.

## Prior context (historical, do not re-execute)

Threads 019fd8c1 (migration), 019fde86 / 019fdf29 / 019fdf45 (hardening
attempt + reviews, 2026-08-07) ended early for non-technical reasons with
work preserved uncommitted; that state is now committed at `1ea8a06f`.
