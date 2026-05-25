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

if OUT="$(./aos service status --mode repo --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["mode"] == "repo", data
assert data["launchd_label"] == "com.agent-os.aos.repo", data
assert data["expected_binary_path"].endswith("/agent-os/aos"), data
PY
then
    pass "service status runs through external command manifest"
else
    fail "service status external dispatch drifted: ${OUT:-}"
fi

RESET_ROOT="$(mktemp -d)"
RESET_OUT="$(mktemp)"
mkdir -p "$RESET_ROOT/installed" "$RESET_ROOT/legacy-junk"
touch "$RESET_ROOT/installed/probe" "$RESET_ROOT/legacy-junk/probe"
AOS_STATE_ROOT="$RESET_ROOT" AOS_RUNTIME_MODE=installed ./aos reset --mode installed --json >"$RESET_OUT" 2>/dev/null
if RESET_ROOT="$RESET_ROOT" RESET_OUT="$RESET_OUT" python3 - <<'PY'
import json
import os

root = os.environ["RESET_ROOT"]
with open(os.environ["RESET_OUT"], encoding="utf-8") as fh:
    data = json.load(fh)
assert data["reset_mode"] == "installed", data
assert f"{root}/installed" in data["removed_paths"], data
assert f"{root}/legacy-junk" in data["removed_paths"], data
assert not os.path.exists(f"{root}/installed"), data
assert os.path.exists("./aos"), "repo binary should not be removed by installed-mode reset"
PY
then
    pass "reset runs through external command manifest in isolated installed mode"
else
    fail "reset external dispatch drifted: $(cat "$RESET_OUT" 2>/dev/null || true)"
fi
rm -rf "$RESET_ROOT" "$RESET_OUT"

COMM_ROOT="$(mktemp -d)"
COMM_REGISTER="$(mktemp)"
COMM_WHO="$(mktemp)"
COMM_SEND="$(mktemp)"
COMM_READ="$(mktemp)"
AOS_STATE_ROOT="$COMM_ROOT" AOS_RUNTIME_MODE=repo AOS_PATH="$PWD/aos" ./aos tell --register --session-id external-dispatch-session --name external-dispatch --role worker --harness test >"$COMM_REGISTER" 2>/dev/null
AOS_STATE_ROOT="$COMM_ROOT" AOS_RUNTIME_MODE=repo AOS_PATH="$PWD/aos" ./aos tell --who >"$COMM_WHO" 2>/dev/null
AOS_STATE_ROOT="$COMM_ROOT" AOS_RUNTIME_MODE=repo AOS_PATH="$PWD/aos" ./aos tell external-dispatch "hello from external dispatch" >"$COMM_SEND" 2>/dev/null
AOS_STATE_ROOT="$COMM_ROOT" AOS_RUNTIME_MODE=repo AOS_PATH="$PWD/aos" ./aos listen external-dispatch --limit 5 >"$COMM_READ" 2>/dev/null
if COMM_REGISTER="$COMM_REGISTER" COMM_WHO="$COMM_WHO" COMM_SEND="$COMM_SEND" COMM_READ="$COMM_READ" python3 - <<'PY'
import json
import os

register = json.load(open(os.environ["COMM_REGISTER"], encoding="utf-8"))
who = json.load(open(os.environ["COMM_WHO"], encoding="utf-8"))
send = json.load(open(os.environ["COMM_SEND"], encoding="utf-8"))
read = json.load(open(os.environ["COMM_READ"], encoding="utf-8"))
assert register["status"] == "success", register
assert "external-dispatch-session" in json.dumps(who), who
assert send["status"] == "success", send
assert "hello from external dispatch" in json.dumps(read), read
PY
then
    pass "tell and listen run through external command manifest"
else
    fail "tell/listen external dispatch drifted"
fi
AOS_STATE_ROOT="$COMM_ROOT" AOS_RUNTIME_MODE=repo AOS_PATH="$PWD/aos" ./aos service stop --mode repo >/dev/null 2>&1 || true
rm -rf "$COMM_ROOT" "$COMM_REGISTER" "$COMM_WHO" "$COMM_SEND" "$COMM_READ"

echo
if [ "$FAILS" -eq 0 ]; then
    echo "external-command-dispatch: all checks passed"
else
    echo "external-command-dispatch: $FAILS failure(s)"
    exit 1
fi
