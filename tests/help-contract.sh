#!/usr/bin/env bash
# help-contract.sh — verify help/error path contracts
#
# Covers:
#   - `aos help --json` returns JSON registry
#   - `aos help show --json` returns JSON for a specific command
#   - unknown flags return JSON stderr with machine-readable `code`
#   - unknown subcommand + --help does NOT masquerade as successful help dump
#   - missing required args return MISSING_ARG via exitError

set -eu
# Deliberately not using pipefail: grep -q exits early after match,
# which causes the upstream `echo` to receive SIGPIPE — pipefail would
# surface that as a false failure.

FAILS=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILS=$((FAILS + 1)); }

# --- 1. aos help --json → JSON registry on stdout, exit 0 ---
OUT=$(./aos help --json 2>/dev/null)
if echo "$OUT" | grep -q '"commands"'; then
    pass "aos help --json emits JSON registry"
else
    fail "aos help --json did not emit JSON registry"
fi

# --- 2. aos help show --json → JSON per-command ---
OUT=$(./aos help show --json 2>/dev/null)
if echo "$OUT" | grep -q '"path"'; then
    pass "aos help show --json emits JSON per-command"
else
    fail "aos help show --json did not emit JSON per-command"
fi

# --- 3. aos help <bogus> → UNKNOWN_COMMAND on stderr, exit 1 ---
if ERR=$(./aos help definitely-not-a-command --json 2>&1 >/dev/null); then
    fail "aos help bogus should exit non-zero"
elif echo "$ERR" | grep -q '"code" : "UNKNOWN_COMMAND"'; then
    pass "aos help bogus returns UNKNOWN_COMMAND"
else
    fail "aos help bogus did not return UNKNOWN_COMMAND: $ERR"
fi

# --- 4. aos do bogus --help --json → UNKNOWN_COMMAND, not text dump ---
if OUT=$(./aos do bogus --help --json 2>&1); then
    # exit 0 = bug (was silently returning help)
    fail "aos do bogus --help --json unexpectedly exited 0 with: $OUT"
else
    if echo "$OUT" | grep -q '"code" : "UNKNOWN_COMMAND"'; then
        pass "aos do bogus --help --json returns UNKNOWN_COMMAND"
    else
        fail "aos do bogus --help --json did not return UNKNOWN_COMMAND: $OUT"
    fi
fi

# --- 5. aos clean --badflag → UNKNOWN_FLAG JSON on stderr ---
if ERR=$(./aos clean --badflag 2>&1 >/dev/null); then
    fail "aos clean --badflag should exit non-zero"
elif echo "$ERR" | grep -q '"code" : "UNKNOWN_FLAG"'; then
    pass "aos clean --badflag returns UNKNOWN_FLAG"
else
    fail "aos clean --badflag did not return UNKNOWN_FLAG: $ERR"
fi

# --- 6. aos tell (no args) → MISSING_ARG on stderr ---
if ERR=$(./aos tell 2>&1 >/dev/null); then
    fail "aos tell with no args should exit non-zero"
elif echo "$ERR" | grep -q '"code" : "MISSING_ARG"'; then
    pass "aos tell with no args returns MISSING_ARG"
else
    fail "aos tell with no args did not return MISSING_ARG: $ERR"
fi

# --- 7. aos listen (no channel) → MISSING_ARG on stderr ---
if ERR=$(./aos listen 2>&1 >/dev/null); then
    fail "aos listen with no args should exit non-zero"
elif echo "$ERR" | grep -q '"code" : "MISSING_ARG"'; then
    pass "aos listen with no args returns MISSING_ARG"
else
    fail "aos listen with no args did not return MISSING_ARG: $ERR"
fi

# --- 8. aos wiki (no subcommand) → MISSING_SUBCOMMAND ---
if ERR=$(./aos wiki 2>&1 >/dev/null); then
    fail "aos wiki with no args should exit non-zero"
elif echo "$ERR" | grep -q '"code" : "MISSING_SUBCOMMAND"'; then
    pass "aos wiki with no args returns MISSING_SUBCOMMAND"
else
    fail "aos wiki with no args did not return MISSING_SUBCOMMAND: $ERR"
fi

# --- 9. Help registry declares --json support for `help` itself ---
# Regression guard for Codex finding #2: outText vs outJSONFlag
OUT=$(./aos help help --json 2>/dev/null)
if echo "$OUT" | grep -q '"supports_json_flag" : true'; then
    pass "help registry declares --json support"
else
    fail "help registry still declares outText (should be outJSONFlag): $OUT"
fi

# --- 10. aos help show eval --json stays aligned with the real parser ---
OUT=$(./aos help show eval --json 2>/dev/null)
if echo "$OUT" | grep -q '"token" : "--js"' &&
   echo "$OUT" | grep -q 'aos show eval --id <name> --js <javascript>' &&
   ! echo "$OUT" | grep -q -- '--script'; then
    pass "show eval help matches --js parser"
else
    fail "show eval help drifted from parser: $OUT"
fi

# --- 11. aos help voice --json exposes the first-class voice surface ---
OUT=$(./aos help voice --json 2>/dev/null)
if echo "$OUT" | grep -q '"path" : \[' &&
   echo "$OUT" | grep -q '"voice-list"' &&
   echo "$OUT" | grep -q '"voice-assignments"' &&
   ! echo "$OUT" | grep -q '"voice-leases"'; then
    pass "voice help exposes registry-backed assignment forms"
else
    fail "voice help drifted from assignment surface: $OUT"
fi

# --- 12. aos help config --json exposes the discoverable config surface ---
OUT=$(./aos help config --json 2>/dev/null)
if echo "$OUT" | grep -q '"config-get"' &&
   echo "$OUT" | grep -q '"config-set"' &&
   echo "$OUT" | grep -q 'aos config get <key> \[--json\]'; then
    pass "config help exposes get/set forms"
else
    fail "config help is missing get/set forms: $OUT"
fi

# --- 13. aos help tell --json exposes session-backed human delivery context ---
OUT=$(./aos help tell --json 2>/dev/null)
if echo "$OUT" | grep -q '"token" : "--from-session-id"' &&
   echo "$OUT" | grep -q '"token" : "--purpose"' &&
   echo "$OUT" | grep -q 'final_response'; then
    pass "tell help exposes final-response relay flags"
else
    fail "tell help is missing final-response relay flags: $OUT"
fi

# --- 14. aos help ready --json exposes the front-door readiness gate ---
OUT=$(./aos help ready --json 2>/dev/null)
if echo "$OUT" | grep -q '"ready"' &&
   echo "$OUT" | grep -q 'aos ready \[--json\] \[--repair\] \[--post-permission\]' &&
   echo "$OUT" | grep -q '"token" : "--repair"' &&
   echo "$OUT" | grep -q '"token" : "--post-permission"' &&
   echo "$OUT" | grep -q '"supports_json_flag" : true'; then
    pass "ready help exposes front-door readiness gate"
else
    fail "ready help is missing or malformed: $OUT"
fi

# --- 15. show create/update registry stays aligned with canvas parser enums ---
if CREATE="$(./aos help show create --json 2>/dev/null)" UPDATE="$(./aos help show update --json 2>/dev/null)" python3 - <<'PY'
import json
import os


def form_arg(payload, form_id, arg_id):
    data = json.loads(payload)
    form = next(item for item in data["forms"] if item["id"] == form_id)
    return next((arg for arg in form["args"] if arg["id"] == arg_id), None)


def enum_values(arg):
    return [item["value"] for item in arg["value_type"]["enum"]]


create_auto = form_arg(os.environ["CREATE"], "show-create", "auto-project")
assert enum_values(create_auto) == ["cursor_trail", "highlight_focused", "label_elements"], create_auto
assert form_arg(os.environ["UPDATE"], "show-update", "auto-project") is None
assert form_arg(os.environ["UPDATE"], "show-update", "anchor-channel") is not None
assert enum_values(form_arg(os.environ["UPDATE"], "show-update", "track")) == ["union"]
PY
then
    pass "show create/update registry matches canvas parser enums"
else
    fail "show create/update registry drifted from canvas parser"
fi

# --- 16. live command registry exposes capability preflight metadata ---
if SEE="$(./aos help see --json 2>/dev/null)" DO="$(./aos help do --json 2>/dev/null)" SHOW="$(./aos help show --json 2>/dev/null)" TELL="$(./aos help tell --json 2>/dev/null)" LISTEN="$(./aos help listen --json 2>/dev/null)" VOICE="$(./aos help voice --json 2>/dev/null)" GRAPH="$(./aos help graph --json 2>/dev/null)" DAEMON_SNAPSHOT="$(./aos help daemon-snapshot --json 2>/dev/null)" CONTENT="$(./aos help content --json 2>/dev/null)" LOG="$(./aos help log --json 2>/dev/null)" python3 - <<'PY'
import json
import os


def forms(payload):
    return {form["id"]: form for form in json.loads(payload)["forms"]}


def caps(form):
    return form["execution"].get("required_capabilities", [])


def ids(form):
    return [cap["id"] for cap in caps(form)]


see = forms(os.environ["SEE"])
do = forms(os.environ["DO"])
show = forms(os.environ["SHOW"])
tell = forms(os.environ["TELL"])
listen = forms(os.environ["LISTEN"])
voice = forms(os.environ["VOICE"])
graph = forms(os.environ["GRAPH"])
daemon_snapshot = forms(os.environ["DAEMON_SNAPSHOT"])
content = forms(os.environ["CONTENT"])
log = forms(os.environ["LOG"])

assert ids(see["see-target"]) == ["perception.ax"], see["see-target"]
assert ids(see["see-observe"]) == ["runtime.daemon", "perception.ax"], see["see-observe"]
assert ids(see["see-capture"]) == ["perception.screen", "browser.adapter"], see["see-capture"]

click_caps = caps(do["do-click"])
assert click_caps[0] == {
    "id": "action.input",
    "scope": "daemon",
    "when": "target_kind != browser",
}, click_caps
assert click_caps[1] == {
    "id": "browser.adapter",
    "scope": "target.session",
    "when": "target_kind == browser",
}, click_caps
assert ids(do["do-fill"]) == ["browser.adapter"], do["do-fill"]
assert ids(do["do-navigate"]) == ["browser.adapter"], do["do-navigate"]

assert ids(show["show-create"]) == ["runtime.daemon", "projection.canvas", "content.root"], show["show-create"]
assert ids(show["show-list"]) == ["runtime.daemon", "projection.canvas"], show["show-list"]
assert ids(show["show-wait"]) == ["runtime.daemon", "projection.canvas"], show["show-wait"]
assert ids(show["show-post"]) == ["runtime.daemon", "projection.canvas"], show["show-post"]
assert ids(show["show-to-front"]) == ["runtime.daemon", "projection.canvas"], show["show-to-front"]
assert ids(tell["tell-message"]) == ["runtime.daemon"], tell["tell-message"]
assert ids(listen["listen-read"]) == ["runtime.daemon"], listen["listen-read"]
assert ids(voice["voice-list"]) == ["runtime.daemon"], voice["voice-list"]
assert ids(voice["voice-assignments"]) == ["runtime.daemon"], voice["voice-assignments"]
assert ids(voice["voice-refresh"]) == ["runtime.daemon"], voice["voice-refresh"]
assert ids(voice["voice-providers"]) == ["runtime.daemon"], voice["voice-providers"]
assert ids(voice["voice-bind"]) == ["runtime.daemon"], voice["voice-bind"]
assert ids(voice["voice-next"]) == ["runtime.daemon"], voice["voice-next"]
assert ids(voice["voice-final-response"]) == ["runtime.daemon"], voice["voice-final-response"]
assert ids(graph["graph-displays"]) == ["runtime.daemon"], graph["graph-displays"]
assert ids(graph["graph-windows"]) == ["runtime.daemon"], graph["graph-windows"]
assert ids(graph["graph-deepen"]) == ["runtime.daemon"], graph["graph-deepen"]
assert ids(graph["graph-collapse"]) == ["runtime.daemon"], graph["graph-collapse"]
assert ids(daemon_snapshot["daemon-snapshot"]) == ["runtime.daemon"], daemon_snapshot["daemon-snapshot"]
assert ids(content["content-status"]) == ["runtime.daemon"], content["content-status"]
assert ids(content["content-wait"]) == ["runtime.daemon"], content["content-wait"]
assert ids(log["log-stream"]) == ["runtime.daemon", "projection.canvas", "content.root"], log["log-stream"]
assert ids(log["log-push"]) == ["runtime.daemon", "projection.canvas"], log["log-push"]
assert ids(log["log-clear"]) == ["runtime.daemon", "projection.canvas"], log["log-clear"]
PY
then
    pass "live command registry exposes capability preflight metadata"
else
    fail "live command capability metadata missing or malformed"
fi

echo
if [ "$FAILS" -eq 0 ]; then
    echo "help-contract: all checks passed"
    exit 0
else
    echo "help-contract: $FAILS failure(s)"
    exit 1
fi
