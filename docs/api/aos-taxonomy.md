# AOS Artifact Taxonomy

Consumer-facing classification rules for AOS artifacts.

Use this doc when deciding where a new AOS artifact belongs, what should own
its source of truth, and which existing surface should consume it. This is a
taxonomy for AOS itself, not an EVOI implementation plan.

For command details, see [`aos.md`](./aos.md). For system architecture, see
[`ARCHITECTURE.md`](../../ARCHITECTURE.md). For day-to-day agent entry paths,
see [`agent-entry-paths-and-verification.md`](../recipes/agent-entry-paths-and-verification.md).

## Classification Questions

Before creating, moving, or promoting an artifact, answer these questions in
order:

1. Is it executable behavior, prose guidance, runtime knowledge, or a
   cross-tool contract?
2. Is it consumed by `./aos`, by an app, by an agent, by tests, or by the
   runtime wiki?
3. Does it need deterministic validation through a schema, command registry,
   or test fixture?
4. Is it indexed or invoked at runtime, or is it read from the repo by humans
   and agents?
5. Is the scope repo-wide, package-local, app-local, runtime-mode-local, or
   historical compatibility?
6. If the artifact is useful in more than one place, should it be promoted to
   a lower AOS layer instead of copied?

## Artifact Classes

| Class | Definition | Source Of Truth | Runtime / Execution | Examples |
| --- | --- | --- | --- | --- |
| Primitive verb | Embodied AOS capability operated through the unified CLI and daemon. | `src/`, `ARCHITECTURE.md`, `docs/api/aos.md` | Executed by `aos` and the daemon. | `see`, `do`, `show`, `tell`, `listen`; `say` as sugar for `tell human`. |
| Command surface | Discoverable CLI command or command form over primitives or operator layers. | command registry, `./aos help`, `docs/api/aos.md` | Executed by `aos`; may be invoked directly by agents. | `ready`, `status`, `ops`, `dev`, `wiki`, `inspect`. |
| Source-backed ops recipe | Schema-backed operator unit that `aos ops` can list, explain, dry-run, and run. | `recipes/`, app/package `recipes/`, `shared/schemas/ops-*` | Executed through `aos ops`; dry-run is static in v1. | `runtime/status-snapshot`, `canvas/window-level-smoke`. |
| Developer workflow rule | Manifest-backed recommendation for AOS developer actions after local changes. | `docs/reference/aos-dev-workflow-rules.json`, `shared/schemas/dev-workflow-rules.schema.json` | Consumed by `aos dev classify`, `aos dev recommend`, and `aos dev surface`; should delegate runnable procedures to commands, tests, or ops recipes. | Swift rebuild routing, docs-only classification, schema-test recommendations. |
| Test harness artifact | Verification helper, fixture, or scenario. | `tests/` and test docs | Executed by test runners or shell scripts; folder taxonomy is owned by the test harness workstream. | schema tests, renderer tests, future `tests/lib/**` helpers and `tests/scenarios/**` scenarios. |
| Instruction surface | Durable agent operating contract or local guidance. | root and subtree `AGENTS.md`; compatibility `CLAUDE.md` pointers for tools that still discover that filename | Read by agents; should not become full command reference. | repo-wide agent contract, Sigil local guidance. |
| Docs recipe | Reusable SOP or practice. | `docs/recipes/` | Read by humans and agents; not directly executable. | app accessibility surfaces, content-root hygiene, developer builds. |
| Cross-tool contract | Consumer-facing API, schema, packet, or architecture contract. | `docs/api/`, `shared/schemas/`, `ARCHITECTURE.md` | Used by commands, packages, apps, tests, and external consumers. | target probe schema, spatial topology, daemon IPC, toolkit API. |
| Design artifact | Plan, spec, note, or supporting artifact that captures intent, rationale, sequencing, or tradeoffs before promotion to a durable contract. | `docs/design/` for new provider-neutral design work; `docs/superpowers/` for legacy Superpowers-origin design history | Read by humans and agents; not itself an execution surface or API contract. | implementation plans, design specs, decision sketches, supporting demos. |
| Runtime wiki knowledge | Mode-scoped knowledge graph content and product/project memory. | runtime wiki under `~/.config/aos/{mode}/wiki/`; repo seed under `wiki-seed/` | Indexed by `aos wiki`; retrieved through wiki list/search/graph/show. | wiki entities, wiki concepts, seeded platform knowledge. |
| Wiki plugin workflow | Runtime wiki workflow bundle with `SKILL.md`, references, and optional scripts. | `wiki-seed/plugins/**` or runtime wiki plugins | Indexed and invoked through `aos wiki`; distinct from Codex-local skills. | seeded wiki plugin workflows. |
| App-local playbook | Product-specific operating guidance or domain knowledge for an app. | nearest app docs or app seed wiki namespace | Read by app agents or app runtime; promotion requires an explicit rule. | Sigil app guidance, Sigil agent wiki docs. |
| Historical or compatibility surface | Old filename, retired path, appendix content, or compatibility pointer retained for discoverability. | nearest owning subtree | Should point to the live source or be clearly scoped. | compatibility `CLAUDE.md`, `_dev` demos, legacy wiki appendix content. |

## Naming Rules

Qualify overloaded terms where ambiguity matters:

- Use `ops recipe` for executable source-backed manifests under `aos ops`.
- Use `docs recipe` for prose SOPs under `docs/recipes/`.
- Use `developer workflow rule` for entries in
  `docs/reference/aos-dev-workflow-rules.json`.
- Use `wiki plugin` or `wiki plugin workflow` for runtime wiki bundles.
- Use `agent skill` for portable agent instruction bundles outside the AOS wiki.
- Use `app-local playbook` for product-specific guidance that has not been
  promoted into a repo-wide docs recipe, wiki plugin, or schema-backed surface.
- Use `command surface` for CLI commands and forms exposed through `aos help`.

Do not use bare `recipe`, `plugin`, `skill`, `workflow`, or `playbook` in a
cross-surface context unless the local context makes the owner obvious.

## Promotion Rules

Start with the narrowest durable home that matches the consumer.

If prose guidance becomes reusable outside one app, promote it from app-local
guidance to a `docs recipe` or a repo-wide instruction surface.

If prose guidance becomes deterministic executable behavior, promote it to a
command, test harness artifact, or `ops recipe`. Do not keep executable repo
contracts only in the runtime wiki.

If runtime knowledge should be searchable or graphable during agent operation,
store it in the runtime wiki or seed it through `wiki-seed/`. Do not use the
wiki as a dumping ground for repo-only procedures.

If a surface changes a packet, schema, command contract, or app/toolkit
consumer contract, update the appropriate `docs/api/`, `shared/schemas/`, or
`ARCHITECTURE.md` source of truth.

If a plan or spec is provider-neutral AOS design work, create it under
`docs/design/`. Treat `docs/superpowers/` as legacy design history from the
Superpowers workflow unless you are deliberately continuing an existing
historical thread.

If a file exists only because older tools look for that filename, keep it thin
and point to the live contract. Provider-specific compatibility files should
not grow independent workflow doctrine.

## EVOI Gate

Do not classify or implement EVOI until AOS artifact taxonomy is settled. The
follow-up decision memo should classify the EVOI prototype against this table
and state whether it belongs as a docs recipe, runtime wiki knowledge, wiki
plugin workflow, app-local playbook, agent skill, schema-backed policy, or ops
recipe.

Current placement decision:
[`2026-05-01-evoi-placement-decision.md`](../design/notes/2026-05-01-evoi-placement-decision.md).
