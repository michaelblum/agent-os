# Work Card: Operator AFK Warm Dock TUI Reuse Live Proof V1

**Status:** Accepted with contract exception 2026-05-24

## Result

- Classification: `functional_success_with_contract_exception`.
- Foreman review: accepted as evidence that warm GDI terminal reuse works, but
  not a strict pass under this card's no-command sentinel criteria.
- Warm GDI terminal reuse was confirmed by the human.
- `/clear` followed by `/goal <pointer>` was confirmed by the human, but cannot
  be internally proven from GDI chat alone.
- The sentinel was accepted.
- No stale-goal or repeated-completion behavior occurred.
- No file, provider store, GitHub, runtime, branch, commit, push, or async
  result-routing mutation occurred.
- Contract exception: GDI ran a command to inspect the work-card pointer before
  seeing the sentinel's no-command instruction. This is a flaw in the sentinel
  transfer shape, not in warm dock reuse. A pointer cannot also be the only
  source of a no-command instruction.
- Follow-up routed:
  `docs/design/work-cards/afk-warm-dock-inline-sentinel-contract-v0.md`.

## Transfer Classification

- Recipient: Operator
- Transfer kind: Operator run, supervised live/HITL evidence collection
- Single next goal: prove the existing warm GDI Codex terminal can be reused
  after `/clear` with a safe `/goal` work-card pointer, without launching a new
  provider process or bridge.
- Source artifacts:
  - `docs/design/work-cards/afk-warm-dock-tui-reuse-contract-v0.md`
  - `docs/design/work-cards/operator-afk-warm-dock-tui-reuse-live-proof-v0.md`
  - `docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md`
  - `docs/design/work-cards/afk-session-trigger-stdout-route-object-normalization-v0.md`
  - `scripts/dock-inbound-message-contract`
  - `scripts/afk-session-trigger-prototype.mjs`
  - `scripts/afk-launch-attempt-prototype.mjs`
- Required start ref: `origin/main` with this work card present.
- Output expectation: make no source, docs, config, provider config, provider
  store, gateway, dock runtime, hook, GitHub, branch, PR, push, merge, or async
  result-routing changes. Return a Foreman chat report only.

Provider-owned Codex transcript/catalog metadata may be inspected only for
bounded `session_meta` facts. Do not edit, delete, move, clean, or paste full
transcript bodies from provider-owned Codex files.

## Fresh Context Contract

Operator starts from a fresh context window. Do not assume branch, worktree,
daemon, terminal state, provider process state, Codex metadata state, or the
blocked V0 proof state. Read and rediscover before acting.

## Why This Exists

V0 was blocked by an invalid one-shot proof prompt that caused stale
goal/repeated-completion behavior. This V1 proof uses the dock inbound contract
shape instead: a plain work-card pointer in the clipboard, which the human
enters into the existing GDI Codex CLI as `/goal <pointer>` after `/clear`.

The headless scheduler proof and stdout route-shape cleanup are accepted. This
run is now only the warm-dock reuse proof, not another headless scheduler run.

## Setup And Preflight

Run from `/Users/Michael/Code/agent-os`:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos ready --post-permission
node --test tests/afk-session-trigger-prototype.test.mjs
node --test tests/afk-launch-attempt-prototype.test.mjs
git diff --check
```

Stop if the worktree is dirty, if `HEAD` is not current `main`/`origin/main`
with this work card present, or if readiness is not:

```text
ready=true mode=repo daemon=reachable tap=active
```

If repo-mode TCC or input-tap readiness blocks, run:

```bash
.docks/operator/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `ready`, run:

```bash
./aos ready --post-permission
```

Only continue if readiness reports ready.

## Inbound Contract Check

Validate the GDI sentinel payload before asking the human to send it:

```bash
payload='follow the instructions in docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md'
printf '%s' "$payload" | scripts/dock-inbound-message-contract --target-dock gdi --json
```

Expected:

- `ok=true`;
- `clipboard_payload` is the plain pointer;
- `provider_entry_prefix="/goal "`;
- `provider_entry_preview` starts with
  `/goal follow the instructions in docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md`;
- no error diagnostics;
- no loop-prone proof-prompt warning.

Stop if the payload is rejected or warned as loop-prone.

## Baseline Process And Metadata Snapshot

Before the human touches GDI, capture bounded baseline state:

```bash
ps -axo pid=,ppid=,pgid=,command= | rg 'codex|Codex|server.mjs|bridge-server.mjs|pty-proxy.py' || true
python3 - <<'PY'
from pathlib import Path
import json

roots = [Path('/Users/Michael/.codex/sessions'), Path('/Users/Michael/.codex/archived_sessions')]
items = []
for root in roots:
    if not root.exists():
        continue
    for path in root.rglob('rollout-*.jsonl'):
        try:
            stat = path.stat()
            first = path.open('r', encoding='utf-8').readline()
            event = json.loads(first) if first.strip() else {}
            payload = event.get('payload') if isinstance(event, dict) else {}
            cwd = payload.get('cwd') if isinstance(payload, dict) else None
            session_id = payload.get('id') if isinstance(payload, dict) else None
        except Exception:
            continue
        if cwd and (cwd.endswith('/.docks/gdi') or cwd.endswith('/.docks/operator')):
            items.append((stat.st_mtime, stat.st_size, path, cwd, session_id))
for mtime, size, path, cwd, session_id in sorted(items)[-12:]:
    print(f"{int(mtime)} {size} {session_id or 'unknown'} {cwd} {path}")
PY
```

This reads only the first JSONL line for `session_meta`-style metadata. Do not
dump transcript bodies or user/assistant message content.

Record:

- latest visible `.docks/gdi` session id, file path, mtime, and size;
- latest visible `.docks/operator` session id, file path, mtime, and size;
- existing Codex/TUI process summary;
- whether any proof-owned `codex --no-alt-screen`, `server.mjs`, or
  `pty-proxy.py` process is already present before the proof.

## Human-Gated GDI Step

Ask the human to use the existing warm GDI Codex terminal, not a new terminal
and not an Agent Terminal bridge. The human should enter exactly:

```text
/clear
/goal follow the instructions in docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md
```

The sentinel itself tells GDI not to edit files, run commands, read transcript
files, open GitHub, create branches, commit, push, or route follow-up work.

If the GDI terminal shows stale goal behavior, repeated completion, or loops,
stop and classify `warm_tui_reuse_blocked_stale_goal_loop`. Tell the human to
recover that GDI terminal with:

```text
/goal clear
/clear
```

Do not run a second GDI attempt without returning to Foreman.

## Post-GDI Metadata Check

After GDI reports, capture bounded metadata again with the same metadata-only
script from the baseline section.

Passing GDI evidence requires:

- the human confirms the existing warm GDI Codex terminal was used;
- `/clear` was submitted before the `/goal` work-card pointer;
- the GDI inbound payload was the allowed work-card pointer shape;
- metadata shows a post-dispatch Codex session with cwd ending `.docks/gdi`;
- when a pre-dispatch `.docks/gdi` session id was visible, the post-dispatch
  id differs from it;
- no proof-owned cold `codex --no-alt-screen`, bridge `server.mjs`, or
  `pty-proxy.py` process was started for the warm proof;
- GDI did not edit files, run shell commands, mutate provider state, or loop.

If metadata cannot prove a new `.docks/gdi` session after `/clear`, classify
`warm_tui_metadata_unobserved`.

## Final Checks

Run:

```bash
./aos ready --post-permission
git status --short --branch
ps -axo pid=,ppid=,pgid=,command= | rg 'codex|Codex|server.mjs|bridge-server.mjs|pty-proxy.py' || true
```

Do not delete provider-owned Codex files. Do not kill existing user-owned dock
Codex terminals.

## Classification

Use one of these:

- `pass`: GDI warm terminal reuse, `/clear` boundary, safe `/goal` pointer,
  metadata session change, no cold launch/bridge, no mutation, and no loop are
  all verified.
- `warm_tui_metadata_unobserved`: GDI accepted the pointer but metadata did not
  show a new `.docks/gdi` session boundary.
- `warm_tui_reuse_blocked_stale_goal_loop`: stale goal/repeated completion
  behavior occurred.
- `gdi_terminal_not_warm`: the target was not an existing GDI Codex terminal.
- `human_needed`: the human did not want to use `/clear`, or permissions/setup
  blocked the bounded proof.

## Completion Report Required

Return a concise Foreman report with:

- branch/head and clean/dirty status before and after;
- readiness before and after;
- preflight results;
- inbound contract result for the GDI sentinel payload;
- baseline and post-GDI metadata summary for `.docks/gdi` and `.docks/operator`;
- whether the human used the existing warm GDI terminal;
- whether `/clear` then `/goal <pointer>` was used;
- GDI's sentinel response summary;
- process comparison summary showing no proof-owned cold provider/bridge/pty
  process was started;
- whether transcript bodies were read, expected answer: no;
- explicit statement that no forbidden mutation or async result routing
  occurred;
- remaining follow-up recommendation.
