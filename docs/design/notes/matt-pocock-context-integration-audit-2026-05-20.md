# Matt Pocock Context Integration Audit - 2026-05-20

## Status

Foreman investigation note. This records how Matt Pocock's skills apply to
agent-os after pulling the latest `mattpocock/skills` repository on
2026-05-20.

No source behavior was changed by this investigation.

## External Reference Pulled

Local repo:

- `/Users/Michael/Code/mattpocock-skills`

Pulled with:

```bash
git -C /Users/Michael/Code/mattpocock-skills pull --ff-only
```

Fast-forward result:

- `e74f006..b8be62f`
- touched `README.md`;
- touched `skills/engineering/grill-with-docs/CONTEXT-FORMAT.md`;
- added `skills/engineering/improve-codebase-architecture/HTML-REPORT.md`;
- updated `skills/engineering/improve-codebase-architecture/SKILL.md`;
- updated `skills/productivity/handoff/SKILL.md`.

The local Matt skills checkout has unrelated untracked `.DS_Store` files.

## Matt Skills Model

The relevant Matt skills expect a setup layer before use:

- `/setup-matt-pocock-skills` creates an `## Agent skills` block in
  `AGENTS.md` or `CLAUDE.md`.
- It writes `docs/agents/issue-tracker.md`,
  `docs/agents/triage-labels.md`, and `docs/agents/domain.md`.
- `docs/agents/domain.md` tells other skills where `CONTEXT.md`,
  `CONTEXT-MAP.md`, and ADRs live.
- The domain-doc choice is explicit: single-context root `CONTEXT.md` plus
  `docs/adr/`, or multi-context `CONTEXT-MAP.md` pointing to per-context
  `CONTEXT.md` files.

`/grill-with-docs` then uses `CONTEXT.md` as a shared language glossary:

- challenge user terms against the glossary;
- sharpen fuzzy terms;
- cross-reference user claims with code;
- update `CONTEXT.md` inline as terms are resolved;
- offer ADRs only for hard-to-reverse, surprising trade-offs.

Important constraint from Matt's skill: `CONTEXT.md` is meant to be a glossary,
not a spec, scratch pad, implementation ledger, or decision store.

## Agent-OS Current State

Agent-os has:

- root `CONTEXT.md`;
- root `ARCHITECTURE.md`;
- root `AGENTS.md` plus many subtree `AGENTS.md` / `CLAUDE.md` files;
- `docs/adr/` with ADR-0001 through ADR-0011;
- `docs/decisions/ADR-001-toolkit-platform-strategy.md`;
- `docs/api/`, `docs/recipes/`, `docs/design/`, `docs/dev/`, `docs/wiki/`;
- no root `CONTEXT-MAP.md`;
- no `docs/agents/`;
- no `## Agent skills` block in root `AGENTS.md` or `CLAUDE.md`.

There are at least 268 Markdown files across `docs/adr`, `docs/api`,
`docs/decisions`, `docs/design`, `docs/dev`, `docs/recipes`, and `docs/wiki`
within two directory levels. Treating this as a simple single-context repo is
too weak for agent-os.

## Misses

### 1. Setup was skipped

Agent-os has adopted the visible artifact (`CONTEXT.md`) without the setup layer
that makes Matt's skills safe to consume:

- no `docs/agents/domain.md` consumer rules;
- no explicit issue tracker / triage label config;
- no `CONTEXT-MAP.md`;
- no instruction telling agents whether this repo is single-context or
  multi-context.

Effect: agents see a root `CONTEXT.md` and infer "single context", even though
agent-os has multiple durable domains: AOS primitives, toolkit/default surface
system, Sigil, docks/session operations, gateway/host, work records, wiki/KB,
runtime permissions, and design-token/toolkit styling.

### 2. `CONTEXT.md` is not just a glossary

The current `CONTEXT.md` is useful, but it exceeds Matt's intended boundary:

- it includes schema references;
- it includes live CLI wire grammar;
- it includes current/future implementation caveats;
- it includes resolved plan-cleanup notes;
- it includes compatibility and migration status;
- it carries more decision-ledger material than a pure glossary.

For agent-os, that may be justified, but it should be named as a deliberate
local adaptation. Today it looks like a partial `/grill-with-docs` result rather
than a governed variant.

Recommended framing: either split pure domain glossary from contract/status
notes, or explicitly define agent-os `CONTEXT.md` as "domain language plus
contract terminology index" and document when implementation detail is allowed.

### 3. Multi-context structure is missing

Matt's model gives a `CONTEXT-MAP.md` for multi-context repos. Agent-os is a
monorepo with separate authority layers and subdomains, but no context map.

Likely contexts:

- AOS runtime primitives and CLI verbs;
- toolkit/default surface system;
- workbench subject/work-record model;
- docks/session roles and transfer vocabulary;
- Sigil app/product behavior;
- gateway/host external adapter surfaces.

Without a map, agents overload root `CONTEXT.md` and then miss nearer authority
docs such as `packages/toolkit/AGENTS.md`, `.docks/AGENTS.md`, `docs/api/`, or
`shared/schemas/`.

### 4. Context maintenance has no SOP

There is no durable rule for:

- when a new term belongs in `CONTEXT.md`;
- when a decision becomes an ADR;
- when a schema change must update `CONTEXT.md`;
- when `ARCHITECTURE.md`, `AGENTS.md`, `docs/api/`, and `docs/adr/` must be
  audited together;
- which stale phrase checks should run after context/doc edits.

This is exactly how the recent drift happened: `ARCHITECTURE.md` and
`CONTEXT.md` were updated, but nearby docs still carry old claims.

### 5. Sibling source-of-truth docs still conflict

After the validated `ARCHITECTURE.md` / `CONTEXT.md` update, stale claims remain
outside those two files:

- `AGENTS.md` still says "`say` is sugar for `tell human`".
- `src/CLAUDE.md` says `aos say` is "sugar for tell human" and `aos tell human`
  is "same as aos say".
- `docs/api/aos.md` says "`aos say` is sugar for `aos tell human ...`".
- `docs/adr/0006-state-id-guards-coordinates-strictly-refs-loosely.md` still
  describes coordinate actions as `screen:<state-id>/<x,y>`.
- `docs/adr/0004-anchor-is-a-role-resolved-into-a-binding.md` still defines
  Target dialect examples as `browser:`, `canvas:`, `screen:`, `ax:` without
  the live CLI qualification now in `CONTEXT.md`.
- Older design notes still cite `screen:<state-id>/<x,y>`.

Some stale historical docs should remain historical, but `AGENTS.md`,
`src/CLAUDE.md`, `docs/api/aos.md`, and live ADRs are not purely historical.
They need a follow-up sweep or explicit supersession notes.

### 6. ADR placement is split

Matt's skills assume `docs/adr/` and context-scoped `docs/adr/` directories.
Agent-os has both:

- `docs/adr/0001...0011`;
- `docs/decisions/ADR-001-toolkit-platform-strategy.md`.

That may be intentional, but it is not documented for consumers. A Matt-style
domain setup would need to say whether `docs/decisions/` is an ADR namespace, a
legacy namespace, or a different decision-document class.

### 7. Root docs overlap without a precedence map

Root `AGENTS.md`, `ARCHITECTURE.md`, `CONTEXT.md`, `README.md`, `docs/api/`,
`docs/adr/`, and subtree `AGENTS.md` files all carry architectural or
operational claims. There is no compact precedence map for which file owns:

- agent operating rules;
- domain vocabulary;
- live CLI/API contracts;
- architecture narrative;
- durable decisions;
- subtree-local policy;
- recipes/SOPs;
- work cards.

The root `AGENTS.md` has a "Durable lessons" paragraph, but it does not mention
`CONTEXT.md`, `CONTEXT-MAP.md`, or Matt-style domain docs as a maintained
surface.

## Likely Root Cause

Agent-os appears to have "dipped into" `/grill-with-docs` by creating
`CONTEXT.md` and ADRs around the subject/work-record model, but did not complete
the setup/adaptation step:

1. No `docs/agents/domain.md` tells agents how to consume context docs.
2. No `CONTEXT-MAP.md` reflects the repo's multi-context architecture.
3. No maintenance SOP links context terms to schemas, API docs, AGENTS files,
   ADRs, and architecture prose.
4. No stale-phrase or ownership audit is required after context changes.

The result is a useful but overburdened `CONTEXT.md` that evolves alongside
other markdown instead of governing or being governed by them.

## Recommended Follow-Up Slices

1. **Install an agent-os-specific Matt setup layer.** Add `docs/agents/domain.md`
   and an `## Agent skills` block that explains the local adaptation. Do not
   blindly use Matt's single-context default.
2. **Create `CONTEXT-MAP.md`.** Map root vocabulary plus context-specific docs:
   runtime/CLI, toolkit, workbench/subjects, docks/session operations, Sigil,
   gateway/host.
3. **Define a context maintenance SOP.** Add a recipe under `docs/recipes/`
   that says when to update `CONTEXT.md`, ADRs, schemas, API docs, AGENTS files,
   and architecture docs together.
4. **Run a sibling-doc stale sweep.** Start with `AGENTS.md`, `src/CLAUDE.md`,
   `docs/api/aos.md`, and ADR-0004/0006 because they already conflict with the
   newly updated root docs.
5. **Decide whether root `CONTEXT.md` stays pure glossary.** Either slim it
   toward Matt's glossary model or explicitly document agent-os's broader
   "glossary plus contract terminology index" variant.

## Immediate Risk

If no follow-up happens, future agents will keep treating `CONTEXT.md` as a
single global source of truth, while still reading conflicting claims from
nearby root and subtree markdown. That creates exactly the failure mode just
observed: local doc corrections land, but the next dock/session reads a
different nearby file and makes a bad assumption.
