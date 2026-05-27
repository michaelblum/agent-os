# Work Card: AFK Warm Dock TUI Reuse Contract V0

**Status:** Accepted 2026-05-23

## Result

- Foreman review: accepted.
- Branch/ref gates passed on `gdi/afk-warm-dock-tui-reuse-contract-v0` at
  `0d826e0860bff02dbf7dcb2c1f7d550a7750433c`, based on
  `96b9c289b86125cad19ed3deb9a7f2d31e7b9b6d`.
- Diff was scoped to:
  - `scripts/afk-launch-attempt-prototype.mjs`;
  - `scripts/afk-session-trigger-prototype.mjs`;
  - `tests/afk-launch-attempt-prototype.test.mjs`;
  - `tests/afk-session-trigger-prototype.test.mjs`.
- Behavior accepted: warm TUI reuse is represented as
  `launch_mode=warm_dock_tui_reuse` with `context_reset_command="/clear"`,
  provider process reuse separated from provider conversation/session identity,
  Codex/GDI `/goal ` dispatch, Operator plain dispatch, metadata-backed session
  boundary observation, and explicit mismatch when the post-reset metadata
  resolves to the previous session id.
- Verification rerun by Foreman passed:
  - `./aos ready` returned
    `ready=true mode=repo daemon=reachable tap=active`;
  - `node --test tests/afk-session-trigger-prototype.test.mjs` with 21/21
    passing;
  - `node --test tests/afk-launch-attempt-prototype.test.mjs` with 41/41
    passing;
  - `node --test packages/host/test/codex-thread-adapter.test.ts` with 16/16
    passing;
  - `git diff --check`.
- Follow-up routed:
  `docs/design/work-cards/operator-afk-warm-dock-tui-reuse-live-proof-v0.md`
  for a supervised proof against the real long-lived GDI and Operator terminals.
- No real dock terminal was driven by Foreman, no live provider launch occurred,
  no transcript body was read, no provider store/catalog/telemetry mutation
  occurred, no gateway/dock runtime mutation occurred, no GitHub issue/PR/main
  mutation occurred, no external notifier or non-local async routing was
  implemented, and no unsupervised trigger behavior occurred during Foreman
  acceptance.

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI round
- Single next goal: add a deterministic warm-dock TUI reuse contract to the AFK
  prototypes so `/clear` is modeled as the provider conversation boundary while
  the dock-local Codex process stays alive.
- Source artifacts:
  - `.docks/README.md`
  - `.docks/gdi/AGENTS.md`
  - `.docks/operator/AGENTS.md`
  - `docs/design/work-cards/afk-session-trigger-result-route-override-normalization-v0.md`
  - `scripts/afk-session-trigger-prototype.mjs`
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `tests/afk-session-trigger-prototype.test.mjs`
  - `tests/afk-launch-attempt-prototype.test.mjs`
  - `packages/host/src/codex-thread-adapter.ts`
  - `packages/host/test/codex-thread-adapter.test.ts`
- Branch/Base:
  - `branch_from: gdi/afk-session-trigger-result-route-override-normalization-v0`
  - `required_start_ref: gdi/afk-session-trigger-result-route-override-normalization-v0`
  - Accepted local route compatibility source head:
    `8265ffc8dfe48f58b1f761657a01c1c9de030ed4`
- Branch/output expectation: create or reuse
  `gdi/afk-warm-dock-tui-reuse-contract-v0` from the required start ref. Commit
  and push that GDI branch when verification passes under the active
  `agentic_relay` profile. Do not open a PR, merge, mutate main, mutate GitHub
  issues/projects, or broaden into external publication.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider process, terminal state, Codex session metadata, or prior live proof.
Read and rediscover before editing.

## User Operating Model To Proceduralize

The user's normal workflow is three long-lived dock-local Codex CLI terminals:

- Foreman terminal with cwd `.docks/foreman`;
- GDI terminal with cwd `.docks/gdi`;
- Operator terminal with cwd `.docks/operator`.

The user normally does not restart Codex between GDI/Operator rounds. They enter
`/clear` in the existing Codex CLI to reset the context window, then:

- for GDI, type `/goal`, type one space, paste Foreman's clipboard payload, and
  press Enter;
- for Operator, paste Foreman's clipboard payload directly and press Enter.

Codex is only exited and restarted when hooks, dock-local config, provider
runtime, or the Codex runtime itself changed enough that the process must
reboot. User-supplied provider notes for Codex and Claude Code say `/clear`
starts a fresh conversation/session context, distinct from Ctrl+L screen
clearing, while keeping the CLI process warm.

## Goal

Make the AFK prototypes represent that manual workflow as a first-class,
deterministic dispatch mode:

```text
warm_dock_tui_reuse = existing dock-local Codex process + /clear context reset + role-shaped dispatch
```

This slice should not drive the real terminals. It should add the receipt
contract, prompt/reset construction, metadata correlation expectations, and
fixture-backed tests needed for a later Operator live proof.

## Required Behavior

- Add a warm reuse launch/dispatch mode name such as `warm-dock-tui-reuse` or
  `warm_tui_reuse` to the AFK prototype receipts.
- The receipt must distinguish provider process identity from provider
  conversation identity:
  - `provider_process_reused=true`;
  - `provider_process_launch_performed=false`;
  - `context_reset_command="/clear"`;
  - `context_reset_expected_provider_boundary=true`;
  - previous provider session/thread id when supplied by fixture or adapter;
  - new provider session/thread id when observed by fixture-backed Codex
    metadata;
  - mismatch if the post-reset Codex metadata resolves to the previous session
    id.
- Keep GDI and Operator dispatch shapes distinct:
  - Codex/GDI dispatch starts with `/goal ` and then the Foreman payload;
  - Operator dispatch is the plain Foreman payload, with no `/goal` prefix;
  - the first character typed after reset should be `/` for GDI and the first
    payload character for Operator.
- Keep `/clear` and `/goal clear` separate:
  - `/clear` is the normal context reset command;
  - `/goal clear` is only a fallback/cleanup command for stale completed goal
    state when the CLI requires it.
- Do not require source-owned provider process teardown in this mode. Cleanup
  should become a warm-lease disposition such as `returned_to_idle`,
  `left_leased_for_operator`, or `retire_required`, not
  `owned_provider_command_child_exit`.
- Preserve existing cold supervised-provider behavior and cleanup requirements.
- Preserve local result-route behavior accepted through
  `8265ffc8dfe48f58b1f761657a01c1c9de030ed4`.

## Suggested Receipt Shape

Use the existing receipt style, but make the warm-mode facts explicit. A narrow
shape like this is enough if it is consistent with local code:

```json
{
  "launch_intent": {
    "launch_mode": "warm_dock_tui_reuse",
    "provider_process_reused": true,
    "provider_process_launch_performed": false,
    "context_reset_command": "/clear"
  },
  "terminal_substrate": {
    "status": "warm_tui_reused",
    "cwd": "/Users/Michael/Code/agent-os/.docks/gdi",
    "input_submission": {
      "context_reset_submitted": true,
      "context_reset_command": "/clear",
      "provider_prompt_mode": "codex_goal",
      "provider_prompt_prefix": "/goal ",
      "first_dispatch_character": "/"
    }
  },
  "provider_acceptance": {
    "status": "provider_session_observed",
    "observation_source": "codex_adapter_metadata",
    "provider_session_id": "<new session id>"
  },
  "warm_tui_reuse": {
    "status": "context_boundary_observed",
    "previous_provider_session_id": "<old session id>",
    "new_provider_session_id": "<new session id>",
    "provider_session_changed": true,
    "cleanup_disposition": "returned_to_idle"
  }
}
```

If existing naming suggests a better field placement, use it, but keep the
distinction between process reuse and conversation/session freshness visible.

## Read First

- `AGENTS.md`
- `.docks/README.md`
- `.docks/gdi/AGENTS.md`
- `.docks/operator/AGENTS.md`
- `docs/dev/active-profile.json`
- `docs/dev/workflow-profiles.json`
- `docs/design/work-cards/afk-session-trigger-result-route-override-normalization-v0.md`
- `scripts/afk-session-trigger-prototype.mjs`
- `scripts/afk-launch-attempt-prototype.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
- `packages/host/src/codex-thread-adapter.ts`
- `packages/host/test/codex-thread-adapter.test.ts`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD gdi/afk-session-trigger-result-route-override-normalization-v0 8265ffc8dfe48f58b1f761657a01c1c9de030ed4
./aos ready
./aos dev recommend --json --paths scripts/afk-session-trigger-prototype.mjs,scripts/afk-launch-attempt-prototype.mjs,tests/afk-session-trigger-prototype.test.mjs,tests/afk-launch-attempt-prototype.test.mjs,packages/host/src/codex-thread-adapter.ts,packages/host/test/codex-thread-adapter.test.ts
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

## Existing Code To Inspect

- `scripts/afk-launch-attempt-prototype.mjs` - owns launch mode, prompt
  construction, Codex metadata promotion, cleanup proof classification, and
  launch-attempt receipt shape.
- `scripts/afk-session-trigger-prototype.mjs` - owns trigger-level scheduler
  receipt and launch-attempt composition.
- `tests/afk-launch-attempt-prototype.test.mjs` - owns fixture-backed provider
  acceptance, prompt transport, cleanup, and Codex adapter tests.
- `tests/afk-session-trigger-prototype.test.mjs` - owns trigger-level receipt
  status, lifecycle, result route, and launch-attempt fixture behavior.
- `packages/host/src/codex-thread-adapter.ts` - owns read-only Codex metadata
  session/thread discovery.

## Scope

This is a deterministic prototype/contract slice. It may add flags, fixture
inputs, helper functions, receipt fields, tests, and docs needed to represent
warm dock TUI reuse. It should not attempt real Terminal.app automation or a
live Codex TUI drive in this round.

## Hard Boundaries

- Do not drive the user's real Foreman, GDI, or Operator terminals.
- Do not run live Codex/provider launches.
- Do not restart, exit, or kill the user's dock-local Codex processes.
- Do not read provider transcript bodies.
- Do not mutate provider store, catalog, telemetry, gateway, dock runtime,
  GitHub issues, PRs, or main.
- Do not implement gateway/broker, Slack, Foreman inbox, GitHub issue/PR
  comment, or external notifier routes.
- Do not implement unsupervised triggers.
- Do not remove or relax `--i-am-present`.
- Do not collapse `/clear` and `/goal clear` into one command.

## Verification

Run and report:

```bash
git status --short --branch
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test packages/host/test/codex-thread-adapter.test.ts
git diff --check
```

If the host adapter test runner is different in this repo, use the smallest
existing host/package command that covers `codex-thread-adapter` and report the
exact command.

## Completion Report Required

Return:

- branch and head SHA;
- base/start SHA;
- files changed;
- tests run and pass/fail counts;
- exact warm-mode flag/field names added;
- receipt examples for Codex/GDI and Operator dispatch shapes;
- proof that old cold supervised-provider cleanup behavior still requires
  source-owned teardown;
- proof local result-route behavior remains intact;
- remaining next slice recommendation, likely an Operator supervised live proof
  against the real long-lived dock terminals;
- explicit statement that no real dock terminal was driven, no live provider
  launch occurred, no transcript body was read, no provider store/catalog/
  telemetry mutation occurred, no gateway/dock runtime mutation occurred, no
  GitHub issue/PR/main mutation occurred, no external notifier or non-local
  async routing was implemented, and no unsupervised trigger behavior occurred
  beyond the expected GDI branch push.
