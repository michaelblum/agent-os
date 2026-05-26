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

if OUT="$(./aos runtime display-union 2>/dev/null)" python3 - <<'PY'
import os
import re

out = os.environ["OUT"]
assert re.match(r"^0,0,[0-9]+,[0-9]+$", out), out
PY
then
    pass "runtime display-union runs through external command manifest"
else
    fail "runtime display-union external dispatch drifted: ${OUT:-}"
fi

if ./aos runtime path --bogus >/tmp/aos-runtime-path-bogus.out 2>/tmp/aos-runtime-path-bogus.err; then
    fail "runtime path accepted an unknown flag"
else
    if grep -q '"code":"UNKNOWN_FLAG"' /tmp/aos-runtime-path-bogus.err; then
        pass "runtime path external script rejects unknown flags"
    else
        fail "runtime path unknown flag error drifted: $(cat /tmp/aos-runtime-path-bogus.err)"
    fi
fi
rm -f /tmp/aos-runtime-path-bogus.out /tmp/aos-runtime-path-bogus.err

if ./aos runtime path extra >/tmp/aos-runtime-path-extra.out 2>/tmp/aos-runtime-path-extra.err; then
    fail "runtime path accepted an extra positional argument"
else
    if grep -q '"code":"UNKNOWN_ARG"' /tmp/aos-runtime-path-extra.err; then
        pass "runtime path external script rejects extra positionals"
    else
        fail "runtime path extra positional error drifted: $(cat /tmp/aos-runtime-path-extra.err)"
    fi
fi
rm -f /tmp/aos-runtime-path-extra.out /tmp/aos-runtime-path-extra.err

if ./aos runtime status --bogus >/tmp/aos-runtime-status-bogus.out 2>/tmp/aos-runtime-status-bogus.err; then
    fail "runtime status accepted an unknown flag"
else
    if grep -q '"code":"UNKNOWN_FLAG"' /tmp/aos-runtime-status-bogus.err; then
        pass "runtime status external script rejects unknown flags"
    else
        fail "runtime status unknown flag error drifted: $(cat /tmp/aos-runtime-status-bogus.err)"
    fi
fi
rm -f /tmp/aos-runtime-status-bogus.out /tmp/aos-runtime-status-bogus.err

if ./aos runtime status extra >/tmp/aos-runtime-status-extra.out 2>/tmp/aos-runtime-status-extra.err; then
    fail "runtime status accepted an extra positional argument"
else
    if grep -q '"code":"UNKNOWN_ARG"' /tmp/aos-runtime-status-extra.err; then
        pass "runtime status external script rejects extra positionals"
    else
        fail "runtime status extra positional error drifted: $(cat /tmp/aos-runtime-status-extra.err)"
    fi
fi
rm -f /tmp/aos-runtime-status-extra.out /tmp/aos-runtime-status-extra.err

if ./aos runtime install --bogus >/tmp/aos-runtime-install-bogus.out 2>/tmp/aos-runtime-install-bogus.err; then
    fail "runtime install accepted an unknown flag"
else
    if grep -q '"code":"UNKNOWN_FLAG"' /tmp/aos-runtime-install-bogus.err; then
        pass "runtime install external script rejects unknown flags before install"
    else
        fail "runtime install unknown flag error drifted: $(cat /tmp/aos-runtime-install-bogus.err)"
    fi
fi
rm -f /tmp/aos-runtime-install-bogus.out /tmp/aos-runtime-install-bogus.err

if ./aos runtime install extra >/tmp/aos-runtime-install-extra.out 2>/tmp/aos-runtime-install-extra.err; then
    fail "runtime install accepted an extra positional argument"
else
    if grep -q '"code":"UNKNOWN_ARG"' /tmp/aos-runtime-install-extra.err; then
        pass "runtime install external script rejects extra positionals before install"
    else
        fail "runtime install extra positional error drifted: $(cat /tmp/aos-runtime-install-extra.err)"
    fi
fi
rm -f /tmp/aos-runtime-install-extra.out /tmp/aos-runtime-install-extra.err

echo
if [ "$FAILS" -eq 0 ]; then
    echo "runtime-external-commands: all checks passed"
else
    echo "runtime-external-commands: $FAILS failure(s)"
    exit 1
fi
