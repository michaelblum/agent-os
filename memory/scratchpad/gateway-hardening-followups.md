---
name: gateway-hardening follow-ups
status: validated-deferred
connects_to: packages/gateway/, ./aos CLI, docs/ (wiki + help text), AGENTS.md
updated: 2026-04-22
---

## What

Two follow-ups surfaced during `gateway-hardening` brainstorm (spec:
`docs/superpowers/specs/2026-04-22-gateway-hardening-design.md`). Neither
belongs in that spec's scope, but both are real.

## 1. Doc/help audit + alignment pass (last ~week of changes)

**Why it matters**: recent landings (gateway singleton fix #102, issue
hygiene skill, plan-retirement audit tweaks, Slack gateway surfacing, timeline
API fix) likely changed CLI surfaces, skills, or behaviors without
corresponding updates to:

- `./aos` help text
- wiki entries under `~/.config/aos/{mode}/wiki/`
- README/AGENTS.md/package CLAUDE.md
- any onboarding flow that still references retired paths

**Why not now**: orthogonal to gateway hardening. Needs its own sweep with a
diff range (e.g., `git log --since='1 week ago' --name-only`) and an
audit-driven plan. Scope includes gateway-hardening's new `./aos doctor
gateway` subcommand once that lands — so this pin naturally absorbs the new
work too.

**Revisit trigger**: after gateway-hardening lands, OR next time Michael hits
a doc that references something retired. Whichever comes first.

**Keywords**: doc drift, help audit, wiki alignment, post-landing sweep,
retirement hygiene.

## 2. Repo dev instructions for agents: CLI > MCP philosophy

**Why it matters**: during gateway-hardening brainstorm, I (Claude Opus 4.7)
proposed adding an MCP `doctor` tool without surfacing the repo rule "aos CLI
is canonical, MCP tools are optional adapter, not for dev work" (AGENTS.md
Repo-Wide Methods). Michael had to flag it. The rule IS in AGENTS.md, but it
didn't jump out to the agent at design-time — it reads as a runtime-usage
rule, not a design-time constraint.

**What to address**: make the CLI-first philosophy unmissable at design time.
Options (pick one during the pin-review session):

- Elevate to a "Design Principles" sibling of "Primitives First" in AGENTS.md
  — explicit line: "design-time: every new dev-facing affordance defaults to
  `./aos <verb>`; MCP tool only if external harness needs it."
- Add to `docs/SESSION_CONTRACT.md` as a bootstrap-visible rule.
- Fold into brainstorming-skill checklist so the question "could this be CLI
  instead of MCP?" is forced.

**Why not now**: this is meta-process work. Needs a small, deliberate edit
rather than a mid-task distraction. Also interacts with the doc-audit pin (1)
— may fold into that sweep.

**Revisit trigger**: alongside (1), or next time an agent proposes MCP-first
for dev-facing work.

**Keywords**: CLI-first, MCP adapter, agent instructions, design-time rule,
AGENTS.md.
