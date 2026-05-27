#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/apps/sigil/scripts/launch-common.sh"

AOS="${AOS:-$ROOT/aos}"
AVATAR_ID="${AVATAR_ID:-avatar-main}"

sigil_configure_status_item "$AOS" "$ROOT/apps/sigil" "$ROOT/packages/toolkit" "$AVATAR_ID"
"$AOS" content wait --root toolkit --root sigil --auto-start --timeout 15s >/dev/null

printf '{"status":"success","avatar":"%s"}\n' "$AVATAR_ID"
