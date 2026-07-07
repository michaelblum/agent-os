# AOS Installable Skills Forward Proof V0

Date: 2026-07-07

## Scope

This is the deterministic M7 proof for installable AOS root skills. It does not
write to the user's real skill tree and does not mutate live UI or browser
state.

## Evidence

- Fixture: `tests/fixtures/aos-skills/cold-agent-forward-proof-v0.json`
- Deterministic check: `node --test tests/aos-skills-forward-proof.test.mjs`
- Install target model: `aos skills install --target path --path <temp-dir>`

## Covered Cold-Agent Tasks

- Install AOS skills into a temp target, then choose `ready`, `status`, or
  `doctor`.
- Inventory desktop/app/window/native AX controls through the capability map and
  stop on unsupported semantic desktop verbs.
- Use saved workspaces to capture, inspect refs, dry-run, act once only when
  authorized, and recapture.
- Use canvas/vision fallback with regions, xray, labels, canvas refs, and
  coordinate provenance.
- Use focus channels as explicit AOS sessions and clean up stale channels.
- Use AOS browser saved refs for durable proof and upstream Playwright CLI
  skills only for unwrapped browser escape hatches.
- Use recapture, refs diff/expect, gates, and Work Records for verification.
- Read a pending annotation before consuming it and explain the safe next
  action.
- Inspect a Work Record through read, verify, status, and report-only recovery
  planning.
- Explain or dry-run an executable recipe without confusing it with a skill,
  guide, playbook, or generic workflow.

## Result

The fixture records prompts, selected skills, selected direct commands,
captured expected outputs, stop conditions, and rejected competing surfaces. The
test asserts the ten required scenarios, temp-target-only installation, direct
`./aos` command use, no project-local wrapper facades, full desktop skill-pack
coverage, and the AOS/Playwright browser boundary.
