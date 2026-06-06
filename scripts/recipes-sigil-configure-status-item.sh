#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/apps/sigil/scripts/launch-common.sh"

AOS="${AOS:-$ROOT/aos}"
AVATAR_ID="${AVATAR_ID:-avatar-main}"
ALLOW_START="false"

if [[ "${1:-}" == "--allow-start" ]]; then
  ALLOW_START="true"
  shift
fi
if [[ $# -gt 0 ]]; then
  echo "Unknown argument: $1" >&2
  exit 2
fi

sigil_configure_status_item "$AOS" "$ROOT/apps/sigil" "$ROOT/packages/toolkit" "$AVATAR_ID"
if [[ "$ALLOW_START" == "true" ]]; then
  "$AOS" content wait --root toolkit --root sigil --auto-start --allow-start --timeout 15s --json >/dev/null
else
  "$AOS" content wait --root toolkit --root sigil --timeout 15s --json >/dev/null
fi

printf '{"status":"success","avatar":"%s"}\n' "$AVATAR_ID"
