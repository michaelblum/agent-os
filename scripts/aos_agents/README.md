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

This prototype does not change `packages/host`, daemon/socket contracts, global
Codex config, or installed packages.

## Usage

Validate local parsing and path behavior:

```bash
python3 scripts/aos_agents/runner.py --self-test
```

Run the focused regression harness:

```bash
bash tests/aos-agents-runner.sh
```

Plan a future provider-backed run:

```bash
python3 scripts/aos_agents/runner.py --role explorer --task "inspect the agent profile inputs"
```

Outside `--self-test`, the runner checks for the OpenAI Agents SDK and fails
clearly when it is missing. Provider execution is intentionally still a
skeleton in this slice.
