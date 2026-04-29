# Recipe: AOS Developer Builds

Use this recipe when an AOS developer agent changes Swift sources under `src/`
or `shared/swift/ipc/`, or when a test/command needs a fresh repo `./aos`
binary.

## Rule

Use the AOS control surface:

```bash
./aos dev build --no-restart
```

Do not default to raw `bash build.sh`. The raw script is implementation detail
for the build command and is only appropriate when `./aos` cannot run or the
build command itself is being repaired.

## Why

Repo-mode `./aos` owns macOS Accessibility and Input Monitoring grants when the
launchd daemon runs from this checkout. Rebuilding the binary can change the
code identity macOS TCC sees. If the binary is ad-hoc or unsigned, System
Settings may still show `aos` enabled while the daemon reports stale or missing
grants.

`aos dev build` makes the flow deterministic:

- delegates to `build.sh`
- signs `./aos` with a stable local codesigning identity when one exists
- reports the signing identity after the build
- tells the agent what to do if macOS permissions go stale

## SOP

1. Rebuild only when Swift or Swift IPC changed, or when an `./aos`-driven test
   needs the new binary.
2. Run `./aos dev build --no-restart` unless you explicitly want daemon restart.
3. Run the smallest verification loop for the changed surface.
4. If readiness reports `daemon_tcc_grant_stale_or_missing`, stop. Tell the
   human the repo-mode `aos` grant is stale and needs remove/re-add in
   Accessibility and Input Monitoring.
5. After the human says `ready`, run exactly:

```bash
./aos ready --post-permission
```

6. Do not run repeated ad-hoc repair loops.

## Deterministic Discovery

Agents should find this path through:

- `./aos help dev`
- `./aos help dev build`
- `docs/reference/aos-dev-workflow-rules.json`
- `docs/api/aos.md`
- root `AGENTS.md`
- this recipe

## Workflow Classification

The structured routing rules live in
[`docs/reference/aos-dev-workflow-rules.json`](../reference/aos-dev-workflow-rules.json)
and validate against
[`shared/schemas/dev-workflow-rules.schema.json`](../../shared/schemas/dev-workflow-rules.schema.json).
Use `./aos dev classify --json` to apply that manifest to current dirty paths
or explicit paths. Use `./aos dev recommend --json` when an agent or toolkit UI
needs the smaller ordered action plan. The same manifest is the seed contract
for toolkit command-surface projection. The stock passive projection is
`aos://toolkit/components/command-surface/index.html`. The manifest is
deliberately small: it decides whether a change needs a signed build, readiness
check, canvas reload, focused test, or human TCC handoff. It does not try to
become a workflow engine.

To inspect the recommendation through AOS itself, use:

```bash
./aos dev surface --json --ttl 10m
```

That command opens or updates the passive command-surface canvas and posts the
current `aos dev recommend --json` payload into it.

## Surface Lifecycle

Before launching a developer surface, state whether it is for agent verification
or for human evaluation.

- For agent verification, prefer a bounded lifetime such as
  `./aos dev surface --ttl 10m`, or remove the canvas with
  `./aos show remove --id aos-dev-command-surface` after the check.
- For human evaluation, say so explicitly and leave the canvas visible until the
  human responds.
- Do not leave canvases on the user's display as an implicit request for review.
  If the human is the sensor, ask for the specific confirmation; otherwise clean
  up runtime state before handing the session back.

After a permission handoff, `./aos ready --post-permission` should normally
return quickly. If it hangs or still reports stale TCC after the human says the
grant is fixed, treat that as a readiness-diagnosis or daemon-handoff bug, not a
request to repeat the same manual permissions step.
