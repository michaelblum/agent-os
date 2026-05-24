# Work Card: Operator AFK Agent Terminal Provider Orchestration Live Proof V0

**Status:** Ready for Operator

## Transfer Classification

- Recipient: Operator
- Transfer kind: Operator run, supervised live/HITL evidence collection
- Single next goal: run one proof-owned headed Agent Terminal Codex session on
  current `main`, submit one harmless prompt through the live terminal UI, watch
  Codex complete bounded local work, collect bridge/session/provider metadata,
  and clean up proof-owned runtime state.
- Source artifacts:
  - `docs/design/work-cards/agent-terminal-input-ux-parity-v0.md`
  - `docs/design/work-cards/agent-terminal-paste-shortcut-live-correction-v0.md`
  - `docs/design/work-cards/operator-afk-visible-milestone-proof-v0.md`
  - `packages/toolkit/components/agent-terminal/launch.sh`
  - `packages/toolkit/components/agent-terminal/bridge-server.mjs`
  - `docs/api/toolkit/runtime.md`
- Required start ref: `origin/main` at
  `707714783495dc65d98665578e3322c1cc4adac7` or later with this work card
  present.
- Output expectation: make no source, docs, config, provider config, provider
  store, gateway, dock profile, hook, GitHub, branch, PR, push, merge, or async
  result-routing changes. Return a Foreman chat report only.

Provider-owned Codex transcript/catalog metadata may be created by the live
provider run. Read only bounded metadata needed for proof classification. Do
not edit, delete, move, clean, or paste full bodies from provider-owned Codex
files.

## Fresh Context Contract

Operator starts from a fresh context window. Do not assume branch, worktree,
daemon, canvas, bridge process, provider session, or prior live proof state.
Read and rediscover before acting.

## Why This Exists

Foreman accepted and live-verified the Agent Terminal input fix on 2026-05-24:
`Cmd+V`, `Ctrl+V`, right-click Paste, and wheel scrollback all worked on a
throwaway bash Agent Terminal. This run is the next provider-spend proof: a
real Codex session must accept a prompt through the headed Agent Terminal UI,
complete inconsequential work, and leave reviewable bridge/session evidence.

This card does not prove every headless AFK scheduler path. It proves the
headed Agent Terminal provider orchestration path after the input fix, with
metadata useful for deciding the next AFK scheduler follow-up.

## Setup And Preflight

Run from `/Users/Michael/Code/agent-os`:

```bash
git status --short --branch
git rev-parse HEAD origin/main
./aos ready --post-permission
node --test tests/renderer/agent-terminal-terminal-controller.test.mjs
node --test tests/renderer/agent-terminal-bridge-client.test.mjs
git diff --check
```

Stop if the worktree is dirty, if `HEAD` is not on current `main`/`origin/main`
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

## Proof-Owned Runtime Names

Use proof-owned names so cleanup is unambiguous:

```bash
export PORT=17794
export CANVAS_ID=operator-agent-terminal-provider-proof
export SESSION=operator-provider-proof-17794
export BRIDGE_SESSION=aos-agent-bridge-operator-provider-proof
export CWD_TARGET=/Users/Michael/Code/agent-os/.docks/gdi
export AGENT_COMMAND='codex --no-alt-screen'
export PROOF_TOKEN="agent-terminal-provider-proof-$(date +%Y%m%d%H%M%S)"
```

Do not reuse existing warm-suspended Agent Terminal WebViews. The point is to
load the current Agent Terminal JS after the accepted input fix.

## Baseline Evidence

Before launch, capture bounded baseline state:

```bash
./aos show list --json
ps -axo pid=,ppid=,pgid=,command= | rg 'agent-terminal|bridge-server.mjs|pty-proxy.py|codex --no-alt-screen|Codex' || true
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

## Launch Headed Agent Terminal

Launch a new headed Agent Terminal surface:

```bash
PORT="$PORT" \
CANVAS_ID="$CANVAS_ID" \
SESSION="$SESSION" \
BRIDGE_SESSION="$BRIDGE_SESSION" \
CWD_TARGET="$CWD_TARGET" \
AGENT_COMMAND="$AGENT_COMMAND" \
  packages/toolkit/components/agent-terminal/launch.sh --restart
```

Confirm the bridge and surface:

```bash
curl -fsS "http://127.0.0.1:${PORT}/health"
curl -fsS "http://127.0.0.1:${PORT}/dock-terminal-session?session=${SESSION}&dock=gdi&cwd=${CWD_TARGET}&provider=codex"
./aos show list --json
```

The canvas must be visible and focused or focusable. If Codex shows an auth,
model-selection, update, or provider account blocker that cannot be resolved
without human credential action, stop as `provider_auth_or_setup_needed`.

## Submit The Provider Prompt Through The UI

Use the Agent Terminal UI for prompt entry. Do not use bridge `/input` to submit
the provider prompt, because that would bypass the live input behavior being
proved.

Put exactly one harmless prompt on the clipboard:

```bash
cat <<EOF | pbcopy
Run a bounded local proof for Foreman. Do not edit files, do not commit, do not change git state, and do not read or quote provider transcript files. In /Users/Michael/Code/agent-os, run: git status --short --branch; node --test tests/renderer/agent-terminal-bridge-client.test.mjs. Then reply with the branch, whether the worktree was clean, the exact node test pass/fail summary, and this proof token: ${PROOF_TOKEN}
EOF
```

Click inside the Agent Terminal terminal pane, then send:

```bash
./aos do key cmd+v
```

Capture a bounded snapshot:

```bash
curl -fsS "http://127.0.0.1:${PORT}/snapshot?session=${SESSION}&lines=80"
```

If the prompt text or `PROOF_TOKEN` is not visible in the live terminal after
`Cmd+V`, classify `agent_terminal_shortcut_paste_regressed` and stop before
spending provider execution tokens. Do not fall back to bridge `/input`.

If the pasted prompt is visible, submit it through the UI:

```bash
./aos do key Enter
```

If Enter does not submit the visible prompt, classify
`provider_prompt_unsubmitted` and stop.

## Observe Provider Execution

Wait for at most 12 minutes. Poll snapshots every 30 to 60 seconds:

```bash
curl -fsS "http://127.0.0.1:${PORT}/snapshot?session=${SESSION}&lines=120"
```

Passing execution evidence requires:

- Codex visibly accepted the submitted prompt.
- The proof token appears in the final provider response or immediately
  adjacent live terminal output.
- The provider reports the result of
  `node --test tests/renderer/agent-terminal-bridge-client.test.mjs`.
- The provider reports branch/worktree cleanliness from
  `git status --short --branch`.
- No source file, docs file, config file, provider config, provider store,
  gateway, dock profile, hook, GitHub, branch, PR, push, merge, or async
  result-routing mutation occurred.

If Codex requests permission for the exact read-only/status command or the
single Node test command in the prompt, the human may approve that exact action.
Do not approve file edits, dependency installs, network access, commits, pushes,
or broad filesystem scans. If approval cannot be constrained to the requested
harmless work, stop as `provider_approval_scope_blocked`.

If the provider stalls, loops, or fails to produce a final response within 12
minutes, classify `provider_execution_stalled`.

## Bridge And Provider Metadata Checks

After execution completes or stalls, collect metadata-only evidence:

```bash
curl -fsS "http://127.0.0.1:${PORT}/health"
curl -fsS "http://127.0.0.1:${PORT}/dock-terminal-session?session=${SESSION}&dock=gdi&cwd=${CWD_TARGET}&provider=codex"
encoded_cwd="$(python3 - <<'PY'
from urllib.parse import quote
print(quote('/Users/Michael/Code/agent-os/.docks/gdi', safe=''))
PY
)"
curl -fsS "http://127.0.0.1:${PORT}/sessions?cwd=${encoded_cwd}&provider=codex"
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
```

If a concrete Codex session id is visible from `/sessions` or other bounded
metadata, record the id and whether its cwd is `.docks/gdi`. Do not paste full
transcript bodies. If no provider session id is visible but the terminal proof
completed, classify metadata as `provider_metadata_unobserved` rather than
failing the whole run.

Run a local final status check outside the provider:

```bash
git status --short --branch
./aos ready --post-permission
```

## Cleanup

Remove only proof-owned runtime state:

```bash
./aos show remove --id "$CANVAS_ID" || true
tmux kill-session -t "$BRIDGE_SESSION" 2>/dev/null || true
tmux kill-session -t "$SESSION" 2>/dev/null || true
```

Verify cleanup:

```bash
curl -fsS "http://127.0.0.1:${PORT}/health" || true
ps -axo pid=,ppid=,pgid=,command= | rg "${BRIDGE_SESSION}|${SESSION}|${PORT}|operator-provider-proof|operator-agent-terminal-provider-proof" || true
./aos show list --json
git status --short --branch
```

Do not delete provider-owned Codex transcript/catalog files.

## Classification

Use one of these classifications in the report:

- `pass`: UI prompt submission, provider execution, bounded observation,
  metadata checks, cleanup, readiness, and git status all meet the required
  evidence.
- `agent_terminal_shortcut_paste_regressed`: `Cmd+V` did not place the prompt
  into the headed Agent Terminal.
- `provider_prompt_unsubmitted`: prompt was visible but could not be submitted.
- `provider_auth_or_setup_needed`: Codex could not start without human
  credential/setup action.
- `provider_approval_scope_blocked`: provider requested approval outside the
  harmless bounded work.
- `provider_execution_stalled`: provider accepted the prompt but did not finish
  within 12 minutes.
- `provider_completed_metadata_unobserved`: provider completed the work, but no
  concrete provider metadata/session id was visible.
- `cleanup_unverified`: provider evidence was obtained, but proof-owned canvas,
  bridge, tmux, or process cleanup could not be verified.
- `human_needed`: repo-mode TCC/input-tap or credential state needs the human.

## Completion Report Required

Return a concise Foreman report with:

- branch/head and clean/dirty status before and after;
- readiness result before and after;
- preflight test results;
- launch command summary, canvas id, port, session, bridge session, and cwd;
- exact prompt-submission method used, including whether `Cmd+V` pasted and
  Enter submitted;
- bounded execution evidence: proof token observed, command/test summary, and
  final provider classification;
- bridge health and `dock-terminal-session` summary;
- provider metadata summary, including session id and cwd when visible;
- cleanup verification;
- explicit statement that transcript bodies were not pasted;
- explicit statement that no forbidden mutation or async result routing
  occurred;
- remaining follow-up recommendation, especially whether the next slice should
  be a headless `./aos dev afk-session-trigger` scheduler proof.
