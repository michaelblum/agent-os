# Work Card: Operator AFK Session Trigger Headless Scheduler Live Proof V0

**Status:** Accepted with deterministic follow-up 2026-05-24

## Result

- Classification: `pass`.
- Foreman review: accepted for the headless scheduler/provider/cleanup gate.
  The run proved current `main` can complete a no-fixture
  `./aos dev afk-session-trigger` Codex/Implementer scheduler proof with provider
  acceptance through Codex adapter metadata and verified cleanup.
- Branch/ref gates passed on `main` at
  `d629afa5a40ce386b462775b32bfbec3016d1b4b`, matching `origin/main` before
  and after. The worktree stayed clean.
- Readiness before and after reported
  `ready=true mode=repo daemon=reachable tap=active`.
- Preflight passed:
  - `node --test tests/afk-session-trigger-prototype.test.mjs` with 22/22
    passing;
  - `node --test tests/afk-launch-attempt-prototype.test.mjs` with 48/48
    passing;
  - `node --test tests/sigil-agent-terminal-server.test.mjs` with 19/19
    passing;
  - `cd packages/host && npm test` with 63/63 passing;
  - `git diff --check`.
- Live trigger evidence:
  - top-level `status=completed`;
  - `packet.validation_status=valid`;
  - `scheduler.lifecycle_state=completed`;
  - `dispatch.provider_launch_allowed=true`;
  - `dispatch.launch_root=the implementer native subagent`;
  - terminal substrate `status=observed`, driver `process`, cwd
    `/Users/Michael/Code/agent-os/the implementer native subagent`, command
    `codex --no-alt-screen`;
  - prompt mode `codex_goal`, prefix `""`, transport `file_pointer`,
    and ref
    `docs/design/work-cards/operator-afk-session-trigger-headless-scheduler-live-proof-v0.md`;
  - prompt preview included `Your work card is at ...`;
  - `provider_execution_observed=true`.
- Provider acceptance closed:
  - `provider_acceptance.status=provider_session_observed`;
  - provider session id `019e58e9-54d8-7770-9be4-a88882c7e906`;
  - observation source `codex_adapter_metadata`;
  - provider cwd `/Users/Michael/Code/agent-os/the implementer native subagent`;
  - `codex_adapter.status=observed`;
  - `codex_adapter.correlation_status=matched_by_cwd_time_window`;
  - matched cwd basis `intended_launch_cwd`;
  - matched thread `019e58e9-54d8-7770-9be4-a88882c7e906`.
- Cleanup was verified. Process comparison showed the owned live launch cleaned
  up; only pre-existing Codex app and Sigil Agent Terminal bridge processes
  remained.
- No stale `provider_session_id_not_observed`, provider-acceptance,
  prompt-profile, cleanup, or async-route mismatch remained in the completed
  provider receipt.
- Residual deterministic finding: `result_route.status=unsupported` for the
  packet's stdout route object, with `result_route_unsupported`. No async
  result routing was started. Foreman accepted this as a local route-shape
  compatibility gap, not a live provider failure, and routed
  `docs/design/work-cards/afk-session-trigger-stdout-route-object-normalization-v0.md`.
- Bounded metadata note: Codex diagnostics included
  `codex_session_meta_incomplete` for older/incomplete rollout files. The new
  provider metadata file was observed by path/mtime/size only:
  `rollout-2026-05-24T03-35-47-019e58e9-54d8-7770-9be4-a88882c7e906.jsonl`.
- Boundary confirmed: transcript bodies were not read or copied, only bounded
  metadata and receipt fields were inspected. No source, docs, config, provider
  store, gateway, dock profile, hook, GitHub, branch, PR, push, merge, or async
  result-routing mutation occurred during the Operator run.

## Transfer Classification

- Recipient: Operator
- Transfer kind: Operator run, supervised live/HITL evidence collection
- Single next goal: run one no-fixture `./aos dev afk-session-trigger`
  Codex/Implementer scheduler proof on current `main`, verify the headless receipt
  closes with provider acceptance and cleanup, or classify the exact blocker.
- Source artifacts:
  - `docs/design/work-cards/operator-afk-agent-terminal-provider-orchestration-live-proof-v0.md`
  - `docs/design/work-cards/operator-afk-dev-session-trigger-prompt-prefix-provider-acceptance-live-proof-v0.md`
  - `docs/design/work-cards/afk-dev-session-trigger-codex-adapter-metadata-mismatch-cleanup-v0.md`
  - `scripts/afk-session-trigger-prototype.mjs`
  - `scripts/afk-launch-attempt-prototype.mjs`
  - `tests/afk-session-trigger-prototype.test.mjs`
  - `tests/afk-launch-attempt-prototype.test.mjs`
- Required start ref: `origin/main` with this work card present.
- Output expectation: make no source, docs, config, provider config, provider
  store, gateway, dock profile, hook, GitHub, branch, PR, push, merge, or async
  result-routing changes. Return a Foreman chat report only.

Provider-owned Codex transcript/catalog metadata may be created by the live
provider run. Read only bounded metadata needed for proof classification. Do
not edit, delete, move, clean, or paste full bodies from provider-owned Codex
files.

## Fresh Context Contract

Operator starts from a fresh context window. Do not assume branch, worktree,
daemon, bridge process, provider session, transcript/catalog state, or prior
proof state. Read and rediscover before acting.

## Why This Exists

The headed Agent Terminal provider proof passed on 2026-05-24, proving live UI
input and real Codex execution after the paste/Enter fix. The previous
supervised `afk-session-trigger` Codex/Implementer proof also passed after the
provider-native  transport and metadata mismatch cleanup. This run now
checks the current `main` headless scheduler receipt path as the next narrow
AFK milestone, without adding the broader warm-dock proof yet.

## Setup And Preflight

Run from `/Users/Michael/Code/agent-os`:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos ready --post-permission
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
node --test tests/sigil-agent-terminal-server.test.mjs
cd packages/host && npm test
git diff --check
```

Stop if the worktree is dirty, if `HEAD` is not current `main`/`origin/main`
with this work card present, or if readiness is not:

```text
ready=true mode=repo daemon=reachable tap=active
```

If repo-mode TCC or input-tap readiness blocks, run:

```bash
report the supervised-runtime blocker to Foreman
```

Then stop with `manual_intervention`. After the human returns with `finished`, run:

```bash
./aos ready --post-permission
```

Only continue if readiness reports ready.

## Baseline Process And Metadata Snapshot

Before the trigger run, capture bounded baseline state:

```bash
ps -axo pid=,ppid=,pgid=,command= | rg 'server.mjs|bridge-server.mjs|pty-proxy.py|codex --no-alt-screen|Codex' || true
python3 - <<'PY'
from pathlib import Path
import time
roots = [Path('/Users/Michael/.codex/sessions'), Path('/Users/Michael/.codex/archived_sessions')]
cutoff = time.time() - 10 * 60
items = []
for root in roots:
    if not root.exists():
        continue
    for path in root.rglob('*'):
        if path.is_file() and path.stat().st_mtime >= cutoff:
            items.append((path.stat().st_mtime, path.stat().st_size, path))
for mtime, size, path in sorted(items)[-20:]:
    print(f"{int(mtime)} {size} {path}")
PY
```

Record only paths, mtimes, sizes, and high-level metadata. Do not open or paste
full transcript bodies.

## Packet And Trigger Run

Create temporary packet and output paths outside the repo. The packet should
use:

- `packet_id`: `operator-afk-session-trigger-headless-scheduler-live-proof-v0`
- `source_artifact`:
  `docs/design/work-cards/operator-afk-session-trigger-headless-scheduler-live-proof-v0.md`
- `requested_recipient`: `implementer`
- `cwd` and `worktree`: `/Users/Michael/Code/agent-os`
- `required_start_ref`: `origin/main`
- `provider_hint`: `codex`
- `result_route`: one local stdout route
- `external_publication_policy`: `local-only`
- `goal`: `current-main headless AFK scheduler proof after Agent Terminal provider proof`

Run exactly one no-fixture trigger attempt:

```bash
./aos dev afk-session-trigger \
  --packet <temp-packet.json> \
  --provider codex \
  --dock implementer \
  --supervised-live-launch \
  --i-am-present \
  --json \
  --timestamp <iso> \
  --idempotence-salt operator-afk-session-trigger-headless-scheduler-live-proof-v0 \
  --out <temp-output.json>
```

Do not pass `--bridge-visibility-fixture`, `--cleanup-proof-fixture`,
`--provider-session-id`, `--codex-home`, or the internal
`--provider-launch-dry-run` script flag. Do not start async result routing.

Record:

- command exit code;
- top-level `status`;
- `packet.validation_status`;
- `scheduler.lifecycle_state`;
- `dispatch.provider_launch_allowed`;
- `dispatch.launch_root`;
- `terminal_substrate.status`, `driver`, `cwd`, and `command`;
- `terminal_substrate.input_submission.status`;
- `terminal_substrate.input_submission.provider_prompt_mode`;
- `terminal_substrate.input_submission.provider_prompt_prefix`;
- `terminal_substrate.input_submission.prompt_transport` and `prompt_ref`, if
  present;
- `terminal_substrate.input_submission.provider_execution_observed`;
- `terminal_substrate.snapshot_ref`;
- bounded `terminal_substrate.snapshot_summary` fields, especially
  `text_excerpt`;
- `provider_acceptance.status`;
- `provider_acceptance.provider_session_id`;
- `provider_acceptance.observation_source`;
- `provider_acceptance.provider_reported_cwd`;
- `provider_acceptance.provider_reported_branch`;
- `provider_acceptance.provider_reported_head`;
- `codex_adapter.status`;
- `codex_adapter.correlation_status`;
- `codex_adapter.matched_cwd_basis`;
- `codex_adapter.matched_thread_id`;
- `codex_adapter.mismatches`;
- `cleanup.status` and proof entries;
- `result_route.status`;
- all top-level and nested mismatch codes.

## Passing Evidence

Classify `pass` only if all are true:

- exit code is `0`;
- top-level `status=completed`;
- `packet.validation_status=valid`;
- `scheduler.lifecycle_state=completed`;
- `dispatch.provider_launch_allowed=true`;
- `terminal_substrate.input_submission.status=submitted`;
- `terminal_substrate.input_submission.provider_prompt_mode=codex_goal`;
- `terminal_substrate.input_submission.provider_prompt_prefix=""`;
- prompt or bounded snapshot evidence shows a short `Your work card is at ...` pointer;
- `terminal_substrate.input_submission.provider_execution_observed=true`;
- `provider_acceptance.status=provider_session_observed`;
- `provider_acceptance.provider_session_id` is a concrete observed id;
- if metadata promotion closes the gate,
  `provider_acceptance.observation_source=codex_adapter_metadata` and
  `codex_adapter.correlation_status=matched_by_cwd_time_window`;
- provider cwd is `the implementer native subagent` or otherwise matches the intended launch cwd;
- `cleanup.status=verified`;
- no top-level or nested stale `provider_session_id_not_observed` mismatch
  remains in the completed receipt;
- no `provider_acceptance_unobserved`, prompt-profile mismatch, cleanup, or
  async route mismatch remains in a pass.

If provider acceptance remains unobserved with verified cleanup, classify
`provider_acceptance_unobserved_still_open`. If provider acceptance is observed
but cleanup is not verified, classify `cleanup_unverified`. If the trigger
launches and completes but stale nested mismatch evidence remains, classify
`receipt_mismatch_cleanup_regressed`.

## Final Checks

After the run, capture metadata-only post-state:

```bash
python3 - <<'PY'
from pathlib import Path
import time
roots = [Path('/Users/Michael/.codex/sessions'), Path('/Users/Michael/.codex/archived_sessions')]
cutoff = time.time() - 20 * 60
items = []
for root in roots:
    if not root.exists():
        continue
    for path in root.rglob('*'):
        if path.is_file() and path.stat().st_mtime >= cutoff:
            items.append((path.stat().st_mtime, path.stat().st_size, path))
for mtime, size, path in sorted(items)[-30:]:
    print(f"{int(mtime)} {size} {path}")
PY
./aos ready --post-permission
git status --short --branch
ps -axo pid=,ppid=,pgid=,command= | rg 'server.mjs|bridge-server.mjs|pty-proxy.py|codex --no-alt-screen|Codex' || true
```

Remove only temporary packet/output files you created outside the repo. Do not
delete provider-owned Codex files.

## Completion Report Required

Return a concise Foreman report with:

- branch/head and clean/dirty status before and after;
- readiness before and after;
- preflight results;
- temp packet/output paths, with confirmation they were removed;
- command exit code and key receipt fields listed above;
- headless scheduler classification;
- provider metadata summary, including session id and cwd when visible;
- cleanup verification;
- process comparison summary;
- whether transcript bodies were read, expected answer: no;
- explicit statement that no forbidden mutation or async result routing
  occurred;
- remaining follow-up recommendation, especially whether the next slice should
  be the warm-dock Implementer reuse proof or Agent Terminal integration for persistent
  AFK visibility.
