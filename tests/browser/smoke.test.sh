#!/usr/bin/env bash
# requires: @playwright/cli, python3
#
# Opt-in end-to-end test. CI skips unless PLAYWRIGHT_SMOKE=1.

set -euo pipefail

if [[ "${PLAYWRIGHT_SMOKE:-0}" != "1" ]]; then
    echo "SKIP (set PLAYWRIGHT_SMOKE=1 to run)"
    exit 0
fi

if ! command -v playwright-cli >/dev/null; then
    echo "SKIP (playwright-cli not installed)"
    exit 0
fi
if ! command -v python3 >/dev/null; then
    echo "SKIP (python3 not available for fixture server)"
    exit 0
fi

FIX="$(cd "$(dirname "$0")" && pwd)/fixtures"
SID="aos-smoke-$$"
tmproot="/tmp/aos-smoke-$$"
export AOS_STATE_ROOT="$tmproot"
export AOS_RUNTIME_MODE="repo"

# Chrome blocks navigation to file:// URLs from a non-user gesture and
# playwright-cli's `open --url` counts as that — it returns "### Error\n
# Access to file: URL is blocked" and leaves the tab at about:blank.
# Serve the fixture over an ephemeral loopback HTTP server instead.
(cd "$FIX" && python3 -m http.server 0 --bind 127.0.0.1 >"$tmproot.server.log" 2>&1) &
HTTP_PID=$!
# Wait for the server to report its port.
for _ in $(seq 1 40); do
    if [[ -s "$tmproot.server.log" ]] && grep -q "Serving HTTP on" "$tmproot.server.log"; then
        break
    fi
    sleep 0.1
done
PORT=$(grep -oE "port [0-9]+" "$tmproot.server.log" | awk '{print $2}' | head -1)
[[ -n "$PORT" ]] || { kill $HTTP_PID 2>/dev/null || true; echo "FAIL: fixture server did not start" >&2; exit 1; }
URL="http://127.0.0.1:$PORT/smoke.html"

trap "
  ./aos focus remove --id $SID >/dev/null 2>&1 || true
  playwright-cli -s=$SID close >/dev/null 2>&1 || true
  kill $HTTP_PID 2>/dev/null || true
  rm -rf $tmproot $tmproot.server.log
" EXIT

# Launch headed browser against smoke.html served via local HTTP
./aos focus create --id "$SID" --target browser://new --url "$URL" >/dev/null

# Capture xray
out=$(./aos see capture "browser:$SID" --xray)
echo "$out" | jq -e '.elements | length > 0' >/dev/null || { echo "FAIL xray: $out" >&2; exit 1; }

# Find the button's ref
button_ref=$(echo "$out" | jq -r '.elements[] | select(.role == "button") | .ref' | head -1)
[[ -n "$button_ref" ]] || { echo "FAIL: no button ref in xray" >&2; exit 1; }

# Click it
./aos do click "browser:$SID/$button_ref" >/dev/null

# Wait for DOM update
sleep 1

# Re-xray and verify 'clicked' text appears somewhere
out=$(./aos see capture "browser:$SID" --xray)
echo "$out" | jq -e '[.elements[] | select(.title == "clicked" or .value == "clicked")] | length > 0' >/dev/null \
    || { echo "FAIL click effect: $out" >&2; exit 1; }

# Fill the input
input_ref=$(echo "$out" | jq -r '.elements[] | select(.role == "textbox") | .ref' | head -1)
./aos do fill "browser:$SID/$input_ref" "smoke test" >/dev/null

echo "PASS"
