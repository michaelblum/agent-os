# agent-os Agent Entry Signage

This root file is intentionally small. Normal agent sessions in this repo should
launch through a dock under `.docks/<dock>` so role instructions, hooks, inbound
message contracts, and stop behavior are applied by the dock harness.

Remote or undocked agents are the exception. If you reached only this file, use
it as signage: read `.docks/README.md`, `.docks/AGENTS.md`, and then the
role-local `.docks/<dock>/AGENTS.md` that matches the request. If no current
role is named and the task is coordination, review, routing, or git/GitHub
hygiene, adopt Foreman.

## Change Control

Do not casually edit this file. Do not put session lessons, hook mechanics,
work-card templates, provider syntax, readiness repair rituals, build recipes,
or role-specific policy here.

Change root `AGENTS.md` only when a repo-wide invariant or routing pointer has
changed. Prefer the narrower owner:

- `.docks/` for dock roles, launch model, active dock profiles, hooks, inbound
  contracts, transfer vocabulary, and stop behavior.
- Nearest subtree `AGENTS.md` for package, app, daemon, toolkit, or test-local
  operating contracts.
- `docs/guides/` for repeatable procedures and checklists.
- `docs/agents/` for issue, triage, and domain-doc practices.
- `docs/dev/` for workflow profiles, branch/review posture, and dev routing
  manifests.
- `docs/api/`, `shared/schemas/`, `ARCHITECTURE.md`, and `docs/adr/` for
  cross-tool contracts and durable architecture decisions.
- `CONTEXT.md` and `CONTEXT-MAP.md` for governed vocabulary and domain routing.

If a rule is too detailed for this file, it belongs somewhere else. Replace old
inline instructions with a pointer to the owning surface.

## DOX Framework

- DOX is the binding `AGENTS.md` hierarchy installed here.
- Agents must follow DOX instructions across any edits.

### Core Contract

- `AGENTS.md` files are binding work contracts for their subtrees.
- Work products, source materials, instructions, records, assets, and durable
  docs must stay understandable from the nearest applicable `AGENTS.md` plus
  every parent `AGENTS.md` above it.

### Read Before Editing

1. Read the root `AGENTS.md`.
2. Identify every file or folder you expect to touch.
3. Walk from the repository root to each target path.
4. Read every `AGENTS.md` found along each route.
5. If a parent `AGENTS.md` lists a child `AGENTS.md` whose scope contains the
   path, read that child and continue from there.
6. Use the nearest `AGENTS.md` as the local contract and parent docs for
   repo-wide rules.
7. If docs conflict, the closer doc controls local work details, but no child
   doc may weaken DOX.

Do not rely on memory. Re-read the applicable DOX chain in the current session
before editing.

### Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning `AGENTS.md` when a change affects:

- purpose, scope, ownership, or responsibilities;
- durable structure, contracts, workflows, or operating rules;
- required inputs, outputs, permissions, constraints, side effects, or
  artifacts;
- user preferences about behavior, communication, process, organization, or
  quality;
- `AGENTS.md` creation, deletion, move, rename, or index contents.

Update parent docs when parent-level structure, ownership, workflow, or child
index changes. Update child docs when parent changes alter local rules. Remove
stale or contradictory text immediately. Small edits that do not change behavior
or contracts may leave docs unchanged, but the DOX pass still must happen.

### Hierarchy

- Root `AGENTS.md` is the DOX rail: project-wide instructions, global
  preferences, durable workflow rules, and the top-level Child DOX Index.
- Child `AGENTS.md` files own domain-specific instructions and their own Child
  DOX Index.
- Each parent explains what its direct children cover and what stays owned by
  the parent.
- The closer a doc is to the work, the more specific and practical it must be.

### Child Doc Shape

- Create a child `AGENTS.md` when a folder becomes a durable boundary with its
  own purpose, rules, responsibilities, workflow, materials, or quality
  standards.
- Work Guidance must reflect the current standards of the project or user
  instructions; if there are no specific standards or instructions yet, leave it
  empty.
- Verification must reflect an existing check; if no verification framework
  exists yet, leave it empty and update it when one exists.

Default section order:

- Purpose
- Ownership
- Local Contracts
- Work Guidance
- Verification
- Child DOX Index

### Style

- Keep docs concise, current, and operational.
- Document stable contracts, not diary entries.
- Put broad rules in parent docs and concrete details in child docs.
- Prefer direct bullets with explicit names.
- Do not duplicate rules across many files unless each scope needs a local
  version.
- Delete stale notes instead of explaining history.
- Trim obvious statements, repeated rules, misplaced detail, and warnings for
  risks that no longer exist.

### Closeout

1. Re-check changed paths against the DOX chain.
2. Update nearest owning docs and any affected parents or children.
3. Refresh every affected Child DOX Index.
4. Remove stale or contradictory text.
5. Run existing verification when relevant.
6. Report any docs intentionally left unchanged and why.

### User Preferences

When the user requests a durable behavior change, record it here or in the
relevant child `AGENTS.md`.

## Start Here

- `README.md` gives the project overview and consumer-facing API links.
- `CONTEXT.md` defines shared vocabulary and resolved terminology.
- `CONTEXT-MAP.md` routes work to the right source roots, contracts, schemas,
  recipes, and domain docs.
- `.docks/README.md` explains dock launch, active profile loading, hook/config
  ownership, and canonical dock roles.
- `.docks/AGENTS.md` is the shared docked-session contract.
- `.docks/foreman/AGENTS.md` defines current Foreman authority and stop
  conditions.

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

For live repo operation, use `./aos` as the first control plane for readiness,
runtime status, canvases, Agent Terminal surfaces, dock sessions, and input or
communication routing. Do not reach directly for daemon HTTP endpoints, raw
PTY/tmux control, launchd state, or ad-hoc runtime files unless an `./aos`
surface is missing, broken, or the task is explicitly testing that lower-level
adapter. When you must bypass `./aos`, state why and keep the bypass scoped as a
last-resort diagnostic.

Use `docs/guides/agent-entry-paths-and-verification.md` for entry-path,
verification, host-shell, and readiness guidance. Use `docs/dev/README.md` and
`docs/dev/workflow-profiles/README.md` for development workflow routing and
branch/review posture. Use `.docks/` contracts for role authority and harness
mechanics.

## Hard Invariants

- Do not discard or overwrite user changes to satisfy workflow hygiene.
- Do not invent new scoping models for runtime resources; preserve runtime mode
  isolation and wiki namespace conventions.
- Treat `_dev` demos as non-canonical.
- Preserve the AOS TCC capability broker canon: `./aos` is the stable
  permissioned process identity and privileged IPC surface; public command
  policy and composition belong outside Swift unless a native-boundary
  justification is explicit. See
  `docs/adr/0015-aos-tcc-capability-broker-boundary.md`.
- Never attribute commits, PR descriptions, issue comments, or release notes to
  Claude or any AI assistant.

## Child DOX Index

- `.codex/AGENTS.md` governs undocked Codex root sessions, native custom-agent
  disablement, and AOS-owned runner posture.
- `.docks/AGENTS.md` governs docked session launch contracts. Its active child
  is `.docks/foreman/AGENTS.md`; `.docks/profiles/` owns profile packs without
  a separate child doc yet.
- `.agents/` contains cross-provider hook scripts and stays root-owned until a
  child doc is needed.
- `.claude/` contains Claude compatibility settings and statusline hooks; live
  project-agent policy stays in AOS-owned docs and runner material.
- `_dev/`, `memory/`, and `tasks/` are root-owned scratch, historical, or task
  packet surfaces. They are not canonical contracts unless a current doc links
  to them as active authority.
- `ai-agents/AGENTS.md` governs provider-neutral and provider-shaped agent role
  source material.
- `apps/AGENTS.md` governs application consumers. Its current child is
  `apps/sigil/AGENTS.md`.
- `docs/AGENTS.md` governs durable docs, ADRs, guides, API docs, reports, and
  archives.
- `experiences/AGENTS.md` governs experience manifests and app activation
  material.
- `manifests/AGENTS.md` governs command and capability manifests.
- `packages/AGENTS.md` governs reusable JavaScript/package layers. Its current
  child is `packages/toolkit/AGENTS.md`, which further indexes `contracts/`,
  `controls/`, `panel/`, and `runtime/`.
- `recipes/AGENTS.md` governs operational recipes and repeatable procedures.
- `scripts/AGENTS.md` governs executable repo tooling, including `aos` command
  adapters and `scripts/aos_agents/`.
- `shared/AGENTS.md` governs shared schemas, shared JS contracts, and shared
  Swift IPC helpers.
- `skills/AGENTS.md` governs local skill packages.
- `src/AGENTS.md` governs native Swift source. Its current child is
  `src/daemon/AGENTS.md`.
- `tests/AGENTS.md` governs shell, Node, Python, browser, daemon, toolkit, and
  scenario verification assets.
- `wiki-seed/AGENTS.md` governs seed wiki content.
