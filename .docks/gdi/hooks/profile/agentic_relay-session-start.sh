#!/usr/bin/env bash
# GDI profile hook: agentic_relay / session-start
#
# Emits a git context block so GDI starts every session with a clear picture
# of the relay state: current main SHA, open gdi/* branches, and a conflict
# risk signal derived from files changed on each branch vs main.
#
# Output goes to stdout and is visible in GDI's session-start context.
# This hook must remain fast (<3s). It does not mutate any state.

set -euo pipefail
REPO_ROOT="${AOS_DOCK_REPO_ROOT:-/Users/Michael/Code/agent-os}"
cd "$REPO_ROOT"

echo ""
echo "## Relay Context (agentic_relay)"
echo "profile=agentic_relay"
echo "relay_merge_authority=remote relay partner (GitHub API access)"

# Current main SHA
MAIN_SHA="$(git rev-parse origin/main 2>/dev/null || git rev-parse main 2>/dev/null || echo 'unknown')"
echo "origin/main=$MAIN_SHA"

# Open gdi/* branches (local + remote)
echo ""
echo "### Open gdi/* branches"
GDI_BRANCHES="$(git branch -a --format='%(refname:short)' 2>/dev/null | grep -E '(^|/)gdi/' | sed 's|remotes/origin/||' | sort -u || true)"
if [[ -z "$GDI_BRANCHES" ]]; then
  echo "none"
else
  while IFS= read -r branch; do
    [[ -z "$branch" ]] && continue
    BRANCH_SHA="$(git rev-parse "origin/$branch" 2>/dev/null || git rev-parse "$branch" 2>/dev/null || echo 'unknown')"
    # Count commits ahead of main
    AHEAD="$(git rev-list --count "main..origin/$branch" 2>/dev/null || git rev-list --count "main..$branch" 2>/dev/null || echo '?')"
    # Files changed vs main (for conflict risk signal)
    CHANGED_FILES="$(git diff --name-only "main" "origin/$branch" 2>/dev/null || git diff --name-only "main" "$branch" 2>/dev/null || true)"
    FILE_COUNT="$(echo "$CHANGED_FILES" | grep -c . || echo 0)"
    echo "  branch=$branch sha=$BRANCH_SHA ahead=$AHEAD files_vs_main=$FILE_COUNT"
  done <<< "$GDI_BRANCHES"
fi

# Conflict risk: files on current branch (if gdi/*) that overlap with other open gdi/* branches
CURRENT_BRANCH="$(git branch --show-current 2>/dev/null || echo '')"
if [[ "$CURRENT_BRANCH" == gdi/* ]]; then
  echo ""
  echo "### Conflict risk for $CURRENT_BRANCH"
  MY_FILES="$(git diff --name-only main 2>/dev/null || true)"
  OVERLAP_FOUND=false
  while IFS= read -r other; do
    [[ -z "$other" || "$other" == "$CURRENT_BRANCH" ]] && continue
    OTHER_FILES="$(git diff --name-only "main" "origin/$other" 2>/dev/null || git diff --name-only "main" "$other" 2>/dev/null || true)"
    OVERLAP="$(comm -12 <(echo "$MY_FILES" | sort) <(echo "$OTHER_FILES" | sort) || true)"
    if [[ -n "$OVERLAP" ]]; then
      echo "  OVERLAP with $other:"
      while IFS= read -r f; do
        echo "    $f"
      done <<< "$OVERLAP"
      OVERLAP_FOUND=true
    fi
  done <<< "$GDI_BRANCHES"
  if [[ "$OVERLAP_FOUND" == false ]]; then
    echo "  none detected"
  fi
fi

echo ""
echo "### Sequencing rule"
echo "If this work card touches files overlapping an open gdi/* branch, branch"
echo "from that branch instead of main and note the dependency in your report."
echo "Do not merge to main. Push branch and report to relay partner."
