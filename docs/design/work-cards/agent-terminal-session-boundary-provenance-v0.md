# Agent Terminal Session Boundary Provenance V0

## Recipient

GDI

## Transfer Kind

GDI round

## Tracker

Primary source artifact:

- `docs/design/work-cards/aos-dock-run-provenance-ledger-v0.md`

Accepted prerequisite branch state:

- branch: `gdi/aos-dock-run-provenance-ledger-v0`
- prerequisite head before this card: `25a3865f44700b08f88c70ea528167ffc817cdca`
- key runtime surface: `./aos dev provenance record|summary|audit|prune`

Foreman synthesis:

- Foreman distilled the outside material into the local decision below. GDI
  should execute this contract without re-researching the outside material.

## Foreman-Distilled Signals

- External token/spend tools are useful as later research references for
  provider transcript shapes, pricing manifests, update cadence, and tests.
- They are not appropriate runtime dependencies for AOS hooks or Agent Terminal
  hot paths because collection must remain local, deterministic, bounded, and
  no-network.
- Do not create a parallel token-spend JSONL source of truth. Any future
  provider pricing/model-contract manifest should be subordinate to explicit
  analysis commands and outside this slice.
- The smallest reversible implementation slice is local: use existing Agent
  Terminal session and input seams to append sanitized accounting events to the
  accepted provenance ledger.
- Foreman verified these local seams as relevant:
  `appendPtyInputTelemetry` in
  `packages/toolkit/components/agent-terminal/terminal-session-manager.mjs` and
  `dockTerminalSessionResponseForUrl` in
  `packages/toolkit/components/agent-terminal/bridge-observation-routes.mjs`.

## Branch / Base

- branch_from: `gdi/aos-dock-run-provenance-ledger-v0`
- required_start_ref: `gdi/aos-dock-run-provenance-ledger-v0`
- output branch expectation: continue on the current work surface unless it is
  dirty with unrelated user changes; if unrelated dirty state blocks clean work,
  stop and report before editing.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
Agent Terminal process state, provider transcript state, or prior Foreman chat.
Read and rediscover before editing.

## Goal

Make Agent Terminal session-boundary and input-delivery accounting visible
through the existing AOS dock provenance ledger, while preserving the user
constraint that collection is cheap mechanical accounting only.

The result should let Foreman answer, per dock/session, whether an Agent
Terminal session was created or observed and whether input was delivered, using
sanitized metadata only. It must not create a second source of truth for
token/spend accounting and must not record raw prompt text, terminal output, or
provider transcripts.

## Read First

- `AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/design/work-cards/aos-dock-run-provenance-ledger-v0.md`
- `scripts/aos-provenance-ledger.mjs`
- `scripts/aos-dev-workflow.mjs`
- `shared/schemas/aos-dock-provenance-ledger-v0.schema.json`
- `packages/toolkit/AGENTS.md`
- `packages/toolkit/components/agent-terminal/terminal-session-manager.mjs`
- `packages/toolkit/components/agent-terminal/bridge-observation-routes.mjs`
- `packages/toolkit/components/agent-terminal/bridge-server.mjs`
- `scripts/lib/dock-terminal-session-registry.mjs`
- `tests/provenance-ledger.sh`
- `tests/schemas/aos-dock-provenance-ledger-v0.test.mjs`
- `tests/sigil-agent-terminal-server.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git worktree list --porcelain
./aos dev recommend --json --files \
  scripts/aos-provenance-ledger.mjs \
  shared/schemas/aos-dock-provenance-ledger-v0.schema.json \
  packages/toolkit/components/agent-terminal/terminal-session-manager.mjs \
  packages/toolkit/components/agent-terminal/bridge-observation-routes.mjs \
  tests/provenance-ledger.sh \
  tests/schemas/aos-dock-provenance-ledger-v0.test.mjs \
  tests/sigil-agent-terminal-server.test.mjs
```

This is primarily a deterministic Node/test slice. Do not spend time repairing
live AOS readiness unless your chosen verification needs it.

## Existing Code To Inspect

- `scripts/aos-provenance-ledger.mjs` owns the current sanitized event builder,
  ledger paths, summary/audit aggregation, retention settings, and prune logic.
- `shared/schemas/aos-dock-provenance-ledger-v0.schema.json` is the canonical
  schema for ledger events and summaries.
- `packages/toolkit/components/agent-terminal/terminal-session-manager.mjs`
  owns session ensure, input delivery, and the existing
  `appendPtyInputTelemetry` seam. That seam currently records local input
  details in a separate JSONL file; make sure any provenance-facing path stores
  only sanitized metadata.
- `packages/toolkit/components/agent-terminal/bridge-observation-routes.mjs`
  owns `dockTerminalSessionResponseForUrl`, which returns
  `aos.dock_terminal_session` and `aos.agent_terminal_observation` receipts.
- `scripts/lib/dock-terminal-session-registry.mjs` owns the stable receipt and
  observation shapes for Agent Terminal sessions.

## Required Behavior

### Ledger Integration

- Reuse the existing provenance ledger as the accounting surface.
- Do not create an independent token-spend or Agent Terminal event lake that
  users must query separately.
- If a small helper module is needed so Agent Terminal code can append
  provenance records without shelling out, keep it local, dependency-free, and
  covered by deterministic tests.
- Hook or Agent Terminal failures must not break provider flow, PTY input, or
  bridge observation responses.

### Session Boundary Events

Capture cheap sanitized session-boundary facts when Agent Terminal creates,
reuses, or exposes a dock terminal session. Exact placement is up to GDI after
inspection, but likely seams are:

- `ensureProcessSession`;
- `ensureTmuxSession`;
- `dockTerminalSessionResponseForUrl`.

Persist only stable accounting fields such as:

- observed timestamp;
- dock;
- phase or event kind;
- stable session identifier, such as `dock_terminal_session_id` or PTY handle;
- provider name;
- PTY driver;
- command metadata using the provenance ledger's existing allowlist/hash
  pattern, not arbitrary command text when unsafe;
- cwd/repo identity only in the same sanitized manner already used by the
  receipt and ledger.

### Input Delivery Events

Record input-delivery accounting without storing input content:

- action: send, key, resize, or equivalent;
- target session;
- driver;
- byte count or key name when safe;
- submit/enter flag when applicable;
- content hash for send actions if useful;
- no raw `text`;
- no `utf8_hex`;
- no terminal output;
- no provider response text.

If preserving the old `AOS_DOCK_PTY_INPUT_LOG` behavior is necessary for an
explicit compatibility reason, state the reason in the completion report and
keep the provenance-facing record sanitized. Otherwise prefer the strict
evergreen contract: local input telemetry should be sanitized by default.

### Summary/Audit Surface

Extend `./aos dev provenance summary --json` enough that Agent Terminal events
are visible without reading raw JSONL files by hand. A minimal acceptable shape
is counts grouped by event kind and dock/session. Do not add pricing,
provider-model cost lookup, or external manifest work in this slice.

Audit does not need to treat Agent Terminal input events as verification
commands. They are accounting evidence, not harness compliance commands.

### Privacy / Safety

- No raw prompts.
- No terminal pane output.
- No provider transcript copy.
- No secret-bearing environment capture.
- No network calls.
- No package-resolution calls such as `npx`, `npm exec`, `pipx`, or dynamic
  third-party CLI invocation.
- Prefer missing/unknown over inference.

## Scope

Owned areas:

- AOS provenance ledger event/schema/summary support;
- Agent Terminal session/input accounting seams;
- deterministic tests and fixtures.

## Hard Boundaries / Non-Goals

- Do not implement provider pricing or a provider-contract manifest in this
  slice.
- Do not add third-party token/spend tooling as a runtime dependency.
- Do not read, summarize, or infer from the outside research material; this
  card is the distilled Foreman contract for the round.
- Do not parse provider transcripts in Agent Terminal hot paths.
- Do not estimate cost from hidden provider/model state.
- Do not add inference-backed analysis.
- Do not add a dashboard.
- Do not resume Sigil Selection Mode or unrelated AFK work cards.
- Do not mutate GitHub, push, or open PRs.

## Suggested Implementation Areas

GDI should inspect first, then choose the narrowest layer. Likely options:

- factor a small append/build helper out of `scripts/aos-provenance-ledger.mjs`
  if direct reuse from Agent Terminal is cleaner than spawning the script;
- extend the event schema with explicit Agent Terminal event kinds, or preserve
  `event: "session"` with a precise `phase`/metadata shape if that keeps the
  schema simpler;
- update `appendPtyInputTelemetry` or its call sites so provenance-visible
  records are metadata-only;
- add fixture coverage proving raw sent text and hex are not persisted.

## Verification

Run the focused deterministic checks that match the final changed paths. At
minimum:

```bash
git diff --check
bash tests/provenance-ledger.sh
node --test tests/schemas/aos-dock-provenance-ledger-v0.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
```

If GDI changes Agent Terminal modules, also run:

```bash
node --check packages/toolkit/components/agent-terminal/terminal-session-manager.mjs
node --check packages/toolkit/components/agent-terminal/bridge-observation-routes.mjs
```

If `./aos ready` or a bounded live check reports a repo-mode Accessibility,
Input Monitoring, or inactive input-tap blocker, do not loop on live checks.
Run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed` and include the script output. After the human
returns with `finished`, run:

```bash
./aos ready --post-permission
```

Only continue live verification if it reports ready.

## Completion Report

Report:

- changed paths;
- whether Agent Terminal session-boundary events are recorded through the
  provenance ledger;
- whether input-delivery records are sanitized by default;
- the exact summary fields added or reused;
- exact tests run and pass/fail results;
- live readiness result if any live check was attempted, or why live checks
  were skipped;
- any unrelated dirty/untracked state left in the worktree;
- any compatibility reason for retaining old raw PTY input telemetry, if one
  remains;
- recommended follow-up, if provider pricing/model manifest work still appears
  useful after this slice.
