#!/bin/bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

if [ -x "./aos" ]; then
  STATUS_JSON="$(./aos status --json 2>/dev/null || true)"
else
  STATUS_JSON=""
fi

if [ -n "$STATUS_JSON" ]; then
  STATUS_LINE="$(printf '%s' "$STATUS_JSON" | python3 -c '
import json
import sys

payload = json.load(sys.stdin)
git = payload.get("git", {})
daemon = payload.get("daemon_snapshot", {})
runtime = payload.get("runtime", {})
stale = payload.get("stale_resources", {})

branch = git.get("branch") or "?"
dirty = git.get("dirty_files", 0)
status = payload.get("status") or "?"
focused = daemon.get("focused_app") or "-"
displays = daemon.get("displays", 0)
windows = daemon.get("windows", 0)
channels = daemon.get("channels", 0)
ahead = git.get("ahead_of_origin_main", 0)
stale_daemons = stale.get("stale_daemons", 0)
stale_canvases = len(stale.get("canvases", []))
mode = payload.get("identity", {}).get("mode") or runtime.get("mode") or "?"

parts = [
    "AOS",
    branch,
    f"d{dirty}",
    status,
    focused,
    f"{displays}d{windows}w",
    f"c{channels}",
    f"+{ahead}",
]
if mode != "repo":
    parts.append(f"m:{mode}")
if stale_daemons:
    parts.append(f"sd{stale_daemons}")
if stale_canvases:
    parts.append(f"sc{stale_canvases}")
print("|".join(parts))
')"
else
  BRANCH="$(git branch --show-current 2>/dev/null || echo '?')"
  DIRTY="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  STATUS_LINE="AOS|${BRANCH}|d${DIRTY}|aos?"
fi

printf '%s\n' "$STATUS_LINE"
