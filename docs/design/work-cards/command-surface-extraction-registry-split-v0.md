# Work Card: Command Surface Extraction Registry Split V0

**Status:** Ready for GDI

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI round
- Single next goal: extract the command registry surface into a clearer module boundary without changing CLI behavior.
- Source branch: `feat/command-surface-extraction`
- Required start ref: `origin/feat/command-surface-extraction`
- Output expectation: commit implementation changes on `feat/command-surface-extraction`; do not push unless explicitly instructed by Foreman or the handoff contract.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
canvas, issue, or prior implementation state. Read and rediscover before editing.

## Goal

Make the current `aos` command registry easier to evolve by separating command
surface assembly from the large static registry data file. Preserve the public
`aos help` and `aos help --json` behavior.

This is a first rearchitecture slice. Keep it narrow and reversible.

## Branch / Base

Start from:

```bash
git fetch origin
git switch feat/command-surface-extraction
git reset --hard origin/feat/command-surface-extraction
```

Stop and report if this would discard local user work.

## Read First

- `AGENTS.md`
- `src/AGENTS.md` if present
- `src/shared/command-registry.swift`
- `src/shared/command-registry-data.swift`
- `src/shared/command-help.swift`
- `src/main.swift`
- `docs/archive/superpowers/specs/2026-04-15-command-registry-design.md`
- `tests/help-contract.sh`
- `tests/dev-workflow-router.sh`
- `tests/schemas/dev-workflow-rules.test.mjs`

## Rediscover State

Run:

```bash
git status --short --branch
./aos ready --post-permission
./aos dev recommend --json --paths src/shared/command-registry.swift,src/shared/command-registry-data.swift,src/shared/command-help.swift,src/main.swift,tests/help-contract.sh,tests/dev-workflow-router.sh
```

This slice is deterministic. If readiness is blocked by repo-mode TCC/input-tap,
do not spend time on live repair unless the deterministic tests require it. Use:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

and report `human_needed` only if a required verification step cannot run.

## Existing Code To Inspect

- `src/shared/command-registry.swift` - owns command descriptor types and JSON serialization.
- `src/shared/command-registry-data.swift` - currently owns builder helpers and the full static registry population.
- `src/shared/command-help.swift` - consumes the global `commandRegistry` and renders text/JSON help.
- `src/main.swift` - initializes `commandRegistry = buildCommandRegistry()`.
- `tests/help-contract.sh` - pins help and registry behavior.
- `docs/dev/workflow-rules.json` and `tests/dev-workflow-router.sh` - route command-registry changes to the expected verification set.

## Required Behavior

Preserve these observable contracts:

- `./aos help --json` emits the same command tree content as before.
- `./aos help dev --json` and representative subcommand help still work.
- `./aos <command> --help --json` keeps using the registry path resolution behavior.
- Existing command descriptor IDs, usage strings, args, execution metadata, output metadata, examples, and discovery refs remain unchanged unless a test exposes a real existing inconsistency.
- `buildCommandRegistry()` remains callable from `src/main.swift`.

## Scope

Ownership boundary: Swift CLI command surface introspection.

The expected shape is a small extraction, such as:

- leave descriptor types and serialization in `src/shared/command-registry.swift`;
- move registry builder conveniences and population into one or more dedicated command-surface files under `src/shared/`;
- keep `command-registry-data.swift` either as a compatibility shim or reduce it to the static data entrypoint if that is less disruptive.

Choose the smallest structure that makes the next command-surface extraction slice easier without changing runtime command routing.

## Hard Boundaries / Non-Goals

- Do not redesign the command registry schema.
- Do not change CLI parsing or command execution behavior.
- Do not add a new runtime `aos` command.
- Do not convert the registry to JSON/YAML in this slice.
- Do not move command policy into the daemon.
- Do not modify unrelated docs, work cards, or archived specs.
- Do not delete old branch refs or mutate GitHub state.
- Do not launch providers.

## Suggested Implementation Areas

Likely files:

- `src/shared/command-registry-data.swift`
- new `src/shared/command-surface.swift` or similarly named file
- `src/main.swift` only if the entrypoint name changes, though preserving `buildCommandRegistry()` is preferred
- `tests/help-contract.sh` only if adding a focused guard for the extracted boundary is useful

After adding a new Swift source file, confirm the project build discovers it through the current build mechanism.

## Verification

Run deterministic checks:

```bash
./aos dev build
bash tests/help-contract.sh
bash tests/dev-workflow-router.sh
node --test tests/schemas/dev-workflow-rules.test.mjs
git diff --check
```

Also compare registry JSON before and after the extraction if practical. A good
approach is to capture `./aos help --json` before editing and compare it after
the build, ignoring only ordering/formatting differences if the JSON objects are
semantically identical.

## Completion Report Required

Return:

- classification: pass/fail/blocked;
- changed files;
- the module boundary chosen and why;
- confirmation that public command/help behavior is unchanged;
- exact verification commands and results;
- readiness state or reason live readiness was irrelevant;
- final `git status --short --branch`;
- any follow-up slice recommended for the command-surface extraction branch.
