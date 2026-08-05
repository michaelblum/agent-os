---
name: aos-verification
description: Use AOS recapture, ref expectations, and optional Work Records for desktop proof. Trigger when a task needs an act-recapture-verify loop, refs diff/expect, diagnostic evidence, durable evidence, or typed stale-target handling.
---

# AOS Verification

Use this skill to make desktop proof concrete without reading the full Work
Record schema first.

## Loop

1. Check readiness with `./aos ready --json` or passive `./aos status --json`.
2. Capture with `./aos see capture ... --save --workspace <id> --mode som`.
3. Inspect refs with `./aos see refs --workspace <id> --json`.
4. Resolve exact current identity; use dry-run only when an optional preview is useful.
5. Act once and handle typed stale, missing, ambiguous, or unsupported results.
6. Recapture into the same workspace.
7. Compare compact refs with
   `./aos see refs --diff <before>..<after> --expect change|no-change --json`.
8. When exact raster evidence matters, compare two already-captured same-size
   PNG artifacts with
   `./aos see compare <before.png> <after.png> [--pixel-tolerance <0..255>] [--expect change|no-change]`.
9. Optionally use Work Record read/verify/status/plan-repair when durable evidence or
   recovery guidance is required.

## Evidence Choices

- Use ref diffs for compact UI state checks.
- Use `see compare` for exact RGBA change checks when visible PNG artifacts are
  the evidence and refs are insufficient. It compares existing files only; it
  does not capture, crop, resize, poll, wait, or produce a diff image.
- Use `./aos daemon-snapshot`, `./aos service logs --tail N`, command JSON,
  and structured errors for diagnostic readback; those are not durable UI-state
  assertions by themselves.
- Use `./aos log` only when you want the display log console/overlay surface.
- Use Gate only when the caller explicitly requests structured human input; a
  Gate does not authorize unrelated actions.
- Optionally use Work Records for durable evidence, verifier status, postconditions,
  exports, and handoff bundles.
- Treat evidence exports and Work Record repair bundles as handoff/readback
  artifacts, not replay engines.

## Diagnostics Trace

There is no current public `aos trace`, `aos verify`, `aos assert`, or
Playwright-style video command. Build the proof trail from current commands:
readiness/status, saved before/action/after captures, action envelopes,
refs diff/expect gates, PNG comparison JSON, diagnostic readbacks, gate records,
and optional Work Records.

## Stop

Stop on stale identity, OS-denied permissions, fallback-only current handles,
unsupported actions, known native limits, or command recommendations that
require recapture. Keep live proof inside the caller's requested scope. After a
real repo-mode `./aos` rebuild, stop until the user resets/regrants TCC and
`./aos ready --repair --post-permission` is green.

## References

- `docs/api/aos-capabilities.md`
- `docs/api/aos.md`
- `docs/adr/0040-ambient-authority-raw-observation-and-target-handles.md`
- `tests/aos-skills-forward-proof.test.mjs`
- `tests/toolkit/work-record-verifier.test.mjs`
