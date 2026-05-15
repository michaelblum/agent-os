#!/usr/bin/env bash
# Relay profile hook: agentic_relay / session-start
#
# NOTE: This hook runs only in local relay sessions that have repo access.
# Remote browser-based relay sessions (e.g. Perplexity) must perform the
# equivalent steps manually using GitHub API tools.
#
# Emits a relay orientation block: open gdi/* branches, open PRs and their
# mergeable_state, and any branches awaiting merge.

set -euo pipefail
REPO_ROOT="${AOS_DOCK_REPO_ROOT:-/Users/Michael/Code/agent-os}"
cd "$REPO_ROOT"

echo ""
echo "## Relay Orientation (agentic_relay)"
echo "profile=agentic_relay"
echo "role=relay partner — merge authority, work card authorship, workstream continuity"

MAIN_SHA="$(git rev-parse origin/main 2>/dev/null || git rev-parse main 2>/dev/null || echo 'unknown')"
echo "origin/main=$MAIN_SHA"

echo ""
echo "### Open gdi/* branches (waiting for relay review/merge)"
GDI_BRANCHES="$(git branch -r --format='%(refname:short)' 2>/dev/null | grep 'origin/gdi/' | sed 's|origin/||' | sort -u || true)"
if [[ -z "$GDI_BRANCHES" ]]; then
  echo "  none"
else
  while IFS= read -r branch; do
    [[ -z "$branch" ]] && continue
    SHA="$(git rev-parse "origin/$branch" 2>/dev/null || echo 'unknown')"
    AHEAD="$(git rev-list --count "main..origin/$branch" 2>/dev/null || echo '?')"
    echo "  $branch  sha=$SHA  ahead=$AHEAD"
  done <<< "$GDI_BRANCHES"
fi

echo ""
echo "### Relay actions"
echo "  1. Run pre-merge checklist for any branch above before merging."
echo "  2. Check open PRs on GitHub for mergeable_state."
echo "  3. Write next work card if queue is empty."
