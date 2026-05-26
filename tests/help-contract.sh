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

if ./aos >/tmp/aos-root-help.out 2>/tmp/aos-root-help.err \
    && ./aos --help >/tmp/aos-root-help-flag.out 2>/tmp/aos-root-help-flag.err \
    && ./aos do --help --json >/tmp/aos-do-help-flag.json 2>/tmp/aos-do-help-flag.err \
    && grep -q 'Usage: ./aos <command> \[options\]' /tmp/aos-root-help.out \
    && grep -q 'Usage: ./aos <command> \[options\]' /tmp/aos-root-help-flag.out \
    && python3 - <<'PY'
import json
data = json.load(open('/tmp/aos-do-help-flag.json'))
assert data['path'] == ['do']
assert any(form['id'] == 'do-click' for form in data['forms'])
PY
then
    pass "root and family help flags route through external help"
else
    fail "external help flag routing drifted"
fi
rm -f /tmp/aos-root-help.out /tmp/aos-root-help.err /tmp/aos-root-help-flag.out /tmp/aos-root-help-flag.err /tmp/aos-do-help-flag.json /tmp/aos-do-help-flag.err

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

# --- 12. aos help say --json exposes voice slot selection ---
OUT=$(./aos help say --json 2>/dev/null)
if echo "$OUT" | grep -q '"token" : "--voice-slot"' &&
   echo "$OUT" | grep -q '"token" : "--language"' &&
   echo "$OUT" | grep -q '"token" : "--gender"' &&
   echo "$OUT" | grep -q '"token" : "--quality-tier"' &&
   echo "$OUT" | grep -q 'aos say \[--voice id\] \[--voice-slot n\] \[--language value\] \[--gender value\] \[--quality-tier value\] \[--rate wpm\] <text>' &&
   echo "$OUT" | grep -q 'resolved after filters'; then
    pass "say help exposes filtered voice-slot selection"
else
    fail "say help is missing filtered voice-slot selection: $OUT"
fi

# --- 13. aos help config --json exposes the discoverable config surface ---
OUT=$(./aos help config --json 2>/dev/null)
if echo "$OUT" | grep -q '"config-get"' &&
   echo "$OUT" | grep -q '"config-set"' &&
   echo "$OUT" | grep -q 'aos config get <key> \[--json\]'; then
    pass "config help exposes get/set forms"
else
    fail "config help is missing get/set forms: $OUT"
fi

# --- 14. aos help tell --json exposes session-backed human delivery context ---
OUT=$(./aos help tell --json 2>/dev/null)
if echo "$OUT" | grep -q '"token" : "--from-session-id"' &&
   echo "$OUT" | grep -q '"token" : "--purpose"' &&
   echo "$OUT" | grep -q 'final_response'; then
    pass "tell help exposes final-response relay flags"
else
    fail "tell help is missing final-response relay flags: $OUT"
fi

# --- 15. aos help ready --json exposes the front-door readiness gate ---
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

# --- 16. show create/update registry stays aligned with canvas parser enums ---
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

# --- 17. do click help exposes coordinate, browser, and canvas ref target forms ---
OUT=$(./aos help do click --json 2>/dev/null)
if OUT="$OUT" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
form = next(item for item in data["forms"] if item["id"] == "do-click")
usage = form["usage"]
tokens = {arg.get("token") for arg in form["args"]}
assert "canvas:<canvas-id>/<ref>" in usage, usage
assert "browser:<session>/<ref>" in usage, usage
assert "--state-id" in tokens, tokens
PY
then
    pass "do click help exposes ref target forms"
else
    fail "do click help is missing ref target forms: $OUT"
fi

# --- 18. dev build only wraps the build step and disables daemon restart ---
if python3 - <<'PY'
from pathlib import Path

source = Path("scripts/aos-dev-build.mjs").read_text(encoding="utf-8")
assert "buildArgs.push('--no-restart')" in source
assert "build_wrapper: 'build.sh'" in source
assert "build_source: 'repo-root/build.sh'" in source
assert "next: null" in source
assert "permission_note" not in source
assert "Next: ./aos ready" not in source
PY
then
    pass "dev build reports its wrapper source and avoids readiness ritual"
else
    fail "dev build wrapper telemetry or readiness boundary regressed"
fi

# --- 19. dev build-checkpoint owns post-build pause/recovery contract ---
OUT=$(./aos dev build-checkpoint --json 2>/dev/null)
if OUT="$OUT" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["schema"] == "aos.dev_build.post_build_checkpoint.v1", data
assert data["pause_command"] == "/goal pause", data
assert data["resume_command"] == "/goal resume", data
commands = data["commands"]
assert commands["reset_runtime"] == "./aos permissions reset-runtime --mode repo", commands
assert commands["setup_once"] == "./aos permissions setup --once", commands
assert commands["post_permission_ready"] == "./aos ready --post-permission", commands
assert "goal_pause_required: repo-mode AOS permission repair" in data["post_tool_system_message"], data
assert "dev_build_checkpoint_already_completed" in data["repeated_build_system_message"], data
assert data["canvas"]["title"] == "AOS permission reset needed", data
PY
then
    pass "dev build-checkpoint owns post-build pause/recovery contract"
else
    fail "dev build-checkpoint contract regressed: $OUT"
fi

# --- 20. dev afk-session-trigger help exposes guarded trigger flags ---
OUT=$(./aos help dev afk-session-trigger --json 2>/dev/null)
if OUT="$OUT" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
form = next(item for item in data["forms"] if item["id"] == "dev-afk-session-trigger")
tokens = {arg.get("token") for arg in form["args"]}
assert {"--packet", "--afk-work-queue", "--queue-run-fixture", "--afk-authorization", "--sleep-lease", "--dry-run", "--supervised-live-launch", "--afk-live-launch", "--sleep-lease-live-launch", "--warm-dock-tui-reuse", "--i-am-present", "--provider-launch-dry-run", "--provider", "--dock", "--repo", "--timestamp", "--out", "--result-route", "--idempotence-salt", "--existing-receipt", "--replacement-for", "--bridge-visibility-fixture", "--cleanup-proof-fixture", "--provider-session-id", "--launch-observed-at", "--codex-home-fixture", "--codex-home", "--json"} <= tokens, tokens
assert "--live" not in tokens, tokens
assert "--launch-provider" not in tokens, tokens
assert "--start" not in tokens, tokens
assert "experimental" in json.dumps(form).lower(), form
assert "prototype" in json.dumps(form).lower(), form
assert "afk authorization" in json.dumps(form).lower(), form
assert "afk live launch" in json.dumps(form).lower(), form
assert "no provider" in json.dumps(form).lower(), form
PY
then
    pass "dev afk-session-trigger help exposes guarded trigger flags"
else
    fail "dev afk-session-trigger help is missing guarded trigger flags: $OUT"
fi

# --- 21. command registry metadata is externally hot-swappable ---
TMP_REGISTRY="$(mktemp "${TMPDIR:-/tmp}/aos-command-registry.XXXXXX.json")"
python3 - "$TMP_REGISTRY" <<'PY'
import json
import sys
from pathlib import Path

manifest = json.loads(Path("manifests/commands/aos-commands.json").read_text(encoding="utf-8"))
dev = next(command for command in manifest["commands"] if command["path"] == ["dev"])
dev["summary"] = "HOT SWAP TEST SUMMARY"
Path(sys.argv[1]).write_text(json.dumps(manifest), encoding="utf-8")
PY
OUT=$(AOS_COMMAND_REGISTRY="$TMP_REGISTRY" ./aos help dev --json 2>/dev/null)
rm -f "$TMP_REGISTRY"
if echo "$OUT" | grep -q 'HOT SWAP TEST SUMMARY'; then
    pass "command registry manifest can change help without Swift changes"
else
    fail "external command registry manifest did not override help: $OUT"
fi

# --- 22. help renderer stays external and does not delegate back into Swift ---
if python3 - <<'PY'
from pathlib import Path

source = Path("scripts/aos-help-proxy.mjs").read_text(encoding="utf-8")
assert "__help" not in source
assert "manifests/commands/aos-commands.json" in source
assert "spawnSync(aosPath()" not in source
PY
then
    pass "help renderer is external and does not delegate to Swift __help"
else
    fail "help renderer delegated back into Swift"
fi

echo
if [ "$FAILS" -eq 0 ]; then
    echo "help-contract: all checks passed"
    exit 0
else
    echo "help-contract: $FAILS failure(s)"
    exit 1
fi
