@../AGENTS.md

# Scripts

## Purpose

`scripts/` contains executable repo tooling behind `./aos`, developer workflow
commands, runtime helpers, wiki tools, and command adapters.

## Ownership

- `aos-*` scripts implement command-surface adapters and developer tooling.
- `generate-command-inventory.mjs` owns the manifest-derived development
  inventory at `docs/dev/reports/aos-command-capability-inventory-v0.md`.
  Keep it generated from command manifests and external routes; do not turn it
  into a hand-maintained source of truth.
- `generate-input-event-validator.mjs` owns the checked browser-safe Ajv
  standalone validator derived from `shared/schemas/input-event-v2.schema.json`;
  Ajv is a toolkit dev dependency, its referenced helper is inlined from the
  installed package, and no runtime package import may remain.
- `lib/` owns shared JavaScript helpers for scripts.
- `lib/aos-readiness.mjs` owns the effective permission view, readiness
  decision model, and reusable status/doctor/permissions projections. The
  ready builder maps its single top-level `ready_source` field directly from the
  verdict and is covered by a bounded command proof.
- `lib/aos-microphone-readiness.mjs` owns daemon microphone state validation,
  blocker/action projection, and denied/restricted/not-determined recovery text.
- `lib/aos-build-attestation.mjs` owns the repo Swift-input fingerprint and
  read-only build-receipt comparison shared by `build.sh` and
  `aos runtime build-attestation`; keep that command passive and daemon-free.
- `lib/experience-runtime-env.mjs` owns normalized experience runtime
  environment and state paths: `AOS_STATE_ROOT`, `AOS_RUNTIME_MODE`,
  `AOS_PATH`, `AOS_EXPERIENCES_DIR`, mode-scoped state/config files, and the
  legacy active-experience fallback path.
- `lib/experience-manifest.mjs` owns reusable experience manifest discovery,
  target validation, content-root resolution, and content URL equivalence.
- `lib/experience-runtime-facts.mjs` owns read-only fact collection for
  `aos.experience-runtime-context.v0`: passive AOS readbacks plus local
  active-experience and runtime-config file reads. Passive probes must be
  hard-bounded; test-only timing overrides must preserve the default public
  timeout posture.
- `lib/experience-runtime-context.mjs` owns the read-only
  `aos.experience-runtime-context.v0` envelope assembler behind
  `aos experience status <id> --json`; focused `lib/experience-runtime-*`
  projector modules own content-root status, runtime readiness, status ranking,
  diagnostics, capabilities, and recommendations.
- `aos-status-item.mjs` owns the public descriptor CLI. Register-follow retains
  lease/event ownership; update is exact-revision compare-and-swap, and the
  registration result must be emitted before buffered initial events.
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
- `aos-skills.mjs` and `aos-skills-validate.mjs` are the CLI entrypoints for
  root skill registry listing, validation, installed-state checks, install
  planning/application, and Playwright CLI companion checks.
- `aos-skills-eval.mjs` is the deterministic captured-response evaluator for
  installable AOS skill efficacy across model/reasoning matrices. It may emit
  prompt packets and dispatch capture-only provider adapters, but scoring must
  remain offline and manifest-backed by default.
- `lib/aos-skills/AGENTS.md` owns the focused module split behind those
  entrypoints. Keep validation, catalog reads, install target resolution,
  installed-state drift checks, transactional install application, Playwright
  companion detection, efficacy scoring, provider capture adapters, and
  captured-run file writing in separate modules instead of rebuilding a large
  mixed-responsibility skills registry file.
- `lib/aos-skills-registry.mjs` is a compatibility re-export only; do not add
  new behavior there.
- Native capability stays in `src/`; public schema contracts stay in
  `shared/schemas/`.
- `lib/aos-voice-follow.mjs` owns the bounded daemon-follow lifecycle used by
  public connection-scoped streaming adapters, including
  `listen --source hotkey|microphone --follow`, `say --follow`, `play --follow`,
  and native annotation selection. Keep daemon
  connection mechanics in `lib/aos-daemon-client.mjs`, keep speech text on
  stdin, do not echo speech text or capture paths through events or errors, and
  cancel the connection-scoped lease when the native external-dispatch owner
  exits. Signal and parent-loss handling must be active before managed daemon
  startup, and startup cancellation must await termination of any owned child.
- `aos-permissions.mjs` treats foreground Microphone preflight as diagnostic
  only. Its public prompt route starts the managed runtime when needed and
  delegates to the daemon authorization primitive; readiness and permissions
  output fail closed unless daemon health reports `microphone_state=authorized`.
  Denied recovery opens the Microphone settings pane and polls daemon health;
  it never teaches drag-add or runtime TCC reset for Microphone.
- `aos-wiki-put.mjs` owns bounded conditional wiki publication. It accepts only
  canonical Markdown paths and UTF-8 stdin, serializes writers, rejects
  symlinks, commits owner-only files atomically, and exposes hashes without
  echoing page content or absolute paths. `none` is create-only; updates require
  the current SHA-256 and fail closed on conflicts.
- `aos-show-client.mjs` owns any isolated daemon it starts for `show listen`.
  Install signal and parent-exit handling before auto-start, forward shutdown
  to that child, and await confirmed child exit before the listener exits.
- `aos-scene.mjs` owns the bounded public NDJSON adapter for connection-scoped
  DesktopWorld scene leases, read-only cartridge validation, scene inspection,
  monitoring, deterministic replay, and AOS-owned DevTools session commands.
  Follow mode accepts only the documented operation set, bounds input/output,
  and never exposes the daemon socket to consumers. `subscribe` and
  `unsubscribe` operate on that same lease, accept only registered typed event
  names, and never create a second socket or per-gesture process. Cartridge validation uses
  `lib/aos-scene-cartridge.mjs` to reject links, traversal, undeclared files,
  digest drift, executable data, remote runtime assets, and unsafe budgets
  without starting the daemon or exposing absolute paths.
  `lib/aos-scene-daemon.mjs` owns the agent-tooling request transport: bounded
  incremental NDJSON reads, request/ref correlation, timeouts, signal and
  parent-loss handling, canonical daemon-response envelope validation and data
  unwrapping, and cleanup of only a daemon it started. It must not replace the
  canonical stage snapshot or carry product content.
- `aos-shortcut.mjs` owns explicit Apple Shortcut execution through
  `/usr/bin/shortcuts`. It passes one exact shortcut name as an argv item,
  never invokes a shell, bounds time and output, and never returns captured
  Shortcut output content.
- `aos-play.mjs` owns bounded connection-scoped WAV playback through the
  daemon voice-output broker. Input paths stay private to the request; public
  events expose only lifecycle, format, byte-count, and meter facts.
- `aos-annotation-select.mjs` owns the public connection-scoped desktop
  annotation adapter. It validates native point, rectangle, freehand, or text
  evidence, persists one pending-annotation record before completion, and
  strips annotation text from the public follow event.

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
  binary rebuild from no-op checks. Repo-mode builds must not post-sign the
  local binary; ADR 0023 owns this managed-endpoint compatibility contract and
  packaged app signing belongs outside the repo-mode build path.
  The raw link must match root `build.sh`: inline source fingerprinting, plain
  Swift inputs and `-lsqlite3`, with no injected plist or metadata section.
  If the repo-local `./aos` artifact is missing or exits `137`, recover with
  `bash build.sh --force --no-restart`; do not add post-build signing, an
  `ld` pass, copying or moving, installation-name editing, an explicit signing
  identifier, entitlements, app bundle wrapping, `-sectcreate`, `__info_plist`,
  allowlist assumptions, or an `spctl` acceptance gate. `spctl` rejection is
  expected for the raw local binary shape; launchability of `./aos` is the
  operational check.
  `aos runtime build-attestation --json` must fail closed when the executable,
  build mode, receipt, or current Swift-input fingerprint does not agree, and
  must never update the receipt or invoke a build.
  After a rebuild that emits `Rebuilt: ./aos`, keep that raw artifact and make
  `./aos help --json` the immediately following command. Do not inspect, hash,
  attest, transform, or run readiness against the live artifact first; stop on
  exit `137`. If help succeeds, stop immediately for the human TCC checkpoint;
  do not inspect the artifact or run any other command. Only after the user
  replies `finished` may the session run exact
  `./aos ready --repair --post-permission --json`, with no intervening command.
  Do not infer exit `137` from empty output or a timeout and do not force-rebuild
  a launchable artifact. The recovery invocation must include `--no-restart`,
  and that path must not execute or restart through the newly linked binary.
  The script's internal source hashes and size reporting are intentional.
  `aos-after-build` must
  reject arbitrary chained commands when its build step reports a real
  rebuild; only exact `help --json` may run, after which it must print the human
  checkpoint and return without another artifact access.
- Mutating command adapters must handle `--help` and `-h` before execution so
  help reads never trigger builds, service restarts, TCC-sensitive signing, or
  other runtime mutation.
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
- For root skill registry validation changes, use
  `node scripts/aos-skills-validate.mjs --json` and
  `node --test tests/aos-skills-registry.test.mjs`.
- For root skill install target, installed-state, staging/finalization, or
  dry-run planning changes, add `node --test tests/aos-skills-command.test.mjs`.
- For Playwright CLI companion skill checks, add
  `node --test tests/aos-skills-companion.test.mjs`.
- For installable skill efficacy scoring, add
  `node --test tests/aos-skills-eval.test.mjs` and
  `node scripts/aos-skills-eval.mjs --fixture tests/fixtures/aos-skills/agentic-efficacy-eval-v0.json --json`.
- For broad command routing changes, include `bash tests/help-contract.sh`,
  `bash tests/dev-workflow-router.sh`, `bash tests/command-manifest-generation.sh`,
  and `git diff --check` when relevant.
- For public voice streams, run `bash tests/voice-transport-native.sh`,
  `node --test tests/voice-follow-cli.test.mjs`, and
  `node --test tests/schemas/daemon-event.test.mjs` before any live audio proof.

## Child DOX Index

- `lib/aos-skills/AGENTS.md` owns root skill registry helper modules.
- `lib/` contains shared script helper modules.
- `lib/agent-workspace/AGENTS.md` owns saved perception workspace helpers,
  compact readback, saved-ref validation, and backend action dispatch.
