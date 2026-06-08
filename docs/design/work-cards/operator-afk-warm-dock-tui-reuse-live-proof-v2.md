# Work Card: Operator AFK Warm Dock TUI Reuse Live Proof V2

**Status:** Pass accepted 2026-05-24

## Result

- Classification: `pass`.
- Foreman review: accepted as strict live proof that the existing warm Implementer Codex
  terminal can be reused after `/clear` with the inline no-command sentinel
  payload.
- Branch/ref gates passed on `main` at
  `08dceaaaa2b4c1363aaa2d640a885d76ce38ec24`, with `HEAD == origin/main` and a
  clean worktree before and after the Operator run.
- Readiness before and after was
  `ready=true mode=repo daemon=reachable tap=active`.
- Preflight passed:
  - `node --test tests/schemas/aos-dock-inbound-message-contract-v0.test.mjs`
    with 10/10 passing;
  - `git diff --check`.
- The inline Implementer payload validated with `ok=true`,
  `provider_entry_prefix=""`, `provider_entry_preview` matching
  plus the payload, and `diagnostics=[]`.
- Metadata-only evidence showed a new latest Implementer Codex session after the
  human-gated dispatch:
  - baseline `the implementer native subagent`: `019e5902-cdaa-79f2-8d44-d4ac1196c517`;
  - post-dispatch `the implementer native subagent`: `019e590c-598d-78c0-9ee1-3fd469e6481a`.
- The human confirmed the existing warm Implementer terminal was used, `/clear` was
  submitted before `<inline payload>`, the Implementer response accepted the
  prompt in the current warm terminal, and no stale-goal or repeated-completion
  behavior occurred.
- Process comparison showed no proof-owned cold `codex --no-alt-screen`, new
  bridge `server.mjs`, or `pty-proxy.py` process started for the warm proof.
- Transcript bodies were not read.
- No source, docs, config, provider store, gateway, dock runtime, hook, GitHub,
  branch, PR, push, merge, or async result-routing changes were made during the
  Operator run.

## Transfer Classification

- Recipient: Operator
- Transfer kind: Operator run, supervised live/HITL evidence collection
- Single next goal: prove the existing warm Implementer Codex terminal can be reused
  after `/clear` with the inline no-command sentinel payload, without launching
  a new provider process or bridge.
- Source artifacts:
  - `docs/design/work-cards/operator-afk-warm-dock-tui-reuse-live-proof-v1.md`
  - `docs/design/work-cards/afk-warm-dock-inline-sentinel-contract-v0.md`
  - `docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md`
  - the implementer native prompt contract
  - `shared/schemas/aos-dock-inbound-message-contract-v0.md`
  - `scripts/dock-inbound-message-contract`
- Required start ref: `origin/main` at or after
  `4e6c42541b9802401f33fb32d15f7ce97ae1b2a9`, with this work card present.
- Output expectation: make no source, docs, config, provider config, provider
  store, gateway, dock runtime, hook, GitHub, branch, PR, push, merge, or async
  result-routing changes. Return a Foreman chat report only.

Provider-owned Codex transcript/catalog metadata may be inspected only for
bounded `session_meta` facts. Do not edit, delete, move, clean, or paste full
transcript bodies from provider-owned Codex files.

## Fresh Context Contract

Operator starts from a fresh context window. Do not assume branch, worktree,
daemon, terminal state, provider process state, Codex metadata state, or the V1
proof state. Read and rediscover before acting.

## Why This Exists

V1 functionally proved warm Implementer terminal reuse, but was not a strict pass
because the no-command sentinel was a work-card pointer. Implementer had to inspect the
file before seeing the no-command boundary.

V2 uses the inline Implementer payload now declared in the implementer native prompt contract
so the no-command boundary is visible before Implementer takes any action.

## Inline Implementer Payload

Use exactly this payload after :

```text
Warm dock TUI reuse validation only. Do not run shell commands, edit files, read provider transcript files, open GitHub, create branches, commit, push, or route follow-up work. Reply with a concise confirmation that this prompt was accepted in the current warm Implementer terminal and whether stale-goal or repeated-completion behavior occurred.
```

Do not replace this with the superseded pointer:

```text
follow the instructions in docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md
```

## Setup And Preflight

Run from `/Users/Michael/Code/agent-os`:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos ready --post-permission
node --test tests/schemas/aos-dock-inbound-message-contract-v0.test.mjs
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

## Native Prompt Contract Check

Validate the inline Implementer payload before asking the human to send it:

```bash
payload='Warm dock TUI reuse validation only. Do not run shell commands, edit files, read provider transcript files, open GitHub, create branches, commit, push, or route follow-up work. Reply with a concise confirmation that this prompt was accepted in the current warm Implementer terminal and whether stale-goal or repeated-completion behavior occurred.'
printf '%s' "$payload" | scripts/dock-inbound-message-contract --target-dock implementer --json
```

Expected:

- `ok=true`;
- `clipboard_payload` is the inline payload;
- `provider_entry_prefix=""`;
- `provider_entry_preview` is  plus the inline payload;
- `diagnostics=[]`.

Stop if the payload is rejected or warned.

## Baseline Process And Metadata Snapshot

Before the human touches Implementer, capture bounded baseline state:

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
        if cwd and (cwd.endswith('/the implementer native subagent') or cwd.endswith('/the operator native subagent')):
            items.append((stat.st_mtime, stat.st_size, path, cwd, session_id))
for mtime, size, path, cwd, session_id in sorted(items)[-12:]:
    print(f"{int(mtime)} {size} {session_id or 'unknown'} {cwd} {path}")
PY
```

This reads only the first JSONL line for metadata. Do not dump transcript bodies
or user/assistant message content.

Record:

- latest visible `the implementer native subagent` session id, file path, mtime, and size;
- latest visible `the operator native subagent` session id, file path, mtime, and size;
- existing Codex/TUI process summary;
- whether any proof-owned `codex --no-alt-screen`, `server.mjs`, or
  `pty-proxy.py` process is already present before the proof.

## Human-Gated Implementer Step

Ask the human to use the existing warm Implementer Codex terminal, not a new terminal
and not an Agent Terminal bridge. The human should enter exactly:

```text
/clear
Warm dock TUI reuse validation only. Do not run shell commands, edit files, read provider transcript files, open GitHub, create branches, commit, push, or route follow-up work. Reply with a concise confirmation that this prompt was accepted in the current warm Implementer terminal and whether stale-goal or repeated-completion behavior occurred.
```

The no-command boundary is in the prompt itself. If the Implementer terminal runs a
command, reads a file, opens GitHub, creates a branch, commits, pushes, routes
follow-up work, or loops, stop and classify the run as not a strict pass.

If the Implementer terminal shows stale goal behavior, repeated completion, or loops,
stop and classify `warm_tui_reuse_blocked_stale_goal_loop`. Tell the human to
recover that Implementer terminal with:

```text
clear
/clear
```

Do not run a second Implementer attempt without returning to Foreman.

## Post-Implementer Metadata Check

After Implementer reports, capture bounded metadata again with the same metadata-only
script from the baseline section.

Passing Implementer evidence requires:

- the human confirms the existing warm Implementer Codex terminal was used;
- `/clear` was submitted before the `` inline payload;
- the Implementer inbound payload was exactly the allowed inline validation shape;
- the Implementer response confirms prompt acceptance in the current warm terminal;
- the Implementer response reports whether stale-goal or repeated-completion behavior
  occurred;
- no proof-owned cold `codex --no-alt-screen`, bridge `server.mjs`, or
  `pty-proxy.py` process was started for the warm proof;
- Implementer did not edit files, run shell commands, read files, mutate provider state,
  open GitHub, create a branch, commit, push, route follow-up work, or loop.

If metadata cannot prove a new `the implementer native subagent` session boundary but the human
confirms the warm terminal and inline prompt flow, classify as
`pass_human_confirmed_metadata_unobserved` rather than retrying.

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

- `pass`: warm Implementer terminal reuse, `/clear` boundary, exact inline ``
  payload, Implementer confirmation, no cold launch/bridge, no mutation, and no loop are
  verified.
- `pass_human_confirmed_metadata_unobserved`: Implementer accepted the exact inline
  payload and the human confirmed the warm terminal flow, but metadata did not
  prove a new `the implementer native subagent` session boundary.
- `warm_tui_reuse_blocked_stale_goal_loop`: stale goal/repeated completion
  behavior occurred.
- `implementer_terminal_not_warm`: the target was not an existing Implementer Codex terminal.
- `contract_boundary_failed`: Implementer ran a command, read a file, or otherwise acted
  before acknowledging the inline no-command boundary.
- `manual_intervention`: the human did not want to use `/clear`, or permissions/setup
  blocked the bounded proof.

## Completion Report Required

Return a concise Foreman report with:

- branch/head and clean/dirty status before and after;
- readiness before and after;
- preflight results;
- native subagent prompt contract result for the inline Implementer payload;
- baseline and post-Implementer metadata summary for `the implementer native subagent` and `the operator native subagent`;
- whether the human used the existing warm Implementer terminal;
- whether `/clear` then `<inline payload>` was used;
- Implementer's sentinel response summary;
- process comparison summary showing no proof-owned cold provider/bridge/pty
  process was started;
- whether transcript bodies were read, expected answer: no;
- explicit statement that no forbidden mutation or async result routing
  occurred;
- remaining follow-up recommendation.
