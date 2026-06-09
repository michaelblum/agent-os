# AOS Agent Runner M1 Read-Only Parity

Date: 2026-06-09

## Decision

AOS agents may now be preferred for bounded read-only provider-backed work for
`explorer`, `reviewer`, `validator`, and `historian`.

This does not mean full native Codex subagent supersession. Full supersession
still requires a patch-producing `implementer` path that does not directly
mutate the main checkout.

## Branch And Dependency Posture

- Branch: `foreman/aos-agents-m1-provider-readback-v0`
- M0 local landing point: `main` at `1f16c459`
- M1 readback commit before this report: `6b63f09a`
- Provider SDK unblock: ignored local venv under `.runtime/dev/aos-agents/.venv`
- Dependency decision: live-smoke-only local environment, not an optional dev
  dependency and not a repo-managed dependency policy

## Provider-Backed Runs

All four read-only roles completed provider execution and wrote both
`summary.json` and `result.json` under `.runtime/dev/aos-agents/runs/`.

| Role | Status | Summary | Result |
| --- | --- | --- | --- |
| `explorer` | `completed` | `.runtime/dev/aos-agents/runs/explorer/summarize-the-active-dock-profile-and-list-unres-4d428213ecac/summary.json` | `.runtime/dev/aos-agents/runs/explorer/summarize-the-active-dock-profile-and-list-unres-4d428213ecac/result.json` |
| `reviewer` | `completed` | `.runtime/dev/aos-agents/runs/reviewer/review-the-active-dock-profile-for-stale-source--e901cc28944f/summary.json` | `.runtime/dev/aos-agents/runs/reviewer/review-the-active-dock-profile-for-stale-source--e901cc28944f/result.json` |
| `validator` | `completed` | `.runtime/dev/aos-agents/runs/validator/validate-that-the-active-dock-profile-and-read-o-106054d28d95/summary.json` | `.runtime/dev/aos-agents/runs/validator/validate-that-the-active-dock-profile-and-read-o-106054d28d95/result.json` |
| `historian` | `completed` | `.runtime/dev/aos-agents/runs/historian/summarize-the-chronology-from-m0-scaffold-landin-5c2f2956dc25/summary.json` | `.runtime/dev/aos-agents/runs/historian/summarize-the-chronology-from-m0-scaffold-landin-5c2f2956dc25/result.json` |

## Result Readback

- `explorer`: summarized the active profile, local branch posture, passive
  runtime posture, foundation-breaking migration posture, and one-world
  workstream pointers.
- `reviewer`: found no direct blocker, but recommended tightening wording around
  passive readback scope and stale-source authority.
- `validator`: returned `pass` for active dock profile and read-only runner
  contract consistency.
- `historian`: produced the requested chronology shape, but self-reported low
  confidence because the provider run lacked source/thread/git retrieval
  context.

## Caveats

- `historian` is provider-backed and artifact-producing, but is not yet reliable
  for source-backed chronology without a retrieval surface or explicit source
  packet.
- The local venv proves M1 live smoke only. It does not settle long-term
  dependency policy.
- Runtime posture remains passive unless explicitly approved. The parity proof
  did not restart live AOS services.

## M2 Boundary

The next fast-track slice should design a patch-only `implementer` lane that
produces reviewable patch artifacts without directly mutating the main checkout.

Minimum M2 properties:

- `implementer` remains disabled from direct checkout mutation by default.
- Output is a patch/diff artifact under `.runtime/dev/aos-agents/runs/`.
- The artifact includes target branch/base commit, touched paths, and an apply
  command or review command.
- Foreman remains responsible for applying, reviewing, committing, and pushing.
- No nested agents, rich lifecycle, concurrency, or UI surfaces are required for
  the first patch-only proof.
