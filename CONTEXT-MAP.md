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
  routing.
- Read `docs/adr/README.md` for ADR status/supersession,
  `docs/adr/0040-ambient-authority-raw-observation-and-target-handles.md` for
  ambient authority, raw observation, and public target-handle contracts, and
  `docs/adr/0043-sovereign-capability-substrate-and-operation-control-plane.md`
  for the accepted sovereign-capability target.
- Read `docs/agents/domain.md` for how domain docs, context sources, ADRs, and
  conflicts should be handled.

## Sovereign Capability Remodel Authority

- Program identifier: `aos-sovereign-capability-substrate-v1`.
- Target architecture:
  `docs/adr/0043-sovereign-capability-substrate-and-operation-control-plane.md`.
- Machine authority and current-only contradiction baseline:
  `docs/dev/aos-sovereign-capability-authority-v1.json`, validated by
  `shared/schemas/aos-sovereign-capability-authority-v1.schema.json`.
- Its tracked scan classifies repository paths as `active`, `target`,
  `generated`, `preserved`, `historical`, or `frozen`. Path-specific current
  markers must exist in both the declared baseline revision and current
  worktree, so a Milestone 0 routing banner cannot satisfy them;
  doctrine-specific matches on scanned active/generated paths must be
  classified explicitly.
- Human dispositions, generated ownership, sequencing, publication boundaries,
  and preservation rules:
  `docs/dev/aos-sovereign-capability-remodel-ledger.md`.
- Current source, command-source manifests, generated help, schemas, tests,
  API docs, and runtime readback remain executable truth until a later atomic
  implementation slice. A mapped Rewrite or Retire claim is burn-down baseline,
  not evidence that the capability already changed.
- The paired external authority is Sigil ADR 0021 under the same program id.
  Its machine publication_state is `not_landed` and revision is `null`; its
  repository and path are external metadata, not an AOS-local path. AOS
  authority lands first. A later Sigil authority commit must atomically advance
  both reviewed AOS pins to the exact landed AOS SHA before Sigil publication.
  Authority publication is distinct from runtime implementation and does not
  make target capabilities executable.

## Runtime Primitives And CLI/API Contracts

- Source roots: `src/` and `shared/`.
- Local contracts: `src/AGENTS.md` and `src/daemon/AGENTS.md`.
- Public API docs: `docs/api/README.md`, `docs/api/aos.md`,
  `docs/api/aos-capabilities.md`, and relevant files under `docs/api/`.
- Schemas and cross-tool contracts: `shared/schemas/`, especially
  `shared/schemas/CONTRACT-GOVERNANCE.md`.
- Command manifest authorship and help metadata:
  `manifests/commands/source/`, generated compatibility manifests at
  `manifests/commands/aos-commands.json` and
  `manifests/commands/aos-external-commands.json`, the generator
  `scripts/generate-command-manifests.mjs`, and the drift gate
  `tests/command-manifest-generation.sh`.
- Installable root skill registry: `skills/registry.json`, especially
  `skills/aos-desktop/SKILL.md` for desktop/app/window/native AX workflows,
  `skills/aos-saved-workspace/SKILL.md` for saved perception/ref workflows,
  `skills/aos-canvas-vision/SKILL.md` for canvas and coordinate fallback,
  `skills/aos-focus-sessions/SKILL.md` for session/channel lifecycle,
  `skills/aos-browser/SKILL.md` for browser ref/proof workflows, and
  `skills/aos-verification/SKILL.md` for act/recapture/assert loops.
- Retained local maintainer skills are also registered in
  `skills/registry.json` but are not part of the installable AOS desktop
  product pack. Use `skills/aos-maintainer-orientation/SKILL.md`,
  `skills/aos-maintainer-routing/SKILL.md`, and
  `skills/aos-repo-binary-build/SKILL.md` for repo maintainer workflows backed
  by deterministic `scripts/aos-dev-*.mjs` commands.
- AOS Execution Model V0: `docs/adr/0013-aos-execution-model-v0.md`.
- Pre-release maturity and zero-installed-base compatibility policy:
  `docs/adr/0039-pre-release-zero-installed-base-compatibility.md` and
  `docs/dev/product-maturity.json`.
- AOS TCC capability broker boundary:
  `docs/adr/0015-aos-tcc-capability-broker-boundary.md`.
- Ambient authority, raw observation, and target-handle boundary:
  `docs/adr/0040-ambient-authority-raw-observation-and-target-handles.md`.
- Command-surface extraction contract: `docs/dev/command-surface.md`.
- Runtime wiki source layers: `docs/wiki/README.md`, `wiki-seed/`, and
  `docs/wiki/repo-docs-projection-v0.json`.
- Packaging and activation vocabulary for Capability Packages, Skills,
  Plugins, Work Cards, and GitHub labels is defined in ADR-0013 and
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
- Schemas: `shared/schemas/aos-workbench-subject.schema.json`, active
  `shared/schemas/aos-work-record-v1.schema.json`, active
  `shared/schemas/aos-step-descriptor-v1.schema.json`, and related workbench,
  evidence, checkpoint, subject-tree, and browser-evidence schemas in
  `shared/schemas/`. Work Record and Step Descriptor V0 schemas are frozen
  historical input, not active authority.
- API docs: `docs/api/toolkit/workbench.md`.
- Transitional Guide/SOP and design context:
  `docs/guides/layered-subject-expressions.md`,
  `docs/guides/aos-app-accessibility-surfaces.md`, and active plans or notes
  under `docs/design/`.
- Use this context for Subjects, Facets, Layers, Subject Browsers, Work Records,
  Playbooks, verifier health, evidence, claims, postconditions, and artifact
  bundle workbenches.

## External Sigil And Frozen Fixture

- Active product authority: [`Ch-osctrl/sigil`](https://github.com/Ch-osctrl/sigil).
- Sigil is the first-party reference consumer and may drive product-neutral AOS
  primitives, toolkit policy, hosts, schemas, and public CLI contracts.
- Repository and compatibility ownership:
  `docs/adr/0021-sigil-reference-consumer-and-toolkit-repository-boundary.md`.
- Frozen compatibility fixture: `tests/fixtures/legacy-sigil/product/`.
- Fixture contract: `tests/fixtures/legacy-sigil/product/AGENTS.md`.
- The test-only tree is not an app-development, launch, packaging, recipe, or
  live-proof surface. Use it only through the bounded deterministic fixture
  proof named by its contract.

## Package Ownership Boundary

- AOS package scope is capability-layer only: `packages/toolkit/`,
  `packages/design-tokens/`, and thin `packages/cli/` and `packages/daemon/`
  roots.
- Model execution, workflow orchestration, product ingress, product memory,
  retries, budgets, and product run state belong in the owning external product
  repository.
- Use ADR 0042 for the ownership decision and ADR 0015 for the capability-broker
  boundary.

## Durable Decisions And SOPs

- ADRs and durable architecture decisions: `docs/adr/`, with active status and
  supersession owned by `docs/adr/README.md`.
- Markdown Guides/SOPs: `docs/guides/`.
- Source-backed executable Recipes: `recipes/` plus `aos recipe`.
- Context maintenance guide: `docs/guides/context-doc-maintenance.md`.
- Design plans, notes, and work cards: `docs/design/`.
- Use this context when a task touches architectural trade-offs, cross-tool
  contracts, reusable procedures, or workstream plans.

## Conflict And Scope Notes

- Prefer live source, `shared/schemas/`, tests, command source manifests and
  generated help, live CLI/API/runtime readback, `docs/api/`, and `docs/adr/`
  before narrative docs. Local `AGENTS.md` files resolve policy and ownership
  routing for their subtree; root `AGENTS.md` resolves only repo-wide invariants
  and authority routing. Treat work cards, external templates, and design notes
  as planning context unless the current instruction explicitly scopes the task
  to them.
- Do not map generated, cache, or temporary trees such as `.runtime/` or
  `.aos-test-tmp/` as durable context domains.
- When docs conflict, surface the conflict and keep the fix scoped to the
  active task instead of rewriting adjacent domains.
