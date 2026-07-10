# App-Owned Operator Selection/Annotation V0 Live Proof

Date: 2026-07-05

Status: passed for route/queue V0; saved-ref/action proof remains open

## Scope

This guarded proof used the non-Sigil `operator-fixture` experience and the
generic status-item menu route. It did not rebuild or re-sign the AOS binary,
and no TCC reset or permission repair was run.

This is not a full epic #584 completion proof. The annotation created here used
`fallback_only` capability, so this report proves routing, queue lifecycle, and
evidence linking only. A saved-ref or explicit fallback action/readback proof
remains required before claiming the full action loop complete.

## Commands And Evidence

- Preflight:
  - `./aos ready --json` returned ready.
  - `node scripts/aos-dev-build.mjs build --no-restart --json` returned `binary_rebuilt:false` and
    `binary_resigned:false`.
- Activated fixture:
  - `./aos experience activate operator-fixture --json --allow-start`
  - Active route: `status_item.menu_action` to `aos.operator_annotation.start`.
- Mounted operator surface:
  - `operator-fixture-surface`
  - URL: `aos://toolkit/runtime/_smoke/operator-annotation.html`
  - At proof time, activation appended `?aos_manifest_menu=...` so the smoke
    surface received menu/action data projected from the manifest rather than
    owning a duplicate fixture menu.
- Posted menu action:
  - `./aos show post --id operator-fixture-surface --event ...`
  - Surface state changed from `idle` to `selecting`.
- Observed before state:
  - `./aos see capture main --save --workspace operator-proof --mode som`
  - Snapshot: `snap-20260705-233441Z-yrg9q5uc`
  - Ref count: 336
- Created pending annotation:
  - ID: `ann-live-proof-20260705T233429Z`
  - Record:
    `/Users/Michael/.config/aos/repo/pending-annotations/records/ann-live-proof-20260705T233429Z.json`
  - Comment: `Live proof optional comment from operator fixture route`
  - Capability: `fallback_only`
- Agent lifecycle:
  - `list --state pending` included the annotation.
  - `read` returned compact target/comment/fallback evidence.
  - `consume` transitioned the annotation to `consumed`.
  - A second `consume` failed closed with
    `PENDING_ANNOTATION_NOT_CONSUMABLE`.
- Re-observed after state:
  - Snapshot: `snap-20260705-233503Z-wuj7hg1a`
  - Ref count: 336
- Linked action/readback evidence:
  - `aos see annotation link-work-record ann-live-proof-20260705T233429Z`
  - Ref: `work-record:operator-annotation-live-proof-20260705T233429Z`
  - Relationship: `annotation_live_proof_evidence`

## Artifact Paths

- Proof root:
  `/tmp/aos-operator-annotation-live-proof-20260705T233429Z`
- Proof summary:
  `/tmp/aos-operator-annotation-live-proof-20260705T233429Z/proof-summary.json`
- Before capture:
  `/tmp/aos-operator-annotation-live-proof-20260705T233429Z/before-capture.json`
- After capture:
  `/tmp/aos-operator-annotation-live-proof-20260705T233429Z/after-capture.json`
- Linked annotation readback:
  `/tmp/aos-operator-annotation-live-proof-20260705T233429Z/annotation-read-linked.json`
- After capture image:
  `/Users/Michael/.config/aos/repo/agent-workspaces/operator-proof/snapshots/snap-20260705-233503Z-wuj7hg1a/artifacts/capture.png`

## Cleanup

- Removed `operator-fixture-surface`.
- Reactivated Sigil:
  `./aos experience activate sigil --json --allow-start`.
- Sigil activation reconciled stale branch-scoped content roots and restored the
  status item target to `aos://sigil/renderer/index.html?toolkit-root=toolkit`.

## Remaining Proof Gap

Epic #584 still needs a saved-ref or explicit fallback action/readback proof
with before/after evidence. This report should be cited only as route/queue V0
proof.
