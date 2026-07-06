@../../AGENTS.md

# Agent Workspace Library

## Purpose

`scripts/lib/agent-workspace/` owns saved AOS perception workspaces: compact
saved captures, snapshot/ref/workspace readback, saved-ref action resolution,
backend validation, and local cleanup.

## Ownership

- `capture.mjs`, `store.mjs`, and `commands.mjs` own persisted workspace state,
  compact stdout/readback, atomic snapshot commits, and cleanup commands.
- `refs.mjs`, `contracts.mjs`, and `browser-ref-validation.mjs` own saved-ref
  conformance, backend action matrices, browser current-target validation, and
  saved-ref capability projections consumed by annotation surfaces.
- `ref-action-*.mjs` and `actions.mjs` own saved-ref grammar, resolution,
  dry-run envelopes, and dispatch wrappers.
- Native capability facts are produced by `src/`; public contract docs and
  schema stay in `shared/schemas/` and `docs/api/`.

## Local Contracts

- Compact command stdout and readback must not include heavy payload fields such
  as AX/browser element arrays, semantic target arrays, annotations,
  perceptions, screenshots, or base64. Keep heavy payloads file-backed under the
  saved snapshot directory.
- Saved refs must fail closed before mutation when confidence, backend,
  resolution class, action compatibility, current validation, or durable native
  identity is insufficient.
- Browser saved-ref mutation requires current page/frame/navigation and element
  validation. Canvas saved-ref mutation requires current canvas target
  resolution. Native AX saved-ref mutation is limited to durable direct-AX facts
  and keeps no-foreground proof approval-gated.
- Coordinate fallback refs are diagnostic/fallback-only and must be refused
  before dispatch.
- Workspace state is local control state, not Work Recording evidence storage.
  Preserve runtime-mode isolation and explicit cleanup acknowledgements.
- Workspace mutation locks must fail closed for live owners, reap dead-owner
  locks, and age out corrupt or ownerless lock directories through the
  `AOS_AGENT_WORKSPACE_STALE_LOCK_MS` threshold.

## Work Guidance

- Keep public behavior synchronized with `manifests/commands/aos-commands.json`,
  `shared/schemas/aos-agent-workspace-v0.*`, `docs/api/aos.md`, and
  `skills/aos-agent-workspace/SKILL.md`.
- Prefer extending the existing backend action matrix and shared test fixtures
  over adding one-off parser or dispatch branches.
- Do not move public command policy into Swift unless a native-boundary
  justification is explicit.

## Verification

- Run the focused saved-ref/readback test for the changed backend:
  `bash tests/agent-workspace-storage.sh`,
  `bash tests/agent-workspace-browser-refs.sh`,
  `bash tests/agent-workspace-canvas-refs.sh`, or
  `bash tests/agent-workspace-native-refs.sh`.
- For contract, schema, docs, skill, or manifest drift, run
  `bash tests/agent-workspace-contract-drift.sh`,
  `bash tests/help-contract.sh`, and
  `node --test tests/schemas/aos-external-command-manifest-v0.test.mjs`.
- Use `bash tests/agent-workspace-saved-ref.sh` as the aggregate deterministic
  suite before closeout when behavior spans multiple backends.

## Child DOX Index
