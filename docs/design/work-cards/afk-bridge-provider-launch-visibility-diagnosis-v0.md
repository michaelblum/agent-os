# AFK Bridge Provider Launch Visibility Diagnosis V0

**Status:** Routed 2026-05-22

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI validation/classification round
- Source artifacts:
  - `docs/design/work-cards/operator-afk-bridge-all-cwd-live-correlation-v0.md`
  - `docs/design/work-cards/afk-all-cwd-unrelated-candidate-classification-v0.md`
- Required start ref: `docs/durable-agent-cognition-v0`
- Branch/output expectation: create or reuse a scoped local output branch named
  `gdi/afk-bridge-provider-launch-visibility-diagnosis-v0` from the required
  start ref. Keep the checkpoint local; do not push, open a PR, mutate GitHub,
  or run live provider checks.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider session, bridge process, catalog, telemetry, Operator report, or prior
implementation state. Read and rediscover before editing.

## Goal

Classify the remaining bridge/provider launch visibility gap and produce a
durable diagnosis that makes the next implementation slice precise.

The accepted state is:

- `/sessions?provider=codex&all_cwd=true` works and can find current sessions
  outside the requested cwd.
- The AFK launch-attempt prototype no longer treats unrelated all-cwd current
  sessions as launched-provider session ids.
- A supervised bridge-launched Codex process in
  `/Users/Michael/Code/agent-os/.docks/gdi` still did not create a current
  provider catalog record for `.docks/gdi` or an independently machine-observed
  provider session id.

This round should answer what surface must carry provider-launch visibility
next: provider catalog, bridge terminal snapshot/title parsing, launch wrapper
health, provider transcript discovery, or an explicit launch-side receipt field.

## Read First

- `.docks/gdi/AGENTS.md`
- `docs/design/work-cards/operator-afk-bridge-all-cwd-live-correlation-v0.md`
- `docs/design/work-cards/afk-all-cwd-unrelated-candidate-classification-v0.md`
- `docs/design/notes/manual-afk-receipts/2026-05-22-afk-provider-session-smoke-gdi-completed.md`
- `docs/design/notes/manual-afk-receipts/2026-05-22-bridge-backed-provider-launch-gdi-partial.md`
- `docs/design/notes/afk-provider-session-observability-map-2026-05-22.md`
- `docs/design/notes/afk-provider-neutral-dispatch-shape-2026-05-21.md`
- `docs/design/notes/afk-launch-attempt-record-shape-2026-05-22.md`
- `apps/sigil/agent-terminal/launch.sh`
- `apps/sigil/codex-terminal/launch.sh`
- `apps/sigil/codex-terminal/server.mjs`
- `apps/sigil/codex-terminal/session-inspector.mjs`
- `scripts/afk-launch-attempt-prototype.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
- `packages/host/src/session-catalog.ts`
- `packages/host/src/session-telemetry.ts`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse --short HEAD
git rev-parse --short docs/durable-agent-cognition-v0
./aos dev recommend --json
```

If live AOS readiness becomes necessary for a bounded non-provider check, run:

```bash
./aos ready
```

If repo-mode Accessibility, Input Monitoring, or input-tap readiness blocks a
check, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `ready`, run
`./aos ready --post-permission`.

## Branch / Base

- branch_from: `docs/durable-agent-cognition-v0`
- required_start_ref: `docs/durable-agent-cognition-v0`
- routed_from_sha: `5eb3706cd751009f4f2d99e68861b47828a9eb48`
- expected output branch:
  `gdi/afk-bridge-provider-launch-visibility-diagnosis-v0`
- publication: local-only; do not push, open a PR, mutate GitHub, or publish
  externally

## Validation Questions

Answer these from code and existing receipts only:

1. What exact event causes a Codex session to become visible in
   `packages/host/src/session-catalog.ts`?
2. Given the Operator reports, is the absence of a current `.docks/gdi` catalog
   record more likely:
   - expected catalog latency or provider metadata timing;
   - the process-driver bridge not creating a provider transcript with
     `session_meta`;
   - the launch wrapper failing before provider startup;
   - no readable prompt/response making it into the bridge snapshot;
   - wrong cwd/provider filter;
   - or another concrete cause?
3. Which facts are currently machine-observable from the bridge before the
   provider catalog appears: selected provider, command, cwd, branch/model/title,
   process/tmux handle, snapshot text, or provider session id?
4. What should the next implementation slice be: catalog polling/matching,
   bridge terminal snapshot/title extraction, launch wrapper health repair,
   explicit launch-side provider acceptance fields, or something else?
5. What deterministic test fixture would prove that next slice without launching
   Codex, Claude, Gemini, or another provider?

## Required Output

Create one durable diagnosis note under `docs/design/notes/` named with today's
date and this topic, for example:

`docs/design/notes/afk-bridge-provider-launch-visibility-diagnosis-2026-05-22.md`

The note must include:

- accepted facts from the Operator reports, without inventing new live evidence;
- current code surfaces and what each can or cannot observe;
- root-cause classification or an explicit "insufficient evidence" result with
  the missing evidence named;
- the recommended next owner and one next implementation/validation slice;
- the deterministic fixture shape needed for that next slice;
- explicit non-goals that should remain deferred.

If, while inspecting, you find a tiny deterministic documentation correction in
the existing Operator or work-card instructions that prevents future
overclaiming, you may update it. Do not implement source behavior in this round
unless the diagnosis would otherwise be incomplete and the fix is strictly
deterministic, provider-free, and small.

## Hard Boundaries

- Do not launch Codex, Claude, Gemini, or another provider.
- Do not run a supervised live bridge proof.
- Do not read, write, delete, or depend on real provider transcripts under the
  user's home directory.
- Do not mutate provider config, gateway state, dock profiles, `.docks` role
  instructions, hooks, GitHub state, push, or PRs.
- Do not implement unattended provider launch, scheduler, gateway routes,
  broker integration, result-route delivery, committed generated receipts, or
  schemas.
- Do not weaken the accepted all-cwd endpoint, unrelated-candidate
  classification, or true wrong-cwd classification.

## Verification

Required:

```bash
git diff --check
./aos dev recommend --json
```

If you make source or test changes despite the validation-first scope, run the
focused tests for those files and explain why the change stayed in scope. If you
only create/update docs, `./aos dev recommend --json --files <changed-docs>` may
be used to show the docs-only verification profile.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- classification result and confidence;
- recommended next owner and next slice;
- whether any source/test code changed;
- exact verification commands and results;
- confirmation that no live provider session was launched and no provider
  config, real provider transcript, gateway state, dock profile, hook, GitHub
  state, push, or PR changed.
