@../AGENTS.md

# Scripts

## Purpose

`scripts/` contains executable repo tooling behind `./aos`, developer workflow
commands, runtime helpers, wiki tools, and AOS-owned agent execution.

## Ownership

- `aos-*` scripts implement command-surface adapters and developer tooling.
- `lib/` owns shared JavaScript helpers for scripts.
- `lib/experience-runtime-env.mjs` owns normalized experience runtime
  environment and state paths: `AOS_STATE_ROOT`, `AOS_RUNTIME_MODE`,
  `AOS_PATH`, `AOS_EXPERIENCES_DIR`, mode-scoped state/config files, and the
  legacy active-experience fallback path.
- `lib/experience-manifest.mjs` owns reusable experience manifest discovery,
  content-root resolution, status-item URL equivalence, and mounted-surface
  menu projection helpers used by experience activation and status.
- `lib/experience-runtime-facts.mjs` owns read-only fact collection for
  `aos.experience-runtime-context.v0`: passive AOS readbacks plus local
  active-experience and runtime-config file reads. Passive probes must be
  hard-bounded; test-only timing overrides must preserve the default public
  timeout posture.
- `lib/experience-runtime-context.mjs` owns the read-only
  `aos.experience-runtime-context.v0` envelope assembler behind
  `aos experience status <id> --json`; focused `lib/experience-runtime-*`
  projector modules own content-root status, status-item/menu status,
  runtime readiness, status ranking, diagnostics, capabilities, and
  recommendations. Mounted-surface menu projection status must compare the full
  canonical projection envelope, not only menu ids.
- `lib/pending-annotations-model.mjs` owns the pending annotation durable
  record model: schema version, id policy, lifecycle/target/capability enums,
  saved-ref DTO normalization, artifact-ref DTO normalization, source-capture
  normalization, capability invariants, full record validation, summary
  projection, and create-input normalization.
- `lib/pending-annotations-store.mjs` owns the pending annotation persistence
  boundary: canonical path containment, symlink rejection, locks, full-store
  preflight, single-record durable mutation writes, record listing, and
  disposable index cache projection. It also owns the read-only pending
  annotation store status projection consumed by experience runtime context.
  It must call model helpers for record validation and summary projection
  rather than reimplementing schema logic. Store scans must classify durable
  record filenames with store-owned parsing; invalid filenames under
  `records/` are corrupt durable state, not public input-id errors. Atomic
  write leftovers are the only ignored record entries, and only when they match
  the writer shape `*.json.tmp-<pid>-<token>`; `.tmp-` remains valid inside
  annotation ids.
- Other `lib/pending-annotations*.mjs` files own the queue facade, lifecycle
  transitions, capture projection, and next-command recommendations behind
  `aos see annotation`.
- `aos_agents/` owns the AOS project-agent runner implementation.
- Native capability stays in `src/`; public schema contracts stay in
  `shared/schemas/`.

## Local Contracts

- Keep script behavior aligned with `./aos help`, manifests, schemas, and tests.
- Prefer structured JSON output for machine surfaces.
- Avoid direct daemon/socket/launchd bypasses unless the script is the sanctioned
  adapter for that lower-level operation.
- Browser helpers must resolve `playwright-cli` through
  `scripts/lib/playwright-cli-runtime.mjs`, the public script-policy owner for
  browser helper and proof-harness runtime discovery. The Swift
  `src/browser/playwright-version-check.swift` resolver is an intentional
  native/bootstrap mirror for the hidden `aos browser _check-version` adapter;
  keep its minimum version and discovery order aligned with the JS resolver
  until native bootstrap extraction removes the direct Swift resolver need.
  Preserve structured missing, too-old, and probe-failure evidence instead of
  adding ad hoc PATH checks.
- Development build wrappers must distinguish an actual repo-mode `./aos`
  binary rebuild from sign-only repair or no-op checks. Only actual rebuilds
  should drive TCC-sensitive human-attention behavior.
- Pending annotation records must be closed derived models at persistence and
  readback: saved-ref actionability is derived from `target.saved_ref`, and
  `source_capture` is either `null` or the public saved-capture shape.
- Pending annotation read/list surfaces must not repair durable state. Records
  are the authoritative durable state; `index.json` is an optional cache and
  must not decide mutation success.
- Command adapter parsers must keep flags scoped to the manifest form they
  execute. Read-only status forms must reject mutation, dry-run, or lifecycle
  flags instead of accepting and silently dropping them.

## Work Guidance

- For shell scripts, preserve macOS Bash 3.2 compatibility.
- For Node scripts, use existing repo helper modules before inventing new
  parsing or routing conventions.
- Treat `generate-command-manifests.mjs` as command-surface infrastructure:
  source files stay under `manifests/commands/source/`, and top-level command
  manifests remain generated artifacts.

## Verification

- Run the focused test matching the command surface changed.
- For runner changes, use `bash tests/aos-agents-runner.sh` and
  `python3 -m py_compile scripts/aos_agents/runner.py`.
- For broad command routing changes, include `bash tests/help-contract.sh`,
  `bash tests/dev-workflow-router.sh`, `bash tests/command-manifest-generation.sh`,
  and `git diff --check` when relevant.

## Child DOX Index

- `aos_agents/` contains the AOS-owned project-agent runner.
- `lib/` contains shared script helper modules.
- `lib/agent-workspace/AGENTS.md` owns saved perception workspace helpers,
  compact readback, saved-ref validation, and backend action dispatch.
