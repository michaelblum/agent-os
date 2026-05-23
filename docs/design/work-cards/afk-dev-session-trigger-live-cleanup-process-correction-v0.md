# Work Card: AFK Dev Session Trigger Live Cleanup Process Correction V0

**Status:** Accepted 2026-05-22

## Foreman Acceptance

Accepted correction commit:
`dd7ce32f5d39e16d226a7a97ffcea9ce57758f3e`
(`fix(afk): require helper child cleanup proof`).

The correction satisfies Foreman's process-cleanup finding:

- the process bridge now tracks the owned process-driver child PID and the PTY
  command child/process-group id for the selected command;
- bridge shutdown now terminates owned process/tmux sessions before the bridge
  exits;
- no-fixture supervised provider cleanup proof now requires bridge process exit,
  bridge health unreachable, process-driver child exit, and provider command
  child/process-group absence before reporting `cleanup.status=verified`;
- fixture-backed cleanup proof is downgraded to `cleanup_unverified` when the
  proof says an owned child/session remains observable;
- provider acceptance timeout plus verified cleanup still reports
  `provider_acceptance_unobserved`, while timeout plus failed cleanup reports
  `cleanup_unverified`;
- guard failures and duplicate states remain non-launching.

Verification:

```text
git status --short --branch
## gdi/afk-dev-session-trigger-live-cleanup-proof-v0

./aos ready
ready=true mode=repo daemon=reachable tap=active

node --test tests/afk-session-trigger-prototype.test.mjs
15 tests passed

node --test tests/afk-launch-attempt-prototype.test.mjs
25 tests passed

node --test tests/sigil-agent-terminal-server.test.mjs
12 tests passed

git diff --check ab42d86afa01b1be050e7a7e7f8c391ceab09dbe..HEAD
passed
```

Foreman reran the fake non-provider `codex` smoke on the real no-fixture
guarded trigger path. The adversarial fake returned exit code `1`,
`receipt.status=provider_acceptance_unobserved`,
`provider_acceptance.status=provider_acceptance_unobserved`,
`cleanup.status=verified`, and terminal command `codex --no-alt-screen`.
The cleanup proof included `owned_bridge_process_exit`,
`owned_bridge_health_unreachable_after_teardown`,
`owned_process_driver_child_exit`, and
`owned_provider_command_child_exit`. Post-run process checks found no lingering
fake `codex`, owned process group, or real `pty-proxy.py codex --no-alt-screen`
process. Temporary fake-provider artifacts were removed.

No live provider launch, real transcript read, provider config/session/catalog
mutation, gateway state, dock profile/hook mutation, GitHub state, push, PR, or
external publication happened during Foreman acceptance.

The source branch is ready for a supervised Operator no-fixture live evidence
run at
`docs/design/work-cards/operator-afk-dev-session-trigger-cleanup-proof-live-v0.md`.

## Transfer Classification

- Recipient: GDI
- Transfer kind: correction round
- Single next goal: correct the live cleanup-proof slice so
  `cleanup.status=verified` is reported only after the helper-owned
  bridge/provider launch substrate, including the terminal child/session for
  `codex --no-alt-screen`, has actually been torn down or proven gone.
- Source artifact:
  `docs/design/work-cards/afk-dev-session-trigger-live-cleanup-proof-v0.md`
- Reviewed output branch:
  `gdi/afk-dev-session-trigger-live-cleanup-proof-v0`
- Reviewed output head:
  `e7645ff38ee266cd04a0e0794066d157c6a4cac2`
- Reviewed base:
  `7fcdae5d1d760ea0af35d803a68eaa8325f298e5`
- Branch/output expectation: continue on
  `gdi/afk-dev-session-trigger-live-cleanup-proof-v0` from this correction
  card commit. Keep the checkpoint local; do not push, open a PR, mutate
  GitHub, or publish externally.

## Fresh Context Contract

GDI starts from a fresh context window. Do not assume branch, worktree, daemon,
bridge process, provider session, transcript/catalog state, Foreman's fake
provider smoke details, or implementation shape beyond this card. Read and
rediscover before editing.

## Foreman Review Finding

The first cleanup-proof output records source-owned cleanup proof and passes the
focused test suite, but its verified cleanup is too narrow. Foreman's
deterministic fake-provider smoke put a temporary non-provider `codex` binary
first on `PATH` and ran the real no-fixture supervised trigger path. The
receipt reported:

```json
{
  "receipt_status": "provider_acceptance_unobserved",
  "provider_acceptance_status": "provider_acceptance_unobserved",
  "cleanup_status": "verified",
  "terminal_command": "codex --no-alt-screen"
}
```

Immediately after the trigger command returned, the same smoke saw a lingering
helper-owned terminal process:

```text
.../pty-proxy.py codex --no-alt-screen
```

That is not acceptable for this slice. Cleanup verification cannot mean only
"bridge server process exited" and "bridge health endpoint is unreachable" if
the terminal child/session launched by that bridge may still be alive.

## Required Behavior

Fix the cleanup proof without broadening the AFK trigger scope:

- `cleanup.status=verified` must require evidence that the helper-owned bridge
  server is gone and the helper-owned terminal/provider child or session for the
  selected command is gone.
- If the bridge server exits but the helper-owned `pty-proxy.py`, process-driver
  child, tmux session, or command process remains observable in the bounded
  cleanup window, report `cleanup_unverified` with a useful reason and proof.
- Cleanup proof must stay scoped to helper-owned artifacts: owned bridge
  session, owned command, owned bridge port, owned child process/session
  handles, or equivalent. Do not kill or classify unrelated pre-existing Codex
  sessions.
- Keep provider acceptance timeout plus verified cleanup reporting
  `provider_acceptance_unobserved`; keep timeout plus failed cleanup reporting
  `cleanup_unverified`.
- Preserve fixture-backed deterministic behavior, but add coverage that would
  catch the fake-provider/process-retention case.
- Preserve dry-run behavior, duplicate suppression before launch, guarded live
  gates, fixture-backed completion, result route `not_attempted`, and work
  receipt `not_attempted`.

## Hard Boundaries

- Do not run a live Codex, Claude, Gemini, tmux, provider terminal, or real
  bridge session in this GDI correction round.
- A temporary fake `codex` binary that does not invoke a provider is acceptable
  for deterministic cleanup testing.
- Do not read real `~/.codex` transcript bodies.
- Do not mutate provider configs, provider session files, provider transcripts,
  provider catalogs, telemetry stores, gateway jobs, dock profiles, hooks,
  `.docks` role instructions, GitHub state, pushes, or PRs.
- Do not add final `aos session ...` spelling, unattended scheduling, gateway
  result-route delivery, schema promotion, prompt submission, or multi-provider
  live parity.

## Suggested Implementation Areas

- `scripts/afk-launch-attempt-prototype.mjs`
- `scripts/afk-session-trigger-prototype.mjs`
- `tests/afk-session-trigger-prototype.test.mjs`
- `tests/afk-launch-attempt-prototype.test.mjs`
- Possibly `apps/sigil/codex-terminal/server.mjs` and its focused tests if the
  correct fix is for the bridge server to terminate process-driver children on
  shutdown.

Prefer a source-owned teardown path over broad process greps. Good outcomes
would include explicit process-driver child termination, an endpoint or signal
handler that closes owned sessions, or a bounded child/session liveness proof
returned by the helper. Avoid making global provider-process state part of the
cleanup contract.

## Verification

Required:

```bash
git status --short --branch
./aos ready
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
git diff --check
```

Add or update focused tests proving:

- a fake non-provider `codex` command that remains alive past bridge server exit
  does not allow `cleanup.status=verified`;
- when cleanup is verified, the proof includes bridge teardown and
  child/session teardown or liveness absence for the helper-owned command;
- provider acceptance timeout with verified cleanup still returns
  `provider_acceptance_unobserved`;
- provider acceptance timeout with failed cleanup returns `cleanup_unverified`;
- fixture-backed completed behavior still requires provider acceptance plus
  cleanup verified;
- guard failures and duplicate states still do not select or clean up a
  provider command.

Run if Swift/help surfaces change:

```bash
bash tests/dev-workflow-router.sh
bash tests/help-contract.sh
./aos dev build --no-restart
```

Do not run live Codex in this GDI correction round. If deterministic
verification passes, report the exact fake-provider cleanup smoke result and the
next Operator supervised live scenario Foreman should route.

## Stop Conditions

Stop and report instead of broadening scope if:

- repo-mode TCC/Input Monitoring readiness blocks;
- proving helper-owned child/session cleanup would require killing or
  classifying unrelated provider processes;
- source-owned cleanup proof would require reading real transcript bodies;
- provider acceptance observation, prompt submission, final command spelling,
  unattended behavior, gateway delivery, or multi-provider support becomes
  necessary to complete this correction.

## Completion Report

Report:

- branch and head SHA;
- changed paths, path-scoped to this correction;
- exact cleanup proof fields and teardown behavior added or corrected;
- fake-provider cleanup-retention test/smoke result;
- provider-timeout, cleanup-failure, completed, guard, and duplicate behavior;
- tests/checks run with exact pass/fail results;
- `./aos ready` result or exact human-needed blocker;
- confirmation that no live provider launch, real transcript read, provider
  config/session/catalog mutation, gateway state, dock profile/hook mutation,
  GitHub state, push, PR, or external publication happened;
- whether the source branch is ready for another Operator supervised live
  evidence run, including the proposed bounded command/scenario.
