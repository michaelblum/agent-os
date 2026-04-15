#!/bin/bash
# Session-start hook for agent-os
# Injects situational awareness into every Claude Code session.
# Output goes to Claude's context as a system reminder.

set -euo pipefail
ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || echo "/Users/Michael/Code/agent-os")"
AOS="$ROOT/aos"

echo "--- agent-os session context ---"

# 1. Open GitHub Issues (replaced task-queue.md as of 2026-04-11)
if command -v gh &>/dev/null; then
  ISSUES=$(gh issue list --repo michaelblum/agent-os --limit 10 --json number,title,labels --template '{{range .}}- #{{.number}} {{.title}}{{range .labels}} [{{.name}}]{{end}}
{{end}}' 2>/dev/null)
  if [ -n "$ISSUES" ]; then
    echo ""
    echo "## Open Issues"
    echo "$ISSUES"
  fi
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

# 2b. Session-boundary cleanup check (stale daemons, orphaned canvases)
if [ -x "$AOS" ]; then
  CLEAN=$("$AOS" clean --dry-run --json 2>/dev/null | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    if d.get('status') == 'dirty':
        parts = []
        sd = d.get('stale_daemons', [])
        cv = d.get('canvases', [])
        if sd: parts.append(f'{len(sd)} stale daemon(s)')
        if cv: parts.append(f'{len(cv)} orphaned canvas(es): {\", \".join(c[\"id\"] for c in cv)}')
        print('DIRTY: ' + '; '.join(parts))
    else:
        print('CLEAN')
except: print('UNKNOWN')
" 2>/dev/null || echo "UNKNOWN")
  if [ "$CLEAN" != "CLEAN" ] && [ "$CLEAN" != "UNKNOWN" ]; then
    echo ""
    echo "## Stale Resources"
    echo "$CLEAN"
    echo "Run \`aos clean\` to wipe, or \`aos clean --dry-run --json\` for details."
    echo "IMPORTANT: Run \`aos clean\` immediately before launching any canvases or doing display work. Report what was cleaned in your preamble. Do NOT ask — stale resources from previous sessions are always safe to clean."
  fi
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
echo "## Start-of-Session Preamble (REQUIRED)"
echo "Your FIRST response in this session MUST begin with a one-block status preamble summarizing the context above: session name (ask if unknown), branch + ahead/dirty counts, AOS daemon status, and the top 2-3 open issues relevant to the user's likely intent. Keep it tight — 3-6 lines, no headers. Then proceed with the user's request (or ask for it if none given)."
echo ""
echo "## End-of-Session Handoff Protocol"
echo "When this session ends with a handoff to a follow-up session, you MUST:"
echo "1. Post the full brief + pointer to the gateway 'handoff' channel (post_message, from=<this-session-name>)."
echo "2. Pick or confirm the next session's name."
echo "3. pbcopy a ready-to-paste launch command so Michael can start the next session with zero friction:"
echo "   - New session:    claude -n \"<name>\" \"<lead-in referencing the handoff pointer id>\""
echo "   - Resume session: claude --resume \"<name>\" \"<continuation prompt>\""
echo "4. Echo the copied command back in plaintext so Michael can see what's on the clipboard."
echo "This is non-negotiable SOP for cross-session continuity."
echo ""
echo "--- end session context ---"
