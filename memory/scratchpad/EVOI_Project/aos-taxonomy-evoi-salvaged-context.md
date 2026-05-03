---
name: aos-taxonomy-evoi-salvaged-context
status: raw-salvaged-context
updated: 2026-05-03
source: checkpoint/sigil-aos-surfaces-root-2026-05-03
connects_to: AOS taxonomy, EVOI, readiness preflight, agent work loops, Sigil
---

# AOS Taxonomy And EVOI Salvaged Context

This note preserves the durable ideas from checkpoint-only scratchpad files on
the retired `codex/sigil-aos-surfaces` workstream. It is not canonical repo
doctrine, not a next-session prompt, and not an implementation plan.

The original checkpoint files contained useful thinking mixed with stale branch
handoffs. This file keeps the concepts and intentionally drops instructions such
as "stay on `codex/sigil-aos-surfaces`" or "read files that do not exist on
current `main`."

## Source Notes

- `memory/scratchpad/EVOI_Project/2026-05-01-readiness-preflight-session-handoff.md`
- `memory/scratchpad/EVOI_Project/aos-taxonomy-next-session-game-plan.md`
- `memory/scratchpad/EVOI_Project/aos-taxonomy-rationalization-epic-draft.md`
- `memory/scratchpad/EVOI_Project/playbook_prototype.md`

The worktree/session-scope note from the same checkpoint is already represented
on current `main` as
`docs/superpowers/notes/2026-05-02-worktree-session-scope.md`.

## Durable Taxonomy Pressure

Before classifying EVOI or creating new workflow surfaces, AOS needs clear
answers for what kind of artifact is being created and where it belongs. The old
notes listed overlapping terms such as command surface, reusable script,
bespoke script, procedure, instruction, protocol, technique, recipe, playbook,
plugin, skill, workflow, wiki knowledge, and schema.

The durable classification question is:

```text
What kind of artifact is this, who consumes it, where is its source of truth,
and what makes it durable?
```

Useful candidate classes from the old notes:

- primitive verb: embodied AOS capability such as `see`, `do`, `show`, `tell`,
  and `listen`
- command surface: discoverable CLI contract over primitives or operator layers
- source-backed ops recipe: schema-backed executable operator unit
- developer workflow rule: manifest-backed recommendation for AOS developer
  actions
- test harness artifact: verification helper, fixture, or scenario
- instruction surface: durable agent operating contract such as `AGENTS.md`
- docs recipe: reusable prose SOP
- cross-tool contract: API doc, schema, architecture, or packet contract
- runtime wiki knowledge: runtime knowledge graph content and project memory
- wiki plugin workflow: runtime wiki workflow bundle
- app-local playbook: product-specific operating guidance that has not yet
  graduated into a stronger contract
- historical or compatibility surface: old path, provider compatibility file,
  retired design note, or legacy appendix

The important naming rule is to qualify overloaded words. For example, prefer
`ops recipe`, `docs recipe`, `wiki plugin workflow`, `agent skill`,
`developer workflow rule`, or `app-local playbook` when the bare noun would be
ambiguous.

## EVOI Kernel

EVOI should not be implemented just because the idea exists. The project memory
worth preserving is that EVOI may become a kernel of agentic behavior in
agent-os, closer to a disciplined sense-plan-act loop than to a decorative
prompting style.

The raw prototype framed the agent as operating under a risk, reward, and
compute economy:

- prefer structured semantic perception before expensive pixel analysis
- use projection/overlay as a cheap clarification mechanism when a spatial
  ambiguity would otherwise force blind guessing
- treat user interruption as a cost, but lower than acting incorrectly
- execute only when confidence is high enough
- otherwise expand perception or ask a targeted projected clarification

That framing needs translation into AOS vocabulary before it becomes product
work. AOS already has primitives for perception, action, projection, and
communication. A future EVOI design should compose those primitives instead of
inventing parallel tool names.

Potential future homes to evaluate:

- app-local Sigil operating mode
- docs recipe or agent-entry recipe
- runtime wiki playbook, if AOS later defines playbooks
- portable agent skill
- schema-backed run-control policy
- ops recipe only if the behavior becomes deterministic and executable

## Readiness Preflight Idea

The old handoff notes also captured a deterministic readiness principle:

```text
agent chooses semantic capability
AOS performs deterministic preflight only when needed
AOS either runs the capability or returns a concrete blocker
```

The design pressure was speed and determinism. Readiness should not become an
agent ritual where every session repeatedly runs `./aos ready` just in case.
Instead, commands that need daemon capabilities could eventually declare those
capabilities, let AOS reuse a valid readiness lease, and return a precise
blocker when the lease is missing or invalid.

This remains future runtime work. It belongs with the runtime capability
preflight bucket from the `codex/sigil-aos-surfaces` retirement map, not with
the checkpoint-note salvage itself.

## Guardrails

- Do not implement EVOI from this scratchpad.
- Do not create a new taxonomy epic just because this note exists.
- Do not treat the old branch handoff prompts as current instructions.
- Do not promote `playbook` to a first-class AOS artifact without an explicit
  design decision.
- If this material becomes active work, first reconcile it with current
  `AGENTS.md`, `ARCHITECTURE.md`, `docs/api/`, `docs/recipes/`, and open GitHub
  issues.

## Next Useful Decision

When there is a lull or the user explicitly asks to resume EVOI/taxonomy work,
the next useful decision is whether to start with:

1. a small provider-neutral taxonomy doc,
2. a parked EVOI decision memo,
3. a runtime capability preflight design, or
4. no action, leaving this as scratchpad only.
