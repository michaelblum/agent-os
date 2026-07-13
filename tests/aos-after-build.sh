#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/aos-after-build.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

LOCK_PATH="$TMP/aos-build.lock"
EVENTS="$TMP/events.log"
FAKE_BUILD="$TMP/fake-build.sh"
FAKE_REBUILD="$TMP/fake-rebuild.sh"
FAKE_AOS="$TMP/aos"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; exit 1; }

cat >"$FAKE_BUILD" <<'EOF'
#!/bin/bash
set -euo pipefail
exec 9> "${AOS_BUILD_LOCK_PATH:?}"
python3 - <<'PY'
import fcntl

fcntl.flock(9, fcntl.LOCK_EX)
PY
printf 'build\n' >> "${AOS_AFTER_BUILD_TEST_LOG:?}"
EOF
chmod +x "$FAKE_BUILD"

python3 - "$LOCK_PATH" <<'PY' &
import fcntl
import sys
import time

with open(sys.argv[1], "w") as handle:
    fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
    time.sleep(2)
PY
LOCK_HOLDER_PID=$!

START_TS="$(python3 - <<'PY'
import time
print(time.time())
PY
)"

AOS_BUILD_SCRIPT="$FAKE_BUILD" \
AOS_BUILD_LOCK_PATH="$LOCK_PATH" \
AOS_AFTER_BUILD_TEST_LOG="$EVENTS" \
scripts/aos-after-build -- bash -lc 'printf "command\n" >> "$AOS_AFTER_BUILD_TEST_LOG"'

wait "$LOCK_HOLDER_PID"

ELAPSED="$(python3 - "$START_TS" <<'PY'
import sys
import time

start = float(sys.argv[1])
print(time.time() - start)
PY
)"

python3 - "$ELAPSED" <<'PY' || fail "expected aos-after-build to wait on the active build lock"
import sys

elapsed = float(sys.argv[1])
if elapsed < 1.5:
    raise SystemExit(1)
PY
pass "aos-after-build waits for active build lock"

EXPECTED=$'build\ncommand'
ACTUAL="$(cat "$EVENTS")"
[[ "$ACTUAL" == "$EXPECTED" ]] || fail "expected serialized build/command order, got: $ACTUAL"
pass "aos-after-build runs command after the serialized build step"

cat >"$FAKE_REBUILD" <<'EOF'
#!/bin/bash
set -euo pipefail
printf 'Rebuilt: ./aos\n'
EOF
chmod +x "$FAKE_REBUILD"

if AOS_BUILD_SCRIPT="$FAKE_REBUILD" AOS_PATH="$FAKE_AOS" \
  scripts/aos-after-build -- bash -lc 'exit 0' >"$TMP/rebuild.out" 2>"$TMP/rebuild.err"; then
  fail "real rebuild allowed a non-help command"
fi
grep -q 'requires.*help --json.*exact next command' "$TMP/rebuild.err" \
  || fail "real rebuild rejection did not name exact help checkpoint"
pass "aos-after-build blocks arbitrary commands after a real rebuild"

cat >"$FAKE_AOS" <<'EOF'
#!/bin/bash
set -euo pipefail
[[ "$*" == "help --json" ]]
printf '{"commands":[]}\n'
EOF
chmod +x "$FAKE_AOS"
AOS_BUILD_SCRIPT="$FAKE_REBUILD" AOS_PATH="$FAKE_AOS" \
  scripts/aos-after-build -- "$FAKE_AOS" help --json >"$TMP/help.out" 2>"$TMP/help.err"
grep -q '{"commands":\[\]}' "$TMP/help.out" \
  || fail "exact post-build help checkpoint did not run"
grep -q 'stop now for the human TCC checkpoint.*finished' "$TMP/help.err" \
  || fail "successful help did not emit the mandatory human checkpoint"
pass "aos-after-build permits exact help checkpoint after a real rebuild"

echo "aos-after-build: all checks passed"
