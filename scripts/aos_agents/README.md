# AOS Agent Runtime

`./aos dev agents` is the AOS-owned local contract surface for project agents.
It is not a provider-proof smoke harness and not a wrapper around opaque Codex
native subagent execution. The command owns role/profile readback, provider
execution, runtime artifact readback, and approval-gated patch
validation/application.

## Architecture

- Provider-backed AOS execution is the default engine: `--engine provider-sdk`.
- Native Codex custom-agent dispatch/import is retired for agent-os. The runner
  fails closed if `--engine native-codex`, `--native-dispatch`, or
  `--complete-native-run` is requested.
- Provider-backed execution remains explicit at mutation/runtime time:
  `--execute`.
- Read-only roles are `explorer`, `reviewer`, `validator`, and `historian`.
- `implementer` remains rejected by default.
- `implementer` may only produce a reviewable `patch.diff` through explicit
  patch-output mode. Provider patch output uses
  `--role implementer --patch-output --execute`; provider patch-output planning
  without `--execute` writes a ready summary only.
- Check/apply gates never invoke providers or SDK code.
- Patch application requires explicit checkout-mutation approval through
  `--apply-patch <output-dir> --i-approve-checkout-mutation`.
- Apply rejects dirty worktrees, reruns `git apply --check`, applies with plain
  `git apply`, and leaves changes unstaged.

## What Stays In `runner.py`

- Loading `ai-agents/providers/codex/*.toml` role specs.
- Loading `.docks/profiles/active-profile.json` and profile packs.
- Deterministic runtime artifact paths under `.runtime/dev/aos-agents/`.
- Optional provider SDK adapter execution.
- `summary.json`, `result.json`, and `patch.diff` artifact writing.
- Patch artifact validation, check, and apply gates.

Durable schemas and public command metadata live outside this script:

- `docs/dev/aos-agents-summary.schema.json`
- `manifests/commands/aos-commands.json`
- `manifests/commands/aos-external-commands.json`
- `docs/dev/workflow-rules.json`

## Dependency And Runtime Packaging

Artifact readback, `--check-patch`, and `--apply-patch` require only the
repository Python runtime. They must not install dependencies or depend on an
ignored smoke virtual environment.

The provider adapter is the default AOS-owned execution lane, but its dependency
is still caller supplied. When `--execute` is used, the caller must provide an
environment where the `agents` Python module is already importable. The runner
disables tracing for those local adapter runs and fails clearly if the SDK is
missing. It never installs, upgrades, publishes, or mutates dependencies.

Provider proxy configuration is environment-driven:

- `AOS_AGENT_PROVIDER_BASE_URL` overrides `OPENAI_BASE_URL`.
- `AOS_AGENT_PROVIDER_API_KEY` overrides `OPENAI_API_KEY`.
- `AOS_AGENT_PROVIDER_API=responses|chat_completions` selects the SDK API
  shape. When a base URL is configured and this is unset, the runner defaults to
  `chat_completions` for OpenAI-compatible proxy compatibility.

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

Run the opt-in real provider SDK smoke from an environment where the
`openai-agents` SDK and provider credentials are already available:

```bash
AOS_AGENT_PROVIDER_SDK_SMOKE=1 AOS_AGENT_PROVIDER_API_KEY=... bash tests/aos-agents-runner-integration.sh
```

Set `AOS_AGENT_PROVIDER_SMOKE_MODEL=<model>` to override the smoke model for a
custom endpoint. Without that override, the smoke uses the repository explorer
model and executes through `./aos dev agents --execute` against an isolated
fixture repo.

Plan a default provider-backed read-only child without executing it:

```bash
./aos dev agents --role explorer --task "inspect the agent profile inputs" --json
```

Execute a default provider-backed read-only child:

```bash
./aos dev agents --role explorer --task "inspect the agent profile inputs" --execute --max-turns 1 --json
```

Plan default provider implementer patch-output without local child execution:

```bash
./aos dev agents --role implementer --task "make a minimal docs change" --context-file scripts/aos_agents/README.md --patch-output --json
```

Produce a reviewable implementer patch artifact through the default provider
lane without mutating the checkout:

```bash
./aos dev agents --role implementer --task "make a minimal docs change" --context-file scripts/aos_agents/README.md --patch-output --execute --max-turns 1 --json
```

Execute explicitly through the provider adapter when documenting the engine:

```bash
./aos dev agents --engine provider-sdk --role explorer --task "inspect the agent profile inputs" --execute --max-turns 1 --json
```

Check an existing patch artifact without invoking providers:

```bash
./aos dev agents --check-patch .runtime/dev/aos-agents/runs/implementer/<run-dir> --json
```

Apply an existing patch artifact only after explicit checkout-mutation approval:

```bash
./aos dev agents --apply-patch .runtime/dev/aos-agents/runs/implementer/<run-dir> --i-approve-checkout-mutation --json
```

List or read existing runtime artifacts without invoking providers or SDK
imports:

```bash
./aos dev agents --list-runs --json
./aos dev agents --read-run .runtime/dev/aos-agents/runs/explorer/<run-dir> --json
```

## Legacy Artifact Policy

Legacy M2 patch artifacts without an explicit `engine` are rejected by
`--check-patch` and `--apply-patch`. Current completed artifacts must identify
`provider-sdk` before the patch can be reviewed or applied.

## Durable Intent

`docs/adr/0016-aos-owned-agent-execution.md` and
`docs/adr/0017-retire-codex-native-custom-agents.md` are the durable north-star
authority: AOS owns child execution through the provider SDK/proxy path. Native
Codex custom-agent registration must not return without an explicit ADR or human
architecture decision that supersedes both ADRs.
