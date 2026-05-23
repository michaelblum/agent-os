# Work Card: afk-provider-neutral-dispatch-shape-v0

**Status:** Accepted 2026-05-21
**Owner:** GDI

## Tracker

Transfer classification:

- Recipient: GDI
- Transfer kind: GDI round
- Source artifact:
  `docs/design/notes/afk-session-trigger-scheduler-shape-2026-05-21.md`
- Single next goal: design a docs-only provider-neutral dispatch shape over the
  dock/session contract.

Follow-up to accepted work card:

- `docs/design/work-cards/afk-session-trigger-scheduler-shape-v0.md`

The accepted scheduler note defines packet validation, lease/timeout policy,
lifecycle state, start-versus-resume selection, and result-route updates. The
remaining design gap is the adapter boundary that actually starts or resumes
Codex, Claude, Gemini, or another provider against the same dock/session
contract without making the scheduler provider-specific or making a dock a
permanent provider identity.

Accepted evidence:

- GDI branch: `gdi/afk-provider-neutral-dispatch-shape-v0`
- Accepted commit: `324ffe5c07ff9986437a15c39e8dbd22fc9752e2`
- Fast-forwarded into local branch `docs/durable-agent-cognition-v0`.
- Output note:
  `docs/design/notes/afk-provider-neutral-dispatch-shape-2026-05-21.md`
- Synthesis update:
  `docs/design/durable-agent-cognition-and-afk-primitives.md`
- Foreman-side verification passed:
  `git diff --check 17c5a31bc502dcbd57d90d2c21c875e2b7396b02..324ffe5c07ff9986437a15c39e8dbd22fc9752e2`,
  `git diff --check c20c85d9e0efd239a2112b5899a8ed164ab745d7..HEAD`,
  and `./aos dev recommend --json`.
- Recommendation accepted: run a design consolidation/readiness pass across the
  AFK packet, scheduler, and provider-neutral dispatch sketches before local
  source prototyping.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before
editing.

## Goal

Create one docs-only design note that sketches provider-neutral dispatch for
future AFK work:

```text
session trigger/scheduler
  -> provider-neutral dispatch
  -> provider adapter
  -> docked provider session
  -> scheduler/result-route lifecycle updates
```

The note should define what dispatch owns when launching or resuming a provider
session with a dock, cwd/worktree, packet reference, lease, and result-route
reference. It should also define what dispatch must not own: scheduler
lifecycle, reusable route judgment, gateway job state, work/evidence proof
semantics, or dock role policy.

## Read First

- `AGENTS.md`
- `.docks/README.md`
- `.docks/AGENTS.md`
- `.docks/foreman/AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `.docks/operator/AGENTS.md`
- `.docks/foreman/dock.json`
- `.docks/gdi/dock.json`
- `.docks/operator/dock.json`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/notes/afk-transfer-packet-result-route-shape-2026-05-21.md`
- `docs/design/notes/afk-session-trigger-scheduler-shape-2026-05-21.md`
- `docs/design/remote-session-control.md`
- `docs/design/worktree-session-scope.md`
- `shared/schemas/aos-dock-profile-v0.md`
- `shared/schemas/aos-dock-profile-v0.schema.json`
- `shared/schemas/provider-session-catalog.md`
- `shared/schemas/provider-session-catalog.schema.json`
- `shared/schemas/agent-session-telemetry.md`
- `shared/schemas/agent-session-telemetry.schema.json`
- `packages/host/src/session-catalog.ts`
- `packages/host/src/session-telemetry.ts`
- `packages/host/src/provider/adapter.ts`
- `packages/host/src/types.ts`
- `apps/sigil/agent-terminal/launch.sh`
- `apps/sigil/codex-terminal/server.mjs`
- `.codex/config.toml`
- `.claude/settings.json`
- `CLAUDE.md`
- `GEMINI.md`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
./aos dev recommend --json
```

This is docs/design validation. Do not run `./aos ready` unless you discover a
need for live runtime evidence, which is not expected.

## Branch/Base

branch_from: `docs/durable-agent-cognition-v0`
required_start_ref: `docs/durable-agent-cognition-v0`

This card depends on local-only design notes and accepted work cards on the
branch above. Do not reset to `origin/main`.

If you create an output branch, use
`gdi/afk-provider-neutral-dispatch-shape-v0` from the required start ref. Keep
the checkpoint local unless Foreman or Michael explicitly asks for a push or PR.

## Existing Surfaces To Inspect

Start with:

- `docs/design/notes/afk-session-trigger-scheduler-shape-2026-05-21.md` -
  accepted scheduler boundary and lifecycle state machine.
- `docs/design/notes/afk-transfer-packet-result-route-shape-2026-05-21.md` -
  accepted packet/result-route fields consumed by scheduler and dispatch.
- `.docks/README.md` and `.docks/*/dock.json` - dock identity, default entry
  path, capability envelope, and launch-root convention.
- `shared/schemas/aos-dock-profile-v0.*` - machine-readable dock profile
  vocabulary.
- `shared/schemas/provider-session-catalog.*` and
  `packages/host/src/session-catalog.ts` - read-only provider-owned session
  discovery and resume commands.
- `shared/schemas/agent-session-telemetry.*` and
  `packages/host/src/session-telemetry.ts` - provider-neutral telemetry and
  lifecycle/capability observations.
- `apps/sigil/codex-terminal/server.mjs` and
  `apps/sigil/agent-terminal/launch.sh` - current product terminal bridge using
  tmux/process sessions; inspect as a useful substrate example, not as the
  future primitive boundary.
- `packages/host/src/provider/adapter.ts`, `packages/host/src/types.ts`, and
  `packages/host/src/provider/anthropic.ts` - existing provider adapter concept
  for model streaming; distinguish it from CLI/session dispatch if needed.
- `.codex/config.toml`, `.claude/settings.json`, `CLAUDE.md`, and `GEMINI.md`
  - current provider-specific configuration surfaces.

Search as needed for:

```bash
rg -n "provider-neutral|dispatch|provider adapter|resume_command|codex|claude|gemini|tmux|process session|agent terminal|dock profile|default_entry_path|harness|session catalog|telemetry|statusline" AGENTS.md .docks docs shared packages apps .codex .claude CLAUDE.md GEMINI.md
```

## Required Output

Create:

- `docs/design/notes/afk-provider-neutral-dispatch-shape-2026-05-21.md`

Use this shape:

1. Summary:
   - docs-only sketch;
   - no schema, source change, command behavior change, provider launch,
     gateway ownership of sessions, or scheduler implementation;
   - why dispatch follows the scheduler sketch and precedes work/evidence
     record trials or a local prototype.
2. Existing surface inventory:
   - dock profiles and launch roots;
   - provider session catalog and resume commands;
   - agent session telemetry/capability events;
   - Sigil Agent Terminal / Codex Terminal bridge as current substrate example;
   - provider-specific config files for Codex, Claude, and Gemini;
   - host provider adapter concept and why it is or is not the same as
     provider-neutral session dispatch.
3. Dispatch responsibility sketch:
   - receive scheduler-selected action: start, resume, dry-run, reject;
   - resolve dock profile and launch root;
   - select provider from explicit requirement, hint, policy, or availability;
   - build provider command for start/resume without hard-coding dock identity;
   - pass packet/result-route reference to the worker session;
   - establish terminal/session substrate expectations;
   - report provider session id, command, cwd/worktree, driver, and capability
     facts back to scheduler;
   - preserve local-only and no-external-publish policy.
4. Provider adapter comparison:
   - Codex CLI start/resume shape;
   - Claude Code start/resume shape;
   - Gemini or future provider placeholder;
   - tmux versus process driver tradeoff;
   - provider availability/authentication checks;
   - provider-local telemetry and drift handling.
5. Non-responsibilities:
   - packet validation and lease state;
   - scheduler lifecycle decisions;
   - reusable route judgment;
   - gateway integration job transitions;
   - work/evidence proof semantics;
   - role instruction policy or Researcher synthesis behavior.
6. Candidate command or API shape:
   - design-only examples such as
     `aos session dispatch --provider codex --dock gdi --packet <ref>`;
   - dry-run output;
   - start output;
   - resume output;
   - provider mismatch or unavailable-provider output;
   - idempotence and correlation keys.
7. Dispatch lifecycle:
   - normal start;
   - normal resume;
   - provider unavailable/auth missing;
   - cwd/worktree mismatch discovered at launch time;
   - provider accepts but no heartbeat/session catalog record appears;
   - provider drift or partial telemetry.
8. Boundary matrix:
   - provider-neutral dispatch;
   - session trigger/scheduler;
   - provider adapter;
   - dock profile;
   - docked provider session;
   - provider session catalog;
   - telemetry/capability surface;
   - terminal substrate;
   - transfer packet and result route.
9. Explicit deferrals:
   - no dispatch implementation;
   - no scheduler implementation;
   - no provider adapter implementation;
   - no transfer packet schema;
   - no source, tests, command behavior, router output, shared schema, or
     `docs/dev/workflow-rules.json` change;
   - no `.docks` instruction, dock profile, or handoff script change;
   - no gateway job schema/API change;
   - no GitHub, push, or PR mutation;
   - no Researcher dock creation.
10. Recommendation:
   - whether the next slice should be a work/evidence record trial, design
     consolidation/readiness pass, or local prototype, and why.

Also make a short synthesis update to
`docs/design/durable-agent-cognition-and-afk-primitives.md` if the new note
changes the near-term sequence or boundary wording. Keep that update short and
cite the new note.

## Scope

Edit only:

- `docs/design/notes/afk-provider-neutral-dispatch-shape-2026-05-21.md`
- optionally `docs/design/durable-agent-cognition-and-afk-primitives.md`

Do not edit prior mapping notes unless a link is broken.

## Hard Boundaries

- Do not add or modify schemas.
- Do not change source, tests, command behavior, router output, shared schema
  files, or `docs/dev/workflow-rules.json`.
- Do not change `.docks` role instructions, dock profiles, transfer scripts,
  hook behavior, or provider config files.
- Do not move or rename recipes, playbooks, workflows, work cards, docks,
  gateway files, API docs, apps, packages, or shared schema files.
- Do not implement provider-neutral dispatch, session trigger/scheduler,
  transfer packets, async result routing, work records, or evidence records.
- Do not launch provider sessions or mutate tmux/process sessions.
- Do not make gateway the owner of sessions.
- Do not create a Researcher dock.
- Do not push, open a PR, mutate GitHub issues, or publish externally.

## Verification

Run:

```bash
git diff --check
./aos dev recommend --json
```

No Swift rebuild, Node test, provider launch, or live AOS smoke is required
unless you violate this card's docs-only scope, which should not be necessary.

## Completion Report

Report:

- files changed;
- dispatch responsibilities and non-responsibilities;
- provider adapter comparison and selected boundary decisions;
- command/API shape examples and idempotence/correlation keys;
- dispatch lifecycle summary;
- boundary decisions across dispatch, scheduler, provider adapters, dock
  profiles, provider sessions, catalogs, telemetry, terminal substrate, transfer
  packets, and result routes;
- explicit deferrals preserved;
- recommended next slice;
- exact verification commands and pass/fail results;
- whether source, schemas, tests, command behavior, `.docks` instructions,
  dock profiles, provider config files, gateway API/schema, shared schema files,
  `docs/dev/workflow-rules.json`, GitHub, push, and PR surfaces were untouched;
- local-only state or unrelated dirty files.
