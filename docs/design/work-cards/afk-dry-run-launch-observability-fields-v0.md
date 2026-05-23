# Work Card: AFK Dry-Run Launch Observability Fields V0

**Status:** Accepted 2026-05-22

## Acceptance

- Accepted output commit:
  `1175eef40c3f7ffbe6ac6e3670c79a05862ba770`
- Changed files:
  - `scripts/afk-dry-run-prototype.mjs`
  - `tests/afk-dry-run-prototype.test.mjs`
- Foreman review: accepted. The receipt now exposes explicit
  `dispatch.launch_observability` facts for selected provider, selected dock,
  dock launch root, intended cwd/worktree, dry-run command, launch state,
  terminal substrate, provider session id, catalog, telemetry, mismatch facts,
  and missing-evidence explanation without implying provider launch.
- Foreman verification:
  - `node --test tests/afk-dry-run-prototype.test.mjs`
  - `git diff --check 412ad0840fb5d04aec4cbb9c34649df212f46399..1175eef40c3f7ffbe6ac6e3670c79a05862ba770`
  - `git diff --check c20c85d9e0efd239a2112b5899a8ed164ab745d7..HEAD`
  - `./aos dev recommend --json`
  - manual `./aos dev afk-dry-run --packet <temp-packet.json> --provider codex --dock gdi --json --timestamp 2026-05-22T01:30:00.000Z`
- Manual smoke result: `final_status=completed`, selected provider `codex`,
  selected dock `gdi`, launch root `.docks/gdi`, intended launch cwd
  `/Users/Michael/Code/agent-os/.docks/gdi`, `launch_performed=false`,
  terminal substrate `not_applicable: dry-run/no-provider-launch`, catalog
  `not_observed`, telemetry `not_observed`, seven validations passed.
- Local-only boundary confirmed: no provider session, provider config, gateway
  state, generated receipt artifact, GitHub state, push, or PR changed.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
provider session, catalog, telemetry, or prior implementation state. Read and
rediscover before editing.

## Goal

Make the experimental AFK dry-run receipt explicitly carry the launch
observability facts needed before automated provider launch, while still
refusing to launch any provider.

This is a no-provider implementation slice. It should make future receipts
harder to overclaim: launch intent, selected provider/dock, intended cwd/root,
terminal substrate, catalog, telemetry, and `launch_performed=false` must be
visible and tested as dry-run facts.

## Read First

- `.docks/gdi/AGENTS.md`
- `docs/design/notes/afk-provider-session-observability-map-2026-05-22.md`
- `docs/design/notes/manual-afk-receipts/2026-05-22-afk-provider-session-smoke-gdi-completed.md`
- `docs/design/notes/afk-work-evidence-receipt-shape-2026-05-21.md`
- `docs/design/notes/afk-provider-neutral-dispatch-shape-2026-05-21.md`
- `docs/design/durable-agent-cognition-and-afk-primitives.md`
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
- routed_from_sha: `55ffdd94`
- expected output branch: `gdi/afk-dry-run-launch-observability-fields-v0`
- publication: local-only; do not push, open a PR, mutate GitHub, or publish
  externally

## Existing Code To Inspect

- `scripts/afk-dry-run-prototype.mjs` - receipt construction and validation.
- `tests/afk-dry-run-prototype.test.mjs` - deterministic receipt coverage.
- `src/commands/dev.swift` - dev command wrapper; inspect only if the script
  invocation contract must change.
- `src/shared/command-registry-data.swift` - help/registry surface; inspect only
  if the command help changes.

## Required Behavior

The dry-run receipt should include a clear launch-observability section or
equivalent explicit fields. Avoid duplicating existing fields when a small
normalization or test assertion is enough.

For a valid dry run with provider `codex` and dock `gdi`, the receipt must make
these facts machine-readable:

- selected provider;
- selected dock;
- selected dock launch root;
- intended launch cwd/worktree;
- intended provider command or dry-run command;
- launch requested state;
- `launch_performed: false`;
- terminal substrate:
  `not_applicable: dry-run/no-provider-launch`;
- provider session id:
  `not_applicable: dry-run/no-provider-launch`;
- catalog reference:
  `not_observed`;
- telemetry reference:
  `not_observed`;
- provider mismatch facts, when provider selection is unsupported;
- missing-evidence explanation that catalog and telemetry are absent by design
  unless transcript/statusline parsing actually runs.

For invalid cwd/worktree and unsupported provider cases, preserve the existing
structured failure behavior and make sure the launch-observability fields do
not imply a launch occurred.

## Hard Boundaries

- Do not launch Codex, Claude, Gemini, or any provider.
- Do not create, edit, delete, parse, or depend on provider sessions or
  transcripts.
- Do not mutate provider config, gateway state, dock profiles, `.docks`
  instructions, hooks, or launch scripts.
- Do not implement scheduler, provider-neutral dispatch, gateway routes,
  terminal bridge, catalog matching, telemetry parsing, schemas, work records,
  evidence records, or generated receipt artifacts.
- Do not change public final AFK command spelling. `./aos dev afk-dry-run`
  remains experimental.
- Do not push, open a PR, mutate GitHub, or publish externally.

## Verification

Required:

```bash
node --test tests/afk-dry-run-prototype.test.mjs
git diff --check
./aos dev recommend --json
```

Also run one manual valid dry-run smoke through the dev command if no Swift
rebuild is required by the router:

```bash
./aos dev afk-dry-run --packet <temp-packet.json> --provider codex --dock gdi --json --timestamp 2026-05-22T01:30:00.000Z
```

Report the key receipt facts from that smoke and remove the temp packet.

If the router recommends Swift rebuild because `src/commands/dev.swift` or
`src/shared/command-registry-data.swift` changed, run the recommended build and
adjacent command/help tests before reporting completion.

## Completion Report

Report:

- branch and head SHA;
- files changed;
- exact behavior changed;
- tests/checks run and results;
- manual dry-run smoke result, including selected provider, selected dock,
  launch root/cwd, launch_performed, terminal substrate, catalog ref, telemetry
  ref, and final_status;
- confirmation that no provider session, provider config, gateway state,
  generated receipt artifact, GitHub state, push, or PR changed;
- remaining gap before automated provider launch.
