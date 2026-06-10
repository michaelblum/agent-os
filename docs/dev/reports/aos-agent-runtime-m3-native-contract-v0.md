# AOS Agent Runtime M3 Native Contract

Superseded: `docs/dev/reports/aos-agent-runtime-m3-correction-v1.md` and
`docs/adr/0016-aos-owned-agent-execution.md` supersede this report wherever it
claims `native-codex` is the default engine or destination. This file is
historical evidence for the M3 drift that was corrected on 2026-06-10.

## Decision

`./aos dev agents` is now the AOS-owned agent runtime contract surface. The
default engine is `native-codex`, which plans the v2 Codex custom-agent spawn
shape from live `.codex/agents` and `.docks/profiles` data. Provider SDK
execution remains available only as an explicit `provider-sdk` adapter.

M3 uses an external native execution lifecycle instead of putting
orchestration into Swift or the Python runner: plan a native run, write
`summary.json` and `native-dispatch.json`, execute the emitted v2 spawn contract
in a Codex session, then import the child result with `--complete-native-run`.

## Ownership Split

- `scripts/aos_agents/runner.py` owns local contract enforcement: role/profile
  loading, native dispatch planning, provider adapter execution, runtime
  artifact writing, and patch check/apply gates.
- `./aos dev agents` owns the public command surface and help/discovery
  contract.
- `docs/dev/aos-agents-summary.schema.json` owns the durable `summary.json`
  artifact schema.
- `docs/dev/aos-agents-native-dispatch.schema.json` owns the durable
  `native-dispatch.json` artifact schema.
- `docs/dev/aos-agents-native-result.schema.json` owns the native imported
  `result.json` artifact schema.
- The coordinating session owns native child execution and patch application decisions.

## Runtime Engines

- `native-codex`: default. Emits
  `spawn_agent(task_name=<role>-<task_hash>, agent_type=<role>,
  fork_turns="none", message=<task>)`. The local Python runner cannot launch
  this engine; local `--execute` writes a blocked summary with the native
  dispatch/import workflow.
- `provider-sdk`: optional local adapter. Executes only with
  `--engine provider-sdk --execute` and only when the caller already provides
  an importable `agents` SDK.

## Safety Gates

- Read-only roles remain `explorer`, `reviewer`, `validator`, and `historian`.
- `implementer` remains rejected by default.
- `implementer` patch artifacts require explicit `--patch-output`. Native
  patch-output uses native dispatch/import; provider patch-output requires
  `--engine provider-sdk --patch-output --execute`.
- Native/provider child execution never applies patches.
- `--check-patch` and `--apply-patch` do not import or call native/provider
  execution.
- `--apply-patch` requires `--i-approve-checkout-mutation`, rejects dirty
  worktrees, reruns `git apply --check`, and leaves applied changes unstaged.

## Command Surface

- `./aos dev agents --role explorer --task "..." --json` plans a ready native
  run and writes `summary.json` plus `native-dispatch.json`.
- `./aos dev agents --engine native-codex --role explorer --task "..."
  --execute --json` remains blocked locally and points to dispatch/import.
- `./aos dev agents --native-dispatch <output-dir> --json` emits the exact v2
  spawn contract and run metadata for native session execution.
- `./aos dev agents --complete-native-run <output-dir> --result-file <path>
  --json` imports a native child result after validating
  `role`, `engine`, `output_dir`, `task_hash`, and a string output field
  named `final_output`, `result`, or `text`.
- Native implementer patch-output completion extracts `patch.diff`; existing
  `--check-patch` and `--apply-patch` gates then work unchanged.

## Legacy Artifact Policy

Legacy M2 patch artifacts without `engine` are intentionally rejected rather
than inferred or migrated. This matches the active foundation-breaking posture:
completed patch artifacts must explicitly declare `native-codex` or
`provider-sdk` before they can be reviewed or applied.

## Dependency Policy

Native planning, readback, check, and apply paths use only repo Python. The
provider adapter is not a repo-managed dependency and is not installed by the
runner. `--runtime-info` reports provider SDK availability for the current
caller environment without mutating runtime state.
