# Context Map

Agent-os is multi-context. Start with root vocabulary, then follow the domain
you are touching to the nearest local contract, live schema, API document, or
source root. This file is a routing map, not a replacement for those sources.

## Root And Shared Vocabulary

- Read `CONTEXT.md` for governed repo vocabulary, contract terminology, and
  resolved naming notes.
- Read `ARCHITECTURE.md` for the system narrative, daemon/toolkit/app boundary,
  and current AOS primitive model.
- Read `AGENTS.md` for repo-wide agent rules, entry paths, verification posture,
  and workflow boundaries.
- Read `docs/agents/domain.md` for how domain docs, context sources, ADRs, and
  conflicts should be handled.

## Runtime Primitives And CLI/API Contracts

- Source roots: `src/` and `shared/`.
- Local contracts: `src/AGENTS.md` and `src/daemon/AGENTS.md`.
- Public API docs: `docs/api/README.md`, `docs/api/aos.md`, and relevant files
  under `docs/api/`.
- Schemas and cross-tool contracts: `shared/schemas/`, especially
  `shared/schemas/CONTRACT-GOVERNANCE.md`.
- Use this context for `aos` verbs, daemon lifecycle, perception/action/display,
  communication, spatial topology, runtime mode isolation, sockets, native
  frames, input streams, and platform state.

## Toolkit And Default Surface System

- Source root: `packages/toolkit/`.
- Local contracts: `packages/toolkit/AGENTS.md`,
  `packages/toolkit/controls/AGENTS.md`, `packages/toolkit/panel/AGENTS.md`,
  and `packages/toolkit/runtime/AGENTS.md`.
- API docs: `docs/api/toolkit.md` and scoped files under `docs/api/toolkit/`.
- Use this context for reusable AOS surface policy: runtime bridges, controls,
  panel/window chrome, DesktopWorld stages, workbench shells, placement,
  minimize/maximize/restore, and generic visual/interaction bindings.

## Workbench Subjects And Work Records

- Source root: `packages/toolkit/workbench/`.
- Schemas: `shared/schemas/aos-workbench-subject.schema.json`,
  `shared/schemas/aos-work-record-v0.schema.json`, and related workbench,
  evidence, checkpoint, subject-tree, and browser-evidence schemas in
  `shared/schemas/`.
- API docs: `docs/api/toolkit/workbench.md`.
- Recipes and design context: `docs/recipes/layered-subject-expressions.md`,
  `docs/recipes/aos-app-accessibility-surfaces.md`, and active plans or notes
  under `docs/design/`.
- Use this context for Subjects, Facets, Layers, Subject Browsers, Work Records,
  Playbooks, verifier health, evidence, claims, postconditions, and artifact
  bundle workbenches.

## Docks And Session Operations

- Root contract: `.docks/AGENTS.md`.
- Role contracts: `.docks/foreman/AGENTS.md`, `.docks/gdi/AGENTS.md`, and
  `.docks/operator/AGENTS.md`.
- Scripts and skills: `.docks/foreman/scripts/handoff`,
  `.docks/gdi/scripts/human-needed-tcc-reset`, and role-local skill directories
  when present.
- Recipes: `docs/recipes/codex-dock-session-profiles.md`,
  `docs/recipes/gdi-work-card-authoring.md`, and
  `docs/recipes/aos-gdi-exit-interview.md`.
- Use this context for dock identity, handoffs, work cards, transfer vocabulary,
  role authority, GDI rounds, Operator supervised probes, and Foreman
  coordination.

## Sigil App Behavior

- Source root: `apps/sigil/`.
- Local contract: `apps/sigil/AGENTS.md`.
- Compatibility pointer: `apps/sigil/CLAUDE.md`.
- Live app docs discovered in-tree include `apps/sigil/context-menu/README.md`,
  `apps/sigil/radial-item-editor/README.md`, and
  `apps/sigil/tests/foundation-acceptance.md`.
- Use this context for Sigil-owned product expression: avatar behavior, radial
  menu semantics, agent docs, renderer modules, configuration surfaces, app
  diagnostics, and Sigil-specific visual state.

## Gateway And Host Adapter Surfaces

- Source roots: `packages/gateway/` and `packages/host/`.
- Compatibility pointer: `packages/gateway/CLAUDE.md`.
- API docs: `docs/api/integration-broker.md` plus any relevant package tests
  and README-style local docs.
- Use this context for external ingress and adapters around AOS: MCP gateway,
  broker integrations, provider hosts, session catalog surfaces, and app-facing
  adapter behavior. These surfaces do not replace daemon-native `tell`,
  `listen`, or session coordination as source of truth.

## Durable Decisions And SOPs

- ADRs and durable architecture decisions: `docs/adr/`.
- Recipes and SOPs: `docs/recipes/`.
- Context maintenance recipe: `docs/recipes/context-doc-maintenance.md`.
- Design plans, notes, and work cards: `docs/design/`.
- Use this context when a task touches architectural trade-offs, cross-tool
  contracts, reusable procedures, or workstream plans.

## Conflict And Scope Notes

- Prefer current work cards, root and local `AGENTS.md`, live code, schemas,
  tests, CLI/API behavior, then API docs, schemas, architecture, and vocabulary
  docs. Treat external templates and design notes as context unless the active
  work card makes them authoritative.
- Do not map generated, cache, or temporary trees such as `.runtime/` or
  `.aos-test-tmp/` as durable context domains.
- When docs conflict, surface the conflict and keep the fix scoped to the
  active task instead of rewriting adjacent domains.
