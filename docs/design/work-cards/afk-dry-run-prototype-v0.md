# Work Card: afk-dry-run-prototype-v0

**Status:** Ready for GDI
**Owner:** GDI

## Tracker

Transfer classification:

- Recipient: GDI
- Transfer kind: GDI round
- Source artifact:
  `docs/design/notes/afk-work-evidence-receipt-shape-2026-05-21.md`
- Single next goal: build a deterministic local AFK dry-run prototype that
  validates one manual packet and emits a reviewable receipt bundle without
  launching a provider.

Follow-up to accepted work card:

- `docs/design/work-cards/afk-work-evidence-receipt-shape-v0.md`

The accepted receipt-shape note says no remaining docs-only question blocks a
deterministic dry-run prototype, as long as the prototype writes only local
dry-run output or a receipt bundle, starts no provider, changes no schemas, and
treats command names as experimental.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Build the smallest deterministic local prototype that proves the AFK notes can
drive a no-provider dry run:

```text
manual packet JSON
  -> current-state validation
  -> dock profile resolution
  -> provider selection as dry-run fact
  -> scheduler/dispatch/work/evidence receipt bundle
```

The prototype should be explicit about being experimental. Do not wire it into
the public `./aos` CLI or imply final command spelling.

## Read First

- `AGENTS.md`
- `.docks/README.md`
- `.docks/AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/notes/afk-transfer-packet-result-route-shape-2026-05-21.md`
- `docs/design/notes/afk-session-trigger-scheduler-shape-2026-05-21.md`
- `docs/design/notes/afk-provider-neutral-dispatch-shape-2026-05-21.md`
- `docs/design/notes/afk-design-consolidation-readiness-2026-05-21.md`
- `docs/design/notes/afk-work-evidence-receipt-shape-2026-05-21.md`
- `shared/schemas/aos-dock-profile-v0.md`
- `shared/schemas/aos-dock-profile-v0.schema.json`
- `.docks/gdi/dock.json`
- `.docks/foreman/dock.json`
- `.docks/operator/dock.json`
- `docs/dev/workflow-rules.json`
- `tests/dev-workflow-router.sh`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
./aos dev recommend --json
./aos dev classify --json --paths scripts/afk-dry-run-prototype.mjs,tests/afk-dry-run-prototype.test.mjs
```

The prototype is expected to touch an experimental script and one focused test.
The script path may classify as `unclassified`; that is acceptable if GDI
inspects the nearest contracts and runs the focused test named below. Do not run
`./aos ready` unless you discover a live-runtime dependency, which is not
expected.

## Branch/Base

branch_from: `docs/durable-agent-cognition-v0`
required_start_ref: `docs/durable-agent-cognition-v0`

This card depends on local-only accepted design notes and accepted work cards
on the branch above. Do not reset to `origin/main`.

If you create an output branch, use `gdi/afk-dry-run-prototype-v0` from the
required start ref. Keep the checkpoint local unless Foreman or Michael
explicitly asks for a push or PR.

## Suggested Implementation Areas

Prefer a standalone Node script and focused test unless inspection shows a
clearly smaller existing prototype surface:

- `scripts/afk-dry-run-prototype.mjs` - experimental local prototype entry
  point. It should parse a manual packet JSON file, validate repo/worktree
  facts, resolve a dock profile, select a dry-run provider fact, and emit a
  receipt bundle to stdout or an explicit output path.
- `tests/afk-dry-run-prototype.test.mjs` - deterministic `node:test` coverage.
  Construct packet input in a temporary directory during the test instead of
  committing generated receipt artifacts.

Use only Node built-ins unless there is already a nearby local helper that
clearly reduces complexity. Do not add package dependencies.

## Required Behavior

The prototype should:

1. Accept a packet file path and deterministic options, for example:

   ```bash
   node scripts/afk-dry-run-prototype.mjs \
     --packet /tmp/manual-afk-packet.json \
     --provider codex \
     --dock gdi \
     --json
   ```

2. Validate at least:
   - packet id/ref is present;
   - source artifact path exists when it is a repo path;
   - cwd/worktree resolves to the repo root or an explicitly supplied path;
   - required start ref resolves to a commit;
   - selected dock has a `.docks/<dock>/dock.json` profile;
   - no provider launch is requested.
3. Resolve dock profile facts needed for review:
   - dock name;
   - role;
   - default entry path or allowed entry paths when present;
   - launch root.
4. Select provider only as a dry-run fact:
   - use explicit `--provider` or packet provider hint;
   - report provider as selected/not available/unsupported without launching
     or authenticating;
   - do not inspect private provider transcripts unless the packet explicitly
     asks for a catalog observation and the implementation keeps it read-only.
5. Emit one receipt bundle with transfer, scheduler, dispatch, work, and
   evidence sections matching the receipt-shape note.
6. Include honest `not_applicable`, `not_observed`, or `missing_with_reason`
   values for facts not available in a dry run.
7. Support JSON output for tests. Markdown output is optional if it stays
   deterministic and does not create committed generated artifacts.
8. Be idempotent for the same packet/worktree/dock/provider inputs: repeated
   dry runs should produce stable correlation keys except timestamps. Tests may
   use a fixed timestamp option to keep output deterministic.

## Scope

Likely files:

- `scripts/afk-dry-run-prototype.mjs`
- `tests/afk-dry-run-prototype.test.mjs`
- optionally `docs/design/durable-agent-cognition-and-afk-primitives.md` for a
  short synthesis update after the prototype exists

Do not edit prior AFK design notes unless a link is broken or the prototype
reveals a direct correction that must be documented before proceeding.

## Hard Boundaries

- Do not wire this into `./aos`, `src/main.swift`, command registry/help, or
  public API docs.
- Do not add or modify schemas.
- Do not launch Codex, Claude, Gemini, tmux, process sessions, or provider
  terminals.
- Do not mutate provider config, provider session files, provider transcripts,
  provider catalogs, telemetry stores, gateway jobs, or notification routes.
- Do not add package dependencies.
- Do not create committed generated receipt artifacts outside tests.
- Do not change `.docks` role instructions, dock profiles, transfer scripts,
  hook behavior, or provider config files.
- Do not move or rename recipes, playbooks, workflows, work cards, docks,
  gateway files, API docs, apps, packages, shared schema files, or
  `docs/dev/workflow-rules.json`.
- Do not implement provider-neutral dispatch, session trigger/scheduler,
  transfer packets, async result routing, durable work records, or durable
  evidence records beyond this local dry-run prototype.
- Do not make gateway the owner of sessions.
- Do not create a Researcher dock.
- Do not push, open a PR, mutate GitHub issues, or publish externally.

## Verification

Run:

```bash
node --test tests/afk-dry-run-prototype.test.mjs
git diff --check
./aos dev recommend --json
```

If the router recommends additional checks because the implementation touches
outside the expected script/test/docs paths, run the smallest relevant check or
explain why it is not applicable. No Swift rebuild, provider launch, or live AOS
smoke is expected unless the implementation violates this card's intended
scope.

## Completion Report

Report:

- files changed;
- prototype command shape and why it remains experimental;
- packet fields validated;
- dock/profile facts resolved;
- provider dry-run behavior and proof that no provider is launched;
- receipt bundle sections and mandatory fields emitted;
- deterministic/idempotence behavior;
- tests run with exact pass/fail results;
- router output and any additional verification;
- whether source command registry, schemas, provider configs, provider
  sessions, gateway state, `.docks` instructions/profiles, generated receipt
  artifacts, GitHub, push, and PR surfaces were untouched;
- local-only state or unrelated dirty files;
- recommended next slice: correction, docs update, or a bounded manual dry-run
  with Operator/HITL evidence.
