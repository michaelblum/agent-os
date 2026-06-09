# Experimental AOS Agent Runner

This directory starts the AOS-owned Python agent runner lane. It is a minimal,
isolated prototype for reading existing role/profile material without depending
on Codex CLI `multi_agent_v2`.

## Scope

- Loads read-only role specs from `.codex/agents/*.toml`.
- Allows only `explorer`, `reviewer`, `validator`, and `historian`.
- Requires each allowed role spec to declare `sandbox_mode = "read-only"`.
- Rejects write-capable roles such as `implementer`.
- Loads `.docks/profiles/active-profile.json` and each listed
  `.docks/profiles/*/profile.md` pack.
- Plans deterministic output directories under `.runtime/dev/aos-agents/`.
- Provides `--self-test` for parser and path validation without OpenAI calls.
- Keeps provider execution behind explicit `--execute`.
- Writes provider results only under the planned runtime directory.

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

Outside `--self-test`, the runner checks for the OpenAI Agents SDK and fails
clearly when it is missing. The runner never installs dependencies; install and
configure the SDK outside this script.

The Python script remains the implementation target and can still be invoked
directly for focused debugging.
