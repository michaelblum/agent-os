# AFK All-CWD Unrelated Candidate Classification V0

**Status:** Routed 2026-05-22

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI round
- Source artifact:
  `docs/design/work-cards/operator-afk-bridge-all-cwd-live-correlation-v0.md`
- Required start ref: `docs/durable-agent-cognition-v0`
- Branch/output expectation: create or reuse a scoped local output branch named
  `gdi/afk-all-cwd-unrelated-candidate-classification-v0` from the required
  start ref. Keep the checkpoint local; do not push, open a PR, mutate GitHub,
  or run live provider checks.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider session, bridge process, catalog, telemetry, Operator report, or prior
implementation state. Read and rediscover before editing.

## Goal

Make the AFK launch-attempt prototype and adjacent instructions distinguish an
unrelated current all-cwd provider session from an independently observed
bridge-launched provider session id.

The defect shown by the Operator partial pass is:

- bridge launched Codex visibly in `/Users/Michael/Code/agent-os/.docks/gdi`;
- requested-cwd catalog did not show a current `.docks/gdi` Codex session;
- all-cwd catalog did show one current Codex session, but it was the supervising
  Operator session in `/Users/Michael/Code/agent-os/.docks/operator`;
- the optional classifier was given that all-cwd candidate id as
  `--provider-session-id`, causing `provider_session_wrong_cwd`;
- that overstates the evidence because the bridge launch did not independently
  observe a provider session id.

Preserve the existing true wrong-cwd behavior for cases where a provider session
id was actually observed from the launch and its catalog cwd differs from the
intended launch cwd.

## Read First

- `.docks/gdi/AGENTS.md`
- `docs/design/work-cards/operator-afk-bridge-all-cwd-live-correlation-v0.md`
- `docs/design/work-cards/afk-provider-session-cwd-mismatch-classification-v0.md`
- `docs/design/work-cards/afk-bridge-catalog-scope-correction-v0.md`
- `docs/design/notes/afk-provider-session-observability-map-2026-05-22.md`
- `docs/design/notes/afk-launch-attempt-record-shape-2026-05-22.md`
- `scripts/afk-launch-attempt-prototype.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
- `apps/sigil/codex-terminal/server.mjs`
- `apps/sigil/codex-terminal/session-inspector.mjs`
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

If live AOS readiness becomes necessary, run:

```bash
./aos ready
```

If repo-mode Accessibility, Input Monitoring, or input-tap readiness blocks a
live check, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `ready`, run
`./aos ready --post-permission`.

## Branch / Base

- branch_from: `docs/durable-agent-cognition-v0`
- required_start_ref: `docs/durable-agent-cognition-v0`
- routed_from_sha: `df00e8e33219371eb95ba33d501617d39622b77f`
- expected output branch:
  `gdi/afk-all-cwd-unrelated-candidate-classification-v0`
- publication: local-only; do not push, open a PR, mutate GitHub, or publish
  externally

## Existing Code To Inspect

- `scripts/afk-launch-attempt-prototype.mjs` - owns
  `classifyCatalogAndTelemetry`, `--provider-session-id`, launch-observed
  handling, catalog fixture handling, and the experimental
  `aos.afk_launch_attempt` record.
- `tests/afk-launch-attempt-prototype.test.mjs` - existing fixture coverage for
  stale catalog sessions, empty catalog, candidate current launch, exact match,
  multiple candidates, wrong-cwd provider session, and missing cwd metadata.
- `apps/sigil/codex-terminal/server.mjs` - `/sessions` all-cwd behavior and
  catalog query shape.
- `apps/sigil/codex-terminal/session-inspector.mjs` - telemetry attached to
  selected catalog records.
- `packages/host/src/session-catalog.ts` - provider catalog record semantics.
- `packages/host/src/session-telemetry.ts` - telemetry extraction semantics.

## Required Behavior

Implement the smallest deterministic source/test correction needed to represent
the Operator partial pass truthfully:

- Do not treat a current all-cwd catalog candidate as an observed launched
  provider session id merely because it is the only current all-cwd candidate.
- Preserve `provider_session_wrong_cwd` only for an independently supplied
  provider session id that was observed from the launched provider session and
  whose catalog cwd differs from the intended launch cwd.
- Add a way for the prototype to carry reviewable unrelated all-cwd candidate
  evidence without binding it as the launched provider session. This may be a
  field/status such as `all_cwd_current_unrelated`,
  `catalog_current_launch_not_observed`, `unrelated_current_session_refs`, or
  a better local name consistent with existing code.
- The output should say the current `.docks/gdi` launch was not catalog-visible
  while still preserving the all-cwd candidate id, cwd, and updated_at as
  reviewable context.
- Telemetry from the unrelated Operator session must not become telemetry for
  the bridge-launched `.docks/gdi` session.
- Update adjacent instructions or docs only where needed to prevent future
  Operator/GDI rounds from passing an all-cwd current candidate as
  `--provider-session-id` unless that id was independently observed from the
  launched provider session.

The prior accepted wrong-cwd fixture behavior must remain:

- when `--provider-session-id <id>` is supplied because the launch observed that
  provider session id;
- and the catalog record for `<id>` reports cwd `.docks/operator` instead of
  `.docks/gdi`;
- then the prototype may classify `provider_session_wrong_cwd` and
  `catalog_provider_session_wrong_cwd`.

## Fixture And Evidence Requirements

Use deterministic fixture data or temporary catalog roots. Do not read, write,
delete, or depend on real provider transcripts under the user's home directory.

Add or update fixture coverage for the Operator partial pass shape:

- intended launch cwd:
  `/Users/Michael/Code/agent-os/.docks/gdi`;
- launch observed at `2026-05-22T15:52:38Z`;
- requested-cwd catalog has no current `.docks/gdi` Codex record after launch;
- all-cwd catalog contains exactly one current Codex candidate:
  `019e5062-42f2-7340-beda-e2295ebf7f41`;
- that candidate cwd is `/Users/Michael/Code/agent-os/.docks/operator`;
- candidate updated_at is `2026-05-22T15:54:01.463Z`;
- result must not overclaim `provider_session_wrong_cwd` unless the test also
  supplies that id through a deliberately observed-provider-session path.

Keep existing coverage for:

- stale `.docks/gdi` current-launch absence;
- true observed provider-session wrong cwd;
- observed provider session with missing cwd;
- exact matched current launch;
- ambiguous current candidates.

## Hard Boundaries

- Do not launch Codex, Claude, Gemini, or another provider.
- Do not run a supervised live bridge proof in this GDI round.
- Do not implement unattended provider launch, scheduler, gateway routes,
  broker integration, result-route delivery, or committed generated receipts.
- Do not add a public `./aos` command unless a minimal test-only option/helper
  proves insufficient.
- Do not add or migrate schemas.
- Do not mutate provider config, provider transcripts, gateway state, dock
  profiles, `.docks` role instructions beyond this narrow SOP correction,
  hooks, GitHub state, push, or PRs.
- Do not weaken the accepted all-cwd `/sessions` endpoint behavior.
- Do not weaken the accepted true wrong-cwd classification.
- Do not require tmux or a live AOS display for deterministic tests.

## Verification

Required:

```bash
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/afk-terminal-substrate-no-provider.test.mjs
git diff --check
./aos dev recommend --json
```

If `apps/sigil/codex-terminal/server.mjs` or session inspector behavior changes,
also run:

```bash
node --test tests/sigil-agent-terminal-server.test.mjs
```

If host catalog or telemetry code changes, run the focused host tests
recommended by `./aos dev recommend --json` and report exact pass/fail output.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- whether any live provider session was launched, expected answer: no;
- how unrelated current all-cwd candidates are represented;
- how true observed provider-session wrong-cwd remains represented;
- fixture/test cases added or changed;
- exact verification commands and results;
- confirmation that no provider config, real provider transcript, gateway
  state, dock profile, hook, GitHub state, push, or PR changed;
- whether this resolves the Operator partial-pass semantics or leaves a
  separate bridge/provider launch visibility follow-up.
