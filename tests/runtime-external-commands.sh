#!/bin/bash
set -euo pipefail

FAILS=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILS=$((FAILS + 1)); }

if OUT="$(./aos runtime path --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["path"].endswith("/Applications/AOS.app"), data
PY
then
    pass "runtime path runs through external command manifest"
else
    fail "runtime path external dispatch drifted: ${OUT:-}"
fi

if OUT="$(./aos runtime status --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["path"].endswith("/Applications/AOS.app"), data
assert isinstance(data["installed"], bool), data
assert isinstance(data["signed"], bool), data
assert isinstance(data["notes"], list), data
PY
then
    pass "runtime status runs through external command manifest"
else
    fail "runtime status external dispatch drifted: ${OUT:-}"
fi

if ./aos runtime path --bogus >/tmp/aos-runtime-path-bogus.out 2>/tmp/aos-runtime-path-bogus.err; then
    fail "runtime path accepted an unknown flag"
else
    if grep -q "Unknown flag: --bogus" /tmp/aos-runtime-path-bogus.err; then
        pass "runtime path external script rejects unknown flags"
    else
        fail "runtime path unknown flag error drifted: $(cat /tmp/aos-runtime-path-bogus.err)"
    fi
fi
rm -f /tmp/aos-runtime-path-bogus.out /tmp/aos-runtime-path-bogus.err

echo
if [ "$FAILS" -eq 0 ]; then
    echo "runtime-external-commands: all checks passed"
else
    echo "runtime-external-commands: $FAILS failure(s)"
    exit 1
fi
