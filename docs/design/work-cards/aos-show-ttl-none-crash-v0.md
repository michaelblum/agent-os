# Work Card: AOS Show TTL None Crash V0

**Status:** Accepted

## Foreman Acceptance

Accepted on 2026-05-24.

- GDI implementation branch: `gdi/aos-show-ttl-none-crash-v0`
- GDI implementation commit: `2be1997c26eb8e194a19852d0ce9a97d39bdddde`
- Main merge commit: `d0b81d86cbd777c48cfa4eb02e21017caa9a347b`

Accepted behavior:

- `./aos show create --ttl none` omits `ttl` from the daemon request, which
  represents no expiry.
- `./aos show update --ttl none` sends `ttl=0`, preserving the existing daemon
  clear-TTL sentinel.
- Non-finite TTL values such as `inf` fail with `INVALID_DURATION` before JSON
  encoding.
- `show update --ttl` help now advertises `none` consistently with create.

Foreman verification:

- `./aos dev build`: passed.
- `./aos ready --post-permission`: ready.
- `node --test tests/schemas/dev-workflow-rules.test.mjs
  tests/schemas/dev-active-profile.test.mjs
  tests/schemas/dev-workflow-profiles.test.mjs`: 10/10 passed.
- `bash tests/dev-workflow-router.sh`: passed.
- `bash tests/dev-audit.sh`: passed.
- `bash tests/help-contract.sh`: passed.
- `bash tests/show-update-reload.sh`: passed.
- `bash tests/canvas-non-finite-frame-rejection.sh`: passed on single rerun
  after an initial daemon readiness timeout while other checks were running.
- `git diff --check`: passed.
- Live repro:
  `./aos show create --id ttl-none-foreman-review-smoke ... --ttl none`
  returned `{"status":"success"}`, and cleanup remove returned
  `{"status":"success"}`.

## Transfer Classification

- Recipient: GDI
- Transfer kind: GDI round
- Single next goal: fix `./aos show create --ttl none` so the documented
  no-expiry TTL value does not crash the CLI and has deterministic create/update
  behavior.
- Source artifact: Foreman live smoke while accepting
  `toolkit-surface-clipboard-write-and-text-ux-baseline-v0`.
- Branch/Base:
  - `branch_from: origin/main`
  - `required_start_ref: origin/main` with this work card present
- Branch/output expectation: create `gdi/aos-show-ttl-none-crash-v0` from
  `origin/main`. Commit and push that GDI branch when verification passes. Do
  not open a PR, merge, mutate main, mutate GitHub issues/projects, or route
  follow-up work from inside the GDI round.

## Foreman Observation

This command shape crashed the CLI before the canvas request reached the daemon:

```bash
./aos show create --id foreman-clipboard-write-smoke \
  --at 120,120,420,180 \
  --html '<html><body>smoke</body></html>' \
  --interactive \
  --ttl none
```

Observed failure:

```text
NSInvalidArgumentException
Invalid number value (infinite) in JSON write
```

Help currently advertises `--ttl` as accepting examples such as
`5s`, `10m`, and `none`, so `none` must not encode as a non-finite JSON number.

## Read First

- `AGENTS.md`
- `src/display/client.swift`
- `src/display/protocol.swift`
- `src/display/canvas.swift`
- `src/shared/command-registry-data.swift`
- `tests/help-contract.sh`
- `tests/show-update-reload.sh`
- `tests/canvas-non-finite-frame-rejection.sh`

## Rediscover State

Run:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos ready
./aos dev recommend --json --paths src/display/client.swift,src/display/protocol.swift,src/display/canvas.swift,src/shared/command-registry-data.swift,tests/help-contract.sh,tests/show-update-reload.sh,tests/canvas-non-finite-frame-rejection.sh
```

If `./aos ready` reports a repo-mode Accessibility, Input Monitoring, or
inactive input-tap blocker, run:

```bash
.docks/gdi/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `ready`, run:

```bash
./aos ready --post-permission
```

Only continue if it reports ready.

## Required Behavior

1. `./aos show create --ttl none` must not crash.
2. Create with `--ttl none` should represent no expiry in the daemon request.
   Use the repo-consistent representation after reading the create/update TTL
   code; do not send non-finite JSON.
3. Update with `--ttl none` must also be deterministic. If existing update
   semantics use a finite sentinel such as `0` to clear TTL, either map `none`
   to that existing clear behavior or document and test the chosen
   repo-consistent behavior.
4. Other invalid or non-finite TTL values must fail with a normal CLI error,
   not an uncaught exception.
5. Keep help text and behavior aligned.

## Verification

Run the checks recommended by `./aos dev recommend`. Expected minimum:

```bash
./aos dev build
bash tests/help-contract.sh
bash tests/show-update-reload.sh
bash tests/canvas-non-finite-frame-rejection.sh
git diff --check
```

Also run a bounded live repro after `./aos ready` passes:

```bash
./aos show create --id ttl-none-smoke --at 120,120,280,120 \
  --html '<html><body>ttl none smoke</body></html>' \
  --interactive --ttl none
./aos show remove --id ttl-none-smoke
```

Report the exact result and clean up any smoke canvas.

## Hard Boundaries

- Do not redesign canvas lifecycle or TTL policy beyond the documented `none`
  crash and deterministic create/update semantics.
- Do not mutate provider stores, catalogs, telemetry, gateway/dock runtime, or
  Codex configuration.
- Do not read provider transcript bodies.
- Do not drive live provider sessions.
- Do not create PRs, mutate GitHub issues/projects, merge to main, or route
  another session from inside the GDI round.

## Completion Report Required

Return:

- branch and head SHA;
- base/start SHA;
- files changed;
- exact TTL parsing and request encoding behavior for `none`;
- deterministic verification commands and results;
- live repro result or exact readiness blocker;
- statement confirming the hard boundaries were respected.
