#!/bin/bash
# Shared session-start hook for agent-os providers.

set -euo pipefail
ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || pwd)"
AOS="$ROOT/aos"

# --- Session Communication Layer ---
SESSION_NAME="${AOS_SESSION_NAME:-}"

if [ -n "$SESSION_NAME" ]; then
  echo ""
  echo "## Gateway Registration"
  echo "Register this session: name=\"${SESSION_NAME}\" harness=\"claude-code\" role=\"worker\""
  echo "Call register_session(name='${SESSION_NAME}', harness='claude-code', role='worker') now."
else
  echo ""
  echo "## Session Name"
  echo "No AOS_SESSION_NAME set. Name this session early:"
  echo "  Use /rename and then register with the gateway via register_session()."
fi

if [ -n "$SESSION_NAME" ] && [ -f "/tmp/aos-handoff-${SESSION_NAME}.json" ]; then
  BRIEF=$(python3 -c "
import json, sys
d = json.load(open('/tmp/aos-handoff-${SESSION_NAME}.json'))
print(d.get('brief', ''))
" 2>/dev/null || echo "(failed to parse bootstrap file)")
  echo ""
  echo "## Handoff Brief"
  echo "$BRIEF"
  rm -f "/tmp/aos-handoff-${SESSION_NAME}.json"
fi

echo "--- agent-os session context ---"

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
  STATUS=$("$AOS" doctor --json 2>/dev/null | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    mode = d.get('identity',{}).get('mode','?')
    status = d.get('status','?')
    pid = d.get('runtime',{}).get('daemon_pid','?')
    acc = d.get('permissions',{}).get('accessibility', False)
    scr = d.get('permissions',{}).get('screen_recording', False)
    commit = d.get('identity',{}).get('git_commit','?')
    print(f'mode={mode} status={status} pid={pid} commit={commit} acc={\"ok\" if acc else \"NO\"} scr={\"ok\" if scr else \"NO\"}')
except Exception:
    print('aos doctor failed to parse')
" 2>/dev/null || echo "aos not running or not built")
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
    echo "Run \`aos clean\` immediately before launching canvases or doing display work."
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
echo "## Shared Start-of-Session Method"
echo "Open with a compact status preamble: branch, ahead/dirty, AOS runtime, stale-resource status, and the 2-3 most relevant issues."
echo "When verifying toolkit or display work, use real \`aos\` canvases and \`aos see\`, not a raw browser page."
echo ""
echo "## Shared Handoff Method"
echo "When handing off, post the brief to the gateway handoff channel and emit one ready-to-run continuation path for the active runtime."
echo ""
echo "--- end session context ---"

