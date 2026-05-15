#!/usr/bin/env bash
# Relay profile hook: agentic_relay / session-start
#
# NOTE: This hook runs only in local relay sessions that have repo access.
# Remote GitHub-only relay sessions must perform the equivalent steps manually
# using their available GitHub API tools.
#
# Emits a relay orientation block: open gdi/* branches, open PRs and their
# mergeable_state, and any branches awaiting merge.

set -euo pipefail
REPO_ROOT="${AOS_DOCK_REPO_ROOT:-/Users/Michael/Code/agent-os}"
cd "$REPO_ROOT"

echo ""
echo "## Relay Orientation (agentic_relay)"
echo "profile=agentic_relay"
echo "role=remote Foreman adapter — GitHub-visible review, merge authority, work card authorship, workstream continuity"

if git rev-parse --verify origin/main >/dev/null 2>&1; then
  BASE_REF="origin/main"
else
  BASE_REF="main"
fi

MAIN_SHA="$(git rev-parse "$BASE_REF" 2>/dev/null || echo 'unknown')"
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
    AHEAD="$(git rev-list --count "$BASE_REF..origin/$branch" 2>/dev/null || echo '?')"
    echo "  $branch  sha=$SHA  ahead=$AHEAD"
  done <<< "$GDI_BRANCHES"
fi

echo ""
echo "### Relay actions"
echo "  1. Run pre-merge checklist for any branch above before merging."
echo "  2. Check open PRs on GitHub for mergeable_state."
echo "  3. Write next work card if queue is empty."
