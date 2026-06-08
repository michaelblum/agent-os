# Implementer Work Card: AOS Guarded Live Operation Command Surface V0

## Transfer

- recipient: Implementer
- kind: Implementer implementation and validation round
- governing issue: #113
- related issues: #411, #427
- source artifact: Foreman correction after a shared-gesture live proof failed
  because agent-facing launch helpers mutated runtime state after
  `./aos ready --json` passed.

## Branch / Base

- `branch_from`: local `main`
- `required_start_ref`: local `main` containing this card
- `expected_output_branch`: `implementer/aos-guarded-live-operation-command-surface-v0`

Do not start from `origin/main`; this is local-relay state. Do not create linked
worktrees. Preserve unrelated untracked files, especially `.playwright-cli/`.

The interrupted #427 shared-gesture work is preserved as a stash:

- `stash@{0}` at dispatch time:
  `preserve shared gesture spine Implementer diff before command-surface hardening`

Do not pop or modify that stash in this card. Foreman will review/reroute the
#427 feature diff after command-surface hardening is accepted.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, checkout, daemon,
canvas, issue, prior implementation state, or parent-thread plans. Read and
rediscover before editing.

## Current Runtime Boundary

At routing time, passive classification showed:

- repo service installed and target-matched;
- service `running:false`;
- no repo socket owner found;
- no persistent repo AOS process found;
- live readiness/control is not approved for this round.

Do not run live `./aos ready`, `./aos status`, `./aos clean`,
`./aos service start`, `./aos service restart`, `./aos show create`, or other
repo daemon control/mutation commands against the real repo runtime. Isolated
`AOS_STATE_ROOT` tests that explicitly start and tear down their own daemon are
allowed.

Allowed passive orientation:

```bash
./aos service status --mode repo --json
ps -axo pid,ppid,stat,etime,command | rg '(/Users/Michael/Code/agent-os/aos|AOS\.app|aos serve|Agent-OS)' || true
lsof -nP -U | rg '/Users/Michael/.config/aos/repo/sock|/Users/Michael/Code/agent-os/aos' || true
```

## Goal

Make normal agent-facing live-operation commands hard to misuse after a
point-in-time readiness pass by introducing a shared guarded live-operation
pattern and removing implicit restart/autostart behavior from verification and
launch helper paths unless explicit live-start permission is supplied.

The guarded pattern is:

```text
preflight runtime verdict
  -> bounded operation
  -> postflight runtime verdict
  -> failure output with the real blocker class
```

## Read First

- `AGENTS.md`
- the implementer native subagent instructions
- `docs/adr/0015-aos-tcc-capability-broker-boundary.md`
- `docs/design/work-cards/implementer-aos-runtime-command-surface-consolidation-v0.md`
- `scripts/lib/aos-readiness.mjs`
- `scripts/lib/aos-facts.mjs`
- `scripts/aos-ready.mjs`
- `scripts/aos-status.mjs`
- `scripts/aos-content.mjs`
- `scripts/aos-show-client.mjs`
- `scripts/aos-content-scope.sh`
- `scripts/aos-experience.mjs`
- `scripts/aos-launch.mjs`
- `scripts/aos-tell-listen.mjs`
- `scripts/aos-log.mjs`
- `scripts/aos-voice.mjs`
- `scripts/aos-inspect.mjs`
- `scripts/aos-see-observe.mjs`
- `packages/toolkit/components/surface-inspector/launch.sh`
- the manual TCC blocker report path
- `docs/dev/workflow-rules.json`
- `tests/aos-readiness-composition.test.mjs`
- `tests/show-wait-timeout-boundary.test.mjs`
- `tests/content-wait.sh`
- `tests/request-client-autostart-disabled.sh`
- `tests/request-client-isolated-autostart.sh`
- `tests/external-command-dispatch.sh`
- `tests/help-contract.sh`

## Rediscover State

Use passive/non-live orientation:

```bash
git status --short --branch
git rev-parse HEAD
./aos dev gh issue view 113 --json
./aos dev gh issue view 411 --json
./aos service status --mode repo --json
ps -axo pid,ppid,stat,etime,command | rg '(/Users/Michael/Code/agent-os/aos|AOS\.app|aos serve|Agent-OS)' || true
lsof -nP -U | rg '/Users/Michael/.config/aos/repo/sock|/Users/Michael/Code/agent-os/aos' || true
./aos dev recommend --json --paths scripts/aos-content-scope.sh,scripts/aos-experience.mjs,scripts/aos-launch.mjs,packages/toolkit/components/surface-inspector/launch.sh,docs/dev/workflow-rules.json,the manual TCC blocker report path,scripts/aos-content.mjs,scripts/aos-show-client.mjs,scripts/aos-tell-listen.mjs,scripts/aos-log.mjs,scripts/aos-voice.mjs,scripts/aos-inspect.mjs,scripts/aos-see-observe.mjs,scripts/lib/aos-readiness.mjs,scripts/lib/aos-facts.mjs
rg -n "auto-start|idle-timeout 5m|aos serve|service restart|content wait|show wait --id|show wait --timeout|timeout 5s|manual_intervention|TCC reset|AOS_DISABLE_DAEMON_AUTOSTART" scripts packages .docks docs/dev/workflow-rules.json tests
```

## Observed Footguns To Correct

- `scripts/aos-content-scope.sh` can run implicit
  `service restart --mode repo` and then `content wait --auto-start`.
- `scripts/aos-experience.mjs` can run `content wait --auto-start --timeout 15s`.
- `scripts/aos-launch.mjs` can run `content wait --auto-start --timeout 15s`.
- `packages/toolkit/components/surface-inspector/launch.sh` uses fixed
  `show wait` failures without runtime verdict detail.
- `docs/dev/workflow-rules.json` recommends brittle
  `./aos show wait --id <canvas-id> --timeout 5s`.
- the manual TCC blocker report path always prints
  `manual_intervention: TCC reset needed`.
- IPC helpers can spawn detached foreground `aos serve --idle-timeout 5m`,
  especially when `AOS_STATE_ROOT` is set.

## Required Behavior

### 1. Shared Guarded Live-Operation Helper

Add a shared command-surface helper or pattern, likely in `scripts/lib/`, for
agent-facing live operations. The helper should be dependency-injectable enough
to test without the real repo daemon.

It must support:

- preflight runtime verdict using the existing `runtimeVerdict(...)` contract
  from `scripts/lib/aos-readiness.mjs` where possible;
- a bounded operation callback;
- postflight runtime verdict;
- structured failure output that includes:
  - primary blocker id/class, such as `daemon_unmanaged`,
    `stale_daemons`, `daemon_unreachable`, `socket_unreachable`,
    `input_tap_not_active`, `accessibility`, `screen_recording`,
    `listen_access`, or `post_access`;
  - `runtime_verdict`;
  - operation id;
  - timeout/pending condition where applicable;
  - exact next action/handoff text.

Do not create a second readiness taxonomy. Reuse or reshape the existing
runtime verdict/action-plan helpers from the accepted #113 consolidation.

### 2. Gate Implicit Start/Restart In Agent Paths

Normal agent verification/launch helpers must not start, restart, or
auto-start the real repo daemon unless explicit live-start permission is
supplied.

Required changes:

- `scripts/aos-content-scope.sh`: remove implicit repo `service restart` and
  implicit `content wait --auto-start` from the default path. Add an explicit
  opt-in such as `--allow-start`, `--live-ok`, or a clearly named function
  parameter used by callers. Environment-only permission is not enough for
  user-facing scripts, though an env alias may be kept for tests.
- `scripts/aos-experience.mjs`: add explicit live-start permission for
  `activate` before service restart/content wait auto-start can happen.
  Without that permission, fail with a structured runtime verdict rather than
  mutating runtime state.
- `scripts/aos-launch.mjs`: same as `aos-experience.mjs`.
- `packages/toolkit/components/surface-inspector/launch.sh`: add explicit
  live-start permission and pass it to content-root setup. Without permission,
  do not start/restart/autostart AOS; fail diagnostically if the runtime is not
  already usable.
- `scripts/recipes-sigil-configure-status-item.sh`,
  `packages/toolkit/components/work-record-workbench/launch.sh`, and
  `packages/toolkit/components/markdown-workbench/launch.sh`: inspect and apply
  the same rule if they are normal agent-facing launch paths.

Tests may still use isolated `AOS_STATE_ROOT` auto-start, but that permission
must be explicit in the test harness or command invocation. Do not remove
isolated-daemon tests that intentionally validate auto-start.

### 3. Diagnostic Waits

Replace brittle fixed waits with diagnostic waits:

- `./aos show wait --json` timeout/failure should include the current
  `runtime_verdict` where available and the pending condition (`id`, manifest,
  JS predicate presence, timeout).
- If `show wait` cannot contact the daemon, it should distinguish
  `daemon_unreachable` / `socket_unreachable` from canvas-not-ready.
- `content wait` timeout/failure should include runtime verdict and missing
  roots when `--json` is used. If no daemon is reachable and auto-start is not
  allowed, return a non-TCC blocker.
- Update `docs/dev/workflow-rules.json` to recommend a diagnostic wait form,
  not fixed `show wait --timeout 5s`.
- Update `surface-inspector/launch.sh` to use diagnostic JSON failures and
  print the verdict on failure instead of collapsing to a generic timeout.

### 4. Runtime-Specific Manual-Intervention Helper

Replace or parameterize the manual TCC blocker report path so Implementer can
return distinct blockers:

- `manual_intervention: daemon_unmanaged`
- `manual_intervention: stale_daemons`
- `manual_intervention: daemon_unreachable`
- `manual_intervention: socket_unreachable`
- `manual_intervention: input_tap_not_active`
- `manual_intervention: accessibility`
- `manual_intervention: screen_recording`
- `manual_intervention: listen_access`
- `manual_intervention: post_access`

The existing TCC wording may remain only when the runtime verdict actually
identifies a permission/input-monitoring blocker. For daemon ownership, stale
lock, socket, or generic timeout failures, the helper must not say TCC reset.

Prefer adding a new helper name such as
`the implementer native subagent/scripts/runtime blocker report` and making the old helper a
thin compatibility entrypoint that calls the new classifier with a TCC-specific
default only when no runtime verdict is available. If any compatibility is kept,
state its removal gate in a comment or test: all in-repo work cards/helpers
should migrate to the runtime-specific helper.

### 5. IPC Auto-Start Hardening

Audit request/IPC clients that can spawn detached `aos serve --idle-timeout
5m`:

- `scripts/aos-content.mjs`
- `scripts/aos-show-client.mjs`
- `scripts/aos-tell-listen.mjs`
- `scripts/aos-log.mjs`
- `scripts/aos-voice.mjs`
- `scripts/aos-inspect.mjs`
- `scripts/aos-see-observe.mjs`

Normal agent workflows must not silently spawn detached foreground daemons.
Acceptable contracts:

- repo-mode without `AOS_STATE_ROOT` may use the managed service only when the
  specific command has explicit live-start permission;
- isolated `AOS_STATE_ROOT` auto-start may remain for tests/harnesses only when
  explicit isolated-start permission is supplied;
- no command should silently create a detached `serve --idle-timeout 5m` in a
  normal agent path after readiness has already been checked.

If a full shared IPC-client refactor is too large, implement the smallest
strict gate now and record the remaining consolidation as a follow-up in #113.
Do not leave an indefinite compatibility path.

### 6. #427 Strict-Contract Finding

Do not resume #427 implementation in this card, but record this finding in the
completion report:

The stashed #427 diff contains design wording like `legacy input_event messages
remain a compatibility source` and `compatibility adapter` without an explicit
removal gate. Foreman will require a correction before accepting #427: any
temporary ingress adapter must name owned in-repo consumers and a removal gate,
and owned callers should migrate rather than receive indefinite compatibility
support.

## Scope

Allowed:

- Node/script command-surface helpers;
- shell launch helper changes;
- Implementer runtime-blocker helper changes;
- deterministic tests;
- focused docs/API/workflow-rule updates needed to expose the new command
  contract.

Out of scope:

- Swift/native changes unless an explicit native-boundary justification is
  unavoidable;
- real repo live AOS restart/control/smoke;
- TCC reset, permission setup, System Settings automation;
- #427 feature implementation;
- broad dock instruction rewrites as the primary fix;
- GitHub mutation, pushing, PRs, or branch cleanup.

If Swift/native work appears necessary, stop with `foreman_rebuild_needed` and
state the exact privileged fact/action/stream or socket substrate change that
requires crossing the TCC broker boundary.

## Suggested Implementation Areas

- `scripts/lib/aos-live-operation.mjs` or `scripts/lib/aos-guarded-live.mjs` -
  new shared guard if existing helpers cannot cleanly host it.
- `scripts/lib/aos-readiness.mjs` - reuse `runtimeVerdict(...)`, blocker ids,
  and next actions.
- `scripts/lib/aos-facts.mjs` - runtime facts and ownership enrichment.
- `scripts/aos-content.mjs` and `scripts/aos-show-client.mjs` - diagnostic wait
  and auto-start gating.
- `scripts/aos-content-scope.sh`, `scripts/aos-launch.mjs`,
  `scripts/aos-experience.mjs` - remove implicit runtime mutation from default
  agent paths.
- `the implementer native subagent/scripts/` - runtime-specific manual-intervention helper.

## Verification

Run deterministic checks:

```bash
git diff --check
node --test tests/aos-readiness-composition.test.mjs
node --test tests/show-wait-timeout-boundary.test.mjs
bash tests/content-wait.sh
bash tests/request-client-autostart-disabled.sh
bash tests/request-client-isolated-autostart.sh
bash tests/external-command-dispatch.sh
bash tests/external-parser-flags.sh
bash tests/help-contract.sh
```

Add focused tests as needed for:

- launch/experience requiring `--allow-start` / `--live-ok` before
  start/restart/autostart;
- `show wait --json` timeout carrying `runtime_verdict`;
- `content wait --json` timeout/missing-root carrying `runtime_verdict`;
- Implementer manual-intervention helper classifying non-TCC runtime blockers distinctly.

Do not run live repo `./aos ready`, `./aos status`, `./aos show create`,
Surface Inspector launch, or Sigil live smoke in this round.

## Completion Report

Return a path-scoped report for Foreman with:

- changed files;
- exact command-surface behavior changed;
- which auto-start/restart paths now require explicit permission;
- any remaining IPC helper auto-start paths and named follow-up/removal gate;
- tests run with exact pass/fail results;
- passive final runtime classification;
- current `git status --short --branch`;
- confirmation that `stash@{0}` for the #427 feature diff was not modified;
- remaining blockers or next slice.
