#!/bin/bash
# Session-start hook for agent-os
# Injects situational awareness into every Claude Code session.
# Output goes to Claude's context as a system reminder.

set -euo pipefail
ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || echo "/Users/Michael/Code/agent-os")"
AOS="$ROOT/aos"

echo "--- agent-os session context ---"

# 1. Task queue (first 25 lines — Active + Queued sections)
if [ -f "$ROOT/memory/task-queue.md" ]; then
  echo ""
  echo "## Task Queue"
  head -25 "$ROOT/memory/task-queue.md"
fi

# 2. AOS daemon health (one-line summary)
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
except: print('aos doctor failed to parse')
" 2>/dev/null || echo "aos not running or not built")
  echo "$STATUS"
fi

# 3. Uncommitted work summary
echo ""
echo "## Git State"
BRANCH=$(git -C "$ROOT" branch --show-current 2>/dev/null || echo "?")
AHEAD=$(git -C "$ROOT" rev-list --count origin/main..HEAD 2>/dev/null || echo "?")
DIRTY=$(git -C "$ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
echo "branch=$BRANCH ahead=$AHEAD dirty=$DIRTY"

# 4. Active worktrees (if any besides main)
WT_COUNT=$(git -C "$ROOT" worktree list 2>/dev/null | wc -l | tr -d ' ')
if [ "$WT_COUNT" -gt 1 ]; then
  echo "worktrees=$WT_COUNT (check for parallel work)"
fi

echo ""
echo "--- end session context ---"
