#!/usr/bin/env bash
# launch.sh - Open the populated Employer Brand Audit fixture as an AOS canvas.

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || pwd)"
source "$ROOT/scripts/aos-content-scope.sh"

AOS="${AOS:-$ROOT/aos}"
CANVAS_ID="${AOS_EMPLOYER_BRAND_REPORT_ID:-employer-brand-audit-report}"
PANEL_W="${AOS_EMPLOYER_BRAND_REPORT_W:-1280}"
PANEL_H="${AOS_EMPLOYER_BRAND_REPORT_H:-820}"
REPORT_CONTENT_ROOT="${AOS_EMPLOYER_BRAND_REPORT_ROOT:-$(aos_content_root_key_for employer_brand_audit "$ROOT")}"
WAIT_TIMEOUT="${AOS_EMPLOYER_BRAND_REPORT_WAIT:-30s}"

if [[ ! -x "$AOS" ]]; then
  echo "aos binary not found at $AOS" >&2
  exit 1
fi

"$AOS" show remove --id "$CANVAS_ID" 2>/dev/null || true

aos_ensure_content_roots_live "$AOS" \
  "$REPORT_CONTENT_ROOT" "$DIR"

DISPLAY_JSON="$("$AOS" graph displays --json 2>/dev/null || echo '{"data":{"displays":[]}}')"
GEOMETRY="$(
  echo "$DISPLAY_JSON" | PANEL_W="$PANEL_W" PANEL_H="$PANEL_H" python3 -c '
import json, os, sys

payload = json.load(sys.stdin)
displays = payload.get("data", {}).get("displays", payload.get("displays", [])) if isinstance(payload, dict) else payload
main = next((entry for entry in displays if entry.get("is_main")), displays[0] if displays else None)
rect = (main or {}).get("visible_bounds") or (main or {}).get("bounds") or {}
x = int(rect.get("x", 0))
y = int(rect.get("y", 0))
w = int(rect.get("w", 1728))
h = int(rect.get("h", 1117))
panel_w = min(int(os.environ["PANEL_W"]), max(840, w - 48))
panel_h = min(int(os.environ["PANEL_H"]), max(620, h - 96))
print(x + 24, y + 64, panel_w, panel_h)
' 2>/dev/null || echo "24 64 $PANEL_W $PANEL_H"
)"

read -r X Y W H <<<"$GEOMETRY"

"$AOS" show create \
  --id "$CANVAS_ID" \
  --at "$X,$Y,$W,$H" \
  --interactive \
  --focus \
  --scope global \
  --url "aos://$REPORT_CONTENT_ROOT/index.html" >/dev/null

READY_JS="$(cat <<'JS'
(() => {
  const snapshot = window.__employerBrandAuditReport?.snapshot?.();
  const text = document.body?.textContent || "";
  const companies = snapshot?.companies || [];
  return Boolean(
    snapshot?.ready === true &&
    snapshot?.hasKilos === true &&
    snapshot?.hasEvidenceCitationTrace === true &&
    snapshot?.citationCount > 0 &&
    snapshot?.evidenceTraceCount > 0 &&
    ["Symphony Talent", "Phenom", "Radancy"].every((name) => companies.includes(name) && text.includes(name)) &&
    text.includes("KILOS Messaging Matrix") &&
    document.querySelector("[data-aos-ref=\"employer-brand-audit:report\"]") &&
    document.querySelector(".cite") &&
    !/Client Company|Add rows|Data Loading Error/.test(text)
  );
})()
JS
)"

"$AOS" show wait \
  --id "$CANVAS_ID" \
  --manifest employer-brand-audit-report \
  --js "$READY_JS" \
  --timeout "$WAIT_TIMEOUT" >/dev/null

echo "Employer Brand Audit report launched at ${X},${Y} (${W}x${H})"
echo "Canvas: $CANVAS_ID"
echo "URL: aos://$REPORT_CONTENT_ROOT/index.html"
