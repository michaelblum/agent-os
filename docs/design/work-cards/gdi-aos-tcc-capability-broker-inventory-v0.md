# GDI Work Card: AOS TCC Capability Broker Inventory V0

## Transfer Header

- Recipient: GDI
- Transfer kind: GDI round
- Source workstream: #407, governance/control-surface lane; follows `docs(aos): codify tcc capability broker boundary` at `aed925ca`.
- Governing canon: `docs/adr/0015-aos-tcc-capability-broker-boundary.md`.
- Roadmap source: `docs/design/aos-tcc-capability-broker-refactor-map-v0.md`.
- Required start ref: current local checkout in `/Users/Michael/Code/agent-os`, branch `gdi/aos-target-addressed-action-ergonomics-v0`, at or after `aed925ca`.
- Branch/output expectation: stay in the single local checkout. Do not create linked worktrees. Do not push. Produce a scoped local docs/report commit if the resulting diff is clean and reviewable.
- Single goal: inventory remaining Swift public/runtime policy and classify each route or policy block as broker primitive, external composition, or remove/cut over.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, checkout, daemon, issue, or prior implementation state. Read and rediscover before editing.

## Goal

Produce the source-backed inventory needed for the first real extraction tranche. The output should tell Foreman exactly what remains in Swift, why it remains there today, what must move out under the TCC capability broker canon, and what private broker primitives need to exist before public behavior can be externalized.

Do not perform the extraction in this round. This is classification, cutover planning, and evidence only.

## Read First

- `AGENTS.md`
- `CONTEXT-MAP.md`
- `docs/adr/0015-aos-tcc-capability-broker-boundary.md`
- `docs/design/aos-tcc-capability-broker-refactor-map-v0.md`
- `docs/dev/command-surface.md`
- `src/AGENTS.md`
- `.docks/gdi/AGENTS.md`
- `.docks/foreman/AGENTS.md`
- `src/main.swift`
- `src/shared/external-command-dispatch.swift`
- `manifests/commands/aos-external-commands.json`
- `manifests/commands/aos-commands.json`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse --show-toplevel
git branch --show-current
git log --oneline -5
```

Do not run `./aos ready`, live service commands, canvas gates, or permission setup. This is a no-live, no-build inventory round.

## Existing Code To Inspect

Inspect, but do not edit source:

- `src/main.swift` - public command fallback and private `__...` routes.
- `src/commands/operator.swift` - current `ready`, `status`, `doctor`, permissions, runtime/blocker, next-action, and recovery policy.
- `src/commands/` - remaining Swift command families and helper files.
- `src/daemon/` - daemon/socket native service boundary and stream/fact surfaces.
- `src/shared/external-command-dispatch.swift` - external manifest dispatcher.
- `src/shared/invocation.swift` - invocation display/runtime helpers used by command policy.
- `manifests/commands/aos-external-commands.json` - public routes that still point back to `$AOS_PATH`.
- `manifests/commands/aos-commands.json` - help metadata and public command forms.
- `scripts/aos-*.mjs`, shell, and Python helpers only as needed to identify already-externalized behavior and existing composition candidates.
- Relevant tests that exercise `ready`, `status`, `doctor`, `permissions`, `service`, `clean`, `see`, `do`, `show`, `tell`, and `listen`.

Use `rg` first. Suggested discovery commands:

```bash
rg -n "case \"__|func .*Command|readyCommand|doctorCommand|statusCommand|permissionsCommand|exitError\\(|print\\(|next_actions|recovery|repair|setup|reset-runtime|service restart|service start|aosInvocationDisplayName|UNKNOWN_|Usage:" src
rg -n "\"executable\": \"\\$AOS_PATH\"|\"argv_prefix\": \\[\"__" manifests/commands/aos-external-commands.json
rg -n "\"path\":|\"forms\":|\"summary\":|\"description\":|\"usage\":" manifests/commands/aos-commands.json
```

## Required Output

Create a report at:

`docs/design/aos-tcc-capability-broker-inventory-v0.md`

The report must include these sections.

### 1. Executive Summary

Summarize the largest remaining Swift policy clusters and the recommended extraction order.

### 2. Public Route Inventory

Table every public command path in `manifests/commands/aos-external-commands.json` that routes to `$AOS_PATH` or a private `__...` Swift route.

Columns:

- public path;
- private Swift route or function;
- current reason it is in Swift;
- classification: `broker_primitive`, `external_composition`, or `remove_cut_over`;
- proposed destination;
- required private broker primitive, if any;
- no-shim/cutover note;
- evidence file/line references.

### 3. Swift Policy Block Inventory

Inventory Swift code blocks that contain public policy, workflow sequencing, presentation, help/usage text, recovery text, next actions, command grammar, or product/app behavior.

Columns:

- file/function or block;
- policy type;
- current public consumer;
- classification;
- extraction target;
- prerequisite primitive or schema;
- risk/stop condition;
- evidence file/line references.

### 4. Broker Primitive Candidates

List minimal stable private broker primitives that likely need to exist before extraction can proceed.

For each candidate include:

- proposed private route or socket service/action name;
- privileged fact/action/stream exposed;
- TCC/native reason it belongs in Swift;
- external commands/composition that would consume it;
- expected JSON shape at a high level;
- deterministic test approach.

Prefer small fact/action/stream primitives over public workflows. Do not design broad "ready" or "doctor" primitives.

### 5. External Composition Candidates

List public behavior that should move to scripts/packages/recipes/manifests.

Include likely destination files, such as:

- `scripts/aos-ready.mjs`
- `scripts/aos-status.mjs`
- `scripts/aos-doctor.mjs`
- `scripts/aos-permissions.mjs`
- `scripts/lib/aos-runtime-compose.mjs`
- manifest/help metadata updates

These are proposals only. Do not create these files in this round.

### 6. Cutover And No-Shim Decisions

Identify in-repo callers/tests/docs that will need strict updates during extraction. Call out any possible real external release boundary separately; if none is found, say so directly.

### 7. Verification And Guard Ideas

Propose machine-checkable tests/guards for later tranches, including:

- route/manifest tests;
- help contract tests;
- no-build policy tests;
- `rg` or allowlist checks that would catch public policy creep in Swift.

### 8. Recommended Next Tranche

Name the next GDI tranche and its single goal. It should normally be runtime/readiness extraction unless the inventory reveals a prerequisite primitive design slice.

## Classification Rules

Use these definitions strictly:

- `broker_primitive`: must remain or be added in Swift because it exposes a permission-gated native fact, action, stream, daemon/socket substrate behavior, macOS framework integration, native lifecycle behavior needed to keep the permissioned process identity stable, or TCC permission probe/reset primitive.
- `external_composition`: public behavior, workflow sequencing, policy, recovery choice, next-action generation, command grammar, help metadata, presentation, product behavior, or orchestration that can be built from existing or newly exposed primitives.
- `remove_cut_over`: stale Swift route, alias, compatibility path, old vocabulary, or in-repo caller/contract that should be broken and updated with no shim.

Do not soften the no-shim rule. If compatibility appears necessary, identify the external consumer and removal gate explicitly.

## Scope

Docs/report only. No implementation refactor.

Likely edited file:

- `docs/design/aos-tcc-capability-broker-inventory-v0.md`

Optional tiny docs edits are allowed only if a typo in the accepted canon blocks clear inventory, but prefer reporting the issue instead of widening scope.

## Hard Boundaries / Non-Goals

- Do not edit Swift, JS, Python, shell source, schemas, manifests, tests, or command docs in this tranche.
- Do not create the external composition scripts yet.
- Do not add adapters, compatibility aliases, transitional wrappers, or shims.
- Do not run `./aos dev build`, `build.sh`, `scripts/aos-after-build`, or any equivalent rebuild.
- Do not mutate the checked-in `./aos` binary.
- Do not run live `./aos ready`, service start/restart, permission setup/reset, or canvas gates.
- Do not push, open PRs, mutate GitHub issues, or clean unrelated untracked files.
- Do not create linked worktrees.

## Verification

Run:

```bash
git diff --check
./aos dev recommend --json --paths docs/design/aos-tcc-capability-broker-inventory-v0.md
test -f docs/design/aos-tcc-capability-broker-inventory-v0.md
rg -n "broker_primitive|external_composition|remove_cut_over" docs/design/aos-tcc-capability-broker-inventory-v0.md
rg -n "\"executable\": \"\\$AOS_PATH\"|\"argv_prefix\": \\[\"__" manifests/commands/aos-external-commands.json
```

The final `rg` is evidence input, not a pass/fail check. Include its output or summarize the matching route count in the completion report.

If `./aos dev recommend` asks for a Swift build for this docs-only report, do not build; report that the recommendation is over-broad.

## Completion Report

Return:

- changed file list;
- report path;
- count of public `$AOS_PATH` routes classified;
- count of Swift policy blocks classified;
- count and names of proposed private broker primitives;
- any external release boundary that might justify compatibility, or state none found;
- recommended next GDI tranche;
- verification commands and outputs;
- whether a scoped local commit was created.
