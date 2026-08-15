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
| [0015](0015-aos-tcc-capability-broker-boundary.md) | Accepted | Active; aligned with ADR 0040 ambient authority. |
| 0016-0017 | Unassigned | No ADR files use these numbers. |
| [0018](0018-installable-aos-skills.md) | Accepted, amended | ADR 0039 owns deletion policy; ADR 0040 owns skill authority posture; ADR 0041 owns the managed Playwright CLI runtime boundary. |
| [0019](0019-retire-project-agent-orchestration.md) | Accepted | Active. |
| [0020](0020-single-owner-local-runtime.md) | Accepted | Active. |
| [0021](0021-sigil-reference-consumer-and-toolkit-repository-boundary.md) | Accepted | Active. |
| [0022](0022-public-voice-transport-boundary.md) | Accepted | Active. |
| [0023](0023-managed-endpoint-raw-repo-artifact.md) | Accepted | Active. |
| [0024](0024-desktopworld-stage-3d-outlet.md) | Accepted | Active. |
| [0025](0025-native-annotation-selection-and-shortcut-execution.md) | Accepted, amended | ADR 0040 owns target-handle and ambient-authority semantics. |
| [0026](0026-desktopworld-cartridge-and-engine-boundary.md) | Partially superseded | ADR 0029 supersedes its executable-implementation restriction. |
| [0027](0027-desktopworld-devtools-session-and-host-leases.md) | Accepted | Active. |
| [0028](0028-native-status-item-anchor-and-dependent-projection-hosts.md) | Accepted | Active. |
| [0029](0029-trusted-scene-projection-extensions.md) | Accepted | Active; supersedes part of ADR 0026. |
| [0030](0030-desktop-frame-texture-leases.md) | Accepted, amended | ADR 0040 owns ambient-authority and raw-observation semantics. |
| [0031](0031-desktop-pixel-broker-and-warm-snapshots.md) | Accepted, amended | ADR 0040 owns ambient-authority and raw-observation semantics. |
| [0032](0032-declarative-native-sheet-feedback.md) | Partially superseded | ADR 0033 supersedes its complete-effect registry requirement. |
| [0033](0033-consumer-authored-native-effect-programs.md) | Accepted | Active; supersedes part of ADR 0032. |
| [0034](0034-three-dimensional-native-effect-programs.md) | Accepted | Active. |
| [0035](0035-native-effect-bindings-and-gesture-lifetimes.md) | Accepted | Active. |
| [0036](0036-desktopworld-native-fidelity-and-local-effect-geometry.md) | Accepted | Active. |
| [0037](0037-stateful-native-height-field-programs.md) | Accepted | Active. |
| [0038](0038-desktopworld-renderkit-boundary.md) | Accepted | Active. |
| [0039](0039-pre-release-zero-installed-base-compatibility.md) | Accepted | Active. |
| [0040](0040-ambient-authority-raw-observation-and-target-handles.md) | Accepted | Active authority for ambient execution, raw observation, target handles, Gate, and Work Record boundaries. |
| [0041](0041-managed-playwright-companion-runtime.md) | Accepted | Owns the optional managed Playwright CLI runtime, safe public MVP, package lifecycle, and browser ownership boundary. |
| [0042](0042-host-and-gateway-move-to-sigil.md) | Proposed | Proposes moving the host and gateway packages to Sigil, contracting AOS package scope, and governing the paired retirement. |
