#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/aos-build-signing.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

FAKE_REPO="$TMP/repo"
FAKE_BIN="$TMP/bin"
LOG="$TMP/events.log"
mkdir -p "$FAKE_REPO/src" "$FAKE_BIN"

cp build.sh "$FAKE_REPO/build.sh"
printf 'print("fake")\n' > "$FAKE_REPO/src/main.swift"

cat >"$FAKE_BIN/swiftc" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
out=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        -o)
            out="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done
if [[ -z "$out" ]]; then
    echo "missing -o" >&2
    exit 1
fi
printf 'swiftc\n' >> "${AOS_BUILD_SIGNING_TEST_LOG:?}"
cat > "$out" <<'BIN'
#!/usr/bin/env bash
if [[ "${1:-}" == "help" && "${2:-}" == "--json" ]]; then
  printf '{"commands":[]}\n'
  exit 0
fi
printf 'fake binary\n'
BIN
chmod +x "$out"
EOF
chmod +x "$FAKE_BIN/swiftc"

cat >"$FAKE_BIN/codesign" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "--verify" ]]; then
    target="${2:-}"
    [[ -n "$target" && -f "$target.signed" ]]
    exit $?
fi
target=""
for arg in "$@"; do
    target="$arg"
done
if [[ -z "$target" ]]; then
    echo "missing target" >&2
    exit 1
fi
printf 'codesign %s\n' "$*" >> "${AOS_BUILD_SIGNING_TEST_LOG:?}"
touch "$target.signed"
EOF
chmod +x "$FAKE_BIN/codesign"

cat >"$FAKE_BIN/rebuild-alert" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'alert\n' >> "${AOS_BUILD_SIGNING_TEST_LOG:?}"
EOF
chmod +x "$FAKE_BIN/rebuild-alert"

FIRST_OUT="$TMP/first.out"
REPAIR_OUT="$TMP/repair.out"
UP_TO_DATE_OUT="$TMP/up-to-date.out"
TOUCHED_OUT="$TMP/touched.out"
CHANGED_OUT="$TMP/changed.out"

PATH="$FAKE_BIN:$PATH" AOS_BUILD_SIGNING_TEST_LOG="$LOG" AOS_BUILD_REBUILD_ALERT_COMMAND="$FAKE_BIN/rebuild-alert" bash "$FAKE_REPO/build.sh" --no-restart >"$FIRST_OUT"
if ! grep -qx 'swiftc' "$LOG" || ! grep -q '^codesign ' "$LOG"; then
    echo "FAIL: first build did not compile and sign" >&2
    cat "$LOG" >&2
    exit 1
fi
if ! grep -qx 'alert' "$LOG"; then
    echo "FAIL: first build did not play the rebuild alert" >&2
    cat "$LOG" >&2
    exit 1
fi
if ! grep -q '^Rebuilt: ./aos' "$FIRST_OUT"; then
    echo "FAIL: first build did not report the explicit rebuild marker" >&2
    cat "$FIRST_OUT" >&2
    exit 1
fi
if ! grep -q -- '--identifier com.agentos.repo-aos' "$LOG"; then
    echo "FAIL: build signing must use the repo-launchable identifier" >&2
    cat "$LOG" >&2
    exit 1
fi
if grep -q -- '--identifier aos\\>' "$LOG"; then
    echo "FAIL: build signing must not force the launch-breaking bare aos identifier" >&2
    cat "$LOG" >&2
    exit 1
fi

rm -f "$FAKE_REPO/aos.signed"
: > "$LOG"
PATH="$FAKE_BIN:$PATH" AOS_BUILD_SIGNING_TEST_LOG="$LOG" AOS_BUILD_REBUILD_ALERT_COMMAND="$FAKE_BIN/rebuild-alert" bash "$FAKE_REPO/build.sh" --no-restart >"$REPAIR_OUT"
if ! grep -q '^codesign ' "$LOG" || grep -qx 'swiftc' "$LOG" || grep -qx 'alert' "$LOG"; then
    echo "FAIL: signature repair should sign without compiling" >&2
    cat "$LOG" >&2
    exit 1
fi
if ! grep -q -- '--identifier com.agentos.repo-aos' "$LOG"; then
    echo "FAIL: signature repair must use the repo-launchable identifier" >&2
    cat "$LOG" >&2
    exit 1
fi
if grep -q -- '--identifier aos\\>' "$LOG"; then
    echo "FAIL: signature repair must not force the launch-breaking bare aos identifier" >&2
    cat "$LOG" >&2
    exit 1
fi
if ! grep -q '^Signing aos (dev)' "$REPAIR_OUT"; then
    echo "FAIL: signature repair did not report sign-only path" >&2
    cat "$REPAIR_OUT" >&2
    exit 1
fi

touch "$FAKE_REPO/src/main.swift" "$FAKE_REPO/build.sh"
: > "$LOG"
PATH="$FAKE_BIN:$PATH" AOS_BUILD_SIGNING_TEST_LOG="$LOG" AOS_BUILD_REBUILD_ALERT_COMMAND="$FAKE_BIN/rebuild-alert" bash "$FAKE_REPO/build.sh" --no-restart >"$TOUCHED_OUT"
if [[ -s "$LOG" ]]; then
    echo "FAIL: unchanged runtime input content should not rebuild or re-sign" >&2
    cat "$LOG" >&2
    exit 1
fi
if ! grep -q '^Up to date: ./aos' "$TOUCHED_OUT"; then
    echo "FAIL: unchanged runtime input content did not report up to date" >&2
    cat "$TOUCHED_OUT" >&2
    exit 1
fi

printf '// runtime source changed\n' >> "$FAKE_REPO/src/main.swift"
: > "$LOG"
PATH="$FAKE_BIN:$PATH" AOS_BUILD_SIGNING_TEST_LOG="$LOG" AOS_BUILD_REBUILD_ALERT_COMMAND="$FAKE_BIN/rebuild-alert" bash "$FAKE_REPO/build.sh" --no-restart >"$CHANGED_OUT"
if ! grep -qx 'swiftc' "$LOG" || ! grep -q '^codesign ' "$LOG" || ! grep -qx 'alert' "$LOG"; then
    echo "FAIL: changed runtime input content should compile, sign, and alert" >&2
    cat "$LOG" >&2
    exit 1
fi
if ! grep -q '^Rebuilt: ./aos' "$CHANGED_OUT"; then
    echo "FAIL: changed runtime input content did not report explicit rebuild marker" >&2
    cat "$CHANGED_OUT" >&2
    exit 1
fi

rm -f "$FAKE_REPO/aos.signed"
: > "$LOG"
PATH="$FAKE_BIN:$PATH" AOS_BUILD_SIGNING_TEST_LOG="$LOG" AOS_BUILD_REBUILD_ALERT=0 bash "$FAKE_REPO/build.sh" --no-restart >"$REPAIR_OUT"
if ! grep -q '^codesign ' "$LOG" || grep -qx 'swiftc' "$LOG" || grep -qx 'alert' "$LOG"; then
    echo "FAIL: post-change signature repair should sign without compiling or alerting" >&2
    cat "$LOG" >&2
    exit 1
fi

: > "$LOG"
PATH="$FAKE_BIN:$PATH" AOS_BUILD_SIGNING_TEST_LOG="$LOG" AOS_BUILD_REBUILD_ALERT=0 bash "$FAKE_REPO/build.sh" --no-restart >"$UP_TO_DATE_OUT"
if [[ -s "$LOG" ]]; then
    echo "FAIL: valid signed artifact should not rebuild or re-sign" >&2
    cat "$LOG" >&2
    exit 1
fi
if ! grep -q '^Up to date: ./aos' "$UP_TO_DATE_OUT"; then
    echo "FAIL: valid signed artifact did not report up to date" >&2
    cat "$UP_TO_DATE_OUT" >&2
    exit 1
fi

echo "build-signing: all checks passed"
