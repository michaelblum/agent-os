# App-Owned Runtime Context V0 Proof

Date: 2026-07-06

Status: passed for V0 read-only runtime context

## Scope

This proof covers GitHub issue #585: a compact, app-owned, read-only AOS
runtime context status surface that an agent can check before trusting
perception, annotation, saved-ref action, or evidence handoff state.

Public command:

```bash
./aos experience status <id> --json
```

The command home is `experience` because experience manifests already own
activation identity, content roots, status-item targets, mounted surfaces, and
menu projection. The status command reuses that ownership and does not add a
consumer-specific path.

## Run Authority

- HEAD at implementation start: `65a41a16`
- Branch: `main`
- Issue: <https://github.com/michaelblum/agent-os/issues/585>
- Binary rebuild: `false`
- Binary resign: `false`
- TCC reset: `false`

## Implemented Contract

`aos experience status <id> --json` emits
`schema_version:"aos.experience-runtime-context.v0"` and includes:

- requested and active experience identity;
- runtime mode, state root, mode-scoped state directory, config path, and
  pending annotation root;
- active and expected status-item target URL;
- mounted toggle surface id, URL, lifecycle, and drift status;
- mounted-surface menu projection status;
- declared/configured/live content root status;
- passive service and permission readiness from read-only command surfaces;
- pending annotation root, records, index, and lock status;
- diagnostics for active mismatch, status-item drift, mounted-surface drift,
  content-root drift, pending state, stale locks, service readiness, and
  permission blockers;
- capability summaries for perception, annotation, saved-ref action, and
  evidence handoff;
- structured `recommended_next[]` entries with argv arrays and
  `display_only:true` for placeholder hints.

`aos experience status --json` without an id remains the existing compact
active-experience readback.

## Deterministic Coverage

New focused test:

```bash
node --test tests/experience-runtime-context.test.mjs
```

The test uses a fake `aos` command and temp state roots. It covers:

- healthy `operator-fixture` context with active experience, current content
  root, current status-item target, mounted surface, menu projection,
  initialized pending annotation root, ready capabilities, and no
  recommendations;
- no mutation during status checks: only `service status`, `permissions check`,
  `content status`, and `show list` are called;
- cross-app isolation: Sigil active/status-item state does not satisfy
  `operator-fixture`;
- stale status-item target and stale mounted surface;
- missing live content root;
- uninitialized pending annotation state;
- corrupt pending annotation root;
- degraded service and missing permission readiness.

## Guarded Repo-Mode Proof

Current live Sigil context:

```bash
./aos experience status sigil --json
```

Observed summary:

- `status:"ok"`
- `active_experience.status:"current"`
- `content_roots.status:"current"`
- `status_item.target.status:"current"`
- `status_item.mounted_surface.status:"current"`
- `runtime.readiness.status:"ready"`
- `diagnostics:[]`
- `recommended_next:[]`

Current live `operator-fixture` context while Sigil is active:

```bash
./aos experience status operator-fixture --json
```

Observed summary:

- `status:"degraded"`
- `active_experience.status:"mismatch"`
- `status_item.target.status:"wrong_surface"`
- `status_item.mounted_surface.status:"missing"`
- `pending_annotations.status:"initialized"`
- `runtime.readiness.status:"ready"`
- diagnostics:
  - `active-experience-mismatch`
  - `status-item-target-drift`
  - `mounted-surface-drift`
- recommended next:
  `["./aos","experience","activate","operator-fixture","--json","--allow-start"]`

This proves the V0 command does not inherit Sigil runtime state as success for
another experience.

## Verification

All checks passed:

```bash
./aos help --json
./aos help experience --json
./aos help experience status --json
./aos ready --json
./aos permissions check --json
node --test tests/experience-runtime-context.test.mjs
node --test tests/schemas/*.test.mjs
bash tests/help-contract.sh
bash tests/external-command-dispatch.sh
node scripts/generate-command-manifests.mjs --check
bash tests/command-manifest-generation.sh
git diff --check
./aos dev build --no-restart --json
```

The final build gate returned:

- `binary_rebuilt:false`
- `binary_resigned:false`

Because no rebuild or re-sign occurred, no sound/TCC follow-up was required.

## Final Claim

Passed. AOS now has a productized, manifest-owned, read-only runtime context
status surface for app-owned experiences. It reports identity, isolation,
state roots, status-item and mounted-surface drift, content roots, pending
annotation state, passive readiness, permissions, capabilities, and exact next
commands without repairing or mutating runtime state.
