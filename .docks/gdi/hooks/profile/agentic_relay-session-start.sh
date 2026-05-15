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
echo "relay_merge_authority=designated Foreman-compatible relay authority; often remote with GitHub access and no local checkout"

if git rev-parse --verify origin/main >/dev/null 2>&1; then
  BASE_REF="origin/main"
else
  BASE_REF="main"
fi

branch_ref() {
  local branch="$1"
  if git rev-parse --verify "origin/$branch" >/dev/null 2>&1; then
    printf 'origin/%s\n' "$branch"
  elif git rev-parse --verify "$branch" >/dev/null 2>&1; then
    printf '%s\n' "$branch"
  fi
}

# Current main SHA
MAIN_SHA="$(git rev-parse "$BASE_REF" 2>/dev/null || echo 'unknown')"
echo "origin/main=$MAIN_SHA"

# Open remote gdi/* branches. These are the relay-visible artifacts; local-only
# gdi branches are not treated as waiting relay work.
echo ""
echo "### Remote gdi/* branches"
GDI_BRANCHES="$(git for-each-ref --format='%(refname:short)' refs/remotes/origin/gdi 2>/dev/null | sed 's|^origin/||' | sort -u || true)"
if [[ -z "$GDI_BRANCHES" ]]; then
  echo "none"
else
  while IFS= read -r branch; do
    [[ -z "$branch" ]] && continue
    REF="$(branch_ref "$branch" || true)"
    if [[ -z "$REF" ]]; then
      continue
    fi
    BRANCH_SHA="$(git rev-parse "$REF" 2>/dev/null || echo 'unknown')"
    # Count commits ahead of main
    AHEAD="$(git rev-list --count "$BASE_REF..$REF" 2>/dev/null || echo '?')"
    # Files changed vs main (for conflict risk signal)
    CHANGED_FILES="$(git diff --name-only "$BASE_REF...$REF" 2>/dev/null || true)"
    FILE_COUNT="$(printf '%s\n' "$CHANGED_FILES" | awk 'NF { count++ } END { print count + 0 }')"
    echo "  branch=$branch sha=$BRANCH_SHA ahead=$AHEAD files_vs_main=$FILE_COUNT"
  done <<< "$GDI_BRANCHES"
fi

LOCAL_GDI_BRANCHES="$(git for-each-ref --format='%(refname:short)' refs/heads/gdi 2>/dev/null | sort -u || true)"
if [[ -n "$LOCAL_GDI_BRANCHES" ]]; then
  echo ""
  echo "### Local-only gdi/* branches"
  while IFS= read -r branch; do
    [[ -z "$branch" ]] && continue
    if git rev-parse --verify "origin/$branch" >/dev/null 2>&1; then
      continue
    fi
    BRANCH_SHA="$(git rev-parse "$branch" 2>/dev/null || echo 'unknown')"
    echo "  branch=$branch sha=$BRANCH_SHA relay_visible=false"
  done <<< "$LOCAL_GDI_BRANCHES"
fi

# Conflict risk: files on current branch (if gdi/*) that overlap with other
# remote relay-visible gdi/* branches.
CURRENT_BRANCH="$(git branch --show-current 2>/dev/null || echo '')"
if [[ "$CURRENT_BRANCH" == gdi/* ]]; then
  echo ""
  echo "### Conflict risk for $CURRENT_BRANCH"
  MY_FILES="$(git diff --name-only "$BASE_REF...HEAD" 2>/dev/null || true)"
  OVERLAP_FOUND=false
  while IFS= read -r other; do
    [[ -z "$other" || "$other" == "$CURRENT_BRANCH" ]] && continue
    OTHER_REF="$(branch_ref "$other" || true)"
    if [[ -z "$OTHER_REF" ]]; then
      continue
    fi
    OTHER_FILES="$(git diff --name-only "$BASE_REF...$OTHER_REF" 2>/dev/null || true)"
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
echo "Do not merge to main. Push branch and report to relay authority."
echo "Report local-only state so remote review knows what GitHub cannot show."
