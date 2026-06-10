# Dock Operating Profiles

Dock profiles are the first-class operating-context model for docked AOS agent
sessions. They describe the doctrine loaded by Foreman and the bounded extracts
Foreman may pass to AOS-owned child runs.

## Model

- Agent definition = who the agent is. Provider-neutral definitions live under
  `ai-agents/`; Codex-shaped runner material lives under
  `ai-agents/providers/codex/*.toml`.
- Dock = named runtime launch envelope: local instructions, hooks/config, voice
  and stop behavior, launch posture, and profile binding. Foreman is the only
  current named dock; future docks are allowed when they define a fresh current
  envelope instead of inheriting stale GDI/Operator assumptions.
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
Delegation: AOS-owned runner only; native Codex subagents disabled
Authority: .docks/profiles/active-profile.json
Stale pools: old entry paths, retired handoffs, stale work cards
```

The header is observability, not a new ceremony. Keep it short and update it
when the active packs change.

## Agent Execution North Star

`docs/adr/0016-aos-owned-agent-execution.md` is the durable authority for AOS
agent execution. `docs/adr/0017-retire-codex-native-custom-agents.md` retires
active Codex custom-agent registration and dispatch for agent-os. AOS owns child
execution through `./aos dev agents` and `scripts/aos_agents/runner.py`;
`provider-sdk` is the default engine. Native Codex custom-agent registration is
disabled for agent-os and must not be reintroduced without a new ADR or explicit
human architecture decision.

## Native Custom-Agent Status

As of Codex CLI 0.138.0 in the real Foreman dock, native custom-agent
delegation is blocked by encrypted tool registration. Foreman must proceed
without native subagents and must document any unproven runtime capability
instead of inferring behavior from public docs.

Authority order for native custom-agent claims:

1. Observed local behavior in the real Foreman dock.
2. Repo and user config: `.codex/config.toml`, `~/.codex/config.toml`,
   `ai-agents/providers/codex/*.toml`, `.docks/foreman/.codex/*`, and
   `.docks/harness/*`.
3. Codex docs/manual as terminology background only.

Default topology is Foreman-orchestrated AOS-owned runner execution through the
provider SDK and configured proxy. Native Codex custom agents and nested squad
leads remain retired unless a new durable decision reverses this boundary.
