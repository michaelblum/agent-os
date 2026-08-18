@../AGENTS.md

# Scripts

## Purpose

`scripts/` contains executable repo tooling behind `./aos`, developer workflow
commands, runtime helpers, wiki tools, and command adapters.

## Ownership

- `aos-*` scripts implement command-surface adapters and developer tooling.
- The existing command capability inventory under `docs/dev/reports/` is frozen
  historical evidence. It has no active generator and must not be treated as
  current command authority or routed as an active source.
- `generate-input-event-validator.mjs` owns the checked browser-safe Ajv
  standalone validator derived from `shared/schemas/input-event-v2.schema.json`;
  Ajv is a toolkit dev dependency, its referenced helper is inlined from the
  installed package, and no runtime package import may remain.
- `generate-work-record-contract-validators.mjs` owns checked standalone
  validators for the active Work Record, Step Descriptor, Repair Plan, Attempt
  Plan, and Attempt Artifact V1 schemas. Register every owned schema before
  compilation so cross-contract refs inline into dependency-free validators.
  Active consumers use those generated validators and reject historical or
  malformed bytes before projection, verification, planning, or harness work.
- `build-work-record-native.mjs` owns the direct current-architecture Darwin
  N-API build for the private descriptor-relative Work Record filesystem
  primitive. It uses system `xcrun clang++` plus the current Node headers,
  fingerprints source and builder inputs, installs no dependencies, and writes
  only the ignored toolkit-native build directory. Root `build.sh` invokes it
  before the one permitted Swift link, and packaged-runtime assembly must carry
  the resulting `.node` resource with the private workbench implementation.
- `stage-work-record-runtime.mjs` owns the narrow installed-runtime projection
  for Work Records. Both packaging routes use it to carry the private workbench
  and current-architecture addon, toolkit ESM marker, bundled-root sentinel,
  command adapter and helper, active default fixtures, and a Work Record-only
  projection of the generated external-command manifest. It must fail when the
  addon or generated command family is absent instead of packaging an
  unreachable or pathname-fallback route.
- `stage-browser-companion-runtime.mjs` owns the separate installed projection
  for the managed Playwright companion command and consumers, focused modules,
  exact descriptor, closed schemas, a closed projection of the generated
  command registry containing only staged routable forms, help proxy and
  route matcher, and exact help/browser/focus/do/see external routes. Both packaging
  scripts call it, and it merges those routes without changing the Work
  Record-owned staging projection. The copied help route remains source-owned
  and resolves its proxy and working directory through `$AOS_REPO_ROOT`; the
  focused staging proof exercises that dispatcher projection from an unrelated
  caller directory.
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
- `aos-runtime-desktop-pixel-baseline.mjs` validates the explicit foreground
  proof arguments, including the standalone or DesktopWorld host selector, and
  delegates to the private in-process native primitive. Both boundaries require
  `AOS_ENABLE_DEVELOPMENT_PROBES=1`. It owns no capture, rendering, daemon,
  broker, permission, or product behavior.
- `lib/experience-runtime-env.mjs` owns normalized experience runtime
  environment and state paths: `AOS_STATE_ROOT`, `AOS_RUNTIME_MODE`,
  `AOS_PATH`, `AOS_EXPERIENCES_DIR`, mode-scoped state/config files, and the
  legacy active-experience fallback path.
- `lib/experience-manifest.mjs` owns reusable experience manifest discovery,
  target validation, content-root resolution, and content URL equivalence.
- `lib/experience-runtime-facts.mjs` owns read-only fact collection for
  `aos.experience-runtime-context.v1`: passive AOS readbacks plus local
  active-experience and runtime-config file reads. Passive probes must be
  hard-bounded; test-only timing overrides must preserve the default public
  timeout posture.
- `lib/experience-runtime-context.mjs` owns the read-only
  `aos.experience-runtime-context.v1` envelope assembler behind
  `aos experience status <id> --json`; focused `lib/experience-runtime-*`
  projector modules own content-root status, runtime readiness, status ranking,
  diagnostics, capabilities, and recommendations.
  `aos.experience-runtime-context.v0` remains a frozen compatibility schema and
  is not silently reused for the status-item-free output.
- `aos-status-item.mjs` owns the public descriptor CLI. Register-follow retains
  lease/event ownership; update is exact-revision compare-and-swap, and the
  registration result must be emitted before buffered initial events.
  Effectful and dry-run invoke both require the current inspect-reported action
  sequence; only the effectful form consumes it. Invoke responses must validate
  the complete canonical discriminated result and the closed stable error-code
  set. Validate
  the complete daemon `status_item` event envelope, then expose only canonical
  `{event, data}` NDJSON to public consumers.
  The long-lived `status-item register --follow` external route must inherit
  stdio so registration and events stream before lease termination and signals
  reach the owner process; captured external dispatch is invalid for this form.
  `lib/status-item-output-writer.mjs` owns bounded stdout backpressure for that
  follow stream and pauses its source socket until buffered output drains.
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
- **Sovereign capability transition
  (`aos-sovereign-capability-substrate-v1`):** ADR 0043, accepted ADR 0044, and
  `docs/dev/aos-sovereign-capability-authority-v1.json` own the target
  grammar-agnostic raw managed-tool transport and every-nontrivial-operation
  control plane. ADR 0044 also requires generation-bound external-dispatch
  intent/finalization: an environment parent PID or token alone never grants
  owner authority, and an authored route declares executable resolution while
  durable records bind only the resolved path/identity digests, device, inode,
  code identity, file digest, script, canonical argv shape, peer generation,
  and operation generation. An absolute executable path is transient resolver
  state, never durable or public. The fixed browser operations and exact adapters below remain
  current executable truth and burn-down baseline; do not widen or delete them
  without the later atomic source/manifest/help/schema/API/skill/test slice.
  The external-command v0 schema remains frozen. Active M2 uses the v1 schema,
  keeps the aggregate path stable at wire version 2, registers only the
  authored `listen` route, and keeps the generator, Swift dispatcher, help
  proxy, proof routing, and installed projections on the same v1-only cutover;
  no dual reader, v0 mutation, translation, or parallel aggregate is allowed.
- `aos-browser-companion.mjs` is the public status/install/update/uninstall CLI
  for the source-pinned Playwright package runtime. Its focused implementation
  and store ownership rules live under `lib/browser-companion/AGENTS.md`.
- `aos-focus-graph.mjs`, `aos-do-browser.mjs`, `aos-browser-internal.mjs`, and
  `aos-browser-broker.mjs` consume only the managed session authority under
  `lib/browser-companion/`. They expose fixed operations and must never regain
  executable-path resolution, upstream list, generic eval/code, browser-window
  locality/anchors/DOM hit testing, or fallback.
- `aos-browser-worker-guardian.mjs` and `aos-browser-worker-group.mjs` are the
  installed private Node supervision entrypoints. The guardian remains inert
  until its parent publishes the PID-bound lock-token reservation and sends
  activation. The detached group sentinel holds the exact process-group
  identity through aggregate-bounded raw stdout/stderr forwarding and bounded
  TERM-to-KILL proof. Forced completion requires exact SIGKILL exit plus
  untruncated control EOF and both raw EOF witnesses; transport loss drains both
  relays. Its small control channel never carries worker output.
- `lib/focus-depth.mjs` owns the canonical native focus traversal-depth grammar
  (`0...15`) used before daemon dispatch.
- Installed companion staging projects only the browser consumer forms whose
  external routes are included in that closed runtime. Browser `do` advertises
  only navigate/type/key/scroll, and browser capture advertises only its narrow
  whole-session and saved-workspace variants.
- Native capability stays in `src/`; public schema contracts stay in
  `shared/schemas/`.
- **ADR 0040 target boundary:** facts already admitted to bounded public
  adapter observations remain raw by default unless a caller explicitly
  transforms them. Saved-handle behavior follows the V1 Observation
  Ref/Locator split; no third target model or implicit reacquisition is allowed.
  This does not widen bounded lifecycle events or operation receipts to
  adjacent media, source, product, or private transport content that their
  public contracts do not observe.
- `lib/target-handle-runtime.mjs` owns the one current bounded browser
  Observation Ref generation per managed session. Its path-free V2 backend
  identity binds the exact descriptor, closure, entrypoint, and random session
  generation. Browser Observation Ref actions remain outside the fixed managed
  operation surface and fail before backend dispatch; never substitute a
  separate probe, reacquisition, or another generation. The same
  target-handle owner enforces the public native AX Locator caps of depth 128
  and timeout 30,000 ms before native dispatch.
- `lib/aos-voice-follow.mjs` owns the bounded daemon-follow lifecycle used by
  public connection-scoped streaming adapters, including
  `listen --source hotkey|microphone --follow`, `say --follow`, `play --follow`,
  and native annotation selection. Keep daemon
  connection mechanics in `lib/aos-daemon-client.mjs`, keep speech text on
  stdin, and cancel the connection-scoped lease when the native
  external-dispatch owner exits. The public events and errors are bounded
  lifecycle observations; speech text and capture paths stay on their owning
  speech, transcription, or capture channels and outside those envelopes. Their
  exclusion is not an ADR 0040 raw-output gap. Signal and
  parent-loss handling must be active before managed daemon startup, and startup
  cancellation must await termination of any owned child.
  Microphone forms also retain and validate the closed generic attribution
  flags consumed by native registered dispatch at operation-intent creation;
  hotkey and other voice forms reject them.
- `aos-permissions.mjs` treats foreground Microphone preflight as diagnostic
  only. Its public prompt route starts the managed runtime when needed and
  delegates to the daemon authorization primitive; readiness and permissions
  output fail closed unless daemon health reports `microphone_state=authorized`.
  Denied recovery opens the Microphone settings pane and polls daemon health;
  it never teaches drag-add or runtime TCC reset for Microphone.
  Direct screen-capture status is also diagnostic and passive. Only
  `permissions prime screen-capture` may request authorization and invoke the
  daemon-owned bounded probe. The setup frame is a private, discarded
  capability-check input outside the public permission-status observation; its
  exclusion is not an ADR 0040 raw-output gap. It is never persisted. Under
  program `aos-sovereign-capability-substrate-v1`, this AOS-local prime gate is
  current executable truth and ADR 0043 burn-down baseline, not enduring target
  policy.
- `aos-see-native.mjs` owns native perception admission,
  `lib/aos-see-supervision.mjs` owns the shared process-group boundary, and
  `lib/aos-see-child-runner.mjs` guards the exact native child for direct,
  saved, and saved-ref revalidation captures. Parent, wrapper, or guardian loss
  must retire that group after a bounded grace period and never orphan capture.
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
  canonical stage snapshot. Arbitrary product and extension content remains
  outside that bounded engine snapshot; its exclusion is not an ADR 0040
  raw-output gap. Admitted engine result facts must not be silently omitted or
  redacted.
- `lib/aos-scene-extension.mjs` owns trusted scene-extension validation and the
  immutable owner-only installation store. Its module inspector must compile
  the exact native-host ES-module wrapper in a bounded child without linking or
  evaluation, and must confirm child termination after graceful or escalated
  shutdown.
- `aos-shortcut.mjs` owns explicit Apple Shortcut execution through
  `/usr/bin/shortcuts`. It passes one exact shortcut name as an argv item,
  never invokes a shell, and bounds time and output. Its typed receipt returns
  status, duration, and byte counts; captured stdout/stderr remain outside that
  bounded receipt.
- `aos-play.mjs` owns bounded connection-scoped WAV playback through the
  daemon voice-output broker. Public events expose lifecycle, format,
  byte-count, and meter facts. The caller-owned input path is outside that
  bounded lifecycle event envelope; its exclusion is not an ADR 0040 raw-output
  gap.
- `aos-annotation-select.mjs` owns the public connection-scoped desktop
  annotation adapter. It validates native point, rectangle, freehand, text, or
  semantic target evidence, persists one pending-annotation record before
  completion, and keeps entered text in that durable record rather than echoing
  it through the bounded completion receipt. The receipt currently replaces
  admitted target `title` and `label` values with `null`, an ADR 0040 fidelity
  gap. The current
  `fallback_only` AX evidence remains selection evidence, not a semantic action
  handle or durable target identity contract.

## Local Contracts

- Keep script behavior aligned with `./aos help`, manifests, schemas, and tests.
- Prefer structured JSON output for machine surfaces.
- Work Record planning commands return schema-shaped `unsupported` payloads
  and a nonzero exit for unsupported verifier profiles; automation must not
  treat an unsupported plan as success.
- Avoid direct daemon/socket/launchd bypasses unless the script is the sanctioned
  adapter for that lower-level operation.
- Browser helpers must resolve a session record through the managed companion
  store and global store lock. The record binds the exact immutable runtime;
  there is no JS or Swift executable resolver, version probe, legacy registry,
  PATH/npx fallback, environment override, or generic upstream command route.
  Preserve content-free typed missing, inactive, cleanup-required, migration,
  store, and worker errors. Browser Observation Ref actions remain unsupported
  even when their V2 backend identity is current.
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
  readback: saved-handle actionability is derived from
  `target.saved_ref.handle`, and `source_capture` is either `null` or the
  public saved-capture shape.
- Pending annotation read/list surfaces must not repair durable state. Records
  are the authoritative durable state; `index.json` is an optional cache and
  must not decide mutation success.
- Command adapter parsers must keep flags scoped to the manifest form they
  execute. Read-only status forms must reject mutation, dry-run, or lifecycle
  flags instead of accepting and silently dropping them.

## Work Guidance

- `aos-work-record.mjs` exposes only Work Record V1 evidence, neutral planning,
  caller-outcome artifact, replacement, supersession, and exact finalization
  forms. Keep Gate request/check, authority inputs, and fixture repair execution
  out of this command adapter. Supersession write requires an explicit
  Replacement Writer Result path because Writer provenance is mandatory.
  Typed malformed supersession indexes are command failures and must exit
  nonzero for automation. Artifact and replacement-proposal build forms also
  exit nonzero when their emitted payload is unusable.

- For shell scripts, preserve macOS Bash 3.2 compatibility.
- For Node scripts, use existing repo helper modules before inventing new
  parsing or routing conventions.
- Native Work Record builder checks and tests must never invoke `./aos`, run the
  daemon, install dependencies, or touch UI/TCC state.
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

- `lib/browser-companion/AGENTS.md` owns the managed Playwright package
  lifecycle, private store, acquisition, activation, and output projection.
- `lib/aos-skills/AGENTS.md` owns root skill registry helper modules.
- `lib/` contains shared script helper modules.
- `lib/agent-workspace/AGENTS.md` owns saved perception workspace helpers,
  compact readback, Target Handle validation, and backend action dispatch.
