#!/bin/bash
# test.sh — Integration tests for hand-off v2 (CLI + session mode)
set -euo pipefail
cd "$(dirname "$0")"

PASS=0
FAIL=0
BINARY="./hand-off"

if [ ! -f "$BINARY" ]; then
    echo "Binary not found. Run build.sh first."
    exit 1
fi

pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1 — $2"; }

# Helper: run a CLI command and check if stdout contains a string
cli_contains() {
    local description="$1"
    local needle="$2"
    shift 2
    local output
    output=$("$BINARY" "$@" 2>&1) || true
    if echo "$output" | grep -q "$needle"; then
        pass "$description"
    else
        fail "$description" "expected '$needle' in: $output"
    fi
}

# Helper: pipe one or more lines into session mode, check last response for a string
session_contains() {
    local description="$1"
    local needle="$2"
    local input="$3"
    shift 3
    local output
    output=$(printf '%s\n' "$input" | "$BINARY" session "$@" 2>&1) || true
    # Take the last non-empty line as the response to check
    local last_line
    last_line=$(echo "$output" | grep -v '^$' | tail -1)
    if echo "$last_line" | grep -q "$needle"; then
        pass "$description"
    else
        fail "$description" "expected '$needle' in: $last_line"
    fi
}

# Helper: pipe multi-line input into session mode, check the Nth response for a string
session_line_contains() {
    local description="$1"
    local needle="$2"
    local line_num="$3"
    local input="$4"
    shift 4
    local output
    output=$(printf '%s\n' "$input" | "$BINARY" session "$@" 2>&1) || true
    local target_line
    target_line=$(echo "$output" | grep -v '^$' | sed -n "${line_num}p")
    if echo "$target_line" | grep -q "$needle"; then
        pass "$description"
    else
        fail "$description" "expected '$needle' in line $line_num: $target_line"
    fi
}

echo "=== CLI Backward Compatibility ==="

cli_contains \
    "help output contains 'session'" \
    "session" \
    help

cli_contains \
    "click --dry-run returns dry_run" \
    "dry_run" \
    click 100,100 --dry-run

cli_contains \
    "hover --dry-run returns dry_run" \
    "dry_run" \
    hover 200,200 --dry-run

cli_contains \
    "scroll --dx --dry-run returns dry_run" \
    "dry_run" \
    scroll 100,100 --dx 50 --dry-run

cli_contains \
    "scroll --dx --dy --dry-run returns dry_run" \
    "dry_run" \
    scroll 100,100 --dx 50 --dy -100 --dry-run

cli_contains \
    "key --dry-run returns dry_run" \
    "dry_run" \
    key cmd+s --dry-run

cli_contains \
    "type --dry-run returns dry_run" \
    "dry_run" \
    type "hello" --dry-run

cli_contains \
    "drag --dry-run returns dry_run" \
    "dry_run" \
    drag 100,100 200,200 --dry-run

cli_contains \
    "profiles returns JSON with natural" \
    "natural" \
    profiles

cli_contains \
    "profiles show natural contains pixels_per_second" \
    "pixels_per_second" \
    profiles show natural

echo ""
echo "=== Session Mode ==="

session_contains \
    "status contains profile" \
    "profile" \
    '{"action":"status"}'

session_contains \
    "status contains cursor" \
    "cursor" \
    '{"action":"status"}'

# Context set then status — response should contain the app name
session_line_contains \
    "context set + status contains app" \
    "app" \
    2 \
    '{"action":"context","set":{"pid":1,"app":"TestApp"}}
{"action":"status"}'

# Context set, context clear, then check clear response is ok
session_line_contains \
    "context clear returns ok" \
    "ok" \
    2 \
    '{"action":"context","set":{"pid":1,"app":"TestApp"}}
{"action":"context","clear":true}'

# Invalid JSON keeps session alive and returns PARSE_ERROR
session_contains \
    "invalid JSON returns PARSE_ERROR" \
    "PARSE_ERROR" \
    'not json'

# Unknown action returns UNKNOWN_ACTION
session_contains \
    "unknown action returns UNKNOWN_ACTION" \
    "UNKNOWN_ACTION" \
    '{"action":"banana"}'

# End action returns end
session_contains \
    "end action returns end" \
    "end" \
    '{"action":"end"}'

# Window coordinate space without window_id is INVALID_CONTEXT
session_contains \
    "window space without window_id returns INVALID_CONTEXT" \
    "INVALID_CONTEXT" \
    '{"action":"context","set":{"coordinate_space":"window"}}'

# Profile flag on session
session_contains \
    "session --profile natural contains natural" \
    "natural" \
    '{"action":"status"}' \
    --profile natural

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] || exit 1
