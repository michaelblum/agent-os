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

if ROOT_JSON="$(./aos help --json 2>/dev/null)" ROOT_TEXT="$(./aos 2>/dev/null)" DIRECT_DEV="$(./aos help dev --json 2>/dev/null)" python3 - <<'PY'
import json
import os
from pathlib import Path

root = json.loads(os.environ["ROOT_JSON"])
manifest = json.loads(Path("manifests/commands/aos-commands.json").read_text(encoding="utf-8"))
assert all(command["path"] != ["dev"] for command in root["commands"]), root
assert "\n  dev" not in os.environ["ROOT_TEXT"], os.environ["ROOT_TEXT"]
direct = json.loads(os.environ["DIRECT_DEV"])
assert direct["path"] == ["dev"], direct
assert direct["consumer_discovery"] is False, direct
assert any(form["id"] == "dev-classify" for form in direct["forms"]), direct
manifest_dev = next(command for command in manifest["commands"] if command["path"] == ["dev"])
assert manifest_dev["consumer_discovery"] is False, manifest_dev
PY
then
    pass "root consumer help excludes dev while direct dev help resolves"
else
    fail "dev demotion from root consumer help drifted"
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

if ERR=$(./aos clean unexpected 2>&1 >/dev/null); then
    fail "aos clean unexpected should exit non-zero"
elif echo "$ERR" | grep -q '"code" : "UNKNOWN_ARG"'; then
    pass "aos clean extra positional returns UNKNOWN_ARG"
else
    fail "aos clean extra positional did not return UNKNOWN_ARG: $ERR"
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
assert "ref:<snapshot-id>:<ref>" in usage, usage
assert "canvas:<canvas-id>/<ref>" in usage, usage
assert "browser:<session>/<ref>" in usage, usage
assert "--state-id" in tokens, tokens
assert "--workspace" in tokens, tokens
assert "--snapshot" in tokens, tokens
PY
then
    pass "do click help exposes ref target forms"
else
    fail "do click help is missing ref target forms: $OUT"
fi

if OUT="$(./aos help do --json 2>/dev/null)" \
   CLICK_TEXT="$(./aos help do click 2>/dev/null)" \
   PRESS_TEXT="$(./aos help do press 2>/dev/null)" \
   SET_VALUE_TEXT="$(./aos help do set-value 2>/dev/null)" \
   FOCUS_TEXT="$(./aos help do focus 2>/dev/null)" \
   SAVED_REF_ACTIONS="$(node --input-type=module <<'JS'
import { SAVED_REF_V0_ACTIONS_BY_BACKEND } from './scripts/lib/agent-workspace/contracts.mjs';
console.log(JSON.stringify([...new Set(Object.values(SAVED_REF_V0_ACTIONS_BY_BACKEND).flat())]));
JS
)" \
   python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
saved_ref_forms = {f"do-{action}" for action in json.loads(os.environ["SAVED_REF_ACTIONS"])}

def required_group(form, summary):
    for group in form.get("constraints", {}).get("required_groups", []):
        if group.get("summary") == summary:
            return {tuple(item) for item in group.get("one_of", [])}
    raise AssertionError(form)

def has_saved_ref_example(form, *, dry_run):
    examples = form.get("examples", [])
    for example in examples:
        if "ref:<snapshot-id>:" not in example:
            continue
        if ("--dry-run" in example) == dry_run:
            return True
    return False

for form in data["forms"]:
    usage = form.get("usage", "")
    examples = " ".join(form.get("examples", []))
    has_saved_ref = "<ref-target" in usage or "ref:<snapshot-id>:<ref>" in usage or "ref:<snapshot-id>:" in examples
    if form["id"] in saved_ref_forms:
        assert has_saved_ref, form
    else:
        assert not has_saved_ref, form
click = next(item for item in data["forms"] if item["id"] == "do-click")
click_target = next(arg for arg in click["args"] if arg.get("id") == "target")
assert "Saved ref" in click_target["summary"], click_target
assert "post_action.recommended_next_command" in click["summary"], click
assert "aos see capture --save" in click["summary"], click
click_examples = click.get("examples", [])
assert "aos do click ref:<snapshot-id>:r1 --workspace default --dry-run" in click_examples, click_examples
assert "aos do click ref:<snapshot-id>:r1 --workspace default" in click_examples, click_examples
set_value = next(item for item in data["forms"] if item["id"] == "do-set-value")
set_value_tokens = {arg.get("token") for arg in set_value["args"]}
assert {"--workspace", "--snapshot", "--value", "--dry-run"} <= set_value_tokens, set_value_tokens
for action in ["click", "fill", "hover", "scroll", "drag", "set-value", "press", "focus"]:
    action_form = next(item for item in data["forms"] if item["id"] == f"do-{action}")
    assert "--dry-run" in action_form["usage"], action_form["usage"]
    assert "post_action.recommended_next_command" in action_form["summary"], action_form
    assert "aos see capture --save" in action_form["summary"], action_form
    assert has_saved_ref_example(action_form, dry_run=True), action_form
    assert has_saved_ref_example(action_form, dry_run=False), action_form
assert "canvas:<canvas-id>/<ref>" in set_value["usage"], set_value["usage"]
assert set_value["usage"].startswith("aos do set-value <ref-target|canvas:<canvas-id>/<ref>>"), set_value["usage"]
assert "| aos do set-value --pid <pid> --role <role>" in set_value["usage"], set_value["usage"]
assert "ref:<snapshot-id>:" in " ".join(set_value.get("examples", [])), set_value
set_value_value = next(arg for arg in set_value["args"] if arg.get("id") == "value")
assert set_value_value["required"] is False, set_value_value
assert "positional value" in set_value_value["summary"], set_value_value
set_value_positional = next(arg for arg in set_value["args"] if arg.get("id") == "value-text")
assert set_value_positional["required"] is False and "Positional value" in set_value_positional["summary"], set_value_positional
assert required_group(set_value, "target source") == {("target",), ("pid", "role")}, set_value
assert required_group(set_value, "value source") == {("value",), ("value-text",)}, set_value
set_value_dry_run = next(arg for arg in set_value["args"] if arg.get("id") == "dry-run")
assert "direct AX" in set_value_dry_run["summary"] and "no_foreground" in set_value_dry_run["summary"] and "proof" in set_value_dry_run["summary"], set_value_dry_run
press = next(item for item in data["forms"] if item["id"] == "do-press")
press_tokens = {arg.get("token") for arg in press["args"]}
assert "--dry-run" in press_tokens, press_tokens
assert press["execution"]["supports_dry_run"] is True, press
assert press["usage"].startswith("aos do press <ref-target>"), press["usage"]
assert "| aos do press --pid <pid> --role <role> [filters]" in press["usage"], press["usage"]
assert "<ref:<snapshot-id>:<ref>|--pid" not in press["usage"], press["usage"]
assert "ref:<snapshot-id>:" in " ".join(press.get("examples", [])), press
press_target = next(arg for arg in press["args"] if arg.get("id") == "target")
assert press_target["required"] is False and "saved native AX ref" in press_target["summary"], press_target
press_role = next(arg for arg in press["args"] if arg.get("id") == "role")
assert press_role["required"] is False and "direct --pid form" in press_role["summary"], press_role
assert required_group(press, "target source") == {("target",), ("pid", "role")}, press
press_dry_run = next(arg for arg in press["args"] if arg.get("id") == "dry-run")
assert "saved-ref or direct AX" in press_dry_run["summary"] and "no_foreground" in press_dry_run["summary"] and "proof" in press_dry_run["summary"], press_dry_run
focus = next(item for item in data["forms"] if item["id"] == "do-focus")
focus_tokens = {arg.get("token") for arg in focus["args"]}
assert "--dry-run" in focus_tokens, focus_tokens
assert focus["execution"]["supports_dry_run"] is True, focus
assert focus["usage"].startswith("aos do focus <ref-target>"), focus["usage"]
assert "| aos do focus --pid <pid> --role <role> [filters]" in focus["usage"], focus["usage"]
assert "<ref:<snapshot-id>:<ref>|--pid" not in focus["usage"], focus["usage"]
assert "ref:<snapshot-id>:" in " ".join(focus.get("examples", [])), focus
focus_target = next(arg for arg in focus["args"] if arg.get("id") == "target")
assert focus_target["required"] is False and "saved native AX ref" in focus_target["summary"], focus_target
focus_role = next(arg for arg in focus["args"] if arg.get("id") == "role")
assert focus_role["required"] is False and "direct --pid form" in focus_role["summary"], focus_role
assert required_group(focus, "target source") == {("target",), ("pid", "role")}, focus
focus_dry_run = next(arg for arg in focus["args"] if arg.get("id") == "dry-run")
assert "saved-ref or direct AX" in focus_dry_run["summary"] and "no_foreground" in focus_dry_run["summary"] and "proof" in focus_dry_run["summary"], focus_dry_run
assert "requires one target source: <target> OR --pid + --role" in os.environ["PRESS_TEXT"], os.environ["PRESS_TEXT"]
assert "requires one target source: <target> OR --pid + --role" in os.environ["FOCUS_TEXT"], os.environ["FOCUS_TEXT"]
assert "requires one target source: <target> OR --pid + --role" in os.environ["SET_VALUE_TEXT"], os.environ["SET_VALUE_TEXT"]
assert "requires one value source: --value OR <value-text>" in os.environ["SET_VALUE_TEXT"], os.environ["SET_VALUE_TEXT"]
assert "post_action.recommended_next_command" in os.environ["CLICK_TEXT"], os.environ["CLICK_TEXT"]
assert "aos see capture --save" in os.environ["CLICK_TEXT"], os.environ["CLICK_TEXT"]
assert "aos do click ref:<snapshot-id>:r1 --workspace default --dry-run" in os.environ["CLICK_TEXT"], os.environ["CLICK_TEXT"]
assert "aos do click ref:<snapshot-id>:r1 --workspace default" in os.environ["CLICK_TEXT"], os.environ["CLICK_TEXT"]
fill = next(item for item in data["forms"] if item["id"] == "do-fill")
fill_tokens = {arg.get("token") for arg in fill["args"]}
assert {"--workspace", "--snapshot", "--dry-run"} <= fill_tokens, fill_tokens
assert "browser:<s>/<ref>" in fill["usage"], fill["usage"]
hover = next(item for item in data["forms"] if item["id"] == "do-hover")
hover_tokens = {arg.get("token") for arg in hover["args"]}
assert {"--workspace", "--snapshot", "--dry-run"} <= hover_tokens, hover_tokens
assert "browser:<session>/<ref>" in hover["usage"], hover["usage"]
scroll = next(item for item in data["forms"] if item["id"] == "do-scroll")
scroll_tokens = {arg.get("token") for arg in scroll["args"]}
assert {"--workspace", "--snapshot", "--dry-run"} <= scroll_tokens, scroll_tokens
assert "browser:<session>/<ref>" in scroll["usage"], scroll["usage"]
drag = next(item for item in data["forms"] if item["id"] == "do-drag")
drag_tokens = {arg.get("token") for arg in drag["args"]}
assert {"--workspace", "--snapshot", "--dry-run"} <= drag_tokens, drag_tokens
assert "--speed" not in drag_tokens, drag_tokens
assert "browser:<session>/<ref>" in drag["usage"], drag["usage"]
assert "--speed" not in drag["usage"], drag["usage"]
assert "x1,y1" not in drag["usage"], drag["usage"]
native_drag = next(item for item in data["forms"] if item["id"] == "do-drag-native")
native_drag_tokens = {arg.get("token") for arg in native_drag["args"]}
assert "--speed" in native_drag_tokens, native_drag_tokens
assert "--speed N" in native_drag["usage"], native_drag["usage"]
assert "<x1,y1> <x2,y2>" in native_drag["usage"], native_drag["usage"]
assert "ref:<snapshot-id>" not in native_drag["usage"], native_drag["usage"]
PY
then
    pass "supported saved-ref do actions advertise saved ref targets"
else
    fail "do saved-ref help advertising drifted"
fi

# --- 18. saved agent workspace help stays discoverable ---
if CAPTURE="$(./aos help see capture --json 2>/dev/null)" \
   CAPTURE_TEXT="$(./aos help see capture 2>/dev/null)" \
   REFS="$(./aos help see refs --json 2>/dev/null)" \
   SNAPSHOTS="$(./aos help see snapshots --json 2>/dev/null)" \
   WORKSPACE="$(./aos help see workspace --json 2>/dev/null)" \
   python3 - <<'PY'
import json
import os

capture = json.loads(os.environ["CAPTURE"])
capture_form = next(item for item in capture["forms"] if item["id"] == "see-capture")
capture_save_form = next(item for item in capture["forms"] if item["id"] == "see-capture-save")
capture_tokens = {arg.get("token") for arg in capture_form["args"]}
capture_save_tokens = {arg.get("token") for arg in capture_save_form["args"]}
capture_conflicts = [set(item) for item in capture_form.get("constraints", {}).get("conflicts", [])]
mode_arg = next(arg for arg in capture_save_form["args"] if arg.get("token") == "--mode")
mode_values = {item["value"] for item in mode_arg["value_type"]["enum"]}
save_arg = next(arg for arg in capture_form["args"] if arg.get("token") == "--save")
capture_save_arg = next(arg for arg in capture_save_form["args"] if arg.get("token") == "--save")
assert {"--save", "--workspace", "--name", "--mode", "--query"} <= capture_tokens, capture_tokens
assert {"--save", "--workspace", "--name", "--mode", "--query"} <= capture_save_tokens, capture_save_tokens
assert {"save", "out"} in capture_conflicts, capture_conflicts
assert mode_values == {"ax", "vision", "som"}, mode_values
assert "stable native AX press/focus/set-value" in save_arg["summary"], save_arg
assert "documented saved-ref action matrix" in capture_save_arg["summary"], capture_save_arg
assert capture_form["examples"][0].startswith("aos see capture") and "--save" in capture_form["examples"][0], capture_form["examples"]
assert any("aos see refs" in item for item in capture_save_form["examples"]), capture_save_form["examples"]
saved_loop_examples = capture_save_form["examples"]
assert "aos see snapshots --workspace default" in saved_loop_examples, saved_loop_examples
assert "aos see refs --workspace default --query Save" in saved_loop_examples, saved_loop_examples
assert "Persist perception" in capture_save_form["summary"], capture_save_form
assert "stable native AX actions" in capture_save_form["summary"], capture_save_form
assert capture_form["execution"]["mutates_state"] is False, capture_form["execution"]
assert capture_form["execution"]["mutates_when_flags"] == ["--save"], capture_form["execution"]
assert capture_form["execution"]["read_only"] is True, capture_form["execution"]
assert capture_form["output"]["conditional_modes"] == [{
    "default_mode": "json",
    "summary": "Saved capture returns compact JSON refs after persisting local workspace perception",
    "when_flags": ["--save"],
}], capture_form["output"]
assert capture_save_form["execution"]["mutates_state"] is True, capture_save_form["execution"]
assert capture_save_form["execution"]["read_only"] is False, capture_save_form["execution"]
assert "--save" in capture["summary"], capture["summary"]
capture_text = os.environ["CAPTURE_TEXT"]
assert "[execution: read-only, mutates-with --save, requires-permissions]" in capture_text, capture_text
assert "[execution: mutates-state, requires-permissions]" in capture_text, capture_text
assert "[output: none; with --save: json]" in capture_text, capture_text
assert "[output: json]" in capture_text, capture_text

refs = json.loads(os.environ["REFS"])
refs_form = next(item for item in refs["forms"] if item["id"] == "see-refs")
refs_tokens = {arg.get("token") for arg in refs_form["args"]}
assert "Inspect compact saved refs" in refs["summary"], refs["summary"]
assert "Inspect compact saved refs" in refs_form["summary"], refs_form
assert refs_form["usage"] == "aos see refs [--workspace <id>] [--snapshot <id>] [--query <text>] [--json]", refs_form
assert {"--workspace", "--snapshot", "--query", "--json"} <= refs_tokens, refs_tokens

snapshots = json.loads(os.environ["SNAPSHOTS"])
snapshots_form = next(item for item in snapshots["forms"] if item["id"] == "see-snapshots")
assert "List compact saved snapshots" in snapshots["summary"], snapshots["summary"]
assert "List compact saved snapshots" in snapshots_form["summary"], snapshots_form
assert snapshots_form["usage"] == "aos see snapshots [--workspace <id>] [--json]", snapshots_form

workspace = json.loads(os.environ["WORKSPACE"])
form_ids = {item["id"] for item in workspace["forms"]}
assert {"see-workspace", "see-workspace-prune", "see-workspace-delete"} <= form_ids, form_ids
assert "see-workspaces" not in form_ids, form_ids
assert "Inspect one local agent workspace" in workspace["summary"], workspace["summary"]
workspace_form = next(item for item in workspace["forms"] if item["id"] == "see-workspace")
prune = next(item for item in workspace["forms"] if item["id"] == "see-workspace-prune")
delete = next(item for item in workspace["forms"] if item["id"] == "see-workspace-delete")
assert "Inspect one local agent workspace" in workspace_form["summary"], workspace_form
assert "Prune local saved workspace snapshots" in prune["summary"], prune
assert "Delete one local agent workspace" in delete["summary"], delete
prune_tokens = {arg.get("token") for arg in prune["args"]}
delete_tokens = {arg.get("token") for arg in delete["args"]}
assert {"--older-than", "--dry-run", "--i-understand-local-artifacts", "--json"} <= prune_tokens, prune_tokens
assert {"--i-understand-local-artifacts", "--json"} <= delete_tokens, delete_tokens
PY
then
    pass "saved agent workspace help exposes capture, refs, snapshots, and cleanup"
else
    fail "saved agent workspace help drifted"
fi

# --- 18. see zone define help matches the external deterministic parser ---
OUT=$(./aos help see zone define --json 2>/dev/null)
if OUT="$OUT" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
form = next(item for item in data["forms"] if item["id"] == "zone-define")
tokens = {arg.get("token") for arg in form["args"]}
arg_ids = [arg["id"] for arg in form["args"]]
assert form["usage"] == "aos see zone define <name> [--target <display>] <x,y,w,h>", form
assert arg_ids == ["name", "target", "bounds"], arg_ids
assert "--target" in tokens, tokens
assert form["execution"]["mutates_state"] is True, form
assert form["execution"]["interactive"] is False, form
assert form["execution"]["requires_permissions"] is False, form
PY
then
    pass "see zone define help matches external parser"
else
    fail "see zone define help drifted from parser: $OUT"
fi

# --- 19. dev build only wraps the build step and disables daemon restart ---
if python3 - <<'PY'
from pathlib import Path

source = Path("scripts/aos-dev-build.mjs").read_text(encoding="utf-8")
assert "buildArgs.push('--no-restart')" in source
assert "build_wrapper: 'build.sh'" in source
assert "build_source: 'repo-root/build.sh'" in source
assert "next: null" in source
assert "post_build_checkpoint" not in source
assert "checkpointContract" not in source
assert "permissions reset-runtime --mode repo" not in source
assert "ready --post-permission" not in source
assert "permission_note" not in source
assert "Next: ./aos ready" not in source
PY
then
    pass "dev build reports wrapper source without post-build ritual"
else
    fail "dev build wrapper telemetry or readiness boundary regressed"
fi

# --- 20. native source keeps product names out of the repo-mode binary path ---
if python3 - <<'PY'
from pathlib import Path

wiki_graph = Path("src/commands/wiki-graph.swift").read_text(encoding="utf-8")
config = Path("src/shared/config.swift").read_text(encoding="utf-8")
assert "sigil/agents/" not in wiki_graph
assert ('raw == "' + 'agent"') not in wiki_graph
assert 'toggle_id: "avatar"' not in config
assert 'toggle_id: "status-item-canvas"' in config
PY
then
    pass "native source keeps product-specific names out of generic binary paths"
else
    fail "native source reintroduced product-specific binary strings"
fi

# --- 21. dev build-checkpoint remains retired ---
if python3 - <<'PY'
import json
from pathlib import Path

external = Path("manifests/commands/aos-external-commands.json").read_text(encoding="utf-8")
commands = Path("manifests/commands/aos-commands.json").read_text(encoding="utf-8")
assert "build-checkpoint" not in external
assert "build-checkpoint" not in commands
PY
then
    pass "dev build-checkpoint is not registered"
else
    fail "dev build-checkpoint command was re-registered"
fi

# --- 22. dev afk-session-trigger help exposes guarded trigger flags ---
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

# --- 22. command registry metadata is externally hot-swappable ---
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

# --- 23. help renderer stays external and does not delegate back into Swift ---
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

# --- 24. main entry point has no active Swift help fallback ---
if python3 - <<'PY'
from pathlib import Path

source = Path("src/main.swift").read_text(encoding="utf-8")
assert 'case "__help"' not in source
assert "helpCommand(args:" not in source
assert "commandRegistry = buildCommandRegistry()" not in source
assert "COMMAND_ROUTE_UNAVAILABLE" in source
assert not Path("src/shared/command-help.swift").exists()
assert not Path("src/shared/command-registry.swift").exists()
PY
then
    pass "main entry point has no active Swift help fallback"
else
    fail "main entry point still has active Swift help fallback"
fi

echo
if [ "$FAILS" -eq 0 ]; then
    echo "help-contract: all checks passed"
    exit 0
else
    echo "help-contract: $FAILS failure(s)"
    exit 1
fi
