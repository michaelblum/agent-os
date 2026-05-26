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

if ./aos do external-dispatch-bogus >/tmp/aos-do-bogus.out 2>/tmp/aos-do-bogus.err; then
    fail "do unknown subcommand succeeded"
else
    if grep -q '"code" : "UNKNOWN_SUBCOMMAND"' /tmp/aos-do-bogus.err \
        && grep -q 'Unknown do subcommand: external-dispatch-bogus' /tmp/aos-do-bogus.err; then
        pass "do unknown subcommands route through external family router"
    else
        fail "do unknown subcommand error drifted: $(cat /tmp/aos-do-bogus.err)"
    fi
fi
rm -f /tmp/aos-do-bogus.out /tmp/aos-do-bogus.err

if ./aos show external-dispatch-bogus >/tmp/aos-show-bogus.out 2>/tmp/aos-show-bogus.err; then
    fail "show unknown subcommand succeeded"
else
    if grep -q '"code" : "UNKNOWN_SUBCOMMAND"' /tmp/aos-show-bogus.err \
        && grep -q 'Unknown show subcommand: external-dispatch-bogus' /tmp/aos-show-bogus.err; then
        pass "show unknown subcommands route through external family router"
    else
        fail "show unknown subcommand error drifted: $(cat /tmp/aos-show-bogus.err)"
    fi
fi
rm -f /tmp/aos-show-bogus.out /tmp/aos-show-bogus.err

if python3 - <<'PY'
import json

manifest = json.load(open("manifests/commands/aos-external-commands.json", encoding="utf-8"))
commands = {tuple(item["path"]): item for item in manifest["commands"]}
for path in [("see", "cursor"), ("see", "list"), ("see", "selection")]:
    command = commands[path]
    assert command["executable"] == "$AOS_PATH", command
    assert command["argv_prefix"] == ["__see", path[-1]], command
PY
then
    pass "live-sensitive see primitives are routed through the external command manifest"
else
    fail "see primitive external manifest routing drifted"
fi

LISTEN_ROOT="$(mktemp -d)"
if AOS_STATE_ROOT="$LISTEN_ROOT" AOS_RUNTIME_MODE=repo AOS_PATH="$PWD/aos" ./aos show listen >/tmp/aos-show-listen-cleanup.out 2>/tmp/aos-show-listen-cleanup.err < /dev/null; then
    sleep 1
    if SOCK="$LISTEN_ROOT/repo/sock" node - <<'NODE'
const net = require('node:net');
const socket = net.createConnection(process.env.SOCK);
const timer = setTimeout(() => {
  socket.destroy();
  process.exit(0);
}, 250);
socket.once('connect', () => {
  clearTimeout(timer);
  socket.end();
  process.exit(1);
});
socket.once('error', () => {
  clearTimeout(timer);
  process.exit(0);
});
NODE
    then
        pass "show listen cleans up isolated auto-start daemon on stdin close"
    else
        fail "show listen left isolated daemon reachable after stdin close"
    fi
else
    fail "show listen cleanup smoke failed: $(cat /tmp/aos-show-listen-cleanup.err)"
fi
rm -rf "$LISTEN_ROOT" /tmp/aos-show-listen-cleanup.out /tmp/aos-show-listen-cleanup.err

if ./aos dev external-dispatch-bogus >/tmp/aos-dev-bogus.out 2>/tmp/aos-dev-bogus.err; then
    fail "dev unknown subcommand succeeded"
else
    if grep -q '"code" : "UNKNOWN_SUBCOMMAND"' /tmp/aos-dev-bogus.err \
        && grep -q 'Unknown dev subcommand: external-dispatch-bogus' /tmp/aos-dev-bogus.err; then
        pass "dev unknown subcommands route through external family router"
    else
        fail "dev unknown subcommand error drifted: $(cat /tmp/aos-dev-bogus.err)"
    fi
fi
rm -f /tmp/aos-dev-bogus.out /tmp/aos-dev-bogus.err

if ./aos service >/tmp/aos-service-empty.out 2>/tmp/aos-service-empty.err; then
    fail "service without subcommand succeeded"
else
    if grep -q '"code" : "MISSING_SUBCOMMAND"' /tmp/aos-service-empty.err \
        && grep -q 'service requires a subcommand' /tmp/aos-service-empty.err; then
        pass "service missing subcommand routes through external subcommand router"
    else
        fail "service missing subcommand error drifted: $(cat /tmp/aos-service-empty.err)"
    fi
fi
rm -f /tmp/aos-service-empty.out /tmp/aos-service-empty.err

if ./aos runtime external-dispatch-bogus >/tmp/aos-runtime-bogus.out 2>/tmp/aos-runtime-bogus.err; then
    fail "runtime unknown subcommand succeeded"
else
    if grep -q '"code" : "UNKNOWN_SUBCOMMAND"' /tmp/aos-runtime-bogus.err \
        && grep -q 'Unknown runtime subcommand: external-dispatch-bogus' /tmp/aos-runtime-bogus.err; then
        pass "runtime unknown subcommands route through external subcommand router"
    else
        fail "runtime unknown subcommand error drifted: $(cat /tmp/aos-runtime-bogus.err)"
    fi
fi
rm -f /tmp/aos-runtime-bogus.out /tmp/aos-runtime-bogus.err

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
