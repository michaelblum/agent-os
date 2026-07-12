#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/aos-build-rebuild-policy.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

FAKE_REPO="$TMP/repo"
FAKE_BIN="$TMP/bin"
LOG="$TMP/events.log"
mkdir -p "$FAKE_REPO/src" "$FAKE_REPO/scripts/lib" "$FAKE_REPO/packaging" "$FAKE_BIN"

cp build.sh "$FAKE_REPO/build.sh"
cp scripts/aos-build-fingerprint.mjs "$FAKE_REPO/scripts/aos-build-fingerprint.mjs"
cp scripts/lib/aos-build-attestation.mjs "$FAKE_REPO/scripts/lib/aos-build-attestation.mjs"
cp scripts/lib/aos-cli.mjs "$FAKE_REPO/scripts/lib/aos-cli.mjs"
cp packaging/RepoRuntimeLinkInfo.plist "$FAKE_REPO/packaging/RepoRuntimeLinkInfo.plist"
printf 'print("fake")\n' > "$FAKE_REPO/src/main.swift"

if ! grep -q 'swiftc "${SWIFTC_FLAGS\[@\]}" "${SWIFT_INPUTS\[@\]}"' "$FAKE_REPO/build.sh"; then
    echo "FAIL: repo-mode build must compile directly with swiftc" >&2
    exit 1
fi
if [[ "$(grep -c '^[[:space:]]*swiftc "${SWIFTC_FLAGS\[@\]}" "${SWIFT_INPUTS\[@\]}"' "$FAKE_REPO/build.sh")" -ne 1 ]]; then
    echo "FAIL: repo-mode build must use one direct swiftc output invocation" >&2
    exit 1
fi
BUILD_COMMANDS="$(sed '/^[[:space:]]*#/d' "$FAKE_REPO/build.sh")"
if grep -Eq '(^|[;&|[:space:]])(ld|codesign|cp|mv|install|ditto|strip|xattr|shasum|otool|file|install_name_tool|spctl)([[:space:]]|$)|--entitlements|--identifier|\.app/' <<<"$BUILD_COMMANDS"; then
    echo "FAIL: repo-mode build must stay raw: no separate link, post-link mutation, wrapping, signing, or artifact inspection" >&2
    exit 1
fi
if grep -Eq '"\$OUTPUT_PATH"[[:space:]]+(service|status|runtime|help)|du[[:space:]].*\$OUTPUT_PATH' "$FAKE_REPO/build.sh"; then
    echo "FAIL: build.sh must not execute or inspect the newly linked artifact" >&2
    exit 1
fi
if ! grep -q -- '-sectcreate' "$FAKE_REPO/build.sh" ||
   ! grep -q 'RepoRuntimeLinkInfo.plist' "$FAKE_REPO/build.sh"; then
    echo "FAIL: repo-mode build must embed raw-runtime privacy metadata at link time" >&2
    exit 1
fi

cat >"$FAKE_BIN/swiftc" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case " $* " in
  *" -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "*"/packaging/RepoRuntimeLinkInfo.plist "*) ;;
  *)
    echo "missing raw-runtime __info_plist linker metadata" >&2
    exit 1
    ;;
esac
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

cat >"$FAKE_BIN/spctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'spctl %s\n' "$*" >> "${AOS_BUILD_SIGNING_TEST_LOG:?}"
exit 1
EOF
chmod +x "$FAKE_BIN/spctl"

cat >"$FAKE_BIN/rebuild-alert" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'alert\n' >> "${AOS_BUILD_SIGNING_TEST_LOG:?}"
EOF
chmod +x "$FAKE_BIN/rebuild-alert"

FIRST_OUT="$TMP/first.out"
FORCE_OUT="$TMP/force.out"
REPAIR_OUT="$TMP/repair.out"
UP_TO_DATE_OUT="$TMP/up-to-date.out"
TOUCHED_OUT="$TMP/touched.out"
CHANGED_OUT="$TMP/changed.out"

PATH="$FAKE_BIN:$PATH" AOS_BUILD_SIGNING_TEST_LOG="$LOG" AOS_BUILD_REBUILD_ALERT_COMMAND="$FAKE_BIN/rebuild-alert" bash "$FAKE_REPO/build.sh" --no-restart >"$FIRST_OUT"
# Scenario: first repo-mode build compiles, emits the bounded readiness reminder,
# and does not run any post-build signing hook.
if ! grep -qx 'swiftc' "$LOG"; then
    echo "FAIL: first build did not compile" >&2
    cat "$LOG" >&2
    exit 1
fi
if grep -q '^codesign ' "$LOG"; then
    echo "FAIL: repo-mode first build must not post-sign the binary" >&2
    cat "$LOG" >&2
    exit 1
fi
if grep -q '^spctl ' "$LOG"; then
    echo "FAIL: repo-mode first build must not gate raw local launchability on spctl" >&2
    cat "$LOG" >&2
    exit 1
fi
if ! grep -qx 'alert' "$LOG"; then
    echo "FAIL: first build did not play the rebuild alert" >&2
    cat "$LOG" >&2
    exit 1
fi
if [[ -e "$FAKE_REPO/aos.signed" ]]; then
    echo "FAIL: first build left a post-signing marker" >&2
    exit 1
fi
if ! "$FAKE_REPO/aos" help --json >/dev/null; then
    echo "FAIL: raw repo-mode build artifact must be judged by launchability" >&2
    exit 1
fi
if ! grep -q '^Rebuilt: ./aos' "$FIRST_OUT"; then
    echo "FAIL: first build did not report the explicit rebuild marker" >&2
    cat "$FIRST_OUT" >&2
    exit 1
fi
if ! grep -q 'first post-build command must be ./aos help --json' "$FIRST_OUT" ||
   ! grep -q 'Do not inspect or transform ./aos before that launch' "$FIRST_OUT"; then
    echo "FAIL: first build did not report the launch-before-inspection checkpoint" >&2
    cat "$FIRST_OUT" >&2
    exit 1
fi
if grep -q -- '--identifier' "$LOG"; then
    echo "FAIL: repo-mode build must not post-sign or force an explicit identifier" >&2
    cat "$LOG" >&2
    exit 1
fi

: > "$LOG"
PATH="$FAKE_BIN:$PATH" AOS_BUILD_SIGNING_TEST_LOG="$LOG" AOS_BUILD_REBUILD_ALERT_COMMAND="$FAKE_BIN/rebuild-alert" bash "$FAKE_REPO/build.sh" --force --no-restart >"$FORCE_OUT"
# Scenario: the direct recovery command for a missing or launch-killed ./aos is
# still the raw compile-only build path. A rejected spctl assessment is not a
# build failure criterion for repo-local development.
if ! grep -qx 'swiftc' "$LOG" || grep -q '^codesign ' "$LOG" || grep -q '^spctl ' "$LOG" || ! grep -qx 'alert' "$LOG"; then
    echo "FAIL: force rebuild recovery must compile and alert without post-signing or spctl gating" >&2
    cat "$LOG" >&2
    exit 1
fi
if ! grep -q '^Rebuilt: ./aos' "$FORCE_OUT"; then
    echo "FAIL: force rebuild recovery did not report explicit rebuild marker" >&2
    cat "$FORCE_OUT" >&2
    exit 1
fi

rm -f "$FAKE_REPO/aos.signed"
: > "$LOG"
PATH="$FAKE_BIN:$PATH" AOS_BUILD_SIGNING_TEST_LOG="$LOG" AOS_BUILD_REBUILD_ALERT_COMMAND="$FAKE_BIN/rebuild-alert" bash "$FAKE_REPO/build.sh" --no-restart >"$REPAIR_OUT"
# Scenario: legacy missing signature markers are irrelevant in repo mode. The
# build remains a no-op instead of entering an obsolete signature repair path.
if [[ -s "$LOG" ]]; then
    echo "FAIL: missing signature marker must not trigger repo-mode post-sign or rebuild" >&2
    cat "$LOG" >&2
    exit 1
fi
if ! grep -q '^Up to date: ./aos' "$REPAIR_OUT"; then
    echo "FAIL: missing signature marker should still report up to date when runtime inputs are unchanged" >&2
    cat "$REPAIR_OUT" >&2
    exit 1
fi

touch "$FAKE_REPO/src/main.swift" "$FAKE_REPO/build.sh"
: > "$LOG"
PATH="$FAKE_BIN:$PATH" AOS_BUILD_SIGNING_TEST_LOG="$LOG" AOS_BUILD_REBUILD_ALERT_COMMAND="$FAKE_BIN/rebuild-alert" bash "$FAKE_REPO/build.sh" --no-restart >"$TOUCHED_OUT"
# Scenario: timestamp-only churn, including build tooling mtime changes, does
# not rebuild, does not sign, and does not alert.
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
# Scenario: real Swift content changes rebuild and alert, still without
# repo-mode post-signing.
if ! grep -qx 'swiftc' "$LOG" || grep -q '^codesign ' "$LOG" || grep -q '^spctl ' "$LOG" || ! grep -qx 'alert' "$LOG"; then
    echo "FAIL: changed runtime input content should compile and alert without repo-mode post-signing" >&2
    cat "$LOG" >&2
    exit 1
fi
if ! grep -q '^Rebuilt: ./aos' "$CHANGED_OUT"; then
    echo "FAIL: changed runtime input content did not report explicit rebuild marker" >&2
    cat "$CHANGED_OUT" >&2
    exit 1
fi
if ! grep -q 'first post-build command must be ./aos help --json' "$CHANGED_OUT" ||
   ! grep -q 'Do not inspect or transform ./aos before that launch' "$CHANGED_OUT"; then
    echo "FAIL: changed runtime input content did not report the launch-before-inspection checkpoint" >&2
    cat "$CHANGED_OUT" >&2
    exit 1
fi

rm -f "$FAKE_REPO/aos.signed"
: > "$LOG"
PATH="$FAKE_BIN:$PATH" AOS_BUILD_SIGNING_TEST_LOG="$LOG" AOS_BUILD_REBUILD_ALERT=0 bash "$FAKE_REPO/build.sh" --no-restart >"$REPAIR_OUT"
# Scenario: after a real rebuild, missing signature markers are still ignored
# and alerts stay tied only to rebuilds.
if [[ -s "$LOG" ]]; then
    echo "FAIL: post-change missing signature marker must not trigger repo-mode post-sign, rebuild, or alert" >&2
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

echo "build-rebuild-policy: all checks passed"
