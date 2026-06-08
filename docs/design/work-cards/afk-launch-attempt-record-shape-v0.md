# Work Card: AFK Launch Attempt Record Shape V0

**Status:** Accepted 2026-05-22

## Acceptance

- Accepted output commit:
  `0d4d3f168b2b7c505b49b100b229b75bc8a3c6e7`
- Output note:
  `docs/design/notes/afk-launch-attempt-record-shape-2026-05-22.md`
- Foreman review: accepted. The note defines the pre-schema
  `aos.afk_launch_attempt` record shape, field ownership, lifecycle states,
  mismatch representation, idempotence key, neighbor-artifact relationships,
  first real-launch acceptance evidence, and the next prototype slice.
- Foreman verification:
  - `git diff --check dc3d1a763b5e8dcf0b27de2457d3fd6252198084..0d4d3f168b2b7c505b49b100b229b75bc8a3c6e7`
  - `git diff --check c20c85d9e0efd239a2112b5899a8ed164ab745d7..HEAD`
  - `./aos dev recommend --json`
- Local-only boundary confirmed: no provider session, provider config, gateway
  state, generated receipt artifact, GitHub state, push, or PR changed.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
provider session, terminal bridge, catalog, telemetry, or prior implementation
state. Read and rediscover before editing.

## Goal

Define the docs-only AFK launch-attempt/session record shape that should bind
selected provider, dock launch root, terminal substrate handle, provider session
id, catalog match, telemetry observation, and result route after a future real
provider launch.

This is a boundary/specification slice. It must not implement launch, mutate
schemas, or launch a provider. The output should make the next implementation
slice safer by naming the record fields, ownership, lifecycle, mismatch cases,
and evidence requirements before automated provider launch begins.

## Read First

- the implementer native subagent instructions
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/notes/afk-provider-neutral-dispatch-shape-2026-05-21.md`
- `docs/design/notes/afk-provider-session-observability-map-2026-05-22.md`
- `docs/design/notes/manual-afk-receipts/2026-05-22-afk-provider-session-smoke-implementer-completed.md`
- `docs/design/work-cards/afk-dry-run-launch-observability-fields-v0.md`
- `docs/design/work-cards/afk-terminal-substrate-no-provider-validation-v0.md`
- `tests/afk-terminal-substrate-no-provider.test.mjs`
- `shared/schemas/provider-session-catalog.md`
- `shared/schemas/agent-session-telemetry.md`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse --short docs/durable-agent-cognition-v0
./aos dev recommend --json
```

This is docs-only unless Implementer discovers a narrow source-test pointer is required.
Do not run or launch a provider session.

## Branch / Base

- branch_from: `docs/durable-agent-cognition-v0`
- required_start_ref: `docs/durable-agent-cognition-v0`
- routed_from_sha: `ab23e597`
- expected output branch: `implementer/afk-launch-attempt-record-shape-v0`
- publication: local-only; do not push, open a PR, mutate GitHub, or publish
  externally

## Existing Code And Contracts To Inspect

Inspect only enough to define the shape:

- `scripts/afk-dry-run-prototype.mjs` - current dry-run receipt bundle and
  `dispatch.launch_observability` facts.
- `apps/sigil/codex-terminal/server.mjs` - terminal bridge facts available from
  `/health`, `/ensure`, `/snapshot`, `/sessions`, and `/session-inspector`.
- `tests/afk-terminal-substrate-no-provider.test.mjs` - no-provider substrate
  proof.
- `packages/host/src/session-catalog.ts` - read-only provider session discovery
  facts.
- `packages/host/src/session-telemetry.ts` - telemetry and mismatch facts.

## Required Questions

Answer these in the output note:

1. What is the smallest launch-attempt/session record that dispatch must create
   before or during provider launch?
2. Which fields come from scheduler/transfer packet, dispatch provider
   selection, dock profile, terminal substrate, provider acceptance, catalog
   match, telemetry parsing, and result-route delivery?
3. Which fields are mandatory at record creation, which are filled later, and
   which may remain `not_observed`?
4. What lifecycle states are needed before schemas exist: requested, rejected,
   terminal_started, provider_acceptance_unobserved, provider_session_observed,
   catalog_matched, telemetry_observed, completed, failed, blocked, expired, or
   similar?
5. What idempotence key prevents duplicate launches before provider session id
   is known?
6. How should mismatch cases be represented: wrong cwd, wrong branch, provider
   unavailable, terminal started but no provider id, multiple catalog matches,
   telemetry unavailable, route update failed?
7. What evidence is required to accept a first real-launch prototype?
8. What is the smallest next implementation slice after this shape is accepted?

## Output

Add:

```text
docs/design/notes/afk-launch-attempt-record-shape-2026-05-22.md
```

The note should include:

- proposed launch-attempt/session record fields;
- ownership table for each field source;
- lifecycle and mismatch table;
- idempotence key recommendation;
- how this record relates to transfer, scheduler, dispatch, work receipt,
  evidence receipt, provider session catalog, telemetry, and result route;
- first real-launch prototype acceptance evidence;
- recommended next slice and explicit deferrals.

Optionally update `docs/design/durable-agent-cognition-and-afk-primitives.md`
with one concise pointer if the near-term sequence changes.

## Hard Boundaries

- Do not launch Codex, Claude, Gemini, or any provider.
- Do not create, edit, delete, parse, or depend on real provider sessions or
  transcripts.
- Do not mutate provider config, gateway state, dock profiles, `.docks`
  instructions, hooks, or launch scripts.
- Do not implement automated provider launch, scheduler, provider-neutral
  dispatch, gateway routes, terminal bridge, catalog matching, telemetry
  parsing, schemas, work records, evidence records, or generated receipt
  artifacts.
- Do not add a generic schema yet.
- Do not push, open a PR, mutate GitHub, or publish externally.

## Verification

Required:

```bash
git diff --check
./aos dev recommend --json
```

If Implementer only changes docs and the router reports docs-only, no runtime
verification is required. If Implementer inspects tests or source for evidence, report
that as inspection unless actually run.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- whether output is docs-only;
- exact verification commands and results;
- key record-shape conclusion;
- recommended next implementation slice;
- confirmation that no provider session, provider config, gateway state,
  generated receipt artifact, GitHub state, push, or PR changed.
