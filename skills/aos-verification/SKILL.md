---
name: aos-verification
description: Use AOS recapture, ref diff, gates, and Work Records for desktop proof. Trigger when a task needs an act-recapture-verify loop, refs diff/expect, diagnostics evidence, durable evidence, or a stop decision on stale targets.
---

# AOS Verification

Use this skill to make desktop proof concrete without reading the full Work
Record schema first.

## Loop

1. Gate readiness with `./aos ready --json` or passive `./aos status --json`.
2. Capture with `./aos see capture ... --save --workspace <id> --mode som`.
3. Inspect refs with `./aos see refs --workspace <id> --json`.
4. Dry-run the selected action when supported.
5. Act once only when the dry-run validates the current target.
6. Recapture into the same workspace.
7. Compare compact refs with
   `./aos see refs --diff <before>..<after> --expect change|no-change --json`.
8. Use Work Record read/verify/status/plan-repair when durable evidence or
   recovery guidance is required.

## Evidence Choices

- Use ref diffs for compact UI state checks.
- Use visible artifacts when the proof is visual and refs are insufficient.
- Use `./aos daemon-snapshot`, `./aos service logs --tail N`, command JSON,
  and structured errors for diagnostic readback; those are not durable UI-state
  assertions by themselves.
- Use `./aos log` only when you want the display log console/overlay surface.
- Use gates when human authorization is required.
- Use Work Records for durable evidence, verifier status, postconditions,
  exports, and handoff bundles.
- Treat evidence exports and Work Record repair bundles as handoff/readback
  artifacts, not replay engines.

## Diagnostics Trace

There is no current public `aos trace`, `aos verify`, `aos assert`, or
Playwright-style video command. Build the proof trail from current commands:
readiness/status, saved before/action/after captures, action envelopes,
refs diff/expect gates, diagnostic readbacks, gate records, and Work Records.

## Stop

Stop on stale identity, missing permissions, fallback-only refs, unsupported
actions, known native limits, command recommendations that require recapture, or
live proof that would mutate UI/TCC/native state without authorization.

## References

- `docs/api/aos-capabilities.md`
- `docs/api/aos.md`
- `tests/aos-skills-forward-proof.test.mjs`
- `tests/toolkit/work-record-verifier.test.mjs`
