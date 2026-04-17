#!/bin/bash
# Shared session-start hook for agent-os providers.

set -euo pipefail
ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || pwd)"
AOS="$ROOT/aos"
cd "$ROOT"
SESSION_NAME="${AOS_SESSION_NAME:-}"
BOOTSTRAP_FILE=""
AOS_DOCTOR_JSON=""
AOS_STARTUP_STATE="missing"

refresh_aos_doctor_json() {
  if [ ! -x "$AOS" ]; then
    AOS_DOCTOR_JSON=""
    return 1
  fi
  if ! AOS_DOCTOR_JSON="$("$AOS" doctor --json 2>/dev/null)"; then
    AOS_DOCTOR_JSON=""
    return 1
  fi
  return 0
}

aos_runtime_ready() {
  [ -n "${AOS_DOCTOR_JSON:-}" ] || return 1
  printf '%s' "$AOS_DOCTOR_JSON" | python3 -c "
import json, sys
try:
    payload = json.load(sys.stdin)
except Exception:
    raise SystemExit(1)
runtime = payload.get('runtime', {})
service = payload.get('aos_service', {})
ready = bool(runtime.get('socket_reachable') or runtime.get('daemon_running') or service.get('running'))
raise SystemExit(0 if ready else 1)
" >/dev/null 2>&1
}

ensure_aos_runtime() {
  if [ ! -x "$AOS" ]; then
    AOS_STARTUP_STATE="missing"
    return 1
  fi

  if refresh_aos_doctor_json && aos_runtime_ready; then
    AOS_STARTUP_STATE="already-running"
    return 0
  fi

  if "$AOS" service start --json >/dev/null 2>&1; then
    AOS_STARTUP_STATE="started-via-service"
  else
    AOS_STARTUP_STATE="started-via-serve"
    if command -v nohup >/dev/null 2>&1; then
      nohup "$AOS" serve --idle-timeout none >/dev/null 2>&1 &
    else
      "$AOS" serve --idle-timeout none >/dev/null 2>&1 &
    fi
  fi

  for _ in $(seq 1 20); do
    sleep 0.2
    if refresh_aos_doctor_json && aos_runtime_ready; then
      return 0
    fi
  done

  AOS_STARTUP_STATE="startup-failed"
  refresh_aos_doctor_json || true
  return 1
}

if [ -n "$SESSION_NAME" ]; then
  BOOTSTRAP_FILE="/tmp/aos-handoff-${SESSION_NAME}.json"
  if [ -f "$BOOTSTRAP_FILE" ]; then
    if ! BRIEF="$(python3 - "$BOOTSTRAP_FILE" <<'PY' 2>/dev/null
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    payload = json.load(handle)

print(payload.get("brief", ""))
PY
    )"; then
      BRIEF="(failed to parse bootstrap file)"
    fi
    echo ""
    echo "## Handoff Brief"
    echo "$BRIEF"
    rm -f "$BOOTSTRAP_FILE"
  fi
fi

ensure_aos_runtime || true

echo "--- agent-os session context ---"

if [ -x "$AOS" ]; then
  HELP_TEXT="$("$AOS" --help 2>/dev/null || true)"
  if [ -n "${HELP_TEXT:-}" ]; then
    echo ""
    echo "## AOS Control Surface"
    echo "You are developing agent-os. Your primary tools should be the following control surface:"
    echo ""
    echo "| Role | Instruction |"
    echo "| --- | --- |"
    echo "| Invocation | Use \`./aos\` in this repo, not \`aos\`. |"
    echo "| Point of entry | Start with \`./aos status\`. |"
    echo "| Self-review / recovery | Use \`./aos introspect review\` after failed attempts or when asked to self-review. |"
    echo "| Perception first | Prefer \`./aos see\` and AX-aware x-ray capture over raw image blobs when the CLI can answer the question directly. |"
    echo "| Live control surface | Lean on \`./aos focus\`, \`./aos graph\`, and \`./aos show\` to stay inside the live agent-os control surface. |"
    echo "| Lower-level verbs | The hook already handled daemon bring-up and stale-resource detection; drop to \`doctor\`, \`daemon-snapshot\`, and \`clean\` only when you need deeper detail or explicit cleanup. |"
    echo ""
    echo '```text'
    echo "$HELP_TEXT"
    echo '```'
  fi
fi

if command -v gh >/dev/null 2>&1; then
  ISSUES=$(gh issue list --repo michaelblum/agent-os --limit 10 --json number,title,labels --template '{{range .}}- #{{.number}} {{.title}}{{range .labels}} [{{.name}}]{{end}}
{{end}}' 2>/dev/null || true)
  if [ -n "${ISSUES:-}" ]; then
    echo ""
    echo "## Open Issues"
    echo "$ISSUES"
  fi
fi

if [ -x "$AOS" ]; then
  echo ""
  echo "## AOS Runtime"
  STATUS="$(printf '%s' "$AOS_DOCTOR_JSON" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    mode = d.get('identity',{}).get('mode','?')
    status = d.get('status','?')
    pid = d.get('runtime',{}).get('daemon_pid','?')
    acc = d.get('permissions',{}).get('accessibility', False)
    scr = d.get('permissions',{}).get('screen_recording', False)
    commit = d.get('identity',{}).get('git_commit','?')
    print(f'mode={mode} status={status} pid={pid} startup=${AOS_STARTUP_STATE} commit={commit} acc={\"ok\" if acc else \"NO\"} scr={\"ok\" if scr else \"NO\"}')
except Exception:
    print('aos doctor failed to parse')
" 2>/dev/null || echo "aos not running or not built")"
  echo "$STATUS"
fi

if [ -x "$AOS" ]; then
  CLEAN=$("$AOS" clean --dry-run --json 2>/dev/null | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    if d.get('status') == 'dirty':
        parts = []
        sd = d.get('stale_daemons', [])
        cv = d.get('canvases', [])
        if sd:
            parts.append(f'{len(sd)} stale daemon(s)')
        if cv:
            parts.append(f'{len(cv)} orphaned canvas(es): {\", \".join(c[\"id\"] for c in cv)}')
        print('DIRTY: ' + '; '.join(parts))
    else:
        print('CLEAN')
except Exception:
    print('UNKNOWN')
" 2>/dev/null || echo "UNKNOWN")
  if [ "$CLEAN" != "CLEAN" ] && [ "$CLEAN" != "UNKNOWN" ]; then
    echo ""
    echo "## Stale Resources"
    echo "$CLEAN"
    echo "Run \`./aos clean\` immediately before launching canvases or doing display work."
    echo "Do not ask the user whether stale resources should be cleaned."
  fi
fi

echo ""
echo "## Git State"
BRANCH=$(git -C "$ROOT" branch --show-current 2>/dev/null || echo "?")
AHEAD=$(git -C "$ROOT" rev-list --count origin/main..HEAD 2>/dev/null || echo "?")
DIRTY=$(git -C "$ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
echo "branch=$BRANCH ahead=$AHEAD dirty=$DIRTY"

WT_COUNT=$(git -C "$ROOT" worktree list 2>/dev/null | wc -l | tr -d ' ')
if [ "$WT_COUNT" -gt 1 ]; then
  echo "worktrees=$WT_COUNT (check for parallel work)"
fi

echo ""
echo "--- end session context ---"
