@../AGENTS.md

# src Local Contract

`src/` owns the unified Swift `aos` binary: perception, display, action, voice,
communication, content serving, daemon lifecycle, command routing, and related
repo-mode developer commands.

Consumer-facing CLI details belong in [`docs/api/aos.md`](../docs/api/aos.md).
Keep this file focused on source-tree development rules and local orientation.

## Build And Readiness

Rebuild the repo binary only when Swift sources in `src/` or
`shared/swift/ipc/` changed, or when the next verification step executes
`./aos` and needs the changed binary.

Use the AOS developer control surface:

```bash
./aos dev build --no-restart
```

Use raw `bash build.sh` only when fixing the build surface itself or when the
current `./aos` binary cannot run. `scripts/aos-after-build` is a lower-level
wrapper around the raw build script; prefer `./aos dev build` for normal repo
development.

Do not rebuild before pure Node/package workflows. Examples that usually stay
outside the Swift build loop:

```bash
node --test tests/studio/*.test.mjs
node --test tests/renderer/*.test.mjs
cd packages/gateway && npm test
cd packages/host && npm test
```

Before daemon-backed or interactive verification, use the repo readiness gate:

```bash
./aos ready
```

If readiness reports stale macOS permissions after a build, follow the root
handoff: stop repair loops, tell the human the repo-mode `aos` grant is stale,
and after the human says `ready`, run `./aos ready --post-permission`.

Detailed build and workflow routing guidance lives in
[`docs/recipes/aos-developer-builds.md`](../docs/recipes/aos-developer-builds.md)
and
[`docs/reference/aos-dev-workflow-rules.json`](../docs/reference/aos-dev-workflow-rules.json).

## Source Map

```text
src/
  main.swift          # entry point, subcommand routing, preflight gating
  shared/             # helpers, envelopes, config, command registry data
  perceive/           # see: cursor, capture, AX, spatial, focus, graph, events
  display/            # show: canvas, render, status item, projection
  act/                # do: click, type, press, session, profiles
  voice/              # say/voice: TTS and voice registry
  content/            # content server for WKWebView canvases
  daemon/             # UnifiedDaemon: socket, routing, autonomic state
  browser/            # browser targets via Playwright adapter
  commands/           # command groups: ops, dev, wiki, tell/listen, runtime, etc.
shared/swift/ipc/
  runtime-paths.swift # AOSRuntimeMode and mode-scoped path resolution
  connection.swift    # socket connection, DaemonSession, auto-start
  request-client.swift # NDJSON request/response helpers
```

State is scoped per runtime mode at `~/.config/aos/{repo|installed}/`.

## Command Contracts

When adding or changing commands:

- Keep the unified binary model; do not add per-capability standalone CLIs.
- Keep subcommands JSON-first and non-interactive during normal operation.
- Update the command registry/help surface with the implementation.
- Update [`docs/api/aos.md`](../docs/api/aos.md) for consumer-facing command
  changes.
- Update `shared/schemas/` when the command emits or consumes a cross-tool
  contract.

## Runtime Knowledge

`aos wiki` runtime behavior lives in source, but wiki content and plugin
classification follow the artifact taxonomy in
[`docs/api/aos-taxonomy.md`](../docs/api/aos-taxonomy.md). Executable repo
contracts should live in source-backed commands, tests, schemas, or ops recipes,
not only in runtime wiki prose.

## Historical Design Context

Existing design history remains under `docs/superpowers/`. New provider-neutral
plans/specs/notes should start under `docs/design/` unless deliberately
continuing an existing legacy thread.
