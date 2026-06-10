# AOS Agent Runtime

`./aos dev agents` is the AOS-owned local contract surface for project agents.
It is not a provider-proof smoke harness. The command owns role/profile
readback, native Codex dispatch planning, runtime artifact readback, and
approval-gated patch validation/application.

## Architecture

- Native Codex is the default engine: `--engine native-codex`.
- Native planning emits the required v2 custom-agent spawn contract:
  `spawn_agent(task_name=<role>-<task_hash>, agent_type=<role>,
  fork_turns="none", message=<task>)`.
- The local Python runner cannot execute native Codex children. A native Codex
  session executes children through the session tool runtime when that v2 contract is
  available.
- Native plans write `summary.json` and `native-dispatch.json`; the child result
  is imported later with `--complete-native-run`.
- Provider-backed execution remains as an explicit optional adapter:
  `--engine provider-sdk --execute`.
- Read-only roles are `explorer`, `reviewer`, `validator`, and `historian`.
- `implementer` remains rejected by default.
- `implementer` may only produce a reviewable `patch.diff` through explicit
  patch-output mode. Native patch-output uses dispatch/import; provider patch
  output uses `--engine provider-sdk --role implementer --patch-output
  --execute`.
- Check/apply gates never invoke native children, providers, or SDK code.
- Patch application requires explicit checkout-mutation approval through
  `--apply-patch <output-dir> --i-approve-checkout-mutation`.
- Apply rejects dirty worktrees, reruns `git apply --check`, applies with plain
  `git apply`, and leaves changes unstaged.

## What Stays In `runner.py`

- Loading `.codex/agents/*.toml` role specs.
- Loading `.docks/profiles/active-profile.json` and profile packs.
- Deterministic runtime artifact paths under `.runtime/dev/aos-agents/`.
- Native v2 dispatch-contract rendering.
- Native dispatch artifact readback and completion import.
- Optional provider SDK adapter execution.
- `summary.json`, `result.json`, and `patch.diff` artifact writing.
- Patch artifact validation, check, and apply gates.

Durable schemas and public command metadata live outside this script:

- `docs/dev/aos-agents-summary.schema.json`
- `docs/dev/aos-agents-native-dispatch.schema.json`
- `docs/dev/aos-agents-native-result.schema.json`
- `manifests/commands/aos-commands.json`
- `manifests/commands/aos-external-commands.json`
- `docs/dev/workflow-rules.json`

## Dependency And Runtime Packaging

Native planning, artifact readback, `--check-patch`, and `--apply-patch` require
only the repository Python runtime. They must not install dependencies or depend
on an ignored smoke virtual environment.

The provider adapter is optional. When `--engine provider-sdk --execute` is
used, the caller must provide an environment where the `agents` Python module is
already importable. The runner disables tracing for those local adapter runs and
fails clearly if the SDK is missing. It never installs, upgrades, publishes, or
mutates dependencies.

Use this readback to inspect the current contract and provider SDK availability:

```bash
./aos dev agents --runtime-info --json
```

## Usage

Validate local parsing and path behavior:

```bash
./aos dev agents --self-test --json
```

Run the focused regression harness:

```bash
bash tests/aos-agents-runner.sh
```

Plan a native Codex read-only child:

```bash
./aos dev agents --role explorer --task "inspect the agent profile inputs" --json
```

Read the exact native spawn contract for a planned native child:

```bash
./aos dev agents --native-dispatch .runtime/dev/aos-agents/runs/explorer/<run-dir> --json
```

Import a native child result:

```bash
./aos dev agents --complete-native-run .runtime/dev/aos-agents/runs/explorer/<run-dir> --result-file /tmp/native-result.json --json
```

The result file must be a JSON object with matching `engine`, `role`,
`task_hash`, and `output_dir` identity fields, plus one string output field:
`final_output`, `result`, or `text`.

Plan native implementer patch-output without local child execution:

```bash
./aos dev agents --role implementer --task "make a minimal docs change" --context-file scripts/aos_agents/README.md --patch-output --json
```

Execute a read-only provider adapter run only when the SDK and credentials are
already available:

```bash
./aos dev agents --engine provider-sdk --role explorer --task "inspect the agent profile inputs" --execute --max-turns 1 --json
```

Produce a reviewable implementer patch artifact without mutating the checkout:

```bash
./aos dev agents --engine provider-sdk --role implementer --task "make a minimal docs change" --context-file scripts/aos_agents/README.md --patch-output --execute --max-turns 1 --json
```

Check an existing patch artifact without invoking native children or providers:

```bash
./aos dev agents --check-patch .runtime/dev/aos-agents/runs/implementer/<run-dir> --json
```

Apply an existing patch artifact only after explicit checkout-mutation approval:

```bash
./aos dev agents --apply-patch .runtime/dev/aos-agents/runs/implementer/<run-dir> --i-approve-checkout-mutation --json
```

List or read existing runtime artifacts without invoking native children,
providers, or SDK imports:

```bash
./aos dev agents --list-runs --json
./aos dev agents --read-run .runtime/dev/aos-agents/runs/explorer/<run-dir> --json
```

## Legacy Artifact Policy

Legacy M2 patch artifacts without an explicit `engine` are rejected by
`--check-patch` and `--apply-patch`. M3 is foundation-breaking: completed
artifacts must identify whether they came from `native-codex` or
`provider-sdk` before the patch can be reviewed or applied.
