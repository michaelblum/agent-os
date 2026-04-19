#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AOS="${AOS:-$ROOT/aos}"
CANVAS_ID="${SIGIL_STAGE_ID:-avatar-main}"

usage() {
  cat <<'EOF'
Usage:
  apps/sigil/stage-signal.sh toggle
  apps/sigil/stage-signal.sh show
  apps/sigil/stage-signal.sh hide
  apps/sigil/stage-signal.sh state
  apps/sigil/stage-signal.sh position <x> <y>
  apps/sigil/stage-signal.sh geometry <shape>
EOF
}

cmd="${1:-}"
case "$cmd" in
  toggle|show|hide|state)
    event="{\"type\":\"sigil.stage\",\"payload\":{\"action\":\"$cmd\"}}"
    ;;
  position)
    [[ $# -eq 3 ]] || { usage; exit 1; }
    event="{\"type\":\"sigil.stage\",\"payload\":{\"action\":\"setPosition\",\"x\":$2,\"y\":$3}}"
    ;;
  geometry)
    [[ $# -eq 2 ]] || { usage; exit 1; }
    event="{\"type\":\"sigil.stage\",\"payload\":{\"action\":\"setGeometry\",\"shape\":$2}}"
    ;;
  *)
    usage
    exit 1
    ;;
esac

"$AOS" show post --id "$CANVAS_ID" --event "$event"
