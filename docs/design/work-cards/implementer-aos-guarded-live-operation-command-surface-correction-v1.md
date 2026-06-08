# Implementer Correction Card: Guarded Live Operation Launch Diagnostics V1

## Transfer

- recipient: Implementer
- kind: correction round after Foreman review
- governing issue: #113
- source artifact: Foreman review of dirty implementation on
  `implementer/aos-guarded-live-operation-command-surface-v0`
- single next goal: make default agent-facing launch-helper failures report a
  structured runtime verdict/blocker instead of plain shell text, and close or
  explicitly classify remaining fixed non-diagnostic launch waits.

## Branch / Base

- `required_start_ref`: current dirty branch
  `implementer/aos-guarded-live-operation-command-surface-v0`
- `base_sha`: `2d07b28466c1043613947f549518980434483ddf`
- `expected_output_branch`: same branch,
  `implementer/aos-guarded-live-operation-command-surface-v0`

Do not reset, stash, pop, or rebuild the branch. Continue from the current dirty
implementation. Preserve unrelated `.playwright-cli/`.

The #427 shared-gesture diff remains preserved as `stash@{0}` with message
`preserve shared gesture spine Implementer diff before command-surface hardening`. Do
not modify that stash.

## Current Review Finding

Foreman reproduced this default Surface Inspector failure with the repo runtime
stopped:

```text
rc=1
Scoped content roots are not live and --allow-start was not supplied; not restarting repo daemon.
```

This satisfies the "do not restart/autostart" half of the contract, but it does
not satisfy the agent-facing diagnostic half. The command should return or print
a structured failure with the real blocker class and `runtime_verdict`.

The likely cause is `scripts/aos-content-scope.sh`: without `--allow-start`, it
returns before delegating to the new diagnostic `content wait --json` path.
Launchers that use this helper can fail before reaching their JSON `show wait`
diagnostics.

## Required Correction

1. Update the default no-start path in `scripts/aos-content-scope.sh` so content
   root failures emit the guarded diagnostic payload instead of only a plain
   shell message.
   - Do not start/restart/autostart the repo daemon.
   - Prefer delegating to `./aos content wait --json` with a bounded timeout so
     the existing `runtime_verdict`, blocker, pending condition, timeout, and
     next action shape is reused.
   - Preserve explicit `--allow-start` behavior for callers that intentionally
     permit restart/autostart.

2. Add deterministic coverage for an agent-facing launch helper, preferably
   `packages/toolkit/components/surface-inspector/launch.sh`, using an isolated
   `AOS_STATE_ROOT` with no daemon.
   - The default launch must fail.
   - It must not start a daemon.
   - Its stderr must contain parseable JSON with `status:"failure"`,
     `blocker`, `operation_id`, `runtime_verdict`, and `next_action`.

3. Search remaining normal agent-facing launch helpers for fixed, non-JSON
   `show wait --timeout ...` paths.
   - Convert normal launch-helper waits to `--json` diagnostic waits.
   - If a remaining path is a test fixture or intentionally outside this
     command-surface slice, name it in the completion report with the reason.
   - At minimum inspect:
     - `packages/toolkit/components/surface-zoom-inspector/launch.sh`
     - `packages/toolkit/components/desktop-world-stage/launch.sh`
     - `scripts/recipes-sigil-verify-surfaces.sh`
     - existing changed launch helpers in this branch.

4. Keep the #427 strict-contract finding in the completion report: the stashed
   #427 diff still contains indefinite `legacy` / `compatibility` wording and
   needs a removal gate before acceptance.

## Boundaries

- Do not run live repo `./aos ready`, `./aos status`, `./aos clean`,
  `./aos service start`, `./aos service restart`, `./aos show create`, or live
  launch smoke against the real repo runtime.
- Isolated `AOS_STATE_ROOT` tests are allowed when they explicitly avoid or
  explicitly permit isolated auto-start according to the behavior under test.
- Do not edit #427 implementation files or pop `stash@{0}`.
- Do not broaden this into dock-instruction rewrites.

## Verification

Run the original deterministic suite from the v0 card plus the new focused
coverage:

```bash
git diff --check
node --test tests/aos-readiness-composition.test.mjs
node --test tests/show-wait-timeout-boundary.test.mjs
bash tests/content-wait.sh
bash tests/request-client-autostart-disabled.sh
bash tests/request-client-isolated-autostart.sh
bash tests/guarded-live-operation.sh
bash tests/external-command-dispatch.sh
bash tests/external-parser-flags.sh
bash tests/help-contract.sh
node --test tests/schemas/dev-workflow-rules.test.mjs
node --test tests/schemas/aos-experience-v0.test.mjs
bash tests/dev-workflow-router.sh
```

Add or update a focused deterministic assertion for the Surface Inspector
default failure. A representative manual proof shape:

```bash
tmp="$(mktemp -d)"
AOS_STATE_ROOT="$tmp" AOS_RUNTIME_MODE=repo \
  packages/toolkit/components/surface-inspector/launch.sh \
  >/tmp/aos-surface-inspector-launch.out \
  2>/tmp/aos-surface-inspector-launch.err
```

That command should exit non-zero, leave no isolated daemon socket owner, and
produce JSON stderr with the runtime blocker details.

## Completion Report

Return a concise report with:

- changed files since the original v0 dirty implementation;
- the exact launch-helper diagnostic behavior corrected;
- remaining fixed/non-JSON launch waits and why any remain;
- tests run with pass/fail results;
- passive final runtime classification;
- current `git status --short --branch`;
- confirmation that `stash@{0}` was not modified.
