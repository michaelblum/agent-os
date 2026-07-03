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
printf 'fake binary\n' > "$out"
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
printf 'codesign\n' >> "${AOS_BUILD_SIGNING_TEST_LOG:?}"
touch "$target.signed"
EOF
chmod +x "$FAKE_BIN/codesign"

FIRST_OUT="$TMP/first.out"
REPAIR_OUT="$TMP/repair.out"
UP_TO_DATE_OUT="$TMP/up-to-date.out"

PATH="$FAKE_BIN:$PATH" AOS_BUILD_SIGNING_TEST_LOG="$LOG" bash "$FAKE_REPO/build.sh" --no-restart >"$FIRST_OUT"
if [[ "$(cat "$LOG")" != $'swiftc\ncodesign' ]]; then
    echo "FAIL: first build did not compile and sign" >&2
    cat "$LOG" >&2
    exit 1
fi

rm -f "$FAKE_REPO/aos.signed"
: > "$LOG"
PATH="$FAKE_BIN:$PATH" AOS_BUILD_SIGNING_TEST_LOG="$LOG" bash "$FAKE_REPO/build.sh" --no-restart >"$REPAIR_OUT"
if [[ "$(cat "$LOG")" != "codesign" ]]; then
    echo "FAIL: signature repair should sign without compiling" >&2
    cat "$LOG" >&2
    exit 1
fi
if ! grep -q '^Signing aos (dev)' "$REPAIR_OUT"; then
    echo "FAIL: signature repair did not report sign-only path" >&2
    cat "$REPAIR_OUT" >&2
    exit 1
fi

: > "$LOG"
PATH="$FAKE_BIN:$PATH" AOS_BUILD_SIGNING_TEST_LOG="$LOG" bash "$FAKE_REPO/build.sh" --no-restart >"$UP_TO_DATE_OUT"
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
