# Recipe: Context Doc Maintenance

Use this recipe when a change may affect shared language, context routing,
agent operating contracts, API contracts, schemas, architecture docs, ADRs,
decision docs, or reusable procedures. The goal is to keep the documentation
topology aligned without turning every edit into a broad stale-doc sweep.

## Local Context Model

Agent-os intentionally adapts Matt Pocock's context-doc pattern. In Matt's
model, `CONTEXT.md` is a pure glossary. In agent-os, root `CONTEXT.md` is a
governed domain language and contract-term index: it may include concise live
wire forms, schema references, migration notes, and resolved terminology when
those details are needed to keep agents and implementers using the same terms.

`CONTEXT-MAP.md` is the multi-context routing map. It tells agents which local
contracts, source roots, schemas, API docs, ADRs, decisions, recipes, and design
notes to inspect for the domain they are touching. Do not use root
`CONTEXT.md` as a substitute for domain routing.

## Change Classification

Before editing docs, classify the change by what it makes true:

- Adopt: the external or local pattern fits agent-os as-is and can be documented
  directly.
- Adapt: the pattern is useful, but agent-os needs a named local variant. Record
  the adaptation explicitly where consumers will encounter it.
- Reject: the pattern conflicts with live architecture, contracts, or role
  boundaries. Record the reason only if future agents are likely to repeat the
  proposal.
- Defer: the pattern may be valuable, but the current slice lacks evidence,
  authority, or scope. Leave a work card, issue, or design note only when there
  is a clear unresolved problem and exit criteria.

Treat Matt skills and other external templates as context unless the active
work card makes them authoritative. When an external pattern conflicts with
live repo sources, surface the conflict instead of silently choosing either
side.

## Placement Rules

Update `CONTEXT.md` when a project-specific term, avoided alias, resolved
ambiguity, or short contract-term definition needs to be shared across domains.
Do not add general programming terms, implementation logs, session notes, or
long process instructions.

Update `CONTEXT-MAP.md` when a source root, domain, local contract, API doc,
schema family, ADR/decision namespace, recipe class, or conflict rule changes
how agents discover authority for a topic.

Update `docs/agents/domain.md` when agent-facing read order, context-source
semantics, conflict handling, ADR/decision discovery, or the local adaptation
of Matt-style domain docs changes.

Update `ARCHITECTURE.md` when the system narrative, daemon/toolkit/app
boundary, primitive model, data flow, cross-component ownership, or durable
architecture rationale changes. Keep tactical procedures elsewhere.

Update `docs/api/` when a public command, option, event, component contract,
wire shape, integration boundary, or user/agent-facing behavior changes.

Update `shared/schemas/` when a structured contract changes. Schema changes
usually require adjacent API docs, examples, fixtures, or migration notes unless
the schema is explicitly internal and experimental.

Add or update an ADR in `docs/adr/` when the choice is hard-to-reverse,
surprising without context, and the result of a real trade-off. `docs/adr/` is
the canonical namespace for ADRs and durable architecture decisions.

Update root `AGENTS.md` only for repo-wide signage, hard invariants, and
authority-routing pointers. Do not put hook mechanics, role policy, operational
SOPs, work-card templates, or provider syntax there. Update `.docks/` when the
rule is about dock roles, launch behavior, hooks, inbound contracts, or
cross-session transfers. Update the nearest subtree `AGENTS.md` when the rule
is local to a package, app, daemon area, or test harness. Keep historical
`CLAUDE.md` files as compatibility pointers unless the active task explicitly
assigns their content.

Add or update a file under `docs/guides/` when the knowledge is a reusable,
bounded procedure that agents or humans may repeat. Recipes should carry
judgment rules and checklists, not one-off session memory.

Leave old design notes historical when they record past investigation,
superseded plans, or dated evidence. Do not rewrite them merely to remove old
phrases. Add a supersession note only when readers are likely to mistake the
old note for live guidance.

## Coupled Update Triggers

When a term in `CONTEXT.md` names a live command, schema field, target grammar,
or cross-tool contract, check the matching `docs/api/`, `shared/schemas/`, and
`ARCHITECTURE.md` surfaces.

When a domain or source-root boundary changes, check `CONTEXT-MAP.md`,
`docs/agents/domain.md`, the relevant dock or subtree `AGENTS.md`, and any
relevant `docs/api/` or schema index. Check root `AGENTS.md` only when the
boundary change affects repo-wide signage or authority routing.

When architecture ownership changes between daemon, toolkit, and apps, check
`ARCHITECTURE.md`, `CONTEXT.md`, `CONTEXT-MAP.md`, relevant subtree
`AGENTS.md`, `docs/api/`, and any ADR/decision docs. Check root `AGENTS.md`
only if the change affects a repo-wide invariant or routing pointer.

When a reusable workflow gets repeated in handoffs or work cards, promote it to
`docs/guides/` and replace broad inline instructions with short pointers.

## Stale-Phrase Checklist

After context or authority-doc changes, run a lightweight search before
declaring the slice complete:

1. Search for old names, avoided aliases, deprecated command forms, and
   superseded source roots named in the change.
2. Search the pointer surfaces that should mention the new recipe, map, or
   contract.
3. Check live docs before historical notes: root and subtree `AGENTS.md`,
   `docs/agents/domain.md`, `CONTEXT-MAP.md`, `CONTEXT.md`,
   `ARCHITECTURE.md`, `docs/api/`, `shared/schemas/`, and current ADR/decision
   docs.
4. Leave archived specs, dated notes, and old work cards alone unless the task
   explicitly assigns a stale-doc sweep or the old text presents itself as live
   guidance.
5. Report any remaining stale-local-doc or authority-conflict findings instead
   of hiding them behind a narrow successful edit.

## Authority Conflicts

When two live sources disagree, do not silently choose the convenient one. Name
the conflict, identify the sources, and keep the fix scoped to the active task.
Prefer the current work card, the relevant dock or local `AGENTS.md`, live
code, schemas, tests, CLI/API behavior, then `docs/api/`, `shared/schemas/`,
`ARCHITECTURE.md`, and `CONTEXT.md`. Root `AGENTS.md` resolves only repo-wide
invariants and authority routing. Treat design notes, old work cards, and
external templates as context unless the active work card makes them
authoritative.

If the correct owner is unclear, stop at the narrowest reversible pointer or
report the conflict for Foreman/human judgment. Do not spread one assumption
across several authority surfaces just to make the docs appear consistent.
