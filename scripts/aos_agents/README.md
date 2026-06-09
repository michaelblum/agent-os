# Experimental AOS Agent Runner

This directory starts the AOS-owned Python agent runner lane. It is a minimal,
isolated prototype for reading existing role/profile material without depending
on Codex CLI `multi_agent_v2`.

## Scope

- Loads read-only role specs from `.codex/agents/*.toml`.
- Allows only `explorer`, `reviewer`, `validator`, and `historian`.
- Requires each allowed role spec to declare `sandbox_mode = "read-only"`.
- Rejects write-capable roles such as `implementer` by default.
- Allows `implementer` only through explicit `--patch-output --execute`, where
  the provider final output is saved as `patch.diff` under the run directory.
- Loads `.docks/profiles/active-profile.json` and each listed
  `.docks/profiles/*/profile.md` pack.
- Plans deterministic output directories under `.runtime/dev/aos-agents/`.
- Provides `--self-test` for parser and path validation without OpenAI calls.
- Keeps provider execution behind explicit `--execute`.
- Writes `summary.json` for ready, completed, and provider-error runs under the
  planned runtime directory.
- Writes provider results only under the planned runtime directory.
- Writes patch-output metadata only under the planned runtime directory; it never
  applies patches to the checkout.
- Lists and reads existing runtime artifacts without SDK or provider calls.

This prototype does not change `packages/host`, daemon/socket contracts, global
Codex config, or installed packages.

## Usage

Validate local parsing and path behavior:

```bash
./aos dev agents --self-test --json
```

Run the focused regression harness:

```bash
bash tests/aos-agents-runner.sh
```

Plan a future provider-backed run:

```bash
./aos dev agents --role explorer --task "inspect the agent profile inputs" --json
```

Execute a read-only provider-backed run when the SDK and credentials are already
available in the caller's environment:

```bash
./aos dev agents --role explorer --task "inspect the agent profile inputs" --execute --json
```

Produce a reviewable implementer patch artifact without mutating the checkout:

```bash
./aos dev agents --role implementer --task "make a minimal docs change" --patch-output --execute --max-turns 1 --json
```

Review the generated patch before any manual apply:

```bash
git apply --check .runtime/dev/aos-agents/runs/implementer/<run-dir>/patch.diff
```

For M1 live-smoke only, use an ignored local venv under `.runtime/dev/aos-agents/`
instead of adding repo-managed Python dependencies:

```bash
python3 -m venv .runtime/dev/aos-agents/.venv
.runtime/dev/aos-agents/.venv/bin/python -m pip install --upgrade pip openai-agents
export OPENAI_API_KEY="sk-..."
PATH="$PWD/.runtime/dev/aos-agents/.venv/bin:$PATH" \
  ./aos dev agents --role explorer --task "inspect the agent profile inputs" --execute --max-turns 1 --json
```

This local environment is a live-smoke unblock only. It is not sufficient for
full native Codex subagent supersession, and it does not establish a
repo-managed dependency policy.

The M1 read-only parity proof is recorded in
`docs/dev/reports/aos-agent-runner-m1-read-only-parity-v0.md`.

List or read existing runtime artifacts without invoking the provider:

```bash
./aos dev agents --list-runs --json
./aos dev agents --read-run .runtime/dev/aos-agents/runs/explorer/<run-dir> --json
```

Outside `--self-test`, the runner checks for the OpenAI Agents SDK and fails
clearly when it is missing. The runner never installs dependencies; install and
configure the SDK outside this script.

The `summary.json` artifact contract is documented in
`docs/dev/aos-agents-summary.schema.json`.

The Python script remains the implementation target and can still be invoked
directly for focused debugging.
