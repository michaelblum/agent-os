#!/bin/bash
set -euo pipefail

FAILS=0

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILS=$((FAILS + 1)); }

if OUT="$(./aos gate records --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["schema_version"] == "aos.gate.records.readback.v1", data
assert isinstance(data["records"], list), data
PY
then
    pass "gate records runs through external command manifest"
else
    fail "gate records external dispatch drifted: ${OUT:-}"
fi

if OUT="$(./aos gate continuations --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["schema_version"] == "aos.gate.continuations.readback.v1", data
assert isinstance(data["continuations"], list), data
PY
then
    pass "gate continuations runs through external command manifest"
else
    fail "gate continuations external dispatch drifted: ${OUT:-}"
fi

if ./aos gate records --bogus >/tmp/aos-gate-records-bogus.out 2>/tmp/aos-gate-records-bogus.err; then
    fail "gate records accepted an unknown flag"
else
    if grep -q "aos gate records: unknown option: --bogus" /tmp/aos-gate-records-bogus.err; then
        pass "gate records external script rejects unknown flags"
    else
        fail "gate records unknown flag error drifted: $(cat /tmp/aos-gate-records-bogus.err)"
    fi
fi
rm -f /tmp/aos-gate-records-bogus.out /tmp/aos-gate-records-bogus.err

set +e
DOCTOR_OUT="$(./aos doctor gateway --quick --json 2>/dev/null)"
DOCTOR_CODE=$?
set -e
if OUT="$DOCTOR_OUT" CODE="$DOCTOR_CODE" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["mode"] == "repo", data
assert data["state_root"].endswith("/.config/aos"), data
assert int(os.environ["CODE"]) == data["exit_code"], data
PY
then
    pass "doctor gateway runs through external command manifest"
else
    fail "doctor gateway external dispatch drifted: ${DOCTOR_OUT:-}"
fi

echo
if [ "$FAILS" -eq 0 ]; then
    echo "external-command-dispatch: all checks passed"
else
    echo "external-command-dispatch: $FAILS failure(s)"
    exit 1
fi
