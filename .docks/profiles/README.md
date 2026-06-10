# Dock Operating Profiles

Dock profiles are the first-class operating-context model for docked AOS agent
sessions. They describe the doctrine loaded by Foreman and the bounded extracts
Foreman may pass to subagents.

## Model

- Agent definition = who the agent or subagent is. Codex agents live in
  `.codex/agents/*.toml` and are selected with structured `agent_type`.
- Dock = runtime shell, hooks, TTS, launch posture, and provider config.
- Profile = active operating doctrine and context for this session.
- Task packet or work card = temporary assignment.
- Issue = durable ledger for a workstream, open decision, or multi-session lane.
- Architecture docs, ADRs, and `CONTEXT.md` = durable system truth.
- Capability route = path, tool, and test routing mechanics. It does not define
  identity, ethos, or architectural doctrine.

Do not use old entry-point language to select identity or ethos. Where the repo
still says "entry path", read it narrowly as capability routing until the local
doc is migrated.

## Active Profile

`.docks/profiles/active-profile.json` selects the ordered profile packs for a
docked session. Foreman loads this file, reads the referenced profile docs, and
announces a compact first-response header before doing work.

Current default:

- `base-aos-local`
- `ethos-foundation-breaking`
- `runtime-passive-unless-approved`
- `workstream-one-world`

## Foreman Header

Fresh Foreman sessions should start with a compact header like:

```text
Profile: foundation-breaking + one-world
Workflow: local branch, no automatic PR
Migration posture: owned contracts may be broken and migrated broadly
Runtime posture: passive unless explicitly approved
Delegation: AOS-owned runner first; native subagents diagnostic
Authority: .docks/profiles/active-profile.json
Stale pools: old entry paths, retired handoffs, stale work cards
```

The header is observability, not a new ceremony. Keep it short and update it
when the active packs change.

## Agent Execution North Star

`docs/adr/0016-aos-owned-agent-execution.md` is the durable authority for AOS
agent execution. AOS owns child execution by default through `./aos dev agents`
and `scripts/aos_agents/runner.py`; `provider-sdk` is the default engine.
Native Codex subagents are an explicit diagnostic/import lane only and must not
become the default execution substrate without a new ADR or explicit human
architecture decision.

## multi_agent_v2 Status

As of Codex CLI 0.138.0 in the real Foreman dock, native `multi_agent_v2`
delegation is blocked by encrypted tool registration. Foreman must proceed
without native subagents when that blocker is present and must document any
unproven runtime capability instead of inferring behavior from public docs.

Authority order for `multi_agent_v2` claims:

1. Observed local behavior in the real Foreman dock.
2. Repo and user config: `.codex/config.toml`, `~/.codex/config.toml`,
   `.codex/agents/*.toml`, `.docks/foreman/.codex/*`, and `.docks/harness/*`.
3. Codex docs/manual as terminology background only.

Default topology is Foreman-orchestrated AOS-owned runner execution. Native
Codex subagents and nested squad leads remain experimental until local Foreman
smoke proves depth, hooks, sandboxing, skill availability, debuggable runtime
state, and role-specific model/effort binding.
