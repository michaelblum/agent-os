# agent-os Agent Entry Signage

This root file is intentionally small. Normal agent sessions in this repo should
launch through a dock under `.docks/<dock>` so role instructions, hooks, inbound
message contracts, and stop behavior are applied by the dock harness.

Remote or undocked agents are the exception. If you reached only this file, use
it as signage: read `.docks/README.md`, `.docks/AGENTS.md`, and then the
role-local `.docks/<dock>/AGENTS.md` that matches the request. If no role is
named and the task is coordination, review, routing, or git/GitHub hygiene,
adopt Foreman.

## Change Control

Do not casually edit this file. Do not put session lessons, hook mechanics,
work-card templates, provider syntax, readiness repair rituals, build recipes,
or role-specific policy here.

Change root `AGENTS.md` only when a repo-wide invariant or routing pointer has
changed. Prefer the narrower owner:

- `.docks/` for dock roles, launch model, hooks, inbound contracts, transfer
  vocabulary, and stop behavior.
- Nearest subtree `AGENTS.md` for package, app, daemon, toolkit, or test-local
  operating contracts.
- `docs/recipes/` for repeatable procedures and checklists.
- `docs/agents/` for issue, triage, and domain-doc practices.
- `docs/dev/` for workflow profiles, branch/review posture, and dev routing
  manifests.
- `docs/api/`, `shared/schemas/`, `ARCHITECTURE.md`, and `docs/adr/` for
  cross-tool contracts and durable architecture decisions.
- `CONTEXT.md` and `CONTEXT-MAP.md` for governed vocabulary and domain routing.

If a rule is too detailed for this file, it belongs somewhere else. Replace old
inline instructions with a pointer to the owning surface.

## Start Here

- `README.md` gives the project overview and consumer-facing API links.
- `CONTEXT.md` defines shared vocabulary and resolved terminology.
- `CONTEXT-MAP.md` routes work to the right source roots, contracts, schemas,
  recipes, and domain docs.
- `.docks/README.md` explains dock launch, hook/config ownership, and canonical
  dock roles.
- `.docks/AGENTS.md` is the shared docked-session contract.
- `.docks/foreman/AGENTS.md`, `.docks/gdi/AGENTS.md`, and
  `.docks/operator/AGENTS.md` define role-local authority and stop conditions.

Historical `CLAUDE.md` files are compatibility pointers for tools that still
discover that filename. Keep live detail in the owned source above.

## Repo Model

- `src/` and `shared/` hold the unified `aos` binary and shared schemas.
- `packages/toolkit/` is the reusable display/toolkit layer between primitives
  and apps.
- `packages/gateway/` and `packages/host/` are peer consumers of the
  primitives, not the middle layer.
- `apps/` contains consumer surfaces such as Sigil.
- Runtime mode is path-selected: `./aos` is repo mode, the packaged app is
  installed mode, and state is isolated under `~/.config/aos/{mode}/`.

## Architecture Compass

When a request touches canvases, panels, DesktopWorld, input routing, Sigil, or
window-shaped surfaces, keep ownership clear:

- Daemon/kernel owns native capability and generic contracts: canvas lifecycle,
  native frames, display topology, content serving, input streams, voice,
  coordination, and platform state.
- Toolkit/default surface system owns reusable opt-in AOS surface policy:
  panel chrome, controls, workbench shells, window state, placement,
  minimize/maximize/restore, DesktopWorld stages, and generic
  visual/interaction bindings.
- Apps own product expression, domain state, content, theming, and special
  behavior.

Build for the platform before the app. If an app needs a capability every future
app will need, extract it to daemon primitives or toolkit policy instead of
growing a private parallel system. See `ARCHITECTURE.md`, `docs/api/`, and the
nearest local contract before changing cross-layer behavior.

## AOS And Development

`aos` is the canonical control surface for agent-os. The base agent shell is the
typed primitive set: `see`, `do`, `show`, `tell`, and `listen`. `./aos dev ...`
is the developer control surface for repo work.

Use `docs/recipes/agent-entry-paths-and-verification.md` for entry-path,
verification, host-shell, and readiness guidance. Use `docs/dev/README.md` and
`docs/dev/workflow-profiles/README.md` for development workflow routing and
branch/review posture. Use `.docks/` contracts for role authority and harness
mechanics.

## Hard Invariants

- Do not discard or overwrite user changes to satisfy workflow hygiene.
- Do not invent new scoping models for runtime resources; preserve runtime mode
  isolation and wiki namespace conventions.
- Treat `_dev` demos as non-canonical.
- Never attribute commits, PR descriptions, issue comments, or release notes to
  Claude or any AI assistant.
