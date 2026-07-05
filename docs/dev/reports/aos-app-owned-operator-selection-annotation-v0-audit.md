# App-Owned Operator Selection/Annotation V0 Audit

Date: 2026-07-05

Epic: https://github.com/michaelblum/agent-os/issues/584

## Start-State Evidence

- Branch start: `main` at `b066586c1b5f1dcfd56c16bad40bdf4d92c71beb`.
- Upstream: `origin/main`.
- Worktree start: clean.
- Runtime readiness: `./aos ready --json` returned `ready: true`.
- Runtime note: active Sigil status item target drift was reported, but this
  static contract/CLI slice did not require live status-item mutation.

## Current Surface Classification

- Reusable:
  - `aos experience activate <id>` and app/experience manifests already own
    app-owned activation and status item configuration.
  - Native status item dispatch already emits generic `status_item.toggle` and
    `status_item.menu_action`.
  - `aos see capture --save`, `aos see refs`, and saved-ref action dry-runs
    already provide compact perception, stable refs where available, honest
    fallback limits, and structured next-command recommendations.
  - Toolkit/workbench annotation, selection, Surface Inspector, human
    checkpoint, and guided-user-signal helpers provide reusable input/session
    vocabulary for future UI wiring.
- Exemplar-only:
  - Sigil status-item menu behavior, radial/reticle behavior, and
    `window.__sigilDebug` dispatch helpers remain Sigil consumer/example code.
  - Sigil `apps/sigil/aos-app.json` proves app-owned status-item declaration
    but is not the reusable operator queue contract.
- Out of scope for this slice:
  - Live status-item mutation, TCC repair, native rebuild/signing, automatic
    replay, Med Ops-specific code, Hammerspoon/cua integration, and broad native
    AX support claims.
- Missing before this slice:
  - No runtime-mode-scoped pending annotation queue existed for agents to
    list/read/consume exactly once.

## Smallest V0 Path

1. Define a neutral pending annotation record contract with target summary,
   optional comment, saved-ref linkage, fallback evidence, capability status,
   disk-backed artifact refs, structured next-command argv, and Work Record
   link slots.
2. Add a compact CLI lifecycle under `aos see annotation`:
   `create`, `list`, `read`, `consume`, and `delete`.
3. Scope state under `$AOS_STATE_ROOT/{repo|installed}/pending-annotations/`.
4. Make `consume` fail closed for any non-`pending` record.
5. Keep stdout compact and preserve heavy evidence by path only.
6. Project compact saved capture/ref readback into the pending queue before
   any live app-owned UI wiring.
7. Add generic app-owned status/menu routing and a non-Sigil fixture before
   running guarded live proof.
8. Run guarded live proof only after deterministic queue, routing, and surface
   coverage is stable.

## Implemented In This Slice

- `aos.pending-annotation.v0` JSON schema and schema documentation.
- `scripts/lib/pending-annotations.mjs` runtime-mode-scoped store helper with
  atomic writes and corrupt-state failure.
- `scripts/aos-pending-annotation.mjs` CLI adapter.
- `aos see annotation ...` command registry and external routes.
- `create --from-capture-json <path|-> [--ref <id>]` projection from compact
  saved capture or refs readback into browser, canvas, native AX, fallback,
  stale, unsupported, or ambiguous annotation records.
- `consume` now fails closed for `unsupported`, `ambiguous`, or `blocked`
  capability statuses even when a record is still structurally `pending`.
- Non-Sigil `operator-fixture` experience manifest with an
  `operator_annotation` status-item menu affordance targeting a mounted
  operator surface.
- Toolkit runtime helpers that project `operator_annotation` menu entries into
  native status menu descriptors and route generic `status_item.menu_action`
  events to `aos.operator_annotation.start`.
- Experience activation now removes a same-id live toggle canvas when its URL
  does not match the newly configured status-item target, including the case
  where the previous status-item target was a different canvas id.
- Minimal toolkit operator annotation surface state model for
  start/comment/commit/cancel, with pending annotation writes injected through a
  storage adapter.
- `aos see annotation link-work-record` for attaching action/readback Work
  Record evidence refs and path-backed artifacts to an annotation without
  mutating Work Records or adding replay.
- API docs for pending annotations in the target ladder and `aos see` reference.
- Deterministic tests for saved-ref records, browser/canvas/native capture
  projection, fallback-only capture projection, stale/unsupported/ambiguous
  failure states, corrupt state, non-Sigil status-item operator menu routing,
  operator surface state transitions, Work Record evidence linking, and external
  command dispatch.

## Guarded Live Proof

- Live proof report:
  `docs/dev/reports/aos-app-owned-operator-selection-annotation-v0-live-proof.md`.
- Proof root:
  `/tmp/aos-operator-annotation-live-proof-20260705T233429Z`.
- Fixture activation:
  `./aos experience activate operator-fixture --json --allow-start`.
- Generic menu route:
  `status_item.menu_action` to `aos.operator_annotation.start` on
  `operator-fixture-surface`.
- Annotation:
  `ann-live-proof-20260705T233429Z`.
- Annotation record:
  `/Users/Michael/.config/aos/repo/pending-annotations/records/ann-live-proof-20260705T233429Z.json`.
- Before/after saved perception snapshots:
  `snap-20260705-233441Z-yrg9q5uc` and
  `snap-20260705-233503Z-wuj7hg1a`.
- Consume-once proof:
  the first consume returned `consumed`; the second consume failed closed with
  `PENDING_ANNOTATION_NOT_CONSUMABLE`.
- Evidence link:
  `work-record:operator-annotation-live-proof-20260705T233429Z` with
  before/after capture artifacts.
- Cleanup:
  removed `operator-fixture-surface` and reactivated Sigil. Sigil activation
  reconciled stale branch-scoped roots and restored the status item target.
- No TCC-owning binary was rebuilt or re-signed; no TCC reset or permission
  repair was run.
