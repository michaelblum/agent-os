# Work Card: AFK Provider Session Observability Map V0

**Status:** Routed 2026-05-22

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider session, catalog, telemetry, issue, or prior implementation state.
Read and rediscover before editing.

## Goal

Create a docs-only observability map for the gap exposed by the supervised AFK
provider-session smoke: the provider session id was human-visible, but provider
catalog and telemetry references were `not_observed`.

The output should explain what current repo surfaces can already observe for a
docked Codex/GDI session, what they cannot observe yet, and the smallest next
implementation or validation slice before automated provider launch.

## Read First

- `.docks/gdi/AGENTS.md`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/notes/manual-afk-receipts/2026-05-22-afk-provider-session-smoke-gdi-completed.md`
- `docs/design/notes/afk-provider-neutral-dispatch-shape-2026-05-21.md`
- `docs/design/notes/afk-work-evidence-receipt-shape-2026-05-21.md`
- `docs/recipes/workstream-checkpoint-continuation.md`
- `shared/schemas/provider-session-catalog.md`
- `shared/schemas/agent-session-telemetry.md`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse --short docs/durable-agent-cognition-v0
./aos dev recommend --json
```

This is a docs/source inspection slice. Do not run or launch a provider session.
If `./aos dev recommend --json` reports docs-only after edits, no runtime check
is required.

## Branch / Base

- branch_from: `docs/durable-agent-cognition-v0`
- required_start_ref: `docs/durable-agent-cognition-v0`
- routed_from_sha: `ece28ec7`
- expected output branch: `gdi/afk-provider-session-observability-map-v0`
- publication: local-only; do not push, open a PR, mutate GitHub, or publish
  externally

## Existing Code And Contracts To Inspect

Inspect only enough to answer the observability question:

- `packages/host/src/session-catalog.ts` - provider session catalog discovery
  source.
- `packages/host/src/session-telemetry.ts` - provider session telemetry source.
- `packages/host/test/session-catalog.test.ts` - expected catalog behavior.
- `packages/host/test/session-telemetry.test.ts` - expected telemetry behavior.
- `shared/schemas/provider-session-catalog.schema.json` - catalog record shape.
- `shared/schemas/agent-session-telemetry.schema.json` - telemetry record
  shape.
- `apps/sigil/agent-terminal/launch.sh` - current agent terminal launch wrapper.
- `apps/sigil/codex-terminal/launch.sh` - delegated Codex terminal launcher.
- `apps/sigil/codex-terminal/server.mjs` - terminal/session bridge behavior.
- `apps/sigil/codex-terminal/session-inspector.mjs` - local provider session
  inspection utility, if still relevant.
- `scripts/afk-dry-run-prototype.mjs` - current dry-run receipt facts.
- `src/commands/dev.swift` and `src/shared/command-registry-data.swift` - dev
  command surface for the dry-run preflight.

## Required Questions

Answer these in the output note:

1. Which current surfaces can observe provider identity, provider session id,
   cwd, branch, launch root, terminal substrate, process/tmux handle, catalog
   record, and telemetry event for a Codex session?
2. Which of those facts are available for a normal `.docks/gdi` Codex CLI
   session launched manually from the dock root?
3. Which facts are only visible in human terminal/shutdown text today?
4. Which facts require the Sigil agent-terminal/codex-terminal launcher rather
   than a direct dock-root provider launch?
5. Is the provider session catalog read-only discovery currently sufficient for
   dispatch receipts, or does dispatch need a launch-side catalog write/bridge?
6. Is telemetry available without provider transcript parsing, and if not, what
   should receipts honestly record?
7. What is the smallest next reversible implementation or validation slice
   before automated provider launch?

## Output

Add:

```text
docs/design/notes/afk-provider-session-observability-map-2026-05-22.md
```

The note should include:

- current observability table;
- direct dock launch versus agent-terminal/codex-terminal launcher distinction;
- what the manual smoke proved;
- what remains `not_observed`;
- recommended next slice with owner and verification;
- explicit deferrals.

Optionally update `docs/design/durable-agent-cognition-and-afk-primitives.md`
with one concise pointer to the new note if it changes the near-term sequence.

## Hard Boundaries

- Do not launch Codex, Claude, Gemini, or any provider.
- Do not create, edit, or delete provider sessions or transcripts.
- Do not mutate provider config, gateway state, dock profiles, `.docks`
  instructions, hooks, or launch scripts.
- Do not implement scheduler, dispatch, catalog, telemetry, terminal substrate,
  schema, gateway, or CLI behavior.
- Do not add schemas or generated receipt artifacts.
- Do not push, open a PR, mutate GitHub, or publish externally.
- Do not treat this as a Researcher dock or async gateway implementation.

## Verification

Required:

```bash
git diff --check
./aos dev recommend --json
```

If the router reports docs-only, no runtime verification is required. If GDI
chooses to inspect tests for understanding, report them as inspection only
unless they are actually run.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- whether the output is docs-only;
- exact verification commands and results;
- key conclusion about direct dock launch versus terminal launcher
  observability;
- recommended next slice;
- local-only state and confirmation that no provider session, provider config,
  gateway state, GitHub state, push, or PR changed.
