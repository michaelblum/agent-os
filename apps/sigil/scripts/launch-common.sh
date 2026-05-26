#!/usr/bin/env bash

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

  "$aos_bin" set content.roots.toolkit "$toolkit_root" >/dev/null
  "$aos_bin" set content.roots.sigil "$sigil_root" >/dev/null
  "$aos_bin" set status_item.enabled true >/dev/null
  "$aos_bin" set status_item.toggle_id "$avatar_id" >/dev/null
  "$aos_bin" set status_item.toggle_url 'aos://sigil/renderer/index.html' >/dev/null
  "$aos_bin" set status_item.toggle_track union >/dev/null
}
