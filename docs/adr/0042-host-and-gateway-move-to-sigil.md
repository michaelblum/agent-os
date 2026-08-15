# ADR 0042: Host And Gateway Move To Sigil

**Status:** Proposed
**Date:** 2026-08-14
**Amends:** ADR 0019's project-agent orchestration scope and ADR 0021's
Sigil/AOS repository boundary
**Governed by:** ADR 0015's capability-broker boundary and ADR 0039's
zero-installed-base compatibility policy
**Paired with:** Sigil ADR 0019

## Context

ADR 0015 assigns privileged native facts, actions, streams, and stable IPC
primitives to AOS while assigning orchestration and product policy to external
composition. ADR 0019 excludes project-agent launchers, registries, and runner
surfaces from AOS core. ADR 0021 makes Sigil the first-party reference consumer
and keeps the reusable toolkit versioned with AOS.

Two current packages sit on the wrong side of those boundaries:

- `packages/host/` is a model-driving agent runtime with sessions, tools,
  provider adaptation, telemetry, and a Unix-socket SDK.
- `packages/gateway/` contains an MCP server and a Slack integration broker
  with workflow registration, durable jobs, and a local snapshot API.

The packages are not independently movable. The gateway serves the host SDK
socket through `packages/gateway/src/sdk-socket.ts`, and the public doctor
surface reaches the gateway through
`manifests/commands/source/external/39-doctor-gateway.json` and the hook in
`manifests/commands/source/aos/25-doctor.json`. Their ownership and retirement
must therefore move as one paired cross-repository change.

## Decision

### Host And Gateway Move Together

`packages/host/` and `packages/gateway/` move from `agent-os` to Sigil in one
paired change. Sigil owns their successor concerns as part of its unprivileged
orchestration hub:

- the host kernel converges with Sigil's run runtime rather than remaining a
  second agent loop;
- the Slack broker becomes Sigil ingress backed by Sigil's run persistence;
  and
- the gateway MCP server, if retained, becomes a Sigil hub ingress rather than
  an AOS package.

The paired migration must explicitly retain that MCP server as Sigil ingress
or delete it. It cannot remain in AOS or become an unowned residue of the
gateway move.

The move transfers ownership; it does not preserve an AOS-hosted forwarding
layer, compatibility wrapper, or duplicate runtime.

### AOS Package Scope Contracts

After the move, the durable package scope in `agent-os` is limited to
capability-layer concerns:

- `packages/toolkit/`, the surface SDK versioned with the daemon and public AOS
  contracts;
- `packages/design-tokens/`; and
- thin packaging roots such as `packages/cli/` and `packages/daemon/`.

The managed Playwright companion, native projection hosts, recipe execution
unit, installable operational skills, and wiki remain AOS capability-layer
surfaces under their existing owners. Model routing, workflow orchestration,
ingress policy, approvals, retries, budgets, product memory, and product run
state do not move into those packages.

This contracts the repository to ADR 0015's low-churn, policy-free capability
broker boundary. It also clarifies ADR 0021: the toolkit stays with AOS, while
the product-orchestration packages belong with Sigil.

### Supersession Audit

The migration applies a superseded-consumer test, not a simple reachability
test: if Sigil replaces the only product consumer, the AOS shard is deleted
rather than moved or adapted.

- `packages/toolkit/components/agent-terminal/` is deleted with the host move.
  Sigil's runs, conversations, and artifacts are its successor; its direct
  import of host session telemetry is evidence that it is not a reusable
  toolkit primitive.
- `packages/toolkit/components/integration-hub/` is deleted with the gateway.
  A future broker dashboard is a Sigil product surface over hub APIs.
- Remaining stock toolkit components, including `log-console`, `test-console`,
  `aos-action-demo`, `visual-object-live-proof`, and the workbench family, are
  audited in the same implementation change. A component remains only when it
  is reusable surface machinery rather than residue of the superseded
  agent-session or gateway experience.

The same audit retires current, non-authoritative scaffolding whose consumer or
premise is superseded: `docs/design/agent-capability-manifest-v0.md`,
`docs/design/remote-session-control.md`, gateway coupling in the named active
design docs, and `memory/scratchpad/`. Current requirements must first move to
their proper owner; no compatibility marker is retained for discoverability.

### Deletion Ledger

The AOS half of the paired implementation is not complete until all current
authority in this ledger has converged.

| Surface | Required retirement |
| --- | --- |
| Packages | Delete `packages/host/` and `packages/gateway/`, including gateway engine, integrations, tools, socket SDK, singleton, and package-local tests. |
| Command manifests | Delete `manifests/commands/source/external/39-doctor-gateway.json`; remove gateway entries from `manifests/commands/aos-external-commands.json` and `manifests/commands/aos-commands.json`; remove the gateway hook from `manifests/commands/source/aos/25-doctor.json`. |
| Repository tests | Delete `tests/gateway-sdk-socket-lifecycle.test.mjs`, `tests/gateway-script-registry-paths.test.mjs`, `tests/gateway-target-handle-projection.test.mjs`, `tests/gateway/user-signal-surface.test.mjs`, and `tests/doctor-gateway.sh`; remove host/gateway cases from `tests/active-authority-pointers.test.mjs`, `tests/legacy-sigil-fixture.test.mjs`, `tests/dev-workflow-router.sh`, and `tests/agent-workspace-contract-drift.sh`. |
| Active docs and rosters | Delete `docs/api/integration-broker.md` and `wiki-seed/entities/gateway.md`; remove the API index entry, the Integration Hub entry in `docs/api/toolkit/components.md`, current host/gateway rows in `ARCHITECTURE.md` and `README.md`, the adapter-surface entry in `CONTEXT-MAP.md`, package ownership and child-index entries in `packages/AGENTS.md`, stale compatibility/test guidance such as `src/CLAUDE.md`, and affected test roster rows in `tests/README.md`. |
| Developer configuration | Remove host/gateway ownership from `docs/dev/workflow-rules.json` and `docs/dev/test-proof-registry.d/agent-workspace.json`. |
| Frozen history | Leave `docs/archive/**` and `docs/dev/reports/**` untouched. They remain dated, non-authoritative history. |

Generated aggregate manifests change only as output of their existing source
owner and generator. The implementation change updates `CONTEXT.md`,
`ARCHITECTURE.md`, `README.md`, applicable DOX, API indexes, and current package
rosters in the same commit sequence; those files are deliberately not changed
by this decision-record-only proposal.

### Paired-Change Mechanics

ADR 0021's reviewed-pin boundary makes the migration one atomic pair:

1. The AOS deletion commit removes the packages and every current AOS-owned
   manifest, test, documentation, roster, and developer-config reference in
   the ledger.
2. Existing Sigil remains valid while it is pinned to the pre-deletion AOS
   revision.
3. Sigil absorbs the moved code at the new AOS revision, updates both sides of
   its reviewed pin, rebases retained ingress on Sigil runs, and deletes
   adapter allowlist entries for removed AOS commands.
4. Sigil acceptance proves the new pin and the converged runtime before the
   pair is considered landed.

There is no supported intermediate state in which Sigil's allowlist references
an AOS command removed at its reviewed pin, or an AOS manifest references a
package already moved to Sigil. Branch and merge ordering must preserve that
invariant.

### Definition Of Done

The paired implementation is complete only when all of the following hold:

- the deletion ledger and supersession audit are complete;
- current AOS authority has no live reference to the retired packages or
  components, proven by a zero-hit check that excludes only frozen history and
  this ADR;
- AOS readiness, doctor, the full test suite, and help/manifest snapshot checks
  are green after the deletion;
- Sigil acceptance is green at the exact new AOS pin; and
- `CONTEXT.md`, `CONTEXT-MAP.md`, `ARCHITECTURE.md`, `README.md`, applicable
  DOX and compatibility pointers, and the wiki seed describe only the
  resulting ownership boundary.

Implementation proof follows the foundational harness ladder in
[`tests/README.md`](../../tests/README.md) and
[`docs/guides/test-harness-ladder-and-prep.md`](../guides/test-harness-ladder-and-prep.md);
this ADR does not authorize a live or permission-gated lane.

The zero-hit check is:

```bash
grep_status=0
hits="$(
  git grep -nE \
    '@agent-os/(host|gateway)|packages/(host|gateway)|integration-broker|agent-terminal|integration-hub' \
    -- . \
    ':(exclude)docs/archive/**' \
    ':(exclude)docs/dev/reports/**' \
    ':(exclude)docs/adr/0042-host-and-gateway-move-to-sigil.md'
)" || grep_status=$?
case "$grep_status" in
  0) printf '%s\n' "$hits" >&2; exit 1 ;;
  1) test -z "$hits" ;;
  *) exit "$grep_status" ;;
esac
```

ADR 0039 is the basis for deleting superseded implementation in the same
change. Git and this ADR preserve the decision history; no live tombstone,
alias, dual-read path, or compatibility shim substitutes for deletion.

## Non-Goals

- This ADR does not perform the package move or any item in the deletion
  ledger.
- This ADR does not move the toolkit, design tokens, recipe runner, managed
  Playwright companion, projection plane, operational skills, or wiki to
  Sigil.
- This ADR does not define Sigil's model, capability, or workflow router
  contracts; the paired Sigil ADR owns those decisions.
- This ADR does not create a compatibility period or a separate toolkit
  repository.

## Consequences

- If accepted, ADR 0019 explicitly excludes the host and gateway package
  concerns as orchestration rather than treating their current location as an
  exception.
- If accepted, ADR 0021 keeps the toolkit in AOS while assigning host and
  gateway successors to Sigil.
- The implementation is larger than a file move because current command,
  test, documentation, and configuration authority must disappear atomically.
- Frozen reports and archives may retain historical names, but current
  greppable authority must describe the resulting ownership truth.

## Verification

This proposal changes only the ADR and ADR index:

```bash
git diff --check
```

The definition-of-done commands above belong to the later paired
implementation, not this ADR-only change.
