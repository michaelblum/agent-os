#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AOS="${AOS:-$ROOT/aos}"
CANVAS_ID="${SIGIL_STAGE_ID:-avatar-main}"
URL="${SIGIL_STAGE_URL:-aos://sigil/renderer/index.html?visible=0}"

"$AOS" set content.roots.sigil apps/sigil >/dev/null
"$AOS" service start --mode "${AOS_MODE:-repo}" >/dev/null 2>&1 || true

"$AOS" show create \
  --id "$CANVAS_ID" \
  --url "$URL" \
  --track union >/dev/null

echo "Sigil stage launched: $CANVAS_ID"
