# Work Card: AFK Dev Session Trigger Supervised Bridge Provider Command Correction V0

**Status:** Routed 2026-05-22

## Transfer Classification

- Recipient: GDI
- Transfer kind: correction round
- Single next goal: correct the supervised bridge launch slice so the no-fixture
  guarded trigger path is provider-capable and will start Codex from `.docks/gdi`
  during a supervised Operator run, instead of starting only the old harmless
  no-provider marker command.
- Source artifact:
  `docs/design/work-cards/afk-dev-session-trigger-supervised-bridge-launch-v0.md`
- Reviewed output branch:
  `gdi/afk-dev-session-trigger-supervised-bridge-launch-v0`
- Reviewed output head:
  `f501072779344a22222f45cf49e94cbed5dbe7aa`
- Reviewed base:
  `a38d0da68f9e2a68ade269e19d1bd651575de516`
- Branch/output expectation: continue on
  `gdi/afk-dev-session-trigger-supervised-bridge-launch-v0` from this
  correction card commit. Keep the checkpoint local; do not push, open a PR,
  mutate GitHub, or publish externally.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider session, bridge process, transcript/catalog state, or Foreman's review
details beyond this card. Read and rediscover before editing.

## Foreman Review Finding

The routed card required the guarded trigger to start the supervised local
bridge/provider launch substrate for Codex from `.docks/gdi` when all guards
pass. The current implementation reuses `createLaunchAttempt`, but that helper
still constructs and enforces a no-provider marker command:

- `scripts/afk-launch-attempt-prototype.mjs:848` builds a harmless
  `node -e ...` marker command;
- `scripts/afk-launch-attempt-prototype.mjs:854` refuses command paths that
  include provider binaries;
- `scripts/afk-launch-attempt-prototype.mjs:1045` selects the harmless marker
  command for the launch attempt;
- `scripts/afk-session-trigger-prototype.mjs:372` calls `createLaunchAttempt`
  after the trigger guards pass.

Foreman targeted smoke of the no-fixture trigger path returned:

```json
{
  "exit": 1,
  "status": "cleanup_unverified",
  "terminal_command": "node -e \"console.log(Buffer.from(...",
  "provider_acceptance_status": "not_applicable: no-provider-launch",
  "provider_launch_allowed": true,
  "mismatch_classes": [
    "provider_acceptance_unobserved",
    "cleanup_unverified"
  ]
}
```

That is not acceptable for this slice: the command reports launch permission but
the terminal command is not Codex and provider acceptance is structurally
`not_applicable: no-provider-launch`. Fixture-backed tests can model acceptance,
but the real Operator path still would not launch Codex.

## Required Behavior

Fix the source behavior without broadening beyond the supervised Codex/GDI path:

- when all accepted trigger guards pass and no bridge/provider fixture is being
  used, the trigger path must be capable of starting Codex from `.docks/gdi`
  through the supervised local bridge substrate;
- the terminal command for that path must be provider-shaped, for example
  `codex --no-alt-screen` or the repo-approved equivalent;
- provider launch must remain impossible unless `--supervised-live-launch`,
  `--i-am-present`, `--json`, `--provider codex`, and `--dock gdi` all pass;
- duplicate suppression must still run before bridge/provider start;
- fixture-backed deterministic tests must still avoid live provider launch;
- no-provider marker behavior may remain available for
  `afk-launch-attempt` diagnostics, but the trigger's accepted supervised live
  no-fixture path must not silently use it as the launch command;
- provider acceptance timeout must remain non-completed;
- cleanup proof must still be required before `completed`;
- provider-owned transcript/catalog boundaries must remain read-only and
  bounded.

## Hard Boundaries

- Do not run a live Codex, Claude, Gemini, tmux, provider terminal, or real
  bridge session in this GDI correction round.
- Do not read real `~/.codex` transcript bodies.
- Do not mutate provider configs, provider session files, provider transcripts,
  provider catalogs, telemetry stores, gateway jobs, dock profiles, hooks,
  `.docks` role instructions, GitHub state, pushes, or PRs.
- Do not add final `aos session ...` spelling, unattended scheduling, gateway
  result-route delivery, schema promotion, or multi-provider live parity.

## Suggested Implementation Areas

- `scripts/afk-launch-attempt-prototype.mjs`
- `scripts/afk-session-trigger-prototype.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
- `src/commands/dev.swift`
- `src/shared/command-registry-data.swift`
- `tests/dev-workflow-router.sh`
- `tests/help-contract.sh`

One likely shape is to add an explicit internal/provider-launch mode to the
launch-attempt helper that is only reachable from the guarded trigger path, then
use deterministic fixtures/tests to assert the provider command shape without
actually executing it in GDI. Choose the smallest implementation that preserves
the existing no-provider diagnostics and keeps provider launch behind the
trigger's human-supervised gates.

## Verification

Required:

```bash
git status --short --branch
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
git diff --check
```

Run after Swift/help registry changes:

```bash
bash tests/dev-workflow-router.sh
bash tests/help-contract.sh
./aos dev build --no-restart
```

Add or update focused tests proving:

- the no-fixture supervised trigger path selects a Codex provider command after
  all trigger guards pass, without actually executing Codex in tests;
- fixture-backed tests still complete without live provider launch;
- missing human presence, missing JSON, wrong provider, wrong dock, duplicate
  states, and rejected/failed relaunch states do not select the provider command;
- provider-acceptance timeout remains non-completed;
- cleanup failure remains `cleanup_unverified`;
- cleanup success remains required before `completed`.

If repo-mode TCC/Input Monitoring readiness blocks, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `ready`, run:

```bash
./aos ready --post-permission
```

## Completion Report

Report:

- branch and head SHA;
- changed paths, path-scoped to this correction;
- exact no-fixture provider command behavior now selected by the guarded
  trigger path;
- how deterministic tests avoid live provider execution while proving command
  shape;
- guard, duplicate, provider-acceptance, and cleanup behavior;
- tests/checks run with exact pass/fail results;
- `./aos ready` result or exact human-needed blocker;
- confirmation that no live provider launch, real transcript read, provider
  config/session/catalog mutation, gateway state, dock profile/hook mutation,
  GitHub state, push, PR, or external publication happened.
