#!/usr/bin/env bash
# Content-root helpers for local launchers and explicit isolated/scoped runtime
# proofs. The default single-checkout workflow uses canonical root names.

aos_content_root_scope() {
  local raw="${AOS_CONTENT_ROOT_SCOPE:-${AOS_VISUAL_CONTENT_ROOT_SCOPE:-}}"
  case "$raw" in
    ""|canonical|single)
      printf '%s\n' canonical
      ;;
    branch|scoped|parallel|worktree)
      printf '%s\n' branch
      ;;
    *)
      echo "FAIL: unknown content root scope: $raw" >&2
      return 2
      ;;
  esac
}

aos_content_root_has_explicit_state_root() {
  local default_state_root
  if [[ -z "${AOS_STATE_ROOT:-}" ]]; then
    return 1
  fi
  if [[ "${AOS_TEST_CLASSIFY_STATE_ROOT_AS_NORMAL:-}" == "1" ]]; then
    return 1
  fi
  default_state_root="${HOME:-}/.config/aos"
  [[ "${AOS_STATE_ROOT%/}" != "${default_state_root%/}" ]]
}

aos_content_root_key_for() {
  local prefix="$1"
  local repo_root="$2"
  local branch scope suffix

  scope="$(aos_content_root_scope)" || return $?
  if [[ "$scope" != "branch" ]]; then
    printf '%s\n' "$prefix"
    return
  fi

  if ! aos_content_root_has_explicit_state_root; then
    echo "FAIL: branch-scoped content roots require explicit non-default AOS_STATE_ROOT; agent-os default runtime uses canonical root names." >&2
    return 2
  fi

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
  local allow_start="false"
  local root_path_pairs=()
  local wait_args=()

  if [[ "${1:-}" == "--allow-start" ]]; then
    allow_start="true"
    shift
  fi

  if [ $(( $# % 2 )) -ne 0 ]; then
    echo "aos_ensure_content_roots_live requires root/path pairs" >&2
    return 2
  fi

  root_path_pairs=("$@")
  while [ "$#" -gt 0 ]; do
    wait_args+=(--root "$1")
    shift 2
  done
  set -- "${wait_args[@]}"

  if ! aos_content_roots_live "$aos_bin" "${root_path_pairs[@]}"; then
    (
      set -- "${root_path_pairs[@]}"
      while [ "$#" -gt 0 ]; do
        "$aos_bin" set "content.roots.$1" "$2" >/dev/null 2>/dev/null || exit $?
        shift 2
      done
    ) || return $?
  fi

  if ! aos_content_roots_live "$aos_bin" "${root_path_pairs[@]}"; then
    if [[ "$allow_start" != "true" ]]; then
      "$aos_bin" content wait "$@" --timeout 3s --json >/dev/null
      return $?
    fi
    echo "Refreshing repo daemon so scoped content roots are live." >&2
    "$aos_bin" service restart --mode repo >/dev/null
  fi

  (
    while [ "$#" -gt 0 ]; do
      if [[ "$allow_start" == "true" ]]; then
        "$aos_bin" content wait "$1" "$2" --auto-start --allow-start --timeout 15s --json >/dev/null || exit $?
      else
        "$aos_bin" content wait "$1" "$2" --timeout 15s --json >/dev/null || exit $?
      fi
      shift 2
    done
  )
}
