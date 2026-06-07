# Semantic Target Drift Cleanup V0

## Recipient

GDI implementation and cleanup round.

## Transfer Kind

GDI round.

## Branch / Base

- branch_from: local `main` containing the accepted #429 descriptor contract and
  this work card.
- required_start_ref: local `main` containing this work card.
- expected output branch: `gdi/semantic-target-drift-cleanup-v0`

Do not reset to `origin/main` for this round. Local `main` is intentionally ahead
of `origin/main` with Foreman coordination commits and the accepted #429
descriptor contract.

## Source Artifact

- GitHub issue #432:
  https://github.com/michaelblum/agent-os/issues/432
- Accepted #429 descriptor contract commit:
  `186eeb6561d1a9b99339bf4831a44514e6f695c5`
- Canonical descriptor contract:
  - `shared/schemas/aos-semantic-targets.md`
  - `docs/api/aos.md`
  - `docs/design/fixtures/aos-target-descriptor-v0/`
  - `tests/toolkit/aos-target-descriptor-contract.test.mjs`
- Adjacent ledgers:
  - #429 owns the target descriptor contract.
  - #430 owns the broader interaction grammar and should wait on this cleanup.
  - #431 remains separate input-event-v2 hard-cutover debt.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, checkout, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Remove or clearly quarantine stale semantic-target guidance so current docs,
tests, and helper names teach agent-first target descriptors: state-scoped refs
plus descriptor-backed machine identity, with labels/names only as
presentation, accessibility, or reacquisition hints.

## Read First

- `AGENTS.md`
- `shared/schemas/aos-semantic-targets.md`
- `docs/api/aos.md`
- `packages/toolkit/runtime/semantic-targets.js`
- `tests/toolkit/aos-target-descriptor-contract.test.mjs`
- `tests/toolkit/runtime-semantic-targets.test.mjs`
- `tests/toolkit/agent-ui-target-conformance.test.mjs`
- `docs/guides/aos-app-accessibility-surfaces.md`
- `docs/api/toolkit/controls.md`
- `docs/api/toolkit/workbench.md`
- `docs/design/aos-shared-gesture-spine-v0.md`
- `docs/design/aos-work-records-and-self-healing-recipes.md`
- `docs/design/work-cards/gdi-agent-ui-target-conformance-fixtures-v0.md`
- `docs/design/work-cards/surface-inspector-semantic-target-late-attach-replay-v0.md`
- `docs/design/work-cards/gdi-aos-target-addressed-action-ergonomics-v0.md`

## Rediscover State

Run before editing:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos service status --mode repo --json
./aos dev gh issue view 432 --json
rg -n "human-readable name exposed to AOS perception|name as id|target id from label|label.*identity|name.*identity|settings\\.opacity|avatar\\.controls\\.scale|semantic_target\\.id|target\\.id|pickName|display name|accessible name" shared/schemas docs/api docs/guides docs/design packages/toolkit/runtime tests/toolkit --glob "*.md" --glob "*.js" --glob "*.mjs" --glob "*.json"
rg -n "semantic_targets|semantic target|target descriptor|target_id|state_id|reacqui|data-semantic-target-id|data-aos-ref|data-aos-action" src/perceive shared/schemas docs/api docs/guides docs/design packages/toolkit/runtime tests/toolkit --glob "*.swift" --glob "*.md" --glob "*.js" --glob "*.mjs" --glob "*.json"
```

Live AOS is intentionally paused for this workstream. Do not run `./aos ready`,
`./aos status`, `./aos clean`, service start/restart, or live smoke unless
Michael explicitly approves it in a new instruction. This slice is
deterministic-only.

## Existing Code To Inspect

- `src/perceive/semantic-targets.swift` - current native producer surface. It
  may not yet emit every #429 descriptor field, so public docs must not imply
  every current `aos see` result already contains fields the producer cannot
  emit.
- `shared/schemas/aos-semantic-targets.md` - canonical descriptor vocabulary.
- `docs/api/aos.md` - public command contract; keep it aligned with descriptor
  vocabulary while being honest about current V0 producer behavior.
- `packages/toolkit/runtime/semantic-targets.js` - helper naming and behavior
  around refs, accessible names, descriptor identity, provenance, and
  reacquisition.
- `docs/guides/aos-app-accessibility-surfaces.md` - likely stale wording around
  "stable" semantic names and identity metadata.
- `docs/api/toolkit/controls.md` and `docs/api/toolkit/workbench.md` - toolkit
  docs that should distinguish state-scoped refs, durable descriptor identity,
  action metadata, and presentation labels.
- Historical work cards under `docs/design/work-cards/` that future searches
  could mistake for current target identity guidance.

## Required Behavior

### Drift Classification

Classify remaining drift hits before editing. Use these buckets in the
completion report:

- current canonical descriptor guidance;
- current docs that need update;
- historical or superseded work cards that need a visible status note;
- fixture-negative/test assertions that intentionally prove labels are not
  identity;
- unrelated local test object identity, such as annotation `target.id`, that is
  not AOS target descriptor identity;
- deferred #430 interaction grammar work.

Do not mechanically edit every `target.id` or `accessible name` hit. Edit where
a future agent could reasonably infer that human names, labels, DOM ids, or nice
examples are durable AOS target identity.

### Current Docs

Update current docs so they teach the accepted descriptor split:

- `ref` is state-scoped and model-facing.
- `state_id` scopes a perceived state and may become stale.
- durable machine identity is `target.target_id` scoped by
  `target.owner_namespace`.
- `actions` name primitive capabilities.
- current `state` is action-relevant but not identity.
- `provenance` is the current address, routing, and geometry evidence.
- `reacquisition` uses machine facts first, with labels/accessibility text only
  as hints.

Specific cleanup expectations:

- `docs/guides/aos-app-accessibility-surfaces.md` should keep AX/ARIA names as
  human/accessibility presentation, not identity. AOS metadata should point to
  refs, target descriptors, owner namespaces, and action metadata.
- `docs/api/toolkit/controls.md` should describe slider semantic target stamping
  in descriptor terms instead of letting `data-aos-ref`,
  `data-semantic-target-id`, or `aria-*` fields blur together.
- `docs/api/toolkit/workbench.md` should not leave semantic target references
  as an old one-field id/ref dialect when it is describing current AOS-owned
  canvas behavior.
- `docs/api/aos.md` should remain public API documentation, but if current
  native producer coverage lags the descriptor contract, phrase the new fields
  as descriptor vocabulary emitted or consumed when present instead of
  promising every current producer result has all fields.
- `docs/design/aos-shared-gesture-spine-v0.md` and
  `docs/design/aos-work-records-and-self-healing-recipes.md` should continue to
  point at the descriptor vocabulary and should not retain `semantic_target.id`
  or nice-name examples as durable ids.

### Historical And Superseded Cards

For old work cards or design notes, prefer a concise status note near the top
over rewriting completed historical instructions. The note should say the card
is historical/superseded for target identity and point to #429/#432 plus
`shared/schemas/aos-semantic-targets.md`.

Likely targets include:

- `docs/design/work-cards/gdi-agent-ui-target-conformance-fixtures-v0.md`
- `docs/design/work-cards/surface-inspector-semantic-target-late-attach-replay-v0.md`
- `docs/design/work-cards/gdi-aos-target-addressed-action-ergonomics-v0.md`
- older nearby semantic-target, visual-object, or work-record cards discovered
  by the rediscovery searches.

Do not delete historical cards.

### Helper Names And Tests

If `packages/toolkit/runtime/semantic-targets.js` still uses helper names or
comments that imply names are identity, make the smallest current-contract edit.
For example, an accessible-name helper may remain if it is clearly presentation
or hint extraction, but it should not be easy to confuse with identity
construction. Update focused tests when helper behavior or names change.

Do not add compatibility aliases for owned in-repo callers unless an external
non-updatable consumer is identified with an explicit removal gate.

### GitHub Ledger Drafts

Do not mutate GitHub issues in this GDI round. Instead, draft exact short
comment bodies for #164 and #428 in the completion report if the cleanup makes
those ledger comments ready. Foreman will post or revise them after acceptance.

## Scope

Allowed:

- docs under `docs/`;
- descriptor/schema docs under `shared/schemas/`;
- focused tests under `tests/toolkit/`;
- tiny helper/comment cleanup under `packages/toolkit/runtime/`;
- passive inspection of `src/perceive/semantic-targets.swift`.

Expected likely output is mostly docs and test assertion updates. Native
producer migration is not expected in this round.

## Hard Boundaries / Non-Goals

- Do not restart live AOS or require live canvas/input evidence.
- Do not run `./aos ready`, `./aos status`, `./aos clean`, service
  start/restart, or live smoke.
- Do not migrate the native Swift producer unless Foreman routes a separate
  #429 producer-migration card.
- Do not implement #430's full interaction record family.
- Do not start #431's input-event-v2 hard cutover.
- Do not introduce Pi's `@e` / `@w` syntax as AOS canonical syntax.
- Do not optimize for pretty human names at the expense of machine robustness.
- Do not delete historical work cards or archives.
- Do not push, open PRs, or mutate GitHub issues.

## Stop Conditions

Stop with a clear report instead of continuing if:

- public docs cannot be made honest without changing native producer behavior;
- cleanup requires choosing #430 grammar details not decided by #429/#432;
- an external consumer requires a compatibility window;
- deterministic tests reveal label/name identity behavior outside this slice's
  safe scope;
- live AOS evidence becomes necessary to proceed.

## Verification

Run deterministic checks:

```bash
git diff --check
node --test tests/toolkit/runtime-semantic-targets.test.mjs
node --test tests/toolkit/agent-ui-target-conformance.test.mjs
node --test tests/toolkit/aos-target-descriptor-contract.test.mjs
node --test tests/toolkit/runtime-gesture-stream.test.mjs tests/toolkit/zag-adapter-slider.test.mjs
rg -n "human-readable name exposed to AOS perception|name as id|target id from label|label.*identity|name.*identity|settings\\.opacity|avatar\\.controls\\.scale|semantic_target\\.id|target\\.id|pickName|display name|accessible name" shared/schemas docs/api docs/guides docs/design packages/toolkit/runtime tests/toolkit --glob "*.md" --glob "*.js" --glob "*.mjs" --glob "*.json"
```

For remaining `rg` hits, classify them in the completion report as current
canonical guidance, historical/superseded and visibly marked, fixture-negative,
unrelated local test identity, retained limit, or deferred #430 work.

If no runtime/test files change, still run the Node tests above because they are
the accepted #429 contract guardrails.

## Completion Report

Return a path-scoped report with:

- branch and head SHA;
- base SHA;
- files changed;
- which current docs were updated;
- which historical cards were marked superseded/historical;
- any helper names/comments changed and why;
- exact verification commands and pass/fail results;
- remaining drift-scan hits and their classification;
- whether `docs/api/aos.md` now distinguishes descriptor contract vocabulary
  from current native producer coverage;
- draft #164 and #428 ledger comment bodies, or a reason they should wait;
- confirmation that live AOS was not restarted;
- local-only state, including dirty/untracked files and known ignored
  artifacts;
- recommended next slice only if the cleanup reveals one concrete follow-up.
