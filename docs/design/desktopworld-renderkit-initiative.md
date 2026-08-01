# DesktopWorld RenderKit Cross-Repository Initiative

- Status: Architecture baseline
- Updated: 2026-08-01
- Canonical owner: AOS platform architecture
- Consumer: `Ch-osctrl/sigil`

This is the single delivery ledger for the DesktopWorld RenderKit initiative.
ADRs own architectural decisions; merged source and exact validation artifacts
own implementation truth. Update this ledger in the PR that changes a milestone
state or dependency.

## Current Baseline

| Repository | State | Exact revision | Evidence |
| --- | --- | --- | --- |
| AOS | Cursor foundation merged | `a1be9198428eef4e8222b405ce009accfae01337` | PR [#724](https://github.com/michaelblum/agent-os/pull/724); phase-aware cursor presentation, emergency-exit restoration, static and Swift typecheck evidence |
| Sigil | Pin and product cursor integration in draft | `06632eaef918955fd1338f86b6919658031ededd` | PR [#83](https://github.com/Ch-osctrl/sigil/pull/83); both pins target AOS `a1be9198`, one preallocated hover visual, captured fast travel uses no cursor art |

The Sigil revision is a PR head, not a merge revision. Replace it with the
immutable merge commit when PR #83 closes.

## Architecture Authority

- [AOS ADR 0038: DesktopWorld RenderKit boundary](../adr/0038-desktopworld-renderkit-boundary.md)
- [Sigil ADR 0018: trusted RenderKit consumer boundary](https://github.com/Ch-osctrl/sigil/blob/main/docs/adr/0018-sigil-as-trusted-renderkit-consumer.md)
- Existing AOS ADRs 0029 through 0037 remain authority for trusted Three.js
  projection, desktop textures, native-effect programs, gesture lifetimes,
  fidelity, and stateful height fields until explicitly superseded.

## Milestones

| ID | Milestone | Dependency | State | Completion evidence |
| --- | --- | --- | --- | --- |
| RK-0 | Phase-aware cursor foundation | None | AOS merged; Sigil draft | AOS `a1be9198`; Sigil PR #83 `06632eae` |
| RK-1 | Durable architecture records | RK-0 AOS merge | In progress | AOS ADR 0038, Sigil ADR 0018, and this ledger merged and cross-linked |
| RK-2 | Existing-surface inventory | RK-1 | Pending | Three.js, native effects, capture, topology, damage, budgets, disposal, DevTools, docs, and skills classified as `reuse`, `generalize`, `replace`, or `retire` with file owners |
| RK-3 | Neutral implementation spike | RK-2 | Pending | Framework and execution-location comparison; one neutral effect; cross-display, capability, telemetry, failure, and 100-cycle disposal evidence |
| RK-4 | Public RenderKit contract V1 | RK-3 decision | Pending | Toolkit contract plus synchronized schema, neutral example, fake runtime, API docs, DevTools, skill, and generated help/manifests where applicable |
| RK-5 | Sigil Ripple adoption | RK-4 AOS merge and reviewed Sigil pin | Pending | Studio/DesktopWorld fixed-time parity, performance, cross-display, cancellation, and disposal proof |
| RK-6 | Sigil Wake adoption | RK-5 | Pending | Stateful route effect parity, gesture coordination, texture fidelity, and disposal proof |
| RK-7 | Sigil Wormhole adoption | RK-6 | Pending | Open/hold/commit/cancel lifecycle, cross-display composition, performance, and disposal proof |
| RK-8 | Consolidation | RK-5 through RK-7 | Pending | Superseded paths removed; one capture owner, one topology, one lifecycle, and no dormant product duplicate |

## Contract Slice Checklist

Every public RenderKit slice ships these together:

- toolkit export and type changes;
- contract or schema authority;
- neutral runnable example;
- deterministic fake-runtime coverage;
- API and lifecycle/error documentation;
- DevTools inspection and bounded resource evidence;
- `aos-desktop-world-authoring` guidance and references; and
- generated command help/manifests when the command surface changes.

Sigil consumes only a merged immutable AOS revision and updates both reviewed
pin locations together. AOS and Sigil implementation changes remain separate
PRs.

## Acceptance Invariants

- AOS remains the sole TCC, capture, physical-surface, input, and GPU-resource
  owner.
- One global DesktopWorld plane spans all displays; per-display native surfaces
  are implementation segments, not consumer coordinate systems.
- Product programs receive bounded toolkit capabilities, not raw pixel buffers,
  native handles, windows, event taps, or independent frame loops.
- Texture sampling and bounded image-product readback remain separately named
  capabilities over one capture infrastructure.
- Effect-only product changes do not require product vocabulary in AOS.
- All allocations and leases settle after cancellation, failure, replacement,
  context loss, and disposal.
- Native/TCC evidence remains a separate supervised lane; deterministic fake
  evidence is required before it.

Test-route design follows the foundational
[harness ladder](../../tests/README.md) and
[harness preparation guide](../guides/test-harness-ladder-and-prep.md). A new
native proof cannot substitute for a lower deterministic layer that can own the
same assertion.

## Spike Decisions Still Open

| Decision | Required comparison |
| --- | --- |
| Native implementation | Raw Metal versus RealityKit versus selected maintained or vendored Satin-derived components |
| Execution location | Trusted in-process renderer extension versus an AOS-owned helper process |
| Program form | Native Swift ABI versus bounded MSL/IR/WASM-assisted package forms |
| Capability vocabulary | Texture sampling, pixel readback, image products, inference, Accessibility, input observation, and event posting scopes |

These rows are not permission to implement competing permanent paths. The
neutral spike records measurements and selects one route before the public ABI
stabilizes.

## Named Deferrals

- Untrusted or community executable native extensions.
- General-purpose DCC or shader-editor tooling.
- Arbitrary consumer filesystem, network, process, TCC, raw Metal-handle, or
  pixel-buffer access.
- Automatic installation of AOS skills into Codex or Claude environments.
- Release signing, notarization, and production TCC attribution.
- New product effects beyond Ripple, Wake, and Wormhole until the first three
  adoption milestones close.

## Update Record

| Date | Change | AOS revision | Sigil revision |
| --- | --- | --- | --- |
| 2026-08-01 | Established architecture baseline after phase-aware cursor merge and Sigil pin/cursor integration | `a1be9198428eef4e8222b405ce009accfae01337` | `06632eaef918955fd1338f86b6919658031ededd` (PR head) |
