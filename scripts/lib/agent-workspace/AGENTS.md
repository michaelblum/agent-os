@../../AGENTS.md

# Agent Workspace Library

## Purpose

`scripts/lib/agent-workspace/` owns saved AOS perception workspaces: compact
saved captures, snapshot/ref/workspace readback, saved-ref action resolution,
typed Target Handle validation, and local cleanup.

## Ownership

- `capture.mjs`, `store.mjs`, and `commands.mjs` own persisted workspace state,
  compact stdout/readback, atomic snapshot commits, and cleanup commands.
- Saved native capture must use
  `../aos-see-supervision.mjs` so owner, wrapper, or guardian loss retires the
  exact native process group without weakening synchronous workspace locking.
- `refs.mjs` and `contracts.mjs` own V1 saved-handle production, backend action
  matrices, and capability projections consumed by annotation surfaces.
- `../target-handle-runtime.mjs` owns the bounded browser capture-generation
  record and original Observation Ref pair validation.
- `ref-action-*.mjs` and `actions.mjs` own saved-ref grammar, resolution,
  dry-run envelopes, and dispatch wrappers.
- Native capability facts are produced by `src/`; public contract docs and
  schema stay in `shared/schemas/` and `docs/api/`.

## Local Contracts

- V1 saved refs are storage indirection to exactly one required discriminated
  handle. Browser handles are Observation Refs; canvas and native AX handles
  are Locators. No resolution class, bare ref shorthand, coordinate fallback,
  or alternate action target may re-enter active records.
- Compact command stdout and readback must not include heavy payload fields such
  as AX/browser element arrays, semantic target arrays, annotations,
  perceptions, screenshots, or base64. Keep heavy payloads file-backed under the
  saved snapshot directory.
- Explicit saved `--region` and bounds-only saved `--interactive` captures are
  the narrow exceptions for the closed, non-heavy `display_topology` mapping:
  compact stdout must preserve the exact native capture value and fail closed
  if it is missing, without observing displays or creating another capture
  path.
- Browser capture generations bind a path-free managed backend identity V2:
  descriptor, closure, entrypoint, and random session generation. Browser
  saved-handle actions remain outside the managed operation surface and fail
  closed before backend dispatch. They must never capture, search, reacquire,
  substitute state, or probe-then-act.
- Canvas and native AX Locators re-resolve at action time. Zero, multiple, and
  non-unique-near results fail with typed target errors; only explicit native
  `index` may choose one match deterministically.
- V0 files remain unchanged historical bytes and active readers reject them
  with `AGENT_WORKSPACE_SCHEMA_UNSUPPORTED` and a recapture requirement.
- Workspace state is local control state, not Work Recording evidence storage.
  Preserve runtime-mode isolation and explicit cleanup acknowledgements.
- Workspace mutation locks must fail closed for live owners, reap dead-owner
  locks, and age out corrupt or ownerless lock directories through the
  `AOS_AGENT_WORKSPACE_STALE_LOCK_MS` threshold.

## Work Guidance

- Keep public behavior synchronized with `manifests/commands/aos-commands.json`,
  `shared/schemas/aos-agent-workspace-v1.*`,
  `shared/schemas/aos-target-handle-v1.*`, `docs/api/aos.md`,
  `docs/api/aos-capabilities.md`, and the current narrow installable skills:
  `skills/aos-saved-workspace/SKILL.md`,
  `skills/aos-canvas-vision/SKILL.md`,
  `skills/aos-desktop/SKILL.md`,
  `skills/aos-focus-sessions/SKILL.md`, and
  `skills/aos-verification/SKILL.md`.
- Preserve the two-type handle union when extending backend action matrices.
- Do not move public command policy into Swift unless a native-boundary
  justification is explicit.

## Verification

- Run `node --test tests/target-handle-runtime.test.mjs` and
  `node --test tests/agent-workspace-v1.test.mjs tests/agent-workspace-v1-actions.test.mjs`
  for handle/storage changes.
- Run `bash tests/native-target-locator-selection.sh` for canvas/native
  exact-one selection changes.
- For contract, schema, docs, skill, or manifest drift, run
  `bash tests/agent-workspace-contract-drift.sh`,
  `bash tests/help-contract.sh`, and
  `node --test tests/schemas/aos-external-command-manifest-v0.test.mjs tests/schemas/aos-external-command-manifest-v1.test.mjs`.

## Child DOX Index
