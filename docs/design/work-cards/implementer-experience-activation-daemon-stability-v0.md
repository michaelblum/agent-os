# Implementer Experience Activation Daemon Stability V0

## Recipient

Implementer deterministic correction round.

## Transfer Kind

Correction round.

## Single Next Goal

Make `aos experience activate sigil` idempotent and daemon-safe so canonical
Sigil activation does not rewrite live-equivalent content roots, destabilize the
repo daemon, or leave stale daemon locks.

## Branch / Base

- branch_from: local `main` containing `732fdf3f`
  (`docs(work-cards): gate input event live proof rerun`).
- required_start_ref: local `main` containing `732fdf3f` and `5f6445a4`.
- expected output branch:
  `implementer/experience-activation-daemon-stability-v0`.
- tracker issue: #431
  https://github.com/michaelblum/agent-os/issues/431
- related published PR: #438
  https://github.com/michaelblum/agent-os/pull/438

Work in `/Users/Michael/Code/agent-os`, not in `.docks/`. Use the single local
checkout; do not create linked git worktrees.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume daemon, branch, issue,
canvas, config, or artifact state. Read and rediscover before editing.

## Source Artifact

Foreman reviewed the blocked Operator run for
`docs/design/work-cards/operator-input-event-v2-live-proof-v0.md`.

- first blocked artifact directory:
  `/tmp/aos-input-event-v2-live-proof-v0/`
- Foreman blocked-run review comment:
  https://github.com/michaelblum/agent-os/issues/431#issuecomment-4641262262
- Foreman bounded recovery attempt after Michael approval:
  - `./aos clean --json` removed stale lock for dead PID `27724`;
  - `./aos service start --mode repo --json` succeeded with service PID `54070`,
    daemon PID `54079`, and active input tap;
  - `./aos experience activate sigil` printed `Sigil experience active.`;
  - immediate `./aos service status --mode repo --json` reported
    `running:false`;
  - `./aos status --json` reported `diagnosis:"daemon_unmanaged"` with a stale
    lock for dead PID `54079`;
  - `launchctl print gui/$(id -u)/com.agent-os.aos.repo` reported last exit code
    `11`;
  - `./aos clean --json` removed the new stale lock.

The repo service is currently intentionally left not running. Do not treat this
card as approval for another live repo service loop.

Current config after the failed recovery is canonical but the service is stopped:

```text
./aos config get status_item.toggle_url --json
=> "aos://sigil/renderer/index.html?toolkit-root=toolkit"

./aos config get content.roots.toolkit --json
=> "/Users/Michael/Code/agent-os/packages/toolkit"

./aos config get content.roots.sigil --json
=> "/Users/Michael/Code/agent-os/apps/sigil"
```

The daemon log for the latest failed run shows canonical Sigil setup followed by
repeated:

```text
Config: content.roots changed - restart daemon to apply
```

and then Sigil canvas removal before the launchd service exited with code `11`.

## Read First

- `AGENTS.md`
- `docs/design/work-cards/operator-input-event-v2-live-proof-v0.md`
- `docs/design/work-cards/implementer-sigil-status-item-stale-root-recovery-v0.md`
- `scripts/aos-experience.mjs`
- `scripts/aos-content-scope.sh`
- `scripts/aos-config-command.mjs`
- `scripts/aos-clean.mjs`
- `scripts/lib/aos-live-operation.mjs`
- `src/commands/serve.swift`
- `src/daemon/unified.swift`
- `src/shared/config.swift`
- `experiences/sigil/aos-experience.json`
- `apps/sigil/scripts/launch-common.sh`
- `tests/guarded-live-operation.sh`
- `tests/aos-clean-canvas-regression.sh`
- `tests/content-wait.sh`
- `tests/sigil-experience-wiki-seed.sh`

## Rediscover State

Run:

```bash
git status --short --branch
git log --oneline origin/main..main
./aos service status --mode repo --json
./aos clean --dry-run --json
./aos config get status_item.toggle_url --json || true
./aos config get content.roots.toolkit --json || true
./aos config get content.roots.sigil --json || true
```

Do not run `./aos ready`, `./aos status`, service start/restart, `./aos
experience activate sigil`, repo-mode live smoke, `./aos dev build`, TCC reset,
or permission repair during rediscovery.

## Problem To Correct

`scripts/aos-experience.mjs` currently resolves Sigil content roots to absolute
paths, then `ensureContentRoots()` writes those roots through `aos config set`
on every activation, regardless of whether the configured roots are already
live-equivalent. In the current repo-mode service, that path is enough to emit
`Config: content.roots changed - restart daemon to apply` and the launchd daemon
exits with code `11` during or shortly after canonical Sigil activation.

The correction should make activation idempotent:

- if a configured content root already resolves to the same path as the
  manifest root, do not rewrite it just because one value is relative and the
  other is absolute;
- if branch-scoped stale roots need reconciliation, remove/update only the stale
  owned keys needed for the active experience;
- do not require a repo service restart when no effective content-root change is
  needed;
- if an effective content-root change really is needed, preserve the existing
  guarded live-operation contract and require explicit `--allow-start` before
  restart/start behavior.

## Required Behavior

1. `aos experience activate sigil --dry-run --json` still reports canonical
   Sigil/toolkit roots and status-item target.
2. In an isolated state root where `content.roots.toolkit=packages/toolkit` and
   `content.roots.sigil=apps/sigil`, activation treats those as equivalent to
   absolute manifest paths and does not perform content-root writes solely to
   normalize path spelling.
3. In an isolated state root with stale owned branch-scoped Sigil/toolkit roots,
   activation still reconciles stale owned keys and sets the canonical current
   roots/status item.
4. `aos experience activate sigil --json` without `--allow-start` still fails
   with `LIVE_START_NOT_ALLOWED` when the operation would need to start or
   restart a daemon.
5. `aos clean --dry-run --json` and `aos status --json` continue to diagnose
   active Sigil status-item drift and stale/broken avatar canvases.

## Hard Boundaries

- Do not run live repo service start/restart or `./aos ready`.
- Do not run repo-mode `./aos experience activate sigil` against the user's
  current state.
- Use isolated daemon/state-root tests for daemon lifecycle reproduction.
- Do not remove branch-scoped roots as a concept.
- Do not break status-item stale-root recovery from
  `implementer-sigil-status-item-stale-root-recovery-v0.md`.
- Do not broaden into #431 input payload code, TCC, native input tap, radial
  menu, voice, or general Sigil UI behavior.
- Do not push, open PRs, mutate #431, or close issues.
- If Swift/native changes become necessary, stop and report why before running
  `./aos dev build`.

## Verification

Run focused deterministic checks:

```bash
git diff --check
bash tests/guarded-live-operation.sh
bash tests/aos-clean-canvas-regression.sh
bash tests/content-wait.sh
bash tests/sigil-experience-wiki-seed.sh
```

Add and run a focused regression for idempotent Sigil activation with equivalent
relative/absolute content roots. Prefer an isolated state root and the existing
isolated daemon helpers rather than the user's repo service.

If you change command help or guarded-operation semantics, also run:

```bash
bash tests/help-contract.sh
bash tests/external-parser-flags.sh
```

## Completion Report

Report:

- branch and head SHA;
- files changed;
- root cause;
- exact idempotence behavior added;
- whether stale branch-scoped root recovery still works;
- exact tests run with pass/fail;
- confirmation that no repo-mode live start/restart, `./aos ready`, repo-mode
  `experience activate`, TCC repair, build, push, PR, or issue mutation was run;
- any remaining runtime blocker before the #431 Operator live proof can be
  rerun.
