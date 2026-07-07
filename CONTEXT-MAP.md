# Context Map

Agent-os is multi-context. Start with root vocabulary, then follow the domain
you are touching to the nearest local contract, live schema, API document, or
source root. This file is a routing map, not a replacement for those sources.

## Root And Shared Vocabulary

- Read `CONTEXT.md` for governed repo vocabulary, contract terminology, and
  resolved naming notes.
- Read `ARCHITECTURE.md` for the system narrative, daemon/toolkit/app boundary,
  and current AOS primitive model.
- Read `AGENTS.md` for repo-wide agent signage, hard invariants, and authority
  routing. It is not the home for dock role policy or operational SOPs.
- Read `docs/agents/domain.md` for how domain docs, context sources, ADRs, and
  conflicts should be handled.

## Runtime Primitives And CLI/API Contracts

- Source roots: `src/` and `shared/`.
- Local contracts: `src/AGENTS.md` and `src/daemon/AGENTS.md`.
- Public API docs: `docs/api/README.md`, `docs/api/aos.md`, and relevant files
  under `docs/api/`.
- Schemas and cross-tool contracts: `shared/schemas/`, especially
  `shared/schemas/CONTRACT-GOVERNANCE.md`.
- Command manifest authorship and help metadata:
  `manifests/commands/source/`, generated compatibility manifests at
  `manifests/commands/aos-commands.json` and
  `manifests/commands/aos-external-commands.json`, the generator
  `scripts/generate-command-manifests.mjs`, and the drift gate
  `tests/command-manifest-generation.sh`.
- Installable root skill registry: `skills/registry.json`, especially
  `skills/aos-saved-workspace/SKILL.md` for saved perception/ref workflows and
  `skills/aos-browser/SKILL.md` for browser ref/proof workflows. The broader
  `skills/aos-agent-workspace/SKILL.md` remains local background and
  compatibility material.
- AOS Execution Model V0: `docs/adr/0013-aos-execution-model-v0.md`.
- AOS TCC capability broker boundary:
  `docs/adr/0015-aos-tcc-capability-broker-boundary.md`.
- Command-surface extraction contract: `docs/dev/command-surface.md`.
- Runtime wiki source layers: `docs/wiki/README.md`, `wiki-seed/`, and
  `docs/wiki/repo-docs-projection-v0.json`.
- Packaging and activation vocabulary for Capability Packages, Skills,
  Plugins, Work Cards, Docks, and GitHub labels is defined in ADR-0013 and
  `CONTEXT.md`; these concepts are not execution ladder rungs.
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
- Transitional Guide/SOP and design context:
  `docs/guides/layered-subject-expressions.md`,
  `docs/guides/aos-app-accessibility-surfaces.md`, and active plans or notes
  under `docs/design/`.
- Use this context for Subjects, Facets, Layers, Subject Browsers, Work Records,
  Playbooks, verifier health, evidence, claims, postconditions, and artifact
  bundle workbenches.

## Docks And Session Operations

- Launch and ownership map: `.docks/README.md`.
- Shared docked-session contract: `.docks/AGENTS.md`.
- Active standalone dock contract: `.docks/foreman/AGENTS.md`.
- AOS-owned runner role material: `ai-agents/providers/codex/*.toml` and
  `ai-agents/agents/*.md`.
- Hook and harness sources: `.docks/foreman/.codex/hooks.json`,
  `.docks/foreman/hooks/`, `.docks/harness/`, `.docks/<dock>/dock.json`, and
  `.docks/<dock>/inbound-contract.json`.
- Scripts and skills: `.docks/foreman/`, `.docks/harness/`, and role-local
  skill directories when present.
- Use this context for Foreman launch identity, active profile doctrine,
  hook-owned behavior, AOS-owned runner role authority, Implementer slices,
  Operator supervised probes, and Foreman coordination. Treat GDI, `/goal`, and
  standalone Operator dock language as stale historical terminology unless an
  old artifact is being read for forensics.

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
- Markdown Guides/SOPs: `docs/guides/`.
- Source-backed executable Recipes: `recipes/` plus `aos recipe`.
- Context maintenance guide: `docs/guides/context-doc-maintenance.md`.
- Design plans, notes, and work cards: `docs/design/`.
- Use this context when a task touches architectural trade-offs, cross-tool
  contracts, reusable procedures, or workstream plans.

## Conflict And Scope Notes

- Prefer current work cards, the relevant dock or local `AGENTS.md`, live code,
  schemas, tests, CLI/API behavior, then API docs, schemas, architecture, and
  vocabulary docs. Root `AGENTS.md` resolves only repo-wide invariants and
  authority routing. Treat external templates and design notes as context unless
  the active work card makes them authoritative.
- Do not map generated, cache, or temporary trees such as `.runtime/` or
  `.aos-test-tmp/` as durable context domains.
- When docs conflict, surface the conflict and keep the fix scoped to the
  active task instead of rewriting adjacent domains.
