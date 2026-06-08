# Work Card: afk-dev-dry-run-command-v0

**Status:** Accepted 2026-05-22
**Owner:** Implementer

## Tracker

Transfer classification:

- Recipient: Implementer
- Transfer kind: Implementer round
- Source artifact:
  `scripts/afk-dry-run-prototype.mjs`
- Single next goal: expose the accepted AFK dry-run prototype through an
  experimental `./aos dev afk-dry-run` command without making it a public AFK
  runtime/session API.

Follow-up to accepted work card:

- `docs/design/work-cards/afk-dry-run-prototype-v0.md`

The accepted dry-run prototype validates one manual packet, resolves dock
profile facts, selects a provider only as a dry-run fact, and emits transfer,
scheduler, dispatch, work, and evidence receipt sections. The next step is to
make that prototype repeatable through the governed repo-development CLI
surface while preserving its experimental/no-provider-launch boundary.

Accepted evidence:

- Implementer branch: `implementer/afk-dev-dry-run-command-v0`
- Accepted commit: `f71c0aa2d8d2f0649a3b6a5f6f308cce0aa9d142`
- Output command:
  `./aos dev afk-dry-run --packet <packet.json> --provider codex --dock implementer --json`
- Changed files:
  `src/commands/dev.swift`, `src/shared/command-registry-data.swift`, and
  `tests/dev-workflow-router.sh`
- Foreman-side verification passed:
  `node --test tests/afk-dry-run-prototype.test.mjs`,
  `./aos dev build --no-restart`,
  `bash tests/dev-workflow-router.sh`,
  `./aos help dev --json`,
  `./aos help dev afk-dry-run --json`,
  `bash tests/help-contract.sh`,
  `node --test tests/schemas/dev-workflow-rules.test.mjs tests/schemas/dev-active-profile.test.mjs tests/schemas/dev-workflow-profiles.test.mjs`,
  `bash tests/dev-audit.sh`,
  `git diff --check`, `./aos dev recommend --json`, and `./aos ready`.
- Command smoke passed with a temp packet: emitted
  `aos.afk_dry_run_receipt_bundle.prototype`, `final_status: completed`,
  selected `codex` as a dry-run provider fact, and reported
  `launch_performed: false`.
- Boundary preserved: no provider launch, no schema mutation, no gateway
  mutation, no `.docks` mutation, no generated receipt artifacts committed, no
  final `aos session`/runtime AFK command, no GitHub mutation, no push, and no
  PR.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, prior implementation state, or built-binary freshness. Read and
rediscover before editing.

## Goal

Add an experimental developer command:

```bash
./aos dev afk-dry-run --packet <packet.json> --provider codex --dock implementer --json
```

The command should delegate to the accepted dry-run prototype behavior. It
should remain under `dev` so it is clearly a repo-development tool, not final
AFK session control. It must not launch providers, mutate schemas, mutate the
gateway, or imply final `aos session ...` command spelling.

## Read First

- `AGENTS.md`
- `.docks/AGENTS.md`
- `.docks/AGENTS.md`
- the implementer native subagent instructions
- `docs/design/work-cards/afk-dry-run-prototype-v0.md`
- `docs/design/work-cards/afk-dry-run-prototype-cwd-validation-correction-v0.md`
- `docs/design/notes/afk-work-evidence-receipt-shape-2026-05-21.md`
- `scripts/afk-dry-run-prototype.mjs`
- `tests/afk-dry-run-prototype.test.mjs`
- `src/commands/dev.swift`
- `src/shared/command-registry-data.swift`
- `tests/dev-workflow-router.sh`
- `tests/help-contract.sh`
- `build.sh`

## Rediscover State

Run from the repo root:

```bash
git status --short --branch
./aos dev recommend --json
./aos dev classify --json --paths src/commands/dev.swift,src/shared/command-registry-data.swift,scripts/afk-dry-run-prototype.mjs,tests/afk-dry-run-prototype.test.mjs,tests/dev-workflow-router.sh
```

This slice changes Swift CLI wiring and tests, so expect a Swift build. If a
live readiness check reports repo-mode TCC/input-tap blockers after rebuilding,
use the repo-standard recovery path rather than retrying blindly:

```bash
the manual TCC blocker report path
```

After the human returns, run:

```bash
./aos ready --post-permission
```

## Branch/Base

branch_from: `docs/durable-agent-cognition-v0`
required_start_ref: `docs/durable-agent-cognition-v0`

This branch contains local-only design notes, work cards, and the accepted
experimental dry-run prototype. Do not reset to `origin/main`.

If you create an output branch, use `implementer/afk-dev-dry-run-command-v0` from the
required start ref. Keep the checkpoint local unless Foreman or Michael
explicitly asks for a push or PR.

## Existing Surfaces To Inspect

Start with:

- `scripts/afk-dry-run-prototype.mjs` - accepted implementation behavior.
- `tests/afk-dry-run-prototype.test.mjs` - current deterministic coverage.
- `src/commands/dev.swift` - `devCommand` subcommand router and existing
  process-wrapper patterns such as `devBuildCommand`.
- `src/shared/command-registry-data.swift` - help/registry form definitions for
  `dev` commands.
- `tests/dev-workflow-router.sh` - current dev command/help assertions.
- `tests/help-contract.sh` - broader registry/help contract expectations.

Search as needed for:

```bash
rg -n "devCommand|dev-build|dev-gh|InvocationForm\\(id: \"dev-|runProcessCapturingOutput|UNKNOWN_SUBCOMMAND|printCommandHelp" src tests
```

## Required Behavior

The command should:

1. Accept the same core options as the prototype:
   - `--packet <path>` required;
   - `--provider <name>` optional when packet has provider hint;
   - `--dock <dock>` optional when packet has requested recipient;
   - `--repo <path>` optional;
   - `--timestamp <iso>` optional for deterministic tests;
   - `--out <path>` optional;
   - `--json` for JSON output.
2. Preserve no-provider-launch behavior:
   - no flag should enable provider launch from the `./aos dev` wrapper;
   - if the underlying script still has `--allow-provider-launch` as an
     internal rejection test hook, do not expose it in command help.
3. Delegate to the script or share its behavior with minimal duplication.
   Prefer invoking the accepted Node script from Swift unless inspection shows a
   smaller safer reuse path.
4. Propagate stdout/stderr and exit status from the dry-run script.
5. Return machine-readable errors through existing `exitError` patterns for
   wrapper-level argument mistakes such as unknown flags or missing values.
6. Expose registry/help metadata:
   - `./aos help dev --json` includes `dev-afk-dry-run`;
   - `./aos help dev afk-dry-run --json` exposes the option tokens;
   - text help does not describe it as stable runtime session control.
7. Keep the command explicitly experimental in summary/help/JSON-facing text.

## Scope

Likely files:

- `src/commands/dev.swift`
- `src/shared/command-registry-data.swift`
- `tests/dev-workflow-router.sh`
- optionally `tests/help-contract.sh` if the broader help contract is the local
  convention for new command forms
- `scripts/afk-dry-run-prototype.mjs` only if a small option/usage adjustment is
  necessary for clean wrapper delegation
- `tests/afk-dry-run-prototype.test.mjs` only if script behavior changes

Do not edit AFK design notes unless a link is broken or the command reveals a
specific correction that must be documented before proceeding.

## Hard Boundaries

- Do not create a final `aos session`, `aos afk`, scheduler, dispatch, or
  runtime command surface.
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
- Do not make gateway the owner of sessions.
- Do not create a Researcher dock.
- Do not push, open a PR, mutate GitHub issues, or publish externally.

## Verification

Run:

```bash
node --test tests/afk-dry-run-prototype.test.mjs
bash tests/dev-workflow-router.sh
./aos dev build --no-restart
```

After the build, run a command-level smoke with a temp packet:

```bash
./aos dev afk-dry-run --packet <temp-packet.json> --provider codex --dock implementer --json
```

The smoke should prove:

- exit code 0 for a valid packet;
- receipt type is `aos.afk_dry_run_receipt_bundle.prototype`;
- `final_status` is `completed`;
- provider is selected as a dry-run fact;
- `launch_performed` is false;
- no provider session id exists beyond the dry-run `not_applicable` value.

Also run:

```bash
./aos help dev --json
./aos help dev afk-dry-run --json
git diff --check
./aos dev recommend --json
```

If `./aos dev recommend --json` recommends `./aos ready`, run it only if local
readiness is the next meaningful proof and the repo-mode TCC/input-tap state is
not blocked. If it is blocked, use the manual TCC blocker report path
and stop with `manual_intervention`.

## Completion Report

Report:

- files changed;
- command shape and why it remains experimental/dev-only;
- whether the wrapper delegates to the script or shares logic another way;
- argument validation behavior;
- help/registry updates;
- valid-packet smoke result and key receipt facts;
- proof that no provider launch occurred;
- exact verification commands and pass/fail results;
- whether schemas, provider configs/sessions/transcripts/catalogs, gateway
  state, `.docks` instructions/profiles, generated artifacts, final AFK runtime
  commands, GitHub, push, and PR surfaces were untouched;
- local-only state or unrelated dirty files;
- recommended next slice: command correction, receipt contract correction, or
  first supervised provider/session launch design.
