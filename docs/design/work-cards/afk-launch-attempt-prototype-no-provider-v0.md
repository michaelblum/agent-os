# Work Card: AFK Launch Attempt Prototype No-Provider V0

**Status:** Accepted 2026-05-22

## Acceptance

- Accepted output commit:
  `ea94a44f2f40790741a88d2f6ba4524925bd50e0`
- Changed files:
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `tests/afk-launch-attempt-prototype.test.mjs`
- Foreman review: accepted. The prototype creates local
  `aos.afk_launch_attempt` records, validates packet/source/cwd/worktree/ref/
  provider/dock before terminal work, observes process-driver terminal
  substrate through the existing Sigil codex-terminal bridge with a harmless
  Node command, handles duplicate in-process idempotence without starting a
  second bridge session, and leaves provider acceptance, catalog, telemetry,
  and route fields honest for the no-provider case.
- Foreman verification:
  - `node --test tests/afk-launch-attempt-prototype.test.mjs`
  - `node --test tests/afk-terminal-substrate-no-provider.test.mjs`
  - `git diff --check da3477c79eb5c34cd0c4ed100d6e11a252823eac..ea94a44f2f40790741a88d2f6ba4524925bd50e0`
  - `./aos dev recommend --json`
  - manual `node scripts/afk-launch-attempt-prototype.mjs --packet <temp-packet.json> --provider codex --dock gdi --json --timestamp 2026-05-22T02:15:00.000Z --out <temp-output.json>`
- Manual smoke result: lifecycle `provider_acceptance_unobserved`,
  idempotence key `116d82a253495a1d21d0b1f8cf77a4ab`, selected provider/dock
  `codex`/`gdi`, terminal driver `process`, terminal session
  `afk-launch-116d82a25349`, terminal cwd
  `/Users/Michael/Code/agent-os/.docks/gdi`, provider acceptance
  `not_applicable: no-provider-launch`, catalog `not_observed`, telemetry
  `not_observed`, route `not_attempted`, provider launch performed `false`,
  eight validations passed.
- Local-only boundary confirmed: no provider session, provider config, gateway
  state, generated committed receipt artifact, GitHub state, push, or PR
  changed.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider session, bridge state, catalog, telemetry, or prior implementation
state. Read and rediscover before editing.

## Goal

Implement a local no-schema AFK launch-attempt prototype that combines the
existing dry-run packet/dispatch facts with real terminal substrate observation
from the Sigil codex-terminal bridge, while still launching no provider.

The prototype should create one in-memory or temp-file `aos.afk_launch_attempt`
record for a no-provider run, enforce idempotence for duplicate launch intent,
observe process-driver terminal substrate facts through a harmless command, and
emit honest `not_observed` catalog/telemetry/provider-acceptance fields.

## Read First

- `.docks/gdi/AGENTS.md`
- `docs/design/notes/afk-launch-attempt-record-shape-2026-05-22.md`
- `docs/design/notes/afk-provider-session-observability-map-2026-05-22.md`
- `docs/design/work-cards/afk-terminal-substrate-no-provider-validation-v0.md`
- `docs/design/work-cards/afk-dry-run-launch-observability-fields-v0.md`
- `scripts/afk-dry-run-prototype.mjs`
- `tests/afk-dry-run-prototype.test.mjs`
- `tests/afk-terminal-substrate-no-provider.test.mjs`
- `apps/sigil/codex-terminal/server.mjs`
- `tests/sigil-agent-terminal-server.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse --short docs/durable-agent-cognition-v0
./aos dev recommend --json
```

## Branch / Base

- branch_from: `docs/durable-agent-cognition-v0`
- required_start_ref: `docs/durable-agent-cognition-v0`
- routed_from_sha: `5c74c1de`
- expected output branch:
  `gdi/afk-launch-attempt-prototype-no-provider-v0`
- publication: local-only; do not push, open a PR, mutate GitHub, or publish
  externally

## Existing Code To Inspect

- `scripts/afk-dry-run-prototype.mjs` - packet validation, current-state
  validation, provider/dock dry-run facts, and receipt output conventions.
- `tests/afk-dry-run-prototype.test.mjs` - deterministic receipt coverage.
- `tests/afk-terminal-substrate-no-provider.test.mjs` - process-driver bridge
  proof with harmless command.
- `apps/sigil/codex-terminal/server.mjs` - terminal bridge endpoints to use
  for no-provider substrate observation.

## Required Behavior

Create a focused experimental prototype, preferably:

```text
scripts/afk-launch-attempt-prototype.mjs
tests/afk-launch-attempt-prototype.test.mjs
```

The prototype should:

- accept a packet path, provider, dock, JSON output, and deterministic timestamp
  similar to the dry-run prototype;
- validate packet id/ref, source artifact, repo/worktree/cwd, required start
  ref, selected provider, and selected dock before any terminal substrate work;
- create an `aos.afk_launch_attempt` record using the field groups from
  `docs/design/notes/afk-launch-attempt-record-shape-2026-05-22.md`;
- use a stable idempotence key based on packet/ref, scheduler or prototype run
  id, selected dock, selected provider, launch root, intended worktree,
  required start ref, result route refs, and action;
- prove duplicate handling within the prototype: a repeated invocation or
  duplicate in-memory request with the same key must not start a second bridge
  session in the same process/test;
- start terminal substrate only through the existing codex-terminal bridge with
  `SIGIL_AGENT_TERMINAL_DRIVER=process` and a harmless Node command;
- reject or refuse any command path that would execute `codex`, `claude`,
  `gemini`, or another provider binary;
- record terminal substrate facts: status, driver, session handle, cwd, command,
  and snapshot reference or inline snapshot summary;
- keep `provider_acceptance`, catalog, telemetry, and result route facts honest:
  `not_applicable` for no-provider launch where appropriate, otherwise
  `not_observed` or `not_attempted`;
- emit JSON to stdout by default and optionally write an explicit `--out` path
  for local temp artifacts;
- clean up bridge child processes and temp files in tests.

Use existing helper code where practical, but avoid broad refactors. It is fine
for the first version to duplicate a small amount of prototype parsing logic if
extracting shared helpers would make the slice harder to review.

## Hard Boundaries

- Do not launch Codex, Claude, Gemini, or any provider.
- Do not create, edit, delete, parse, or depend on real provider sessions or
  transcripts.
- Do not mutate provider config, gateway state, dock profiles, `.docks`
  instructions, hooks, or launch scripts.
- Do not add a public `./aos` command yet.
- Do not implement unattended provider launch, scheduler, provider-neutral
  dispatch, gateway routes, catalog matching for real sessions, telemetry
  parsing, schemas, work records, evidence records, or generated committed
  receipt artifacts.
- Do not require tmux; force the bridge process driver for deterministic tests.
- Do not push, open a PR, mutate GitHub, or publish externally.

## Verification

Required:

```bash
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/afk-terminal-substrate-no-provider.test.mjs
git diff --check
./aos dev recommend --json
```

If GDI changes shared bridge behavior, also run:

```bash
node --test tests/sigil-agent-terminal-server.test.mjs
```

Run one manual prototype smoke with a temp packet and report the key record
facts. Remove the temp packet and any temp output afterward.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- exact prototype command shape;
- record fields/lifecycle/idempotence behavior implemented;
- tests/checks run and results;
- manual smoke key facts: final status, lifecycle state, idempotence key,
  selected provider/dock, terminal driver/session/cwd, provider acceptance,
  catalog, telemetry, and route status;
- confirmation that no provider session, provider config, gateway state,
  generated committed receipt artifact, GitHub state, push, or PR changed;
- remaining gap before the first supervised real provider launch.
