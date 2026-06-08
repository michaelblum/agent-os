# Perceive Semantic Target Canonical Cutover V0

## Recipient

Implementer implementation round.

## Branch / Base

- branch_from: `origin/main` at
  `9665dd324a9663354f87caab575eab90155c8027`
- expected output branch: `implementer/perceive-semantic-target-canonical-cutover-v0`
- PR #400 has merged to `main`; treat the canonical normalizer as already
  present.

This is the slice that lets issue #399 close. PR #400 cut the toolkit/workbench
producers to the canonical `agent_ui_target` shape but left transitional
old-spelling fallbacks because the **native `perceive` producer** still emits a
divergent flat record. This card migrates that last producer and then deletes
the fallbacks.

## Source Artifact

- Issue #399 "Track removal of transitional semantic target identity sniffers":
  https://github.com/michaelblum/agent-os/issues/399
- Direction and gates: `docs/design/agent-ui-affordance-synthesis-v0-review.md`
- Canonical producer landed by PR #400:
  `packages/toolkit/runtime/semantic-targets.js` `normalizeAgentUiTarget(...)`
- Conformance pack: `docs/design/fixtures/agent-ui-target-conformance-v0/`

Foreman has settled two design questions; treat them as controlling:

1. **`do_target` stays.** It is the action-routing identity
   (`canvas:<canvas-id>/<ref>`) consumed by `src/act/canvas-ref-targeting.swift`
   for `aos do` input targeting. It is NOT a legacy spelling of `ref` and must
   NOT be folded into `ref`. It moves into the canonical envelope as a derived
   routing/provenance field, not a second top-level identity.
2. **No compatibility aliases.** This is an intentional breaking cutover of a
   published contract. Update the wire contract, schema, SDK type, and the act
   consumer in lockstep. Do not preserve `target_id`/`aos_ref`/`data_aos_ref`
   producer spellings behind aliases.

**Reshape the wire, not a JS-side adapter.** A JS ingestion adapter that
converts the divergent native record to canonical was considered and rejected:
the `aos see` semantic-target shape is not toolkit-internal. It is exposed by
the published `@agent-os/gateway` SDK (`packages/gateway/sdk/aos-sdk.d.ts`
`capture().semantic_targets`, `packages/gateway/src/aos-proxy.ts`, generated
`packages/gateway/dist/aos-proxy.d.ts`) and consumed by a Sigil renderer
live-module (`apps/sigil/renderer/live-modules/main.js`) and the Swift act
layer. An adapter would leave the published SDK contract divergent — the exact
incoherence this cutover exists to remove. Make the producer canonical at the
source so there is one shape across the whole wire.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Read First

- `AGENTS.md` (root) and `src/perceive/AGENTS.md` if present
- `docs/design/agent-ui-affordance-synthesis-v0-review.md`
- `packages/toolkit/runtime/semantic-targets.js` (the canonical envelope)
- `src/perceive/semantic-targets.swift` (the divergent flat producer)
- `src/perceive/models.swift` (`AOSSemanticTargetJSON`,
  `AOSSemanticTargetStateJSON`)
- `src/act/canvas-ref-targeting.swift` (the `do_target` consumer)
- `packages/gateway/sdk/aos-sdk.d.ts` (published semantic-target type)
- `packages/gateway/src/aos-proxy.ts` and generated
  `packages/gateway/dist/aos-proxy.d.ts` (gateway SDK surface)
- `apps/sigil/renderer/live-modules/main.js` (Sigil renderer consumer of the
  `aos see` semantic-target shape)
- `packages/toolkit/workbench/annotation-projection.js`
  (`buildSemanticTargetProjectionAdapterResult`)
- `packages/toolkit/components/surface-inspector/index.js`
  (`semanticTargetIdentifier`, `buildRevealPayloadForSurfaceInspectorPin`,
  `buildRevealTargetEvalScript`)
- relevant `shared/schemas/` semantic-target schema and `docs/api/` page for
  `aos see` semantic-target output

## Rediscover State

```bash
git status --short --branch
git rev-parse HEAD
gh issue view 399 --json number,title,state,url,body
# Native producer + its shape:
rg -n "AOSSemanticTargetJSON|do_target|parent_canvas|aos_ref|data_aos_ref|target_id" src/perceive src/act
# Remaining JS-side transitional fallbacks this card should be able to delete:
rg -n "target_id|semantic_target_id|do_target|data_aos_ref|aos_ref|Removal gate" packages/toolkit/workbench/annotation-projection.js packages/toolkit/components/surface-inspector/index.js packages/toolkit/components/html-workbench-expression/index.js
# Wire/SDK contract surface:
rg -n "SemanticTarget|do_target|aos_ref|parent_canvas|ref" packages/gateway/sdk/aos-sdk.d.ts shared/schemas docs/api
```

### Native build / runtime

This slice changes Swift. Before build choices run `./aos dev recommend --json`
and build with `./aos dev build`, not raw `bash build.sh`. Live `aos see`
verification on a real canvas needs Accessibility/Screen Recording; if repo-mode
permissions block it, run the manual TCC blocker report path, stop with
`manual_intervention`, and resume with `./aos ready --post-permission`. The producer
JSON shape itself is verifiable deterministically (see Verification).

## Required Behavior

### Native producer: emit the canonical envelope

- Reshape `AOSSemanticTargetJSON` (`src/perceive/models.swift`) and the JS
  probe in `src/perceive/semantic-targets.swift` so `aos see` semantic-target
  output is the canonical `agent_ui_target` record:
  `ref` (sole top-level identity), `surface`, `role`, `name`, `kind`,
  `enabled`, `state{value,current,pressed,selected,checked,expanded}`,
  `actions[]`, `extension{}`, `provenance{}`.
- `ref` comes from harvested `data-aos-ref` (already done at the DOM probe).
- `enabled` is top-level; fold the old flat `state.disabled` accordingly.
- `action` (singular) becomes a one-item `actions[]` when present, matching
  `normalizeAgentUiTarget`'s actions rule.
- `bounds`/`center` geometry and `parent_canvas` move under `provenance`
  (geometry is observation/provenance, not producer identity). Match the field
  names the canonical envelope and projection layer already use.
- `do_target` is preserved as the derived canvas-scoped routing field. Keep its
  `canvas:<canvas-id>/<ref>` format. Place it where the act layer can still read
  it (under `provenance`, or a clearly-named routing field) — not as a
  top-level identity competing with `ref`.
- Do not emit top-level `id` as an identity twin of `ref`; if a local DOM slug
  is still needed downstream, carry it under `provenance`/`extension`.

### Act consumer: read the new shape

- Update `src/act/canvas-ref-targeting.swift` (and its `CanvasSemanticTarget`
  decode) to read `ref`, geometry, and `do_target` from the new canonical
  location, preserving `aos do` canvas-ref input targeting exactly.

### Wire contract, schema, SDK

- Update the semantic-target schema under `shared/schemas/` and the `docs/api/`
  page for `aos see` semantic-target output to the canonical shape.
- Update the published type in `packages/gateway/sdk/aos-sdk.d.ts`
  (`capture().semantic_targets`) to match, plus `packages/gateway/src/aos-proxy.ts`
  and the generated `packages/gateway/dist/aos-proxy.d.ts`. This is a deliberate
  breaking change to the SDK type — make it clean, no alias fields.
- Update `apps/sigil/renderer/live-modules/main.js` to read the canonical shape
  if it depends on the old flat fields.

### Delete the transitional fallbacks (the #399 payoff)

- Once the native producer is canonical, remove the now-dead old-spelling
  consumer fallbacks:
  - `semanticTargetIdentifier(...)` legacy chain in
    `surface-inspector/index.js`;
  - the legacy re-emission block in `buildRevealPayloadForSurfaceInspectorPin`
    (`target_id`/`semantic_target_id`/`data_aos_ref`/`aos_ref` outputs);
  - the legacy branches in `buildRevealTargetEvalScript`;
  - the old-spelling arm of `buildSemanticTargetProjectionAdapterResult` and the
    dual `reveal_eligible` read in `annotation-projection.js`;
  - the duplicated `targetRef`/`targetDomId` accessors that only existed to
    paper over the drift.
- Delete every "Removal gate ... #399" comment as its code goes.
- Keep `ref` as the join identity. Read selectors/DOM ids only as
  reveal/provenance hints.

### Close the loop

- Update the conformance pack so the native/Surface-Inspector producer is no
  longer listed as remaining drift, and the mapping table no longer cites
  `target_id`/`aos_ref`/`data_aos_ref` as current producer spellings.
- Prepare issue #399 for closure (note in completion report; Foreman closes).

## Scope

Native `perceive` producer + `act` consumer (Swift), the `aos see`
semantic-target wire contract (`shared/schemas/`, `docs/api/`), the gateway SDK
type, and the toolkit JS consumers whose transitional fallbacks become dead.

## Hard Boundaries / Non-Goals

- Do not fold `do_target` into `ref` or remove canvas-scoped action routing.
- Do not add compatibility aliases, dual spellings, or transitional wrappers for
  the new producer contract.
- Do not collapse projection vocabulary (`subject_id`, `subject_path`,
  `root_id`, `current_render_status`, `display_space_rect`) into producer
  records — projection identity is a separate, deliberate concept.
- Do not change the rendered DOM attribute names (`data-aos-ref`,
  `data-semantic-target-id`); the DOM contract is already canonical.
- Do not touch the `employer-brand-*` reference art.
- Do not redesign the projection adapter strategy or settle the review's open
  Section 11 questions.

## Stop Conditions

Stop with a clear report instead of continuing if:

- an external (non-repo) consumer of the `aos see` semantic-target JSON or the
  SDK type needs a migration window Foreman must own;
- the act layer needs `do_target` or geometry in a location that conflicts with
  the canonical envelope, forcing a routing-model decision;
- a JS fallback cannot be deleted because a producer other than the native
  perceive layer still emits the old spelling (identify which producer);
- the schema change would require a coordinated release of a separately
  versioned package.

## Suggested Implementation Areas

- `src/perceive/models.swift`, `src/perceive/semantic-targets.swift`
- `src/act/canvas-ref-targeting.swift`
- `shared/schemas/` semantic-target schema, `docs/api/` `aos see` page
- `packages/gateway/sdk/aos-sdk.d.ts`, `packages/gateway/src/aos-proxy.ts`,
  `packages/gateway/dist/aos-proxy.d.ts` (generated)
- `apps/sigil/renderer/live-modules/main.js`
- `packages/toolkit/workbench/annotation-projection.js`
- `packages/toolkit/components/surface-inspector/index.js`
- `packages/toolkit/components/html-workbench-expression/index.js`
- `docs/design/fixtures/agent-ui-target-conformance-v0/` (+ `mapping-table.md`)
- affected tests under `tests/toolkit/` and any perceive/act Swift tests

## Verification

```bash
git diff --check
./aos dev build
# JS consumers + conformance (transitional fallbacks should now be gone):
node --test tests/toolkit/annotation-projection.test.mjs tests/toolkit/surface-inspector.test.mjs
node --test tests/toolkit/agent-ui-target-conformance.test.mjs
node --test tests/toolkit/runtime-semantic-targets.test.mjs tests/toolkit/html-workbench-expression.test.mjs
# Swift perceive/act suites, if present:
./aos dev recommend --json --files src/perceive/semantic-targets.swift src/act/canvas-ref-targeting.swift
# Drift gone everywhere except intentional projection vocabulary:
rg -n "target_id|semantic_target_id|data_aos_ref|aos_ref|Removal gate" packages/toolkit/workbench packages/toolkit/components src/perceive src/act
```

Any remaining match must be intentional projection vocabulary (`subject_id`
etc.) or `do_target` action routing — anything else means the cutover is
incomplete.

If `./aos ready` passes, capture one bounded live signal: `aos see` a canvas
with semantic targets and confirm the emitted record is the canonical envelope
(`ref` present, no `target_id`/`aos_ref`/`data_aos_ref`), and that an `aos do`
against a `canvas:<id>/<ref>` target still resolves.

## Completion Report

Include:

- branch and head SHA;
- changed paths across Swift, schema/API, SDK, and JS consumers;
- the exact emitted canonical `aos see` semantic-target record shape, and where
  `do_target`, geometry, and `parent_canvas` now live;
- confirmation the act layer still resolves `canvas:<id>/<ref>` targets;
- which JS transitional fallbacks and #399 comments were deleted;
- schema/`docs/api`/SDK changes made and whether any external migration window
  is required;
- exact verification commands and pass/fail results (deterministic, plus live
  `aos see`/`aos do` smoke or the readiness blocker);
- whether issue #399 is ready to close;
- any remaining producer still emitting old spellings, if the cutover could not
  fully delete the fallbacks.
