#!/usr/bin/env bash
# Shared content-root helpers for one singleton daemon with many worktrees.

aos_content_root_key_for() {
  local prefix="$1"
  local repo_root="$2"
  local branch suffix

  branch="$(git -C "$repo_root" branch --show-current 2>/dev/null || true)"
  if [[ -z "$branch" || "$branch" == "main" ]]; then
    printf '%s\n' "$prefix"
    return
  fi

  suffix="$(
    printf '%s' "$branch" \
      | tr '[:upper:]' '[:lower:]' \
      | sed -E 's/[^a-z0-9]+/_/g; s/^_+//; s/_+$//'
  )"
  printf '%s_%s\n' "$prefix" "${suffix:-worktree}"
}

aos_content_roots_live() {
  local aos_bin="$1"
  shift

  "$aos_bin" content status --json 2>/dev/null \
    | python3 -c '
import json
import pathlib
import sys

pairs = sys.argv[1:]
if len(pairs) % 2:
    raise SystemExit(1)

try:
    roots = json.load(sys.stdin).get("roots", {})
except Exception:
    raise SystemExit(1)

def norm(path):
    return str(pathlib.Path(path).expanduser().resolve(strict=False))

for index in range(0, len(pairs), 2):
    name = pairs[index]
    expected = pairs[index + 1]
    active = roots.get(name)
    if not active or norm(active) != norm(expected):
        raise SystemExit(1)
' "$@"
}

aos_ensure_content_roots_live() {
  local aos_bin="$1"
  shift

  if [ $(( $# % 2 )) -ne 0 ]; then
    echo "aos_ensure_content_roots_live requires root/path pairs" >&2
    return 2
  fi

  if ! aos_content_roots_live "$aos_bin" "$@"; then
    (
      while [ "$#" -gt 0 ]; do
        "$aos_bin" set "content.roots.$1" "$2" >/dev/null || exit $?
        shift 2
      done
    ) || return $?
  fi

  if ! aos_content_roots_live "$aos_bin" "$@"; then
    if [[ -n "${AOS_STATE_ROOT:-}" ]]; then
      echo "Waiting for isolated daemon scoped content roots to become live." >&2
    else
      echo "Refreshing repo daemon so scoped content roots are live." >&2
      "$aos_bin" service restart --mode repo >/dev/null
    fi
  fi

  (
    while [ "$#" -gt 0 ]; do
      "$aos_bin" content wait --root "$1" --auto-start --timeout 15s >/dev/null || exit $?
      shift 2
    done
  )
}
