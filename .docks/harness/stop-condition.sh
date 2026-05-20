#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: stop-condition.sh write|consume <repo-root> <dock> <condition> [ttl-seconds]" >&2
  exit 2
}

command="${1:-}"
repo_root="${2:-}"
dock="${3:-}"
condition="${4:-}"
ttl_seconds="${5:-300}"

if [[ -z "$command" || -z "$repo_root" || -z "$dock" || -z "$condition" ]]; then
  usage
fi

case "$dock" in
  *[!a-zA-Z0-9_.-]*|"") usage ;;
esac
case "$condition" in
  *[!a-zA-Z0-9_.-]*|"") usage ;;
esac
case "$ttl_seconds" in
  ''|*[!0-9]*) usage ;;
esac

repo_id="$(printf '%s' "$repo_root" | shasum -a 256 | awk '{print $1}')"
state_root="${AOS_DOCK_STOP_CONDITION_DIR:-${TMPDIR:-/tmp}/aos-dock-stop-conditions}"
marker_dir="$state_root/$repo_id/$dock"
marker="$marker_dir/$condition"
now="$(date +%s)"

case "$command" in
  write)
    mkdir -p "$marker_dir"
    expires_at=$((now + ttl_seconds))
    umask 077
    {
      printf 'repo_root=%s\n' "$repo_root"
      printf 'dock=%s\n' "$dock"
      printf 'condition=%s\n' "$condition"
      printf 'expires_at=%s\n' "$expires_at"
    } >"$marker"
    ;;
  consume)
    if [[ ! -f "$marker" ]]; then
      exit 1
    fi
    expires_at="$(awk -F= '$1 == "expires_at" {print $2}' "$marker" 2>/dev/null || true)"
    marker_repo_root="$(awk -F= '$1 == "repo_root" {print substr($0, index($0, "=") + 1)}' "$marker" 2>/dev/null || true)"
    marker_dock="$(awk -F= '$1 == "dock" {print $2}' "$marker" 2>/dev/null || true)"
    marker_condition="$(awk -F= '$1 == "condition" {print $2}' "$marker" 2>/dev/null || true)"
    rm -f "$marker"
    rmdir "$marker_dir" "$state_root/$repo_id" "$state_root" 2>/dev/null || true
    if [[ "$marker_repo_root" != "$repo_root" || "$marker_dock" != "$dock" || "$marker_condition" != "$condition" ]]; then
      exit 1
    fi
    if [[ "$expires_at" == '' || "$expires_at" == *[!0-9]* || "$expires_at" -lt "$now" ]]; then
      exit 1
    fi
    printf '%s\n' "$condition"
    ;;
  *)
    usage
    ;;
esac
