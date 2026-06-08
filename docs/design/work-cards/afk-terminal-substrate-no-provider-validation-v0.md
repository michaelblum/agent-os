# Work Card: AFK Terminal Substrate No-Provider Validation V0

**Status:** Accepted 2026-05-22

## Acceptance

- Accepted output commit:
  `360fcb55c096a7a9981033aaf708fe25f8b91a74`
- Changed file:
  - `tests/afk-terminal-substrate-no-provider.test.mjs`
- Foreman review: accepted. The validation starts the existing Sigil
  codex-terminal bridge with `SIGIL_AGENT_TERMINAL_DRIVER=process`, temporary
  home/catalog roots, and a harmless Node command. It asserts machine-readable
  `/health`, `/ensure`, `/snapshot`, `/sessions`, and `/session-inspector`
  facts without launching Codex, Claude, Gemini, or another provider.
- Foreman verification:
  - `node --test tests/afk-terminal-substrate-no-provider.test.mjs`
  - `node --test tests/sigil-agent-terminal-server.test.mjs`
  - `git diff --check 369d8310e3bbb6c428f8a72a0f1548f74b845c3f..360fcb55c096a7a9981033aaf708fe25f8b91a74`
  - `./aos dev recommend --json`
- Substrate facts verified: process driver, default session, cwd, ensured
  session id, harmless command snapshot/output, machine-readable session/cwd
  payload, empty provider catalog, and missing telemetry/session-inspector
  record.
- Local-only boundary confirmed: no provider session, provider config, gateway
  state, generated receipt artifact, GitHub state, push, or PR changed.

## Fresh Context Contract

Implementer starts from a fresh context window. Do not assume branch, worktree, daemon,
provider session, bridge state, tmux state, or prior implementation state. Read
and rediscover before editing.

## Goal

Add one deterministic AFK-facing validation that proves the repo can observe
real terminal/session substrate facts without launching a provider.

The validation should exercise the existing Sigil agent-terminal/codex-terminal
bridge with a harmless process command, capture substrate facts such as driver,
session, cwd, command, and snapshot/output, and keep provider catalog/telemetry
claims honest. This is a substrate validation slice before automated provider
launch; it must not launch Codex, Claude, Gemini, or any provider.

## Read First

- the implementer native subagent instructions
- `docs/design/notes/afk-provider-session-observability-map-2026-05-22.md`
- `docs/design/work-cards/afk-dry-run-launch-observability-fields-v0.md`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
- `apps/sigil/codex-terminal/server.mjs`
- `tests/sigil-agent-terminal-server.test.mjs`
- `scripts/afk-dry-run-prototype.mjs`
- `tests/afk-dry-run-prototype.test.mjs`

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
- routed_from_sha: `6a422a2c`
- expected output branch:
  `implementer/afk-terminal-substrate-no-provider-validation-v0`
- publication: local-only; do not push, open a PR, mutate GitHub, or publish
  externally

## Existing Code To Inspect

- `apps/sigil/codex-terminal/server.mjs` - bridge endpoints and driver/session
  behavior.
- `tests/sigil-agent-terminal-server.test.mjs` - existing process-driver test
  setup with harmless commands and fixture provider transcripts.
- `packages/host/src/session-catalog.ts` and
  `packages/host/src/session-telemetry.ts` - inspect only as needed to avoid
  overclaiming catalog/telemetry.
- `scripts/afk-dry-run-prototype.mjs` and
  `tests/afk-dry-run-prototype.test.mjs` - current AFK receipt vocabulary.

## Required Behavior

Create a focused deterministic validation, preferably a new test file such as:

```text
tests/afk-terminal-substrate-no-provider.test.mjs
```

The validation should:

- start `apps/sigil/codex-terminal/server.mjs` on a free local port with
  `SIGIL_AGENT_TERMINAL_DRIVER=process`;
- use a temporary cwd/home and a harmless command such as a short-lived Node
  command, not `codex`, `claude`, `gemini`, or any provider binary;
- call the bridge endpoint(s) needed to prove terminal substrate facts, such as
  `/health`, `/ensure`, and `/snapshot`;
- assert the observed driver/session/cwd/command facts are machine-readable;
- assert provider session id, provider catalog, and telemetry are absent or
  fixture-only unless explicit fixture transcripts are supplied;
- clean up the child bridge process and temporary files;
- avoid dependence on a running AOS daemon, browser, display, tmux, provider
  auth, or provider transcript state.

If an existing test already fully covers this AFK-specific validation, do not
duplicate it blindly. Add the smallest AFK-oriented assertion, fixture, or docs
pointer that makes the substrate proof reusable for the AFK dispatch workstream.

## Optional Docs Update

If the validation clarifies the next implementation step, add a concise pointer
to `docs/design/durable-agent-cognition-and-afk-primitives.md` or a short note
under `docs/design/notes/`. Keep it brief and evidence-based.

## Hard Boundaries

- Do not launch Codex, Claude, Gemini, or any provider.
- Do not create, edit, delete, parse, or depend on real provider sessions or
  transcripts.
- Do not mutate provider config, gateway state, dock profiles, `.docks`
  instructions, hooks, or launch scripts.
- Do not implement automated provider launch, scheduler, provider-neutral
  dispatch, gateway routes, catalog matching for real sessions, telemetry
  parsing beyond existing fixture-backed paths, schemas, work records, evidence
  records, or generated receipt artifacts.
- Do not require tmux; force the bridge process driver for deterministic tests.
- Do not push, open a PR, mutate GitHub, or publish externally.

## Verification

Required:

```bash
node --test tests/afk-terminal-substrate-no-provider.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
git diff --check
./aos dev recommend --json
```

If the exact new test filename differs, run the actual focused AFK substrate
test and name it in the completion report. If Implementer changes only docs, explain
why the existing test already covers the required behavior and run the existing
bridge test.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- whether any source behavior changed or this was test/docs only;
- exact substrate facts asserted by the validation;
- tests/checks run and results;
- confirmation that no provider session, provider config, gateway state,
  generated receipt artifact, GitHub state, push, or PR changed;
- remaining gap before automated provider launch.
