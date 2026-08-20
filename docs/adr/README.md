# Architecture Decision Index

This is the status and supersession index for active AOS architecture
decisions. When ADR prose conflicts, the newest accepted ADR listed as an
amendment or supersession controls. Files without an explicit in-file status
predate the status field and are treated as accepted unless this index says
otherwise.

| ADR | Status | Authority note |
| --- | --- | --- |
| [0001](0001-facets-belong-to-layers.md) | Accepted | Active. |
| [0002](0002-work-records-and-playbooks-are-distinct-artifacts.md) | Accepted, amended | ADR 0013 owns the broader execution model; ADR 0040 and Work Record V1 make records optional neutral evidence, never permission. V0 is frozen history. |
| [0003](0003-claims-and-postconditions-split-along-intent-and-execution.md) | Accepted | Active. |
| [0004](0004-anchor-is-a-role-resolved-into-a-binding.md) | Accepted | Active. |
| [0005](0005-subjects-are-host-neutral-facets-declare-hosts.md) | Accepted | Active. |
| [0006](0006-state-id-guards-coordinates-strictly-refs-loosely.md) | Superseded | ADR 0040 replaces loose ref re-resolution with Observation Ref versus Locator. |
| [0007](0007-subject-type-is-kind-not-projection.md) | Accepted | Active. |
| [0008](0008-subject-browser-is-a-surface-kind.md) | Accepted | Active. |
| [0009](0009-recipe-playbook-workflow-as-three-distinct-artifacts.md) | Accepted | Active. |
| [0010](0010-capabilities-are-named-contracts-not-buttons-or-facets.md) | Accepted | Active. |
| [0011](0011-host-neutral-surfaces-use-capability-bounded-hosts.md) | Accepted clarification | Active. |
| [0012](0012-toolkit-platform-strategy.md) | Accepted | Active. |
| [0013](0013-aos-execution-model-v0.md) | Accepted, amended | ADR 0040 makes dry-run optional and Gate explicit; active Work Record and Step Descriptor V1 contracts are neutral and V0 is frozen history. |
| [0014](0014-visual-object-descriptor-contract.md) | Accepted | Active. |
| [0015](0015-aos-tcc-capability-broker-boundary.md) | Accepted | Active; aligned with ADR 0040 ambient authority. ADR 0043 expands its broker boundary toward mechanically complete privileged exposure without changing this ADR body. |
| 0016-0017 | Unassigned | No ADR files use these numbers. |
| [0018](0018-installable-aos-skills.md) | Accepted, amended | ADR 0039 owns deletion policy; ADR 0040 owns skill authority posture; ADR 0041 retains the managed Playwright package/session lifecycle, while ADR 0043 supersedes its fixed public-operation boundary and owns complete managed-tool grammar direction. |
| [0019](0019-retire-project-agent-orchestration.md) | Accepted, amended | ADR 0042 assigns host and gateway orchestration to Sigil while this ADR continues to exclude project-agent orchestration from AOS core. |
| [0020](0020-single-owner-local-runtime.md) | Accepted | Active. |
| [0021](0021-sigil-reference-consumer-and-toolkit-repository-boundary.md) | Accepted, amended | ADR 0042 retains the toolkit and capability-layer hosts in AOS while assigning host and gateway successors to Sigil. |
| [0022](0022-public-voice-transport-boundary.md) | Accepted | Active. |
| [0023](0023-managed-endpoint-raw-repo-artifact.md) | Accepted | Active. |
| [0024](0024-desktopworld-stage-3d-outlet.md) | Accepted | Active. |
| [0025](0025-native-annotation-selection-and-shortcut-execution.md) | Accepted, amended | ADR 0040 owns target-handle and ambient-authority semantics. |
| [0026](0026-desktopworld-cartridge-and-engine-boundary.md) | Partially superseded | ADR 0029 supersedes its executable-implementation restriction. |
| [0027](0027-desktopworld-devtools-session-and-host-leases.md) | Accepted | Active. |
| [0028](0028-native-status-item-anchor-and-dependent-projection-hosts.md) | Accepted | Active. |
| [0029](0029-trusted-scene-projection-extensions.md) | Accepted | Active; supersedes part of ADR 0026. |
| [0030](0030-desktop-frame-texture-leases.md) | Accepted, partially superseded | ADR 0040 owns ambient-authority and raw-observation semantics. ADR 0043 supersedes its AOS-local process-lifetime direct-capture consent/prime gate while retaining texture-lease and mechanical capture ownership. |
| [0031](0031-desktop-pixel-broker-and-warm-snapshots.md) | Accepted, partially superseded | ADR 0040 owns ambient-authority and raw-observation semantics. ADR 0043 supersedes its explicit direct-capture consent/prime clauses while retaining pixel-broker, warm-snapshot, serialization, identity, and cleanup ownership. |
| [0032](0032-declarative-native-sheet-feedback.md) | Partially superseded | ADR 0033 supersedes its complete-effect registry requirement. |
| [0033](0033-consumer-authored-native-effect-programs.md) | Accepted | Active; supersedes part of ADR 0032. |
| [0034](0034-three-dimensional-native-effect-programs.md) | Accepted | Active. |
| [0035](0035-native-effect-bindings-and-gesture-lifetimes.md) | Accepted | Active. |
| [0036](0036-desktopworld-native-fidelity-and-local-effect-geometry.md) | Accepted | Active. |
| [0037](0037-stateful-native-height-field-programs.md) | Accepted | Active. |
| [0038](0038-desktopworld-renderkit-boundary.md) | Accepted | Active. |
| [0039](0039-pre-release-zero-installed-base-compatibility.md) | Accepted | Active. |
| [0040](0040-ambient-authority-raw-observation-and-target-handles.md) | Accepted | Active authority for ambient execution, raw observation, target handles, Gate, and Work Record boundaries. ADR 0043 expands its caller-transform rule across raw managed-tool streams and artifacts without changing this ADR body. |
| [0041](0041-managed-playwright-companion-runtime.md) | Accepted, partially superseded | Retains the managed Playwright package, store, session, guardian, and cleanup lifecycle. ADR 0043 supersedes its fixed public-operation allowlist and browser-feature non-goals. |
| [0042](0042-host-and-gateway-move-to-sigil.md) | Accepted | Owns the host and gateway move to Sigil, contracted AOS package scope, supersession audit, and paired retirement. |
| [0043](0043-sovereign-capability-substrate-and-operation-control-plane.md) | Accepted, amended | Owns the sovereign capability substrate target, grammar-agnostic pinned managed-tool transport, every-nontrivial-operation control plane, transient raw outputs, caller-owned transforms, AOS/Sigil boundary, and staged burn-down authority map. ADR 0044 accepts its mechanical owner-root, exact registered-set same-effective-UID host-control, bounded replay, explicit prior-generation recovery, and split resource mechanics; ADR 0045 freezes the complete-AX M4 contract and boundary without changing this ADR body. |
| [0044](0044-operation-owner-roots-host-control-and-resource-claims.md) | Accepted | Defines immediate socket-peer audit identity and proc-generation-verified non-AOS ancestry, content-free generation-bound external dispatch, registered-set host receipts with expected-barrier CAS and bounded retained replay, distinct custody/claim recovery dispositions, nine-machine prior-generation recovery, and split claim-set/resource/broker mechanics for M2. |
| [0045](0045-complete-ax-observation-notification-and-coordinate-contract.md) | Accepted | Defines M4 native AX roots, immutable bounded snapshots and pages, raw value/action truth, per-PID observer lifecycle, exact coordinate spaces and SCK identity limits, M4/M5/M6/M10 boundaries, production-owner proof classes, and dependency-ordered delivery. |
