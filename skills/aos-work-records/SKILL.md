---
name: aos-work-records
description: Use AOS Work Record commands for evidence, verification, recovery guidance, repair planning, and report-only status. Trigger when an agent needs to inspect a Work Record, verify it, plan repair, link evidence, or avoid changing repair/finalization semantics.
---

# AOS Work Records

Use Work Records as durable receipts and recovery inputs. They are not skills,
recipes, or generic workflow notes.

## Start

1. Inspect `./aos help work-record --json` before using subcommands.
2. Prefer list, read, verify, and status before any repair or replacement path.
3. Treat report-only verifier output and recovery guidance as evidence.
4. Use dry-run forms for repair, attempt, and replacement surfaces when they
   exist.

## Boundaries

- Do not change repair, attempt, replacement, or finalization semantics from a
  skill.
- Do not execute repair or write replacement records unless the task explicitly
  authorizes that side effect.
- Preserve source ids, raw paths, artifacts, and verifier reports.

## Stop

Stop when a Work Record is corrupt, superseded, missing authorization, missing
artifacts, or requires live UI/browser/native actions not authorized by the
task.

## References

- `docs/api/aos.md`
- `manifests/commands/source/aos/35-work-record.json`
- `tests/design/aos-work-record-fixtures.test.mjs`
