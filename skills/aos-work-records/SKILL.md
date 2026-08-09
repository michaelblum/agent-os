---
name: aos-work-records
description: Use AOS Work Record commands for evidence, verification, recovery guidance, repair planning, and report-only status. Trigger when an agent needs to inspect a Work Record, verify it, plan repair, link evidence, or avoid changing repair/finalization semantics.
---

# AOS Work Records

Use Work Records as optional durable receipts and recovery inputs. They are not
skills, recipes, generic workflow notes, or permission grants.

## Start

1. Inspect the current command manifest or `aos help work-record --json` before
   using subcommands when the caller requested that runtime lane.
2. Prefer list, read, verify, and status before any repair or replacement path.
3. Treat report-only verifier output and recovery guidance as evidence.
4. Use dry-run forms as optional non-mutating previews for repair, attempt, and
   replacement surfaces when useful.

## Boundaries

- Do not change repair, attempt, replacement, or finalization semantics from a
  skill.
- Keep repair or replacement writes inside the caller's requested scope.
- Preserve source ids, raw paths, artifacts, and verifier reports.
- Treat Repair Plans and Attempt Plans as non-executing source-bound proposals.
  `ready` means inputs are complete; it is not permission.
- Attempt Artifacts accept caller-supplied outcomes and must preserve exact plan,
  evidence, timing, cleanup, rollback, verifier-after, and source-digest proof.
  Success requires one exact source-bound payload/digest outcome for every
  planned candidate patch; Proposal and Writer project/copy it without applying
  it or synthesizing observations.
- Historical V0 bytes remain unchanged but are unsupported by active readers.

## Stop

Stop when a Work Record is corrupt, superseded, missing required artifacts, or
the requested recovery cannot satisfy its current mechanical inputs. Keep live
UI/browser/native work inside the caller's requested scope.

## Repair Recovery

- `aos work-record repair guide ... --json` returns non-executing recovery
  guidance with stage, blockers, `recovery_summary`, and exact next command
  descriptors.
- `aos work-record repair bundle ... --output-root <dir> --json` writes a
  bounded handoff bundle only under the explicit output root; dry-run writes
  nothing and the bundle is not a repair executor, replay engine, finalizer, or
  source-record mutator.
- `aos work-record repair bundle status ... --json` is read-only lifecycle
  scanning for explicit bundle roots or immediate bundle-parent children.
- `aos work-record repair bundle inspect <bundle-root> --json` is read-only
  validation of one explicit bundle root and does not execute repair, finalize,
  replace, supersede, or touch live UI/TCC surfaces.

## References

- `docs/api/aos.md`
- `docs/adr/0040-ambient-authority-raw-observation-and-target-handles.md`
- `manifests/commands/source/aos/35-work-record.json`
- `tests/schemas/aos-work-record-v1.test.mjs`
- `tests/toolkit/work-record-recovery-acceptance.test.mjs`
