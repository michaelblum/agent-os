# ADR 0017: Retire Codex Native Custom-Agent Registration

**Status:** Superseded by ADR 0019
**Date:** 2026-06-10

## Supersession

ADR 0019 retires the repo-local project-agent runner as well as native Codex
custom-agent registration. This ADR is retained as historical context for why
native custom-agent registration was removed, not as current authority for an
active `./aos dev agents` provider-runner path.

## Decision

AOS will not register or dispatch Codex native custom agents for agent-os.
Remove active `multi_agent_v2`, `[agents.*]`, repo `.codex/agents`, and
user-global `~/.codex/agents` registration surfaces from the agent-os Codex
configuration stack.

The project-agent execution path at the time was the now-retired:

```text
Foreman
  -> ./aos dev agents
      -> scripts/aos_agents/runner.py
          -> provider-sdk
              -> configured OpenAI-compatible proxy or standard OpenAI endpoint
```

Codex-shaped role material was preserved under
`ai-agents/providers/codex/*.toml` as source material for the AOS-owned runner
and future provider translation, not as an active Codex custom-agent discovery
surface. ADR 0019 subsequently retired that source material from the active repo
tree.

## Rationale

ADR 0016 established that AOS owns project-agent child execution because Codex
native subagent execution was opaque, hard to debug, and failed the role-specific
model/effort control goal. A subsequent Codex regression exposed encrypted
native tool registration failures before the model turn could run. Keeping
native custom-agent registration in config, docs, or helper scripts leaves a
path for the same failure mode to return.

The proxy/provider path is inspectable and testable inside this repo. The runner
owns role specs, runtime artifacts, provider environment readback, patch gates,
and execution status.

## Consequences

- `provider-sdk` was the default and only active child execution engine before
  ADR 0019 retired the AOS-owned project-agent runner.
- `scripts/agent-sync.sh` is retired and must fail closed.
- Active Codex config files must not contain `multi_agent_v2`, `[agents]`, or
  `[agents.<role>]` registration blocks for agent-os.
- `.codex/agents/*.toml` and `~/.codex/agents/*.toml` are not active agent-os
  discovery surfaces.
- Historical Foreman instructions routed bounded child work through
  `./aos dev agents` or direct Foreman execution, not native Codex custom-agent
  tools.
- Reversal requires a new ADR or explicit human architecture decision naming
  this ADR and ADR 0016, plus local evidence that the native path is
  inspectable, role-bound, model/effort-bound, debuggable, and compatible with
  the configured proxy stack.

## Provider Proxy Environment

The AOS runner uses these variables for proxy-backed provider execution:

```bash
AOS_AGENT_PROVIDER_BASE_URL=<proxy-url>
AOS_AGENT_PROVIDER_API_KEY=<proxy-key>
AOS_AGENT_PROVIDER_API=chat_completions
```

`AOS_AGENT_PROVIDER_BASE_URL` and `AOS_AGENT_PROVIDER_API_KEY` override
`OPENAI_BASE_URL` and `OPENAI_API_KEY` for the runner only. When a base URL is
configured and `AOS_AGENT_PROVIDER_API` is unset, the runner defaults to
`chat_completions` for OpenAI-compatible proxy compatibility.

## Verification

When reading historical branches that still change this boundary, the former
verification gate was the now-retired:

```bash
bash tests/aos-agents-runner.sh
node --test tests/schemas/dock-operating-profiles.test.mjs
bash tests/dock-hook-isolation.sh
```

The former provider/proxy posture readback was the now-retired:

```bash
./aos dev agents --runtime-info --json
```
