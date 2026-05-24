# Work Card: AFK Sleep Lease Safety Contract V0

**Status:** Ready for GDI

## Foreman Triage

The user wants AOS to support work continuing while they sleep.

This warrants near-term work, but it is not safe to treat the current
`--supervised-live-launch --i-am-present` path as an overnight mode. The current
AFK prototype deliberately requires human presence, rejects unattended aliases,
and keeps live provider launch bounded. That is the correct baseline.

The next reversible step is to define a "sleep lease" contract: an explicit,
bounded user authorization that lets an AFK run continue without the human
watching, while preserving branch isolation, local evidence, budget limits,
hard stop conditions, and a wake-up report.

Do not start an unattended live provider run in this slice.

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI round
- Single next goal: define the AFK sleep-lease safety contract and near-term
  implementation sequence for allowing bounded work to continue while the human
  is asleep.
- Source artifacts:
  - `docs/design/durable-agent-cognition-and-afk-primitives.md`
  - `docs/design/notes/afk-work-evidence-receipt-shape-2026-05-21.md`
  - `docs/design/notes/afk-session-trigger-scheduler-shape-2026-05-21.md`
  - `docs/design/notes/afk-session-trigger-guarded-live-mode-readiness-2026-05-22.md`
  - `docs/design/work-cards/afk-dev-session-trigger-guarded-live-codex-launch-v0.md`
  - `docs/design/work-cards/afk-dev-session-trigger-dry-run-command-v0.md`
  - `docs/design/work-cards/operator-afk-session-trigger-headless-scheduler-live-proof-v0.md`
  - `scripts/afk-session-trigger-prototype.mjs`
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `tests/afk-session-trigger-prototype.test.mjs`
  - `tests/afk-launch-attempt-prototype.test.mjs`
- Branch/Base:
  - `branch_from: origin/main`
  - `required_start_ref: origin/main` with this work card present
- Branch/output expectation: create
  `gdi/afk-sleep-lease-safety-contract-v0` from `origin/main`. Commit and push
  that GDI branch when verification passes. Do not open a PR, merge, mutate
  main, mutate GitHub issues/projects, start live providers, or route follow-up
  work.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
readiness, provider auth, provider process state, prior live proof state, or
current AFK prototype behavior. Read and rediscover before editing.

## Product Intent

The target user story is:

```text
Before going to sleep, the human grants AOS a bounded sleep lease. AOS may work
through pre-approved local tasks until the lease expires or a stop condition is
hit. When the human wakes up, AOS can provide a compact receipt showing what was
attempted, what changed, what passed, what failed, what was left untouched, and
what decision is needed next.
```

This is not an open-ended autonomous agent. It is a bounded local execution
lease with explicit authorization and durable evidence.

## Required Output

Create one design note:

- `docs/design/notes/afk-sleep-lease-safety-contract-2026-05-24.md`

Optionally add a short pointer in:

- `docs/design/durable-agent-cognition-and-afk-primitives.md`

Only update the synthesis doc if the new note changes the near-term AFK
sequence.

## Required Decisions To Cover

1. Authorization model:

   - explicit user opt-in before sleep;
   - absolute expiry time and maximum wall-clock duration;
   - maximum number of provider launches;
   - provider token or spend budget if enforceable, otherwise a clear
     "not enforceable yet" field;
   - allowed docks/providers;
   - allowed work-card refs or queue entries;
   - allowed branch/output behavior;
   - whether branch pushes are allowed during the lease.

2. Work scope:

   - one pre-approved work card versus a small queue;
   - whether Foreman may choose the next card while the human is asleep;
   - whether GDI may continue after tests fail;
   - whether Operator/HITL work is forbidden by default while the human sleeps;
   - how to represent work that needs human judgment.

3. Start gates:

   - clean worktree or path-scoped dirty-state allowance;
   - required start ref;
   - `./aos ready` or deterministic-only fallback;
   - provider availability/auth checks;
   - result route availability;
   - receipt pre-write before provider launch;
   - duplicate/idempotence checks.

4. Runtime guardrails:

   - heartbeat cadence and lease file location;
   - local receipt/update cadence;
   - timeout behavior;
   - retry limits;
   - process cleanup proof;
   - branch isolation;
   - no main merge, no PR, no GitHub issue mutation, no external publication,
     and no destructive cleanup unless explicitly authorized;
   - transcript-body and provider-store boundaries.

5. Stop conditions:

   - TCC/readiness blocker;
   - provider auth or credential prompt;
   - unexpected human prompt;
   - permission request;
   - unrelated dirty worktree state;
   - merge conflict;
   - tests fail after a bounded correction attempt;
   - provider timeout or cleanup unverified;
   - token/spend/time budget reached;
   - external publication or human judgment needed.

6. Wake-up report:

   - branch/head/base refs;
   - commits and pushed branches;
   - changed files;
   - tests and command gates;
   - provider sessions launched and bounded metadata only;
   - token/spend estimate if available;
   - local artifacts and receipt paths;
   - cleanup proof;
   - unresolved blockers;
   - next human decision.

7. Near-term implementation sequence:

   - deterministic sleep-lease packet validation, no provider launch;
   - dry-run receipt for accepted/rejected sleep lease;
   - guarded live run with explicit sleep lease but short duration while the
     human is awake;
   - first true overnight run only after the previous gates pass.

## Read First

- `AGENTS.md`
- `.docks/README.md`
- `.docks/foreman/AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `.docks/operator/AGENTS.md`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `docs/design/notes/afk-work-evidence-receipt-shape-2026-05-21.md`
- `docs/design/notes/afk-session-trigger-scheduler-shape-2026-05-21.md`
- `docs/design/notes/afk-session-trigger-guarded-live-mode-readiness-2026-05-22.md`
- `docs/design/work-cards/afk-dev-session-trigger-guarded-live-codex-launch-v0.md`
- `scripts/afk-session-trigger-prototype.mjs`
- `scripts/afk-launch-attempt-prototype.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos dev recommend --json --paths docs/design/durable-agent-cognition-and-afk-primitives.md,docs/design/notes/afk-work-evidence-receipt-shape-2026-05-21.md,docs/design/notes/afk-session-trigger-scheduler-shape-2026-05-21.md,docs/design/notes/afk-session-trigger-guarded-live-mode-readiness-2026-05-22.md,docs/design/work-cards/afk-dev-session-trigger-guarded-live-codex-launch-v0.md,scripts/afk-session-trigger-prototype.mjs,scripts/afk-launch-attempt-prototype.mjs,tests/afk-session-trigger-prototype.test.mjs,tests/afk-launch-attempt-prototype.test.mjs
```

This is a docs/design slice. Do not run `./aos ready` unless source reading
shows live runtime state is needed, which is not expected.

## Hard Boundaries

- Do not implement a sleep-lease command in this slice.
- Do not remove or relax `--i-am-present`.
- Do not add `--unattended`, `--background`, or similar live provider behavior.
- Do not start live Codex, Claude, Gemini, tmux, provider terminal, or bridge
  sessions.
- Do not read provider transcript bodies.
- Do not mutate provider stores, catalogs, telemetry, gateway/dock runtime,
  Codex configuration, dock profiles, hooks, or `.docks` role instructions.
- Do not implement gateway/broker, Slack, Foreman inbox, GitHub issue/PR
  comment, or external notifier routes.
- Do not create durable schemas, fixtures, or generated receipt artifacts.
- Do not create PRs, mutate GitHub issues/projects, merge to main, or route
  another work card.

## Verification

Run:

```bash
git diff --check
./aos dev recommend --json --paths docs/design/notes/afk-sleep-lease-safety-contract-2026-05-24.md,docs/design/durable-agent-cognition-and-afk-primitives.md
```

No Swift build, Node test, provider launch, or live AOS smoke is required unless
the docs-only boundary is violated, which should not be necessary.

## Completion Report Required

Return:

- branch and head SHA;
- base/start SHA;
- files changed;
- authorization model decisions;
- work-scope and queue decisions;
- start gates;
- runtime guardrails;
- stop conditions;
- wake-up report shape;
- near-term implementation sequence;
- exact verification commands and results;
- explicit statement that no source, schema, fixture, generated receipt,
  provider launch, transcript body read, provider store/catalog/telemetry
  mutation, gateway/dock runtime mutation, GitHub issue/PR/main mutation,
  external notifier, durable work/evidence record, unattended trigger, or
  follow-up routing occurred beyond the expected GDI branch push.
