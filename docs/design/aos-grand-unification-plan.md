# AOS Grand Unification Plan — Retired Lineage

**Status:** retired May 2026 implementation lineage; not the current roadmap,
public API, or implementation dispatch
**Retired:** 2026-08-09

This path is retained so accepted ADRs, frozen fixtures, and historical links do
not break. The former phase plan remains available in Git history, but its phase
ordering, commands, schemas, and “next” work must not be used to dispatch a new
agent session.

## Current Authority

Use the narrowest current owner instead:

1. `AGENTS.md`, `docs/adr/README.md`, and accepted ADRs own architecture and
   authority boundaries.
2. `docs/adr/0040-ambient-authority-raw-observation-and-target-handles.md`
   owns ambient authority, fidelity-first observation, Target Handle Runtime
   V1, Gate, and optional Work Record boundaries.
3. `docs/api/aos.md` and `docs/api/aos-capabilities.md` own consumer-facing
   behavior and the explicit current-gap ledger.
4. Source command manifests and their generated artifacts own exact callable
   command truth.
5. Active V1 schemas under `shared/schemas/` own Work Record and Step
   Descriptor contracts; their V0 predecessors are frozen historical bytes.
6. A current scoped work card may dispatch one bounded gap, but it does not
   supersede an ADR, API contract, source manifest, or schema.

## Durable Decisions Promoted Elsewhere

The useful decisions from the former plan now have stronger owners:

- the AOS Execution Model is owned by ADR 0013;
- Subjects, Layers, Facets, Hosts, and Subject Browser semantics are owned by
  ADRs 0001 and 0005–0012 plus the active workbench schema/API;
- browser capture is a projection of the execution model, not another taxonomy;
- Work Record V1 is optional neutral evidence/history and Step Descriptor V1 is
  neutral caller-selected harness input;
- Target Handle Runtime V1 distinguishes stale-rejecting Observation Refs from
  re-resolving Locators;
- AOS-native runtime and diagnostic surfaces remain AOS-native while external
  products own product meaning and acceptance.

Do not restore the retired phase plan to resolve a disagreement. Repair the
stronger owner directly, add a drift test where the convention is mechanical,
and delete competing guidance once its durable requirements are promoted.
