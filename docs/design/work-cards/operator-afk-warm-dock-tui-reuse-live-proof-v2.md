# Work Card: Operator AFK Warm Dock TUI Reuse Live Proof V2

**Status:** Pass accepted 2026-05-24

## Result

- Classification: `pass`.
- Foreman review: accepted as strict live proof that the existing warm GDI Codex
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
- The inline GDI payload validated with `ok=true`,
  `provider_entry_prefix="/goal "`, `provider_entry_preview` matching `/goal `
  plus the payload, and `diagnostics=[]`.
- Metadata-only evidence showed a new latest GDI Codex session after the
  human-gated dispatch:
  - baseline `.docks/gdi`: `019e5902-cdaa-79f2-8d44-d4ac1196c517`;
  - post-dispatch `.docks/gdi`: `019e590c-598d-78c0-9ee1-3fd469e6481a`.
- The human confirmed the existing warm GDI terminal was used, `/clear` was
  submitted before `/goal <inline payload>`, the GDI response accepted the
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
- Single next goal: prove the existing warm GDI Codex terminal can be reused
  after `/clear` with the inline no-command sentinel payload, without launching
  a new provider process or bridge.
- Source artifacts:
  - `docs/design/work-cards/operator-afk-warm-dock-tui-reuse-live-proof-v1.md`
  - `docs/design/work-cards/afk-warm-dock-inline-sentinel-contract-v0.md`
  - `docs/design/work-cards/afk-warm-dock-tui-reuse-live-sentinel-v0.md`
  - `.docks/gdi/inbound-contract.json`
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

V1 functionally proved warm GDI terminal reuse, but was not a strict pass
because the no-command sentinel was a work-card pointer. GDI had to inspect the
file before seeing the no-command boundary.

V2 uses the inline GDI payload now declared in `.docks/gdi/inbound-contract.json`
so the no-command boundary is visible before GDI takes any action.

## Inline GDI Payload

Use exactly this payload after `/goal `:

```text
Warm dock TUI reuse validation only. Do not run shell commands, edit files, read provider transcript files, open GitHub, create branches, commit, push, or route follow-up work. Reply with a concise confirmation that this prompt was accepted in the current warm GDI terminal and whether stale-goal or repeated-completion behavior occurred.
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
.docks/operator/scripts/human-needed-tcc-reset
```

Then stop with `human_needed`. After the human returns with `ready`, run:

```bash
./aos ready --post-permission
```

Only continue if readiness reports ready.

## Inbound Contract Check

Validate the inline GDI payload before asking the human to send it:

```bash
payload='Warm dock TUI reuse validation only. Do not run shell commands, edit files, read provider transcript files, open GitHub, create branches, commit, push, or route follow-up work. Reply with a concise confirmation that this prompt was accepted in the current warm GDI terminal and whether stale-goal or repeated-completion behavior occurred.'
printf '%s' "$payload" | scripts/dock-inbound-message-contract --target-dock gdi --json
```

Expected:

- `ok=true`;
- `clipboard_payload` is the inline payload;
- `provider_entry_prefix="/goal "`;
- `provider_entry_preview` is `/goal ` plus the inline payload;
- `diagnostics=[]`.

Stop if the payload is rejected or warned.

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

This reads only the first JSONL line for metadata. Do not dump transcript bodies
or user/assistant message content.

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
/goal Warm dock TUI reuse validation only. Do not run shell commands, edit files, read provider transcript files, open GitHub, create branches, commit, push, or route follow-up work. Reply with a concise confirmation that this prompt was accepted in the current warm GDI terminal and whether stale-goal or repeated-completion behavior occurred.
```

The no-command boundary is in the prompt itself. If the GDI terminal runs a
command, reads a file, opens GitHub, creates a branch, commits, pushes, routes
follow-up work, or loops, stop and classify the run as not a strict pass.

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
- `/clear` was submitted before the `/goal` inline payload;
- the GDI inbound payload was exactly the allowed inline validation shape;
- the GDI response confirms prompt acceptance in the current warm terminal;
- the GDI response reports whether stale-goal or repeated-completion behavior
  occurred;
- no proof-owned cold `codex --no-alt-screen`, bridge `server.mjs`, or
  `pty-proxy.py` process was started for the warm proof;
- GDI did not edit files, run shell commands, read files, mutate provider state,
  open GitHub, create a branch, commit, push, route follow-up work, or loop.

If metadata cannot prove a new `.docks/gdi` session boundary but the human
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

- `pass`: warm GDI terminal reuse, `/clear` boundary, exact inline `/goal`
  payload, GDI confirmation, no cold launch/bridge, no mutation, and no loop are
  verified.
- `pass_human_confirmed_metadata_unobserved`: GDI accepted the exact inline
  payload and the human confirmed the warm terminal flow, but metadata did not
  prove a new `.docks/gdi` session boundary.
- `warm_tui_reuse_blocked_stale_goal_loop`: stale goal/repeated completion
  behavior occurred.
- `gdi_terminal_not_warm`: the target was not an existing GDI Codex terminal.
- `contract_boundary_failed`: GDI ran a command, read a file, or otherwise acted
  before acknowledging the inline no-command boundary.
- `human_needed`: the human did not want to use `/clear`, or permissions/setup
  blocked the bounded proof.

## Completion Report Required

Return a concise Foreman report with:

- branch/head and clean/dirty status before and after;
- readiness before and after;
- preflight results;
- inbound contract result for the inline GDI payload;
- baseline and post-GDI metadata summary for `.docks/gdi` and `.docks/operator`;
- whether the human used the existing warm GDI terminal;
- whether `/clear` then `/goal <inline payload>` was used;
- GDI's sentinel response summary;
- process comparison summary showing no proof-owned cold provider/bridge/pty
  process was started;
- whether transcript bodies were read, expected answer: no;
- explicit statement that no forbidden mutation or async result routing
  occurred;
- remaining follow-up recommendation.
