# AFK Warm Reuse Agent Terminal Session Fixture Correction v0

## Recipient

GDI

## Transfer Kind

Correction round

## Tracker

Source card:

- `docs/design/work-cards/afk-warm-reuse-agent-terminal-session-fixture-v0.md`

Rejected head:

- `gdi/afk-warm-reuse-agent-terminal-session-fixture-v0` at
  `46bc880a408932c2f84929870a56f18cac77ebd7`.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, provider, or prior implementation state. Read and rediscover
before editing.

## Goal

Correct two contract regressions in the Agent Terminal warm reuse fixture slice:

1. Agent Terminal observation copied into AFK receipts must remain explicitly
   non-evidence even if a fixture claims provider acceptance.
2. Loose warm-reuse fixtures without Agent Terminal session facts must preserve
   the previous warm substrate defaults.

Do not broaden the slice.

## Branch / Base

- card_branch:
  `foreman/afk-warm-reuse-agent-terminal-session-fixture-correction-v0`
- branch_from: `gdi/afk-warm-reuse-agent-terminal-session-fixture-v0` at
  `46bc880a408932c2f84929870a56f18cac77ebd7`
- required_start_ref:
  `foreman/afk-warm-reuse-agent-terminal-session-fixture-correction-v0`
- expected_output_branch:
  `gdi/afk-warm-reuse-agent-terminal-session-fixture-correction-v0`

Create or update the expected output branch from the required start ref. Do not
reset to `origin/main`; the rejected implementation and this correction card are
feature-branch state.

## Read First

- `AGENTS.md`
- `docs/design/work-cards/afk-warm-reuse-agent-terminal-session-fixture-v0.md`
- `scripts/afk-launch-attempt-prototype.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git log --oneline --decorate --max-count=6
./aos ready
```

If `./aos ready` reports a repo-mode Accessibility, Input Monitoring, or
inactive input-tap blocker, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

Only continue if it reports ready.

## Review Findings

### Finding 1: Agent Terminal acceptance status is not forced to non-evidence

At rejected head, `scripts/afk-launch-attempt-prototype.mjs` copies
`dockTerminalFixture.agent_terminal_observation.provider_acceptance.status` into
`terminal_substrate.agent_terminal_observation.provider_acceptance.status` when
the fixture provides one.

That means a malformed or overly optimistic Agent Terminal-shaped fixture can
leave `provider_acceptance.status="provider_session_observed"` inside the
Agent Terminal observation. The source card required Agent Terminal observation
to remain `human_observability_only` with `provider_acceptance.status` equal to
`not_evidence`; AFK provider acceptance must come from Codex metadata/catalog
or explicit provider-session fixtures, not Agent Terminal visual state.

Correction:

- Always force the nested Agent Terminal observation copy to:
  - `acceptance_role: "human_observability_only"`;
  - `provider_acceptance.status: "not_evidence"`.
- Preserve harmless descriptive fields such as `reason` if useful, but do not
  preserve a positive provider acceptance status from Agent Terminal.
- Add a focused regression where the fixture tries to provide
  `provider_acceptance.status="provider_session_observed"` and the resulting
  nested Agent Terminal observation is still `not_evidence`.

### Finding 2: Loose warm-reuse fallback substrate defaults changed

At rejected head, `terminal_substrate.driver` and `session_handle` are always
taken from the normalized dock terminal receipt. For old loose warm-reuse
fixtures with no Agent Terminal dock session facts, that changes exposed
substrate defaults from the previous:

- `driver: base?.terminal_substrate?.driver ?? "manual_tui"`;
- `session_handle: base?.terminal_substrate?.session_handle ?? warm.session_handle ?? warm.sessionHandle ?? "not_observed"`;

to registry defaults such as:

- `driver: "aos_pty"`;
- `session_handle: "gdi:fixture-pty"`.

The source card explicitly required preserving older fallback behavior for
fixtures that only provide `warm_tui_reuse`, `warmTuiReuse`, or loose warm
fields.

Correction:

- Use Agent Terminal dock-session receipt driver/handle only when an actual
  dock terminal session fixture is present.
- Otherwise preserve the previous exposed fallback behavior for
  `terminal_substrate.driver` and `terminal_substrate.session_handle`.
- Add assertions to existing warm reuse tests proving the loose fixture path
  still reports the old defaults.

## Hard Boundaries

- Do not drive real dock terminals.
- Do not launch live providers.
- Do not read provider transcript bodies.
- Do not mutate provider stores, catalogs, telemetry, gateway/dock runtime, or
  Codex configuration.
- Do not start async result routing.
- Do not create PRs, mutate GitHub issues, merge to main, or mutate main.
- Do not route Operator live proof.
- Do not remove or relax `--i-am-present`.

## Verification

Run:

```bash
./aos ready
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
git diff --check
```

## Completion Report

Report:

- branch and head SHA;
- base SHA;
- changed files;
- exact fix for each finding;
- exact verification commands and results;
- any local-only dirty or generated artifacts;
- remaining risk or recommended follow-up;
- confirmation that no live provider launch, real terminal drive, transcript
  body read, provider mutation, GitHub issue/PR/main mutation, async routing, or
  Operator live proof occurred.
