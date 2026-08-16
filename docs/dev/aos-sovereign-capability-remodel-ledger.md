# AOS Sovereign Capability Remodel Disposition Ledger

Program: `aos-sovereign-capability-substrate-v1`

Status: Milestone 0 authority and drift-control baseline at
`b48bf4d58c9cfad04f0dc03ef21dbe6d5e4a3044`.

Canonical target authority is
`docs/adr/0043-sovereign-capability-substrate-and-operation-control-plane.md`.
The schema-backed machine authority is
`docs/dev/aos-sovereign-capability-authority-v1.json`. This ledger is its human
review projection.

## Reading rule

Milestone 0 changes authority, not capability. Current source, command-source
manifests, generated help, schemas, API docs, tests, and runtime readback remain
the executable contract until a later atomic implementation slice changes them.
A row marked Rewrite or Retire is declared burn-down debt; it is not a claim
that the current implementation has already changed.

The paired Sigil authority is ADR 0021 at
`docs/adr/0021-sigil-sovereign-workflow-composition.md`, keyed by the same
program identifier in `https://github.com/Ch-osctrl/sigil`. Its publication
state is `not_landed` and its revision is `null`; the path is external metadata,
not an AOS-local repository path. Cross-repo landing and activation are
separately sequenced. This AOS packet does not claim the Sigil ADR is already
landed.

## Disposition ledger

| Asset or authority | Current truth | Disposition | Milestone 0 action | Later exit gate |
| --- | --- | --- | --- | --- |
| `docs/adr/0015-aos-tcc-capability-broker-boundary.md` | Stable TCC identity and privileged fact/action/stream broker; policy belongs above native code. | Expand | ADR 0043 makes mechanically complete supported privileged exposure the target; hash-preserve the ADR 0015 body. | Native and managed surfaces expose every supported primitive through stable IPC/SDK contracts. |
| `docs/adr/0040-ambient-authority-raw-observation-and-target-handles.md` | Ambient authority, raw admitted facts, caller transforms, exact Observation Ref/Locator mechanics. | Expand | ADR 0043 extends the rule to raw transports and complete managed-tool grammar; hash-preserve the ADR 0040 body. | All admitted channels are fidelity-first and every transform is explicitly caller-owned. |
| `docs/adr/0041-managed-playwright-companion-runtime.md` | Strong pin, integrity, store, session, guardian, cleanup, and receipt model coupled to a fixed public grammar and broad feature non-goals. | Rewrite | Mark partially superseded in the ADR index; hash-preserve the old body as decision history. | Keep lifecycle mechanics while atomically replacing fixed wrappers with raw argv/stdin/stdout/stderr/artifact transport for the pinned upstream executable and environment. |
| `docs/adr/0042-host-and-gateway-move-to-sigil.md` | AOS owns capability-layer packages; Sigil owns orchestration. | Keep | Reuse as the cross-repo ownership boundary. | Reviewed AOS/Sigil pins prove no orchestration returns to AOS. |
| `docs/adr/0030-desktop-frame-texture-leases.md` | Owns texture-lease and capture mechanics but also requires an AOS-local process-lifetime direct-capture consent/prime gate. | Rewrite | Mark the gate partially superseded in the ADR index; preserve the old body. | Retain capture mechanics while removing the AOS-local admission gate atomically across native, IPC, help, API, tests, and proofs. |
| `docs/adr/0031-desktop-pixel-broker-and-warm-snapshots.md` | Owns the single pixel broker, warm snapshots, serialization, identity, settlement, and cleanup while retaining explicit direct-capture consent/prime clauses. | Rewrite | Mark only those clauses partially superseded in the ADR index; hash-preserve the old body. | Retain broker/warm-snapshot correctness while removing the AOS-local admission gate atomically across native, IPC, help, API, tests, and proofs. |
| `docs/adr/0018-installable-aos-skills.md` | Owns installable AOS skills and still describes external Playwright as the escape hatch for grammar AOS does not expose. | Repoint | Update only the ADR-index authority note; preserve the old body. | Skills and their governing ADR describe implemented complete managed grammar without a competing ambient runtime path. |
| Root `AGENTS.md`, `CONTEXT-MAP.md`, and `ARCHITECTURE.md` | Root ambient-authority rules align, but the architecture narrative still presents the current minimal/fixed surface without target/current precedence. | Repoint | Add one authority route and temporary transition banner. | Remove the banner after active narrative, implementation, help, schemas, skills, and proofs converge. |
| `README.md`, `CONTEXT.md`, and `docs/api/README.md` | Current implementation and discovery narrative; no Milestone 0 executable change. | Keep | Leave unchanged and route through the root map. | Update only with the atomic public-capability slice that changes their claims. |
| `docs/api/aos.md` and `docs/api/aos-capabilities.md` | Correct current command and capability contract, including fixed browser gaps and explicit screen-capture priming. | Repoint | Add a temporary target/current banner; retain all existing implementation claims. | Rewrite each affected section with source manifests, generated help, schema, implementation, skills, and tests. |
| `manifests/commands/source/aos/` and `manifests/commands/source/external/` | Authorship source for AOS command grammar and help metadata. | Keep | Record ownership; do not edit in Milestone 0. | AOS lifecycle/control commands remain source-authored; upstream Playwright operations pass as raw argv and do not gain one manifest entry per upstream operation. |
| `manifests/commands/aos-commands.json` and `manifests/commands/aos-external-commands.json` | Generated command/help compatibility artifacts. | Keep | Do not hand-edit or regenerate. | Change only as output of `scripts/generate-command-manifests.mjs`; prove with `tests/command-manifest-generation.sh`. |
| Browser command sources, especially `07-do-01-pointing.json`, `07-do-02-text.json`, and their external routes | Browser Observation Ref actions fail with `TARGET_ACTION_UNSUPPORTED`; only a small session grammar is exposed. | Rewrite | Classify in the machine burn-down baseline; do not edit. | Full upstream operation grammar lands with exact lifecycle, bounds, schemas, receipts, help, API, skills, and tests. |
| `scripts/lib/browser-companion/` and `scripts/aos-browser-*.mjs` | AOS-managed reviewed Playwright runtime, private store, exact leases, fixed worker envelopes, guardian, and cleanup. | Expand | Preserve implementation; add nearest-owner authority signage only. | Replace operation-specific envelopes with grammar-agnostic raw argv/stdin/stdout/stderr/artifact transport without weakening pin, environment identity, bounds, guardian, kill, cleanup, or receipts. |
| `src/browser/` | Narrow Swift client for fixed managed browser operations. | Expand | Replace the stale prose-heavy `src/browser/CLAUDE.md` with compatibility pointers; do not edit Swift. | Native bridge supports the mechanically required generic transport without interpreting workflow semantics. |
| Browser schemas under `shared/schemas/aos-browser-*.schema.json`, `shared/schemas/aos-semantic-targets.md`, and Target Handle V1 | Closed current lifecycle/results and fail-closed browser-ref action semantics. | Rewrite | Retain as current executable truth and classify restrictive claims with path-specific markers. | Schema only AOS lifecycle, identity, bounds, raw transport, artifacts, and control; it does not wrap each upstream operation semantically. |
| `docs/design/aos-desktop-playwright-cli-map.md` | Maintained consumer crosswalk that still routes trace/video/PDF to an external escape hatch, says AOS exposes no generic browser runner, and leaves full browser grammar upstream rather than AOS-managed. | Rewrite | Keep the maintained design path active-scanned and add its exact baseline/current markers to the fixed-grammar claim. | Rewrite with the atomic managed-grammar implementation slice so the maintained crosswalk reflects raw pinned-upstream transport rather than a competing external route. |
| Browser tests and `docs/dev/test-proof-registry.d/browser-companion.json` | Prove lifecycle correctness and the absence of upstream list, generic code, ref actions, and tab operations. | Rewrite | Keep all tests; classify the exact enforcing tests and proof source with path-specific required markers. | Replace negative surface proofs with raw-transport and control-plane proofs while retaining lifecycle regressions. |
| `scripts/AGENTS.md`, `scripts/lib/browser-companion/AGENTS.md`, `src/AGENTS.md`, and `tests/AGENTS.md` browser clauses | Closest active DOX requires fixed operations and forbids generic grammar. | Repoint | Add temporary local target/current pointers without deleting executable constraints. | Delete transition banners when local contracts describe the implemented complete grammar. |
| `skills/aos-browser/SKILL.md`, related installable skills, and `skills/registry.json` | Teach the current narrow managed session and unsupported browser-ref boundary. | Repoint | Add local target/current signage; do not claim new commands. | Update installed skill content and registry backing atomically with implemented grammar. |
| `src/daemon/desktop-frame-capture-consent.swift`, direct-capture IPC, and permission command source | Current process-lifetime direct-capture gate requires explicit AOS priming before runtime capture. | Retire | Preserve runtime/source; classify the gate as burn-down baseline. | Remove AOS-local admission only with native code, IPC, manifest/help, API, tests, and proof routing changed together. |
| `src/daemon/AGENTS.md`, `shared/schemas/daemon-ipc.md`, `docs/api/aos.md`, and `docs/api/toolkit/scene-extensions.md` | Accurately document the current consent/prime gate and protected ScreenCaptureKit lifecycle. | Repoint | Add temporary pointers at the active docs/DOX centers; retain current behavior text. | Rewrite when runtime exposes platform permission facts without AOS-local policy. |
| Native-capture tests and `docs/dev/test-proof-registry.d/native-capture.json` | Prove the current broker, topology, callback, permission, and TCC-free harness boundaries. | Rewrite | Leave unchanged; map the exact consent-enforcing tests/proof source and exclude preserved ADR bodies from active stale evidence. | Preserve mechanical capture proofs while replacing consent-gate expectations. |
| Status-item source, schemas, `docs/api/toolkit/status-item.md`, and tests | Product-neutral lease, inspect, update, invoke, dry-run, event, and action-sequence model; not a general operation control plane. | Expand | Add a temporary pointer and classify the exact narrow status-item contract as current baseline. | Keep status-item identity separate while AOS adds its neutral active-operation/recording projection; Sigil owns product labels and action policy. |
| Browser guardian and exact-focus/native process supervision | Strong exact-identity termination mechanics exist in bounded feature-specific owners. | Expand | Keep as reference implementation and current executable truth. | Factor or reuse product-neutral operation control without weakening exact identity or residual-authority receipts. |
| `packages/toolkit/` and `docs/api/toolkit/` | AOS-owned reusable surface layer; selected JS clients are transport-injected, but no comprehensive substrate SDK exists. | Expand | Add ownership pointer at Toolkit/status centers; no package code changes. | Publish maintained CLI/IPC/SDK projections for substrate and control-plane contracts. |
| AOS installable skills | Generic substrate workflow guidance, constrained by current CLI/help. | Expand | Route to ADR/map and retain current command syntax. | Teach complete implemented primitives and optional caller transforms without policy. |
| Current Gate, annotation, and Guided User Signal fidelity gaps listed by ADR 0040 | Some admitted facts still receive default redaction or omission. | Rewrite | Preserve explicit gap accounting. | Migrate each fact with exact schema/API/implementation/test ownership and explicit caller transforms. |
| General operation-control commands and schemas | No complete cross-capability plane exists for every nontrivial privileged or managed operation or its one-shot terminal history. | Expand | Record absence without inventing a command or schema. | Land list/inspect/status/recent content-free history; kill-one; terminal outcome/blame/cleanup; artifact reveal/remove/release/explicit retain; and a separately bounded observation-only data tap with no default raw accumulation. A mechanically authenticated peer or owner establishes the controllable set; caller-asserted client/agent/task/project/capability values only narrow within it and never add operations or expand control; a mechanically bound scope may establish a stronger owner boundary; host-wide emergency stop-all is separate mechanically authenticated host-operator control. |
| Compatibility aliases, fixed-grammar policy, and any competing ambient Playwright resolver | Fixed grammar and old resolver residue are incompatible with the target. | Retire | No runtime retirement in Milestone 0. | Delete atomically under ADR 0039 after all internal consumers migrate. |
| `docs/archive/**` and `docs/dev/reports/**` | Historical evidence, not active authority. | Archive | Preserve unchanged and exclude from stale scans. | None; Git and explicit archive ownership preserve history. |
| Maintained `docs/design/**` notes and current work cards | Active design exploration under `docs/AGENTS.md`; some paths carry executable-current contradiction claims. | Keep | Scan tracked regular files as active authority and classify exact contradictions path-by-path. | Promote stable decisions to ADR/API/schema owners without using a blanket design-tree exclusion. |
| Six exact self-declared historical/retired design notes plus `docs/design/fixtures/**` | Historical research/retired lineage and frozen fixture material, not maintained current design authority. | Archive | Preserve unchanged and exclude only the exact mapped notes and fixture subtree from the tracked stale scan. | None unless a separately authorized migration explicitly reclassifies an exact artifact. |

The historical design-note exclusions are exactly
`2026-05-07-architecture-deepening-audit-triage.md`,
`2026-05-17-platform-debt-map.md`,
`agent-relay-readiness-narrative-ledger-2026-06-04.md`,
`aos-grand-unification-plan.md`,
`aos-surface-stack-v0-checkpoint-hygiene-report.md`, and
`see-do-grammar-trace-connections.md`, all under `docs/design/`. The only
design-tree fixture exclusion is `docs/design/fixtures/**`.

ADR 0015, 0018, 0030, 0031, 0040, and 0041 keep the program dispositions in
their individual rows while their bodies are separately hash-preserved and
excluded from stale-evidence scanning. Preservation does not reclassify active
0015/0040 doctrine as archived or make superseded 0030/0031/0041 clauses
current.

## Active contradiction baseline

The machine map binds exact paths and path-specific required markers for three
current contradiction families:

1. fixed managed-browser grammar and explicit unsupported operations;
2. the AOS-local native-capture consent/prime gate; and
3. narrow status-item control without a general operation control plane.

The static authority test requires every path-specific marker in both the
declared baseline revision and current worktree, so a new Milestone 0 banner
cannot satisfy old implementation evidence. It also scans every Git-tracked
text path classified `active` or `generated` for doctrine-specific matches and
fails when a match lives outside the claim's path-specific baseline. `target`,
`preserved`, `historical`, and `frozen` scopes are explicit exclusions;
generated help is classified separately but remains scanned. Maintained design
notes are active-scanned; only the six exact self-declared historical/retired
notes and `docs/design/fixtures/**` are excluded. Removing a path or claim
therefore requires an explicit map update in the atomic implementation slice.

The baseline is not exhaustive implementation proof. Later milestones must add
their own source/schema/help/API/skill/test/proof convergence and delete each
burn-down entry only when its exit gate is met.

## Generated ownership and proof routing

- Command help authorship: `manifests/commands/source/aos/` and
  `manifests/commands/source/external/`.
- Generated outputs: `manifests/commands/aos-commands.json` and
  `manifests/commands/aos-external-commands.json`.
- Generator: `scripts/generate-command-manifests.mjs`.
- Drift proof: `tests/command-manifest-generation.sh`.
- Milestone 0 static proof:
  `tests/sovereign-capability-active-authority.test.mjs`.
- Proof-worth fragment:
  `docs/dev/test-proof-registry.d/sovereign-capability-authority.json`.
- Workflow route: `sovereign-capability-authority` in
  `docs/dev/workflow-rules.json`.

## Sequencing

1. Land the AOS authority-only packet first and record its exact landed AOS SHA.
2. In one later Sigil authority commit, atomically advance both reviewed AOS pin
   fields, `verifiedRef` and `sourceRevision`, to that exact landed AOS SHA
   before Sigil authority publication. Land Sigil ADR 0021 and its authority
   map in that same reviewed commit; until then its publication state remains
   `not_landed` with revision `null`.
3. Only after both authority commits are reviewed may cross-repo authority be
   described as active. Authority publication does not publish runtime
   implementation or make any target capability executable.
4. Implement the find, center, and record-video vertical slice in atomic
   capability increments: substrate, managed grammar, artifact/stream transport,
   operation lineage/status/kill/blame, SDK/skills, and proof.
5. Burn down fixed-grammar and consent-gate claims only as their exact owners
   converge.
6. Join Simulation Author as the first follow-on flagship consumer only under
   later explicit owner direction. Do not touch its independent documents in
   this program slice.

## Publication and preservation boundary

Milestone 0 does not publish or imply native capability, full Playwright
grammar, SDK, status/kill/blame, or changed permission behavior. It does not
edit runtime source, command-source manifests, generated help, frozen ADR
bodies, archives, reports, V0 contracts, or frozen fixtures. No capability is
advertised as implemented until its executable and documentation owners change
atomically.

Authority publication does not publish runtime implementation. The future
managed Playwright boundary inherits snapshots, boxes, evaluation, tracing,
video, network, storage, PDF, tabs, input, navigation, and lifecycle from the
reviewed pin through raw transport; none of those target families is claimed as
newly implemented by this ledger.
