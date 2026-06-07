ss# GDI Work Card: AOS TCC Capability Broker Canon V0

## Transfer Header

- Recipient: GDI
- Transfer kind: GDI round
- Source workstream: #407, governance/control-surface lane; user request to make the AOS binary a stable TCC capability broker before the larger binary streamlining refactor.
- Required start ref: current local checkout in `/Users/Michael/Code/agent-os`, branch `gdi/aos-target-addressed-action-ergonomics-v0`, at or after `e0992f8d`.
- Branch/output expectation: stay in the single local checkout. Do not create linked worktrees. Do not push. Produce a scoped local docs/design commit if the resulting diff is clean and reviewable.
- Single goal: codify the AOS binary boundary as canon across durable architecture docs and agent operating contracts, with a concrete migration roadmap for the follow-on refactor.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, checkout, daemon, issue, or prior implementation state. Read and rediscover before editing.

## Goal

Make this the repo-canonical position:

`./aos` is a stable TCC capability broker with a privileged IPC surface. It should hold the permissioned process identity, expose the smallest durable set of privileged native facts/actions/streams, and delegate public command behavior, workflow policy, recovery choices, user-facing text, command grammar, product behavior, and orchestration to hot-swappable layers outside the binary.

The long-term aim is not "small binary" as a file-size goal. The aim is a low-churn permission identity: after the broker is refactored, Swift rebuilds should be exceptional and auditable, required only for a new or changed privileged native primitive, daemon/socket substrate behavior, macOS framework integration, or a new TCC permission class.

## Read First

- `AGENTS.md` - repo-wide signage and architecture compass.
- `CONTEXT-MAP.md` - routing map for runtime primitives, docs, and ADRs.
- `ARCHITECTURE.md` - current architecture narrative; likely contains drift to fix.
- `docs/dev/command-surface.md` - current command-surface extraction contract.
- `src/AGENTS.md` - native layer operating contract.
- `.docks/foreman/AGENTS.md` - Foreman review/routing authority for binary work.
- `.docks/gdi/AGENTS.md` - GDI binary/native boundary.
- `docs/adr/0013-aos-execution-model-v0.md` - current execution model ADR.
- `src/main.swift` and `src/shared/external-command-dispatch.swift` - inspect only for architectural accuracy, not for behavior changes in this tranche.
- `manifests/commands/aos-external-commands.json` - inspect current public-to-external routing model.

## Required Canonical Terms

Use the clearest technical language available. Prefer these terms consistently:

- TCC capability broker
- permissioned process identity
- privileged native substrate
- privileged IPC surface
- stable primitive surface
- privileged facts, privileged actions, privileged streams
- external composition layer
- hot-swappable command surface
- policy-free native boundary
- low-churn permission identity

Define the distinction explicitly:

- Swift owns permission-gated native observation/action and stable broker transport.
- External layers own interpretation, policy, composition, presentation, workflow, and product behavior.

## Required Behavior

### 1. Add A Durable ADR

Create the next ADR under `docs/adr/`, expected path:

`docs/adr/0015-aos-tcc-capability-broker-boundary.md`

The ADR must cover:

- Decision: `./aos` is a TCC capability broker, not the home of public command policy.
- Context: command-surface rearchitecture already externalized public command behavior; this ADR makes the boundary strict.
- Principle: if privileged information/action/stream can be exposed through a stable IPC primitive, policy and composition must live outside the binary.
- Micro-API stance: privileged continuous data such as mouse/input streams, focus/window/display changes, canvas lifecycle, or future audio/STT events should be exposed as stable subscription/stream contracts rather than consumer-specific Swift logic.
- No-shim migration stance: in-repo callers/consumers/contracts should be broken and updated during this refactor. Do not add aliases, compatibility wrappers, transitional routes, or adapters unless a real external release boundary is identified with a removal gate.
- Swift change gate: any Swift change touching the broker must justify why the behavior cannot live in manifests, scripts, packages, recipes, schemas, or an external composition layer using existing or newly exposed primitives.
- Non-goals: this is not a file-size optimization and not a move away from a unified daemon/socket/TCC identity.

### 2. Remove Architecture Drift

Update `ARCHITECTURE.md` so it no longer implies public command policy belongs inside Swift.

Preserve the unified native identity where it is still true:

- one permissioned broker binary;
- one daemon/socket substrate;
- one shared native capability layer.

Replace or clarify old language such as "all capability ships inside the unified binary" and "subcommand groups inside the binary" so the canonical model is:

- stable TCC broker and native primitives in Swift;
- public command behavior and composition outside Swift;
- consumers get privileged data/actions through stable IPC contracts.

### 3. Tighten Command-Surface Contract

Update `docs/dev/command-surface.md` from "command behavior should be outside Swift" to a strict contract:

- public command behavior, help metadata, argument shape, workflow policy, recovery policy, next actions, and presentation text are external;
- public routes pointing back to `$AOS_PATH` are temporary candidates for extraction unless they are true bootstrap/native primitive surfaces;
- future work should extract `ready`, `doctor`, `status`, and permission workflow policy by exposing smaller private broker primitives and moving public behavior to scripts/composition code.

### 4. Update Agent Onboarding Gates

Add concise pointers, not duplicated essays:

- `src/AGENTS.md`: before changing Swift, prove the change cannot be externalized; Swift may expose privileged facts/actions/streams, not public policy.
- `CONTEXT-MAP.md`: add the new ADR and `docs/dev/command-surface.md` as required context for runtime primitive and CLI/API work.
- `AGENTS.md`: add a short hard-invariant pointer to the TCC capability broker canon.
- `.docks/foreman/AGENTS.md`: Foreman must reject policy/composition changes disguised as native work unless the native-boundary justification is explicit.
- `.docks/gdi/AGENTS.md`: GDI must stop/report when a goal appears to require Swift but could be solved by externalizing behavior or adding a smaller stable primitive. GDI still must not rebuild or mutate `./aos`.

### 5. Add The Follow-On Migration Map

Create a concise roadmap note, expected path:

`docs/design/aos-tcc-capability-broker-refactor-map-v0.md`

It should lay out the next tranches without implementing them:

1. Inventory remaining Swift public/runtime policy and classify as broker primitive, external composition, or remove/cut over.
2. Extract runtime/readiness policy from `src/commands/operator.swift` into external composition.
3. Extract status/doctor presentation and next-action text.
4. Extract permissions workflow policy while preserving native TCC probes/reset primitives where truly required.
5. Add guard tests against policy/string/command-surface creep back into Swift.

Each tranche should include likely files, stop conditions, and machine-checkable acceptance evidence.

## Scope

Docs and governance only. No source behavior refactor in this tranche.

Likely edited files:

- `docs/adr/0015-aos-tcc-capability-broker-boundary.md`
- `ARCHITECTURE.md`
- `docs/dev/command-surface.md`
- `src/AGENTS.md`
- `CONTEXT-MAP.md`
- `AGENTS.md`
- `.docks/foreman/AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `docs/design/aos-tcc-capability-broker-refactor-map-v0.md`

Adjust exact file list only if reading shows a narrower or cleaner canonical home.

## Hard Boundaries / Non-Goals

- Do not edit Swift, JS, Python, shell source, schemas, or tests in this tranche except for documentation examples that are clearly docs-only.
- Do not run `./aos dev build`, `build.sh`, live `./aos ready`, service start/restart, or canvas gates.
- Do not push, open PRs, mutate GitHub issues, or clean unrelated untracked files.
- Do not create linked worktrees.
- Do not add compatibility language that weakens the no-shim migration stance.
- Do not make "small binary" the canonical phrase; use "stable TCC capability broker" and "low-churn permission identity".

## Verification

Run:

```bash
git diff --check
./aos dev recommend --json --paths \
  docs/adr/0015-aos-tcc-capability-broker-boundary.md \
  ARCHITECTURE.md \
  docs/dev/command-surface.md \
  src/AGENTS.md \
  CONTEXT-MAP.md \
  AGENTS.md \
  .docks/foreman/AGENTS.md \
  .docks/gdi/AGENTS.md \
  docs/design/aos-tcc-capability-broker-refactor-map-v0.md
```

Run focused contradiction checks and explain any remaining hits:

```bash
rg -n "All capability ships inside the unified|public command behavior.*Swift binary|subcommand groups.*inside the binary|source of truth for public command behavior" \
  ARCHITECTURE.md docs/dev/command-surface.md docs/adr src/AGENTS.md CONTEXT-MAP.md AGENTS.md .docks/foreman/AGENTS.md .docks/gdi/AGENTS.md
```

Also run any no-build docs checks recommended by `./aos dev recommend`. If the router recommends a rebuild, do not rebuild; report that the recommendation is over-broad for this docs-only tranche.

## Completion Report

Return:

- changed file list;
- exact ADR path and title;
- summary of contradictions removed or clarified;
- whether any docs still imply policy belongs in Swift;
- verification commands and outputs;
- whether a scoped local commit was created;
- any proposed next GDI tranche for inventory/extraction.
