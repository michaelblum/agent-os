# AOS Orchestration Retirement Audit

**Date:** 2026-08-14
**Authority:** ADR 0042 and Sigil dispatch Hub 004
**Deletion base:** `12629d1adb6ad2e915556ed5ecae2381c340e37b`

## Scope Classification

- Delete every package, command, test, document, seed, schema, and product
  fixture shard named by ADR 0042's retirement ledger and superseded-consumer
  audit.
- Retain the capability-layer package boundary: toolkit, design tokens, and
  thin CLI/daemon roots.
- Retain the managed browser companion, native projection hosts, recipe
  execution, operational skills, wiki, and product-neutral Work Record
  machinery.
- Retain the maintained developer capability-manifest system because current
  maintainer routing and GitHub-helper consumers use it independently of the
  retired product orchestration packages.
- Leave `docs/archive/**` and `docs/dev/reports/**` byte-for-byte unchanged.

The complete stock toolkit component classification is maintained in
[`docs/api/toolkit/components.md`](../api/toolkit/components.md#stock-component-retention-audit).
Every surviving stock unit is classified `Retain` with its product-neutral
responsibility.

## Orphan Dispositions

| Unit | Disposition | Reason |
| --- | --- | --- |
| Runtime resource forensics report, capture helper, and fixture tree | Delete | The report is self-labeled historical but lives under active design authority. Seven immutable captured snapshots contain a retired product surface; rewriting evidence would be invalid, partial deletion would strand the report and its sole-purpose helper, and moving the unit into frozen history is outside this change. |
| Legacy low-poly tablet model asset unit | Delete | It is referenced only by the retired fixture radial item and its fixture inventory, so no reusable or maintained consumer remains. |
| Provider session catalog and session telemetry schema units | Delete | Their only live consumers were retired in this change; keeping unused schemas would preserve orchestration vocabulary without an AOS capability-layer owner. |
| Integration broker snapshot schema unit | Delete | Its sole producer and sole stock view are retired together, leaving no maintained consumer. |
| Command capability inventory generator | Delete | Its only output is a report inside the frozen `docs/dev/reports/` history boundary; current authority remains the source manifests and two generated command aggregates. |
| Gateway SDK and script-registry design-document unit | Delete | The two design sketches describe a gateway-era SDK and saved-script registry without a retained capability-layer implementation or current owner. |
| Four gateway-only Gate subprocess-adapter error constants | Delete | Their only consumer was the retired gateway adapter; the retained CLI-owned Gate service uses the remaining request, receptor, presentation, and record error codes. |
| Frozen legacy product fixture | Rebaseline | Remove only the superseded product shards, then refresh its deterministic path inventory and digest while preserving the generic substrate fixture. |

## Execution Caps And Gates

This PR is limited to static implementation. It does not authorize `./aos`, a
build, restart, install, doctor, readiness, native/TCC work, live provider work,
or any Sigil mutation. The first review freeze is a non-Git structural
checkpoint; no partial commit is created before the approved static gates run.

Proposed static acceptance is the complete changed-path router output, every
applicable deterministic command it returns, source-owned command-manifest
generation and drift proof, schema/dispatch/help/workflow/proof-registry checks,
focused affected tests, ADR 0042's exact tracked-file zero-hit command, and
`git diff --check`.
