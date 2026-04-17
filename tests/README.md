# Test Targets

Use the smallest loop that matches the change. Do not rebuild `./aos` by
default before every verification step.

## Rebuild `./aos` First

Rebuild with `bash build.sh` when both of these are true:

- the work changed Swift sources in `src/` or `shared/swift/ipc/`
- the command or test you are about to run executes `./aos`

Examples:

- `bash tests/wiki-seed.sh`
- `bash tests/wiki-migrate.sh`
- `bash tests/wiki-write-api.sh`
- `bash tests/content/wiki-list.test.sh`
- `bash tests/daemon-singleton.sh`
- `bash tests/capture-region-perception.sh`
- `bash tests/capture-canvas-surface.sh`
- `bash tests/capture-parallel.sh`
- `./aos runtime status --json`
- `./aos show create ...`

## No `./aos` Rebuild Needed

Stay in the local package or Node loop when the work does not depend on a fresh
`./aos` binary.

Examples:

- `node --test tests/studio/*.test.mjs`
- `node --test tests/renderer/*.test.mjs`
- `node --test tests/toolkit/*.test.mjs`
- `cd packages/gateway && npm test`
- `cd packages/host && npm test`

## Mixed Work

If a change spans both Swift and JS/package surfaces:

1. Run the smallest local tests first without rebuilding `./aos`.
2. Rebuild once before the first `./aos`-backed verification step.
3. Reuse that binary for the remaining `./aos` checks until Swift changes again.

## Situational Hardware Tests

Some display tests depend on real hardware topology and OS permissions. Those
tests should skip cleanly when the environment does not qualify.

These tests should also run in an isolated `AOS_STATE_ROOT` and tear down their
own temp-root daemon state so they do not leave duplicate `aos` windows behind
if a run is interrupted.

Do not call daemon auto-starting commands such as `aos doctor`, `aos show ping`,
or `aos graph displays` before isolated tests finish writing required config like
`content.roots.toolkit`. Preflight checks should use non-daemon surfaces such as
`aos permissions check --json`, then start the isolated daemon explicitly and
wait on the isolated socket helper in `tests/lib/isolated-daemon.sh`.

Once the daemon is intentionally running, prefer the canonical readiness
commands over ad hoc polling:

- `aos content wait --root <name> ...`
- `aos show wait --id <canvas> [--manifest <name>] [--js <condition>]`

Examples:

- `bash tests/capture-region-perception.sh`
- `bash tests/capture-canvas-surface.sh`
- `bash tests/capture-union-canvas-surface.sh`
- `bash tests/capture-parallel.sh`
- `bash tests/canvas-inspector-move-abs.sh`
- `bash tests/canvas-inspector-cross-display-drag.sh`
- `bash tests/canvas-inspector-tint.sh`

## Recovery

If an interrupted display/toolkit run leaves stale windows or extra non-launchd
daemons behind, use:

- `./aos clean`
