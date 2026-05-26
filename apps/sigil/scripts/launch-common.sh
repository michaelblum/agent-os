#!/usr/bin/env bash
# Compatibility helpers retained for older test harnesses.

sigil_launch_repo_root() {
  local source_path="${BASH_SOURCE[0]}"
  local dir
  dir="$(cd "$(dirname "$source_path")/../../.." && pwd)"
  printf '%s\n' "$dir"
}

sigil_configure_status_item() {
  local aos_bin="$1"
  local sigil_root="$2"
  local toolkit_root="$3"
  local avatar_id="${4:-avatar-main}"
  local repo_root
  repo_root="$(sigil_launch_repo_root)"
  source "$repo_root/scripts/aos-content-scope.sh"

  local sigil_key toolkit_key
  sigil_key="${AOS_SIGIL_CONTENT_ROOT:-$(aos_content_root_key_for sigil "$repo_root")}"
  toolkit_key="${AOS_TOOLKIT_CONTENT_ROOT:-$(aos_content_root_key_for toolkit "$repo_root")}"

  aos_ensure_content_roots_live "$aos_bin" \
    "$toolkit_key" "$toolkit_root" \
    "$sigil_key" "$sigil_root" >/dev/null
  "$aos_bin" set status_item.enabled true >/dev/null
  "$aos_bin" set status_item.toggle_id "$avatar_id" >/dev/null
  "$aos_bin" set status_item.toggle_url "aos://$sigil_key/renderer/index.html?toolkit-root=$toolkit_key" >/dev/null
  "$aos_bin" set status_item.toggle_track union >/dev/null
}
