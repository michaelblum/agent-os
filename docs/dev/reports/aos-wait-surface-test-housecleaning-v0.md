# AOS Wait And Surface Test Housecleaning V0

Date: 2026-07-09

## Summary

This report classifies the current AOS wait/surface proof set after the Sigil
toolkit extraction. The goal is to keep AOS aligned with the Playwright-like
desktop contract: explicit targets, saved refs for behavior proof, bounded
readiness waits, canonical content roots by default, and guarded live proof for
runtime surfaces.

Do not use this report to delete tests blindly. Use it as the first pass for a
follow-up cleanup commit: delete only after the replacement proof named here is
green and routed by `node scripts/aos-dev-workflow.mjs recommend`.

## Keep As Canonical Contract

- `tests/show-wait-timeout-boundary.test.mjs`: owns bounded `show wait`
  timeout behavior and structured pending-condition JSON.
- `tests/content-wait.sh`: owns content-root readiness, unknown-argument
  parsing, missing-root timeout shape, and explicit autostart behavior.
- `tests/agent-os-worktree-runtime-policy.sh`: owns the default-runtime linked
  worktree guard for `content`, `show`, and `service`.
- `tests/guarded-live-operation.sh`: owns live-start permission failures for
  `content wait`, `show wait`, `launch`, and `experience activate`.
- `tests/ready-stale-daemon-hygiene.sh`: owns stale daemon classification
  across `ready`, `status`, `doctor`, and `clean`.

## Keep As Surface Smoke

These launchers catch browser/WebView import and content-root defects that
Node-only tests miss. Keep them as focused live smoke, not broad default gates:

- `packages/toolkit/components/surface-inspector/launch.sh`
- `packages/toolkit/components/wiki-subject-browser/launch.sh`
- `packages/toolkit/components/step-descriptor-workbench/launch.sh`
- `packages/toolkit/components/artifact-bundle-workbench/launch.sh`
- `packages/toolkit/components/work-record-workbench/launch.sh`

## Migrate Before Deleting

- Shell tests that layer fixed sleeps around `show wait` should move the wait
  into shared helpers or replace it with an AOS-observed predicate. Start with
  `tests/lib/visual-harness.sh`, `tests/lib/sigil/visual-harness.sh`, and
  `tests/lib/real-input-surface-harness.sh`.
- Fixed sleeps that model input dwell or OS delivery are temporary escape
  hatches. Keep them only in named guarded helpers until AOS exposes a
  readiness, lifecycle, semantic-target, input-region, saved-ref, or Work Record
  observation that can replace them.
- Component launchers that use repeated `show wait` blocks should either keep
  those waits as readiness checks or move behavior proof into saved-ref
  capture/diff tests.
- Any test using branch-scoped content roots must prove an explicit isolated
  `AOS_STATE_ROOT`. Default repo-runtime tests must use canonical `repo`,
  `sigil`, and `toolkit` roots.

## Quarantine As Guarded Live

These tests should not be part of broad default loops because they depend on
real input, permissions, user idle state, or the shared repo daemon:

- `tests/scenarios/sigil/radial-menu/real-input.sh`
- `tests/scenarios/sigil/radial-menu/real-input-desktop-world-path.sh`
- `tests/sigil-real-input-status-avatar.sh`
- `tests/sigil-avatar-controls-real-input.sh`
- `tests/manual/cross-backend-saved-ref-regression-proof.sh`
- `tests/manual/native-ax-saved-ref-live-proof.sh`

## Delete Candidates

Do not delete in this pass. Candidates must first meet all criteria:

- covered by a deterministic unit/schema contract and one canonical live smoke;
- not returned by `node scripts/aos-dev-workflow.mjs recommend --json --paths <changed paths>`;
- not referenced by docs, manifests, or launch scripts;
- not preserving a defect variable named in
  `docs/guides/test-harness-ladder-and-prep.md`.

## Current Decision

Keep the existing live proof family, add structured wait/root contract coverage,
and defer deletion until a follow-up commit can prove specific duplicate tests
are no longer routed or uniquely valuable.
