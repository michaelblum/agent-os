#!/bin/bash
set -euo pipefail

source tests/lib/process-cleanup-serial.sh
trap aos_process_cleanup_release_serial_lock EXIT
aos_process_cleanup_acquire_serial_lock "tests/external-command-dispatch.sh"

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

if ./aos ops list --json >/tmp/aos-ops-list.out 2>/tmp/aos-ops-list.err; then
    fail "retired ops command succeeded"
else
    if grep -q '"code" : "UNKNOWN_COMMAND"' /tmp/aos-ops-list.err; then
        pass "retired ops command returns UNKNOWN_COMMAND"
    else
        fail "retired ops command error drifted: $(cat /tmp/aos-ops-list.err)"
    fi
fi
rm -f /tmp/aos-ops-list.out /tmp/aos-ops-list.err

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

if ./aos see zone >/tmp/aos-see-zone-missing.out 2>/tmp/aos-see-zone-missing.err; then
    fail "see zone missing subcommand succeeded"
else
    if grep -q '"code" : "MISSING_SUBCOMMAND"' /tmp/aos-see-zone-missing.err \
        && grep -q 'see zone requires a subcommand' /tmp/aos-see-zone-missing.err; then
        pass "see zone missing subcommand routes through external subcommand router"
    else
        fail "see zone missing subcommand error drifted: $(cat /tmp/aos-see-zone-missing.err)"
    fi
fi
rm -f /tmp/aos-see-zone-missing.out /tmp/aos-see-zone-missing.err

if ./aos see zone external-dispatch-bogus >/tmp/aos-see-zone-bogus.out 2>/tmp/aos-see-zone-bogus.err; then
    fail "see zone unknown subcommand succeeded"
else
    if grep -q '"code" : "UNKNOWN_SUBCOMMAND"' /tmp/aos-see-zone-bogus.err \
        && grep -q 'Unknown see zone subcommand: external-dispatch-bogus' /tmp/aos-see-zone-bogus.err; then
        pass "see zone unknown subcommands route through external subcommand router"
    else
        fail "see zone unknown subcommand error drifted: $(cat /tmp/aos-see-zone-bogus.err)"
    fi
fi
rm -f /tmp/aos-see-zone-bogus.out /tmp/aos-see-zone-bogus.err

ZONE_ROOT="$(mktemp -d)"
if AOS_STATE_ROOT="$ZONE_ROOT" ./aos see zone define header --target main 0,0,100,50 >/tmp/aos-see-zone-define.out 2>/tmp/aos-see-zone-define.err \
    && AOS_STATE_ROOT="$ZONE_ROOT" ./aos see zone list >/tmp/aos-see-zone-list.out 2>/tmp/aos-see-zone-list.err \
    && python3 - <<'PY'
import json

saved = json.load(open('/tmp/aos-see-zone-define.out', encoding='utf-8'))
zones = json.load(open('/tmp/aos-see-zone-list.out', encoding='utf-8'))
assert saved == {'status': 'saved', 'zone': 'header'}, saved
assert zones['header'] == {'crop': '0,0,100,50', 'target': 'main'}, zones
PY
then
    pass "see zone define persists explicit bounds through the external zone command"
else
    fail "see zone define external command drifted: $(cat /tmp/aos-see-zone-define.err /tmp/aos-see-zone-list.err 2>/dev/null)"
fi
rm -rf "$ZONE_ROOT" /tmp/aos-see-zone-define.out /tmp/aos-see-zone-define.err /tmp/aos-see-zone-list.out /tmp/aos-see-zone-list.err

if ./aos see annotation >/tmp/aos-see-annotation-missing.out 2>/tmp/aos-see-annotation-missing.err; then
    fail "see annotation missing subcommand succeeded"
else
    if grep -q '"code" : "MISSING_SUBCOMMAND"' /tmp/aos-see-annotation-missing.err \
        && grep -q 'see annotation requires a subcommand' /tmp/aos-see-annotation-missing.err; then
        pass "see annotation missing subcommand routes through external subcommand router"
    else
        fail "see annotation missing subcommand error drifted: $(cat /tmp/aos-see-annotation-missing.err)"
    fi
fi
rm -f /tmp/aos-see-annotation-missing.out /tmp/aos-see-annotation-missing.err

if ./aos see annotation external-dispatch-bogus >/tmp/aos-see-annotation-bogus.out 2>/tmp/aos-see-annotation-bogus.err; then
    fail "see annotation unknown subcommand succeeded"
else
    if grep -q '"code" : "UNKNOWN_SUBCOMMAND"' /tmp/aos-see-annotation-bogus.err \
        && grep -q 'Unknown see annotation subcommand: external-dispatch-bogus' /tmp/aos-see-annotation-bogus.err; then
        pass "see annotation unknown subcommands route through external subcommand router"
    else
        fail "see annotation unknown subcommand error drifted: $(cat /tmp/aos-see-annotation-bogus.err)"
    fi
fi
rm -f /tmp/aos-see-annotation-bogus.out /tmp/aos-see-annotation-bogus.err

ANNOTATION_ROOT="$(mktemp -d)"
cat >/tmp/aos-see-annotation-capture.json <<'JSON'
{
  "schema_version": "aos.agent-workspace.v0",
  "status": "success",
  "workspace_id": "ws-dispatch",
  "snapshot_id": "snap-dispatch",
  "capture_target": "browser:dispatch",
  "capture_mode": "som",
  "artifact_refs": [
    {
      "role": "capture_summary",
      "path": "/tmp/aos-see-annotation-capture-summary.json"
    }
  ],
  "refs": [
    {
      "ref": "r1",
      "workspace_id": "ws-dispatch",
      "snapshot_id": "snap-dispatch",
      "backend": "browser",
      "resolution_class": "snapshot_scoped",
      "confidence": "high",
      "target_summary": "Dispatch saved ref",
      "action_target": "ref:snap-dispatch:r1",
      "artifact_refs": []
    }
  ]
}
JSON
if AOS_STATE_ROOT="$ANNOTATION_ROOT" ./aos see annotation create --id ann-dispatch --target-kind region --target-summary dispatch --comment ok --json >/tmp/aos-see-annotation-create.out 2>/tmp/aos-see-annotation-create.err \
    && AOS_STATE_ROOT="$ANNOTATION_ROOT" ./aos see annotation create --id ann-dispatch-capture --from-capture-json /tmp/aos-see-annotation-capture.json --ref r1 --json >/tmp/aos-see-annotation-capture-create.out 2>/tmp/aos-see-annotation-capture-create.err \
    && AOS_STATE_ROOT="$ANNOTATION_ROOT" ./aos see annotation list --state pending --json >/tmp/aos-see-annotation-list.out 2>/tmp/aos-see-annotation-list.err \
    && AOS_STATE_ROOT="$ANNOTATION_ROOT" ./aos see annotation consume ann-dispatch --json >/tmp/aos-see-annotation-consume.out 2>/tmp/aos-see-annotation-consume.err \
    && AOS_STATE_ROOT="$ANNOTATION_ROOT" ./aos see annotation link-work-record ann-dispatch --work-record work-record:dispatch-proof --artifact after=/tmp/aos-see-annotation-after.json --json >/tmp/aos-see-annotation-link.out 2>/tmp/aos-see-annotation-link.err \
    && ! AOS_STATE_ROOT="$ANNOTATION_ROOT" ./aos see annotation consume ann-dispatch --json >/tmp/aos-see-annotation-reconsume.out 2>/tmp/aos-see-annotation-reconsume.err \
    && python3 - <<'PY'
import json

created = json.load(open('/tmp/aos-see-annotation-create.out', encoding='utf-8'))
capture_created = json.load(open('/tmp/aos-see-annotation-capture-create.out', encoding='utf-8'))
listed = json.load(open('/tmp/aos-see-annotation-list.out', encoding='utf-8'))
consumed = json.load(open('/tmp/aos-see-annotation-consume.out', encoding='utf-8'))
linked = json.load(open('/tmp/aos-see-annotation-link.out', encoding='utf-8'))
reconsume = json.load(open('/tmp/aos-see-annotation-reconsume.err', encoding='utf-8'))
assert created['status'] == 'created', created
assert created['annotation']['id'] == 'ann-dispatch', created
assert capture_created['annotation']['saved_ref']['workspace_id'] == 'ws-dispatch', capture_created
assert capture_created['annotation']['capability_status'] == 'saved_ref', capture_created
assert listed['count'] == 2 and {item['id'] for item in listed['annotations']} == {'ann-dispatch', 'ann-dispatch-capture'}, listed
assert consumed['status'] == 'consumed', consumed
assert consumed['annotation']['state'] == 'consumed', consumed
assert linked['status'] == 'linked', linked
assert linked['annotation']['work_record_link_count'] == 1, linked
assert linked['work_record_link']['ref'] == 'work-record:dispatch-proof', linked
assert reconsume['code'] == 'PENDING_ANNOTATION_NOT_CONSUMABLE', reconsume
assert reconsume['state'] == 'consumed', reconsume
PY
then
    pass "see annotation lifecycle runs through external command manifest"
else
    fail "see annotation external command drifted: $(cat /tmp/aos-see-annotation-create.err /tmp/aos-see-annotation-capture-create.err /tmp/aos-see-annotation-list.err /tmp/aos-see-annotation-consume.err /tmp/aos-see-annotation-link.err /tmp/aos-see-annotation-reconsume.err 2>/dev/null)"
fi
rm -rf "$ANNOTATION_ROOT" \
    /tmp/aos-see-annotation-capture.json \
    /tmp/aos-see-annotation-create.out /tmp/aos-see-annotation-create.err \
    /tmp/aos-see-annotation-capture-create.out /tmp/aos-see-annotation-capture-create.err \
    /tmp/aos-see-annotation-list.out /tmp/aos-see-annotation-list.err \
    /tmp/aos-see-annotation-consume.out /tmp/aos-see-annotation-consume.err \
    /tmp/aos-see-annotation-link.out /tmp/aos-see-annotation-link.err \
    /tmp/aos-see-annotation-reconsume.out /tmp/aos-see-annotation-reconsume.err

SKILLS_ROOT="$(mktemp -d)"
PLAYWRIGHT_COMPANION_ROOT="$(mktemp -d)"
mkdir -p "$PLAYWRIGHT_COMPANION_ROOT/bin"
cat >"$PLAYWRIGHT_COMPANION_ROOT/bin/playwright-cli" <<'SH'
#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "0.1.15"
  exit 0
fi
echo "unexpected playwright-cli invocation: $*" >&2
exit 7
SH
chmod +x "$PLAYWRIGHT_COMPANION_ROOT/bin/playwright-cli"
if ./aos skills list --json >/tmp/aos-skills-list.out 2>/tmp/aos-skills-list.err \
    && ./aos skills check --target path --path "$SKILLS_ROOT" --json >/tmp/aos-skills-check.out 2>/tmp/aos-skills-check.err \
    && ./aos skills install --target path --path "$SKILLS_ROOT" --dry-run --json >/tmp/aos-skills-install.out 2>/tmp/aos-skills-install.err \
    && AOS_PLAYWRIGHT_CLI_DISABLE_REPO=1 AOS_PLAYWRIGHT_CLI="$PLAYWRIGHT_COMPANION_ROOT/bin/playwright-cli" ./aos skills companion install --name playwright-cli --target path --path "$SKILLS_ROOT" --dry-run --json >/tmp/aos-skills-companion-install.out 2>/tmp/aos-skills-companion-install.err \
    && SKILLS_ROOT="$SKILLS_ROOT" python3 - <<'PY'
import json
import os

listed = json.load(open('/tmp/aos-skills-list.out', encoding='utf-8'))
checked = json.load(open('/tmp/aos-skills-check.out', encoding='utf-8'))
planned = json.load(open('/tmp/aos-skills-install.out', encoding='utf-8'))
companion = json.load(open('/tmp/aos-skills-companion-install.out', encoding='utf-8'))
assert listed['schema_version'] == 'aos.skills.list.v0', listed
assert any(skill['name'] == 'aos-core-orientation' and skill['installable'] for skill in listed['skills']), listed
assert checked['schema_version'] == 'aos.skills.check.v0', checked
assert checked['summary']['missing'] >= 1, checked
assert planned['schema_version'] == 'aos.skills.install.plan.v0', planned
assert planned['status'] == 'dry_run', planned
assert any(item['skill'] == 'aos-core-orientation' and item['kind'] == 'manifest' for item in planned['planned_writes']), planned
assert companion['schema_version'] == 'aos.skills.companion.install.plan.v0', companion
assert companion['status'] == 'dry_run', companion
assert companion['planned_invocation']['argv'] == ['install', '--skills'], companion
assert not os.path.exists(os.path.join(os.environ['SKILLS_ROOT'], 'aos-core-orientation'))
PY
then
    pass "skills list/check/install and companion dry-run route through external command manifest"
else
    fail "skills external command drifted: $(cat /tmp/aos-skills-list.err /tmp/aos-skills-check.err /tmp/aos-skills-install.err /tmp/aos-skills-companion-install.err 2>/dev/null)"
fi
rm -rf "$SKILLS_ROOT" "$PLAYWRIGHT_COMPANION_ROOT" \
    /tmp/aos-skills-list.out /tmp/aos-skills-list.err \
    /tmp/aos-skills-check.out /tmp/aos-skills-check.err \
    /tmp/aos-skills-install.out /tmp/aos-skills-install.err \
    /tmp/aos-skills-companion-install.out /tmp/aos-skills-companion-install.err

if python3 - <<'PY'
import json
import re
from pathlib import Path

manifest = json.load(open("manifests/commands/aos-external-commands.json", encoding="utf-8"))
commands = {tuple(item["path"]): item for item in manifest["commands"]}
registry = json.load(open("manifests/commands/aos-commands.json", encoding="utf-8"))
registry_paths = {tuple(item["path"]) for item in registry["commands"]}
external_paths = {tuple(item["path"]) for item in manifest["commands"]}
assert registry_paths <= external_paths, sorted(registry_paths - external_paths)
bootstrap_families = {"serve", "ready", "permissions"}
def concrete_usage_path(usage):
    if usage.startswith("aos "):
        aos_usage = usage
    else:
        aos_usage = next((part for part in re.split(r"\s+\|\s+", usage) if part.startswith("aos ")), None)
    if not aos_usage:
        return []
    concrete = []
    for token in aos_usage.split()[1:]:
        if token.startswith("[") or token.startswith("(") or token.startswith("<") or token.startswith("--"):
            break
        concrete.append(token)
    return concrete

for command in registry["commands"]:
    for form in command["forms"]:
        concrete = concrete_usage_path(form["usage"])
        if concrete and concrete[0] in {"help"}:
            continue
        if concrete and concrete[0] in bootstrap_families:
            continue
        assert tuple(concrete) in external_paths, (form["id"], concrete)
command = commands[("help",)]
assert command["executable"] == "/usr/bin/env", command
assert command["argv_prefix"] == ["node", "scripts/aos-help-proxy.mjs"], command
assert command["env"]["AOS_PATH"] == "$AOS_PATH", command
for family in ["do", "see"]:
    matches = [item for item in manifest["commands"] if tuple(item["path"]) == (family,) and item["argv_prefix"] == ["node", "scripts/aos-help-proxy.mjs", family]]
    assert len(matches) == 1, (family, matches)
    assert matches[0]["executable"] == "/usr/bin/env", matches[0]
    assert matches[0]["env"]["AOS_PATH"] == "$AOS_PATH", matches[0]
    assert matches[0]["when"]["child_arg_missing"] is True, matches[0]
see_fallback = [item for item in manifest["commands"] if tuple(item["path"]) == ("see",) and item["argv_prefix"] == ["node", "scripts/aos-see-native.mjs", "capture"]]
assert len(see_fallback) == 1, see_fallback
assert see_fallback[0]["executable"] == "/usr/bin/env", see_fallback[0]
assert see_fallback[0]["env"]["AOS_PATH"] == "$AOS_PATH", see_fallback[0]
assert "capture" in see_fallback[0]["when"]["excluded_values"], see_fallback[0]
for path in [("see", "capture"), ("see", "cursor"), ("see", "list"), ("see", "selection")]:
    command = commands[path]
    assert command["executable"] == "/usr/bin/env", command
    assert command["argv_prefix"] == ["node", "scripts/aos-see-native.mjs", path[-1]], command
    assert command["env"]["AOS_PATH"] == "$AOS_PATH", command
command = commands[("say",)]
assert command["executable"] == "/usr/bin/env", command
assert command["argv_prefix"] == ["node", "scripts/aos-say.mjs"], command
assert command["stdio"] == "inherit", command
assert command["env"]["AOS_PATH"] == "$AOS_PATH", command
command = commands[("show", "render")]
assert command["executable"] == "/usr/bin/env", command
assert command["argv_prefix"] == ["node", "scripts/aos-show-render.mjs"], command
assert command["stdio"] == "inherit", command
assert command["env"]["AOS_PATH"] == "$AOS_PATH", command
show_client = Path("scripts/aos-show-client.mjs").read_text(encoding="utf-8")
update_case = re.search(r"case 'update':(?P<body>.*?)break;", show_client, re.S)
assert update_case, "show update switch case missing"
assert update_case.group("body").count("mutationCommand(args, 'update')") == 1, update_case.group("body")
for path, primitive in [
    (("serve",), "__serve"),
]:
    command = commands[path]
    assert command["executable"] == "$AOS_PATH", command
    assert command["argv_prefix"] == [primitive], command
command = commands[("doctor",)]
assert command["executable"] == "/usr/bin/env", command
assert command["argv_prefix"] == ["node", "scripts/aos-doctor.mjs"], command
assert command["env"]["AOS_PATH"] == "$AOS_PATH", command
command = commands[("ready",)]
assert command["executable"] == "/usr/bin/env", command
assert command["argv_prefix"] == ["node", "scripts/aos-ready.mjs"], command
assert command["env"]["AOS_PATH"] == "$AOS_PATH", command
command = commands[("status",)]
assert command["executable"] == "/usr/bin/env", command
assert command["argv_prefix"] == ["node", "scripts/aos-status.mjs"], command
assert command["env"]["AOS_PATH"] == "$AOS_PATH", command
for subcommand in ["check", "preflight", "setup", "reset-runtime"]:
    command = commands[("permissions", subcommand)]
    assert command["executable"] == "/usr/bin/env", command
    assert command["argv_prefix"] == ["node", "scripts/aos-permissions.mjs", subcommand], command
    assert command["env"]["AOS_PATH"] == "$AOS_PATH", command
    assert command["env"]["AOS_INVOCATION_DISPLAY_NAME"] == "$AOS_INVOCATION_DISPLAY_NAME", command
    assert command["env"]["AOS_RUNTIME_MODE"] == "$AOS_RUNTIME_MODE", command
    assert command["env"]["AOS_STATE_ROOT"] == "$AOS_STATE_ROOT", command
command = commands[("permissions",)]
assert command["executable"] == "/usr/bin/env", command
assert command["argv_prefix"] == ["node", "scripts/aos-permissions.mjs"], command
assert command["env"]["AOS_PATH"] == "$AOS_PATH", command
assert command["env"]["AOS_INVOCATION_DISPLAY_NAME"] == "$AOS_INVOCATION_DISPLAY_NAME", command
assert command["env"]["AOS_RUNTIME_MODE"] == "$AOS_RUNTIME_MODE", command
assert command["env"]["AOS_STATE_ROOT"] == "$AOS_STATE_ROOT", command
for primitive in ["click", "hover", "drag", "scroll", "type", "key", "press", "set-value", "focus", "raise", "move", "resize", "close", "minimize", "maximize", "restore", "activate", "quit", "hide", "unhide", "menu", "tell", "session"]:
    native = [item for item in manifest["commands"] if tuple(item["path"]) == ("do", primitive) and item["argv_prefix"] == ["node", "scripts/aos-do-native.mjs", primitive]]
    assert len(native) == 1, (primitive, native)
    assert native[0]["executable"] == "/usr/bin/env", native[0]
    assert native[0]["env"]["AOS_PATH"] == "$AOS_PATH", native[0]
    if primitive in ["click", "hover", "drag", "scroll", "type", "key"]:
        expected_excluded = ["browser:", "ref:", "canvas:"] if primitive in ["click", "drag"] else ["browser:", "ref:"]
        assert native[0]["when"]["excluded_prefixes"] == expected_excluded, native[0]
        browser = [item for item in manifest["commands"] if tuple(item["path"]) == ("do", primitive) and item["argv_prefix"] == ["node", "scripts/aos-do-browser.mjs", primitive]]
        assert len(browser) == 1, (primitive, browser)
        assert browser[0]["argv_prefix"] == ["node", "scripts/aos-do-browser.mjs", primitive], browser[0]
        assert browser[0]["when"]["prefix"] == "browser:", browser[0]
        if primitive in ["click", "drag"]:
            canvas = [item for item in manifest["commands"] if tuple(item["path"]) == ("do", primitive) and item["argv_prefix"] == ["node", "scripts/aos-do-canvas.mjs", primitive]]
            assert len(canvas) == 1, canvas
            assert canvas[0]["when"]["prefix"] == "canvas:", canvas[0]
    if primitive == "set-value":
        assert native[0]["when"]["excluded_prefixes"] == ["ref:", "canvas:"], native[0]
        canvas = [item for item in manifest["commands"] if tuple(item["path"]) == ("do", "set-value") and item["argv_prefix"] == ["node", "scripts/aos-do-canvas.mjs", "set-value"]]
        assert len(canvas) == 1, canvas
        assert canvas[0]["when"]["prefix"] == "canvas:", canvas[0]
    if primitive in ["press", "focus"]:
        assert native[0]["when"]["excluded_prefixes"] == ["ref:"], native[0]
for action in ["click", "hover", "drag", "scroll", "type", "key", "fill", "press", "set-value", "focus"]:
    ref = [item for item in manifest["commands"] if tuple(item["path"]) == ("do", action) and item["argv_prefix"] == ["node", "scripts/aos-do-ref.mjs", action]]
    assert len(ref) == 1, (action, ref)
    assert ref[0]["executable"] == "/usr/bin/env", ref[0]
    assert ref[0]["when"]["prefix"] == "ref:", ref[0]
    assert ref[0]["env"]["AOS_PATH"] == "$AOS_PATH", ref[0]
fill = [item for item in manifest["commands"] if tuple(item["path"]) == ("do", "fill") and item["argv_prefix"] == ["node", "scripts/aos-do-browser.mjs", "fill"]]
assert len(fill) == 1, fill
assert fill[0]["when"]["excluded_prefixes"] == ["ref:"], fill[0]
PY
then
    pass "live-sensitive native primitives are routed through the external command manifest"
else
    fail "native primitive external manifest routing drifted"
fi

if OUT="$(./aos permissions reset-runtime --mode repo --dry-run --json 2>/dev/null)" python3 - <<'PY'
import json
import os

d = json.loads(os.environ["OUT"])
assert d["status"] == "ok", d
assert d["mode"] == "repo", d
assert d["dry_run"] is True, d
assert d["service_stop"]["status"] == "planned", d
assert d["tcc_reset"]["status"] == "unavailable", d
PY
then
    pass "permissions reset-runtime routes through external dry-run composition"
else
    fail "permissions reset-runtime external dry-run route drifted: ${OUT:-}"
fi

SETUP_ROOT="$(mktemp -d)"
if AOS_STATE_ROOT="$SETUP_ROOT" AOS_TEST_ASSUME_PERMISSIONS_GRANTED=1 ./aos __permissions setup-marker write --json >/dev/null 2>&1 \
    && OUT="$(AOS_STATE_ROOT="$SETUP_ROOT" AOS_TEST_ASSUME_PERMISSIONS_GRANTED=1 AOS_DISABLE_DAEMON_AUTOSTART=1 ./aos permissions setup --once --json 2>/dev/null)" python3 - <<'PY'
import json
import os

d = json.loads(os.environ["OUT"])
assert d["status"] == "ok", d
assert d["completed"] is True, d
assert d["setup"]["setup_completed"] is True, d
assert d["missing_permissions"] == [], d
assert d["restarted_services"] == [], d
PY
then
    pass "permissions setup routes through external once skip composition"
else
    fail "permissions setup external once skip route drifted: ${OUT:-}"
fi
rm -rf "$SETUP_ROOT"

LISTEN_ROOT="$(mktemp -d)"
if AOS_STATE_ROOT="$LISTEN_ROOT" AOS_RUNTIME_MODE=repo AOS_PATH="$PWD/aos" AOS_ALLOW_DAEMON_AUTOSTART=1 ./aos show listen >/tmp/aos-show-listen-cleanup.out 2>/tmp/aos-show-listen-cleanup.err < /dev/null; then
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

SIGNAL_LISTEN_ROOT="$(mktemp -d)"
if ROOT="$SIGNAL_LISTEN_ROOT" AOS_BIN="$PWD/aos" node - <<'NODE'
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');

const root = process.env.ROOT;
const sock = `${root}/repo/sock`;
const out = '/tmp/aos-show-listen-signal.out';
const err = '/tmp/aos-show-listen-signal.err';
fs.writeFileSync(out, '');
fs.writeFileSync(err, '');

function probe(expectConnect) {
  return new Promise((resolve) => {
    const socket = net.createConnection(sock);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(!expectConnect);
    }, 250);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve(expectConnect);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(!expectConnect);
    });
  });
}

async function main() {
  const child = spawn(process.env.AOS_BIN, ['show', 'listen'], {
    env: {
      ...process.env,
      AOS_STATE_ROOT: root,
      AOS_RUNTIME_MODE: 'repo',
      AOS_PATH: process.env.AOS_BIN,
      AOS_ALLOW_DAEMON_AUTOSTART: '1',
    },
    stdio: ['pipe', fs.openSync(out, 'a'), fs.openSync(err, 'a')],
  });

  let connected = false;
  for (let i = 0; i < 20; i += 1) {
    if (await probe(true)) {
      connected = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (!connected) {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    process.exit(2);
  }

  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  await new Promise((resolve) => setTimeout(resolve, 1000));
  process.exit((await probe(false)) ? 0 : 3);
}

main();
NODE
then
    pass "show listen cleans up isolated auto-start daemon on SIGTERM"
else
    rc=$?
    if [ "$rc" -eq 2 ]; then
        fail "show listen did not start isolated daemon for signal cleanup smoke: $(cat /tmp/aos-show-listen-signal.err)"
    else
        fail "show listen left isolated daemon reachable after SIGTERM"
    fi
fi
rm -rf "$SIGNAL_LISTEN_ROOT" /tmp/aos-show-listen-signal.out /tmp/aos-show-listen-signal.err

WATCHDOG_LISTEN_ROOT="$(mktemp -d)"
WATCHDOG_PID_FILE="$WATCHDOG_LISTEN_ROOT/listen.pid"
ROOT="$WATCHDOG_LISTEN_ROOT" AOS_BIN="$PWD/aos" PID_FILE="$WATCHDOG_PID_FILE" node - <<'NODE'
const { spawn } = require('node:child_process');
const fs = require('node:fs');

const child = spawn(process.env.AOS_BIN, ['show', 'listen'], {
  detached: true,
  env: {
    ...process.env,
    AOS_STATE_ROOT: process.env.ROOT,
    AOS_RUNTIME_MODE: 'repo',
    AOS_PATH: process.env.AOS_BIN,
    AOS_ALLOW_DAEMON_AUTOSTART: '1',
  },
  stdio: 'ignore',
});
child.unref();
fs.writeFileSync(process.env.PID_FILE, String(child.pid));
NODE
WATCHDOG_PID="$(cat "$WATCHDOG_PID_FILE")"
for _ in $(seq 1 60); do
    if ! ps -p "$WATCHDOG_PID" >/dev/null 2>&1; then
        break
    fi
    sleep 0.1
done
if WATCHDOG_PID="$WATCHDOG_PID" SOCK="$WATCHDOG_LISTEN_ROOT/repo/sock" node - <<'NODE'
const net = require('node:net');

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function probeSocket(sock) {
  return new Promise((resolve) => {
    const socket = net.createConnection(sock);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 250);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

(async () => {
  const alive = pidAlive(Number(process.env.WATCHDOG_PID));
  const reachable = await probeSocket(process.env.SOCK);
  process.exit(!alive && !reachable ? 0 : 1);
})();
NODE
then
    pass "show listen parent-exit watchdog cleans up isolated auto-start daemon"
else
    fail "show listen parent-exit watchdog left stale listener or daemon"
fi
kill "$WATCHDOG_PID" >/dev/null 2>&1 || true
rm -rf "$WATCHDOG_LISTEN_ROOT"

ORPHAN_ROOT="$(mktemp -d)"
ORPHAN_PID_FILE="$ORPHAN_ROOT/pid"
node - "$ORPHAN_PID_FILE" <<'NODE'
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const pidFile = process.argv[2];
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 10000)', 'scripts/aos-show-client.mjs', 'listen'], {
  detached: true,
  stdio: 'ignore',
});
child.unref();
fs.writeFileSync(pidFile, String(child.pid));
NODE
ORPHAN_PID="$(cat "$ORPHAN_PID_FILE")"
for _ in 1 2 3 4 5; do
    if ps -p "$ORPHAN_PID" -o ppid= | grep -q '^[[:space:]]*1$'; then
        break
    fi
    sleep 0.2
done
if CLEAN_DRY="$(./aos clean --dry-run --json)" CLEANED="$(./aos clean --json)" ORPHAN_PID="$ORPHAN_PID" python3 - <<'PY'
import json
import os

pid = int(os.environ["ORPHAN_PID"])
dry = json.loads(os.environ["CLEAN_DRY"])
cleaned = json.loads(os.environ["CLEANED"])
assert any(item["pid"] == pid for item in dry["orphaned_clients"]), dry
assert any(f"pid={pid}" in action for action in cleaned["actions_taken"]), cleaned
PY
then
    pass "clean reports and terminates orphaned show listen clients"
else
    fail "clean did not terminate orphaned show listen client"
fi
kill "$ORPHAN_PID" >/dev/null 2>&1 || true
rm -rf "$ORPHAN_ROOT"

if ./aos dev external-dispatch-bogus >/tmp/aos-dev-bogus.out 2>/tmp/aos-dev-bogus.err; then
    fail "retired dev command family dispatched"
else
    if grep -q '"code" : "UNKNOWN_COMMAND"' /tmp/aos-dev-bogus.err; then
        pass "retired dev command family is not dispatchable"
    else
        fail "retired dev command family error drifted: $(cat /tmp/aos-dev-bogus.err)"
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
touch "$RESET_ROOT/installed/probe" "$RESET_ROOT/legacy-junk/probe" "$RESET_ROOT/experience-state.json"
AOS_STATE_ROOT="$RESET_ROOT" AOS_RUNTIME_MODE=installed ./aos reset --mode installed --json >"$RESET_OUT" 2>/dev/null
if RESET_ROOT="$RESET_ROOT" RESET_OUT="$RESET_OUT" python3 - <<'PY'
import json
import os

root = os.environ["RESET_ROOT"]
with open(os.environ["RESET_OUT"], encoding="utf-8") as fh:
    data = json.load(fh)
assert data["reset_mode"] == "installed", data
assert f"{root}/installed" in data["removed_paths"], data
assert f"{root}/legacy-junk" not in data["removed_paths"], data
assert f"{root}/experience-state.json" not in data["removed_paths"], data
assert not os.path.exists(f"{root}/installed"), data
assert os.path.exists(f"{root}/legacy-junk"), data
assert os.path.exists(f"{root}/experience-state.json"), data
assert os.path.exists("./aos"), "repo binary should not be removed by installed-mode reset"
PY
then
    pass "reset installed mode preserves repo fallback state"
else
    fail "reset external dispatch drifted: $(cat "$RESET_OUT" 2>/dev/null || true)"
fi
rm -rf "$RESET_ROOT" "$RESET_OUT"

COMM_ROOT="$(mktemp -d)"
COMM_REGISTER="$(mktemp)"
COMM_WHO="$(mktemp)"
COMM_SEND="$(mktemp)"
COMM_READ="$(mktemp)"
cleanup_isolated_daemon() {
    local root="$1"
    local lock="$root/repo/daemon.lock"
    if [[ ! -f "$lock" ]]; then
        return
    fi
    local pid
    pid="$(sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$lock" | head -1)"
    if [[ -n "$pid" ]]; then
        kill "$pid" 2>/dev/null || true
    fi
}
trap 'cleanup_isolated_daemon "$COMM_ROOT"; rm -rf "$COMM_ROOT" "$COMM_REGISTER" "$COMM_WHO" "$COMM_SEND" "$COMM_READ"; aos_process_cleanup_release_serial_lock' EXIT
AOS_STATE_ROOT="$COMM_ROOT" AOS_RUNTIME_MODE=repo AOS_PATH="$PWD/aos" AOS_ALLOW_DAEMON_AUTOSTART=1 ./aos tell --register --session-id external-dispatch-session --name external-dispatch --role worker --harness test >"$COMM_REGISTER" 2>/dev/null
AOS_STATE_ROOT="$COMM_ROOT" AOS_RUNTIME_MODE=repo AOS_PATH="$PWD/aos" AOS_ALLOW_DAEMON_AUTOSTART=1 ./aos tell --who >"$COMM_WHO" 2>/dev/null
AOS_STATE_ROOT="$COMM_ROOT" AOS_RUNTIME_MODE=repo AOS_PATH="$PWD/aos" AOS_ALLOW_DAEMON_AUTOSTART=1 ./aos tell external-dispatch "hello from external dispatch" >"$COMM_SEND" 2>/dev/null
AOS_STATE_ROOT="$COMM_ROOT" AOS_RUNTIME_MODE=repo AOS_PATH="$PWD/aos" AOS_ALLOW_DAEMON_AUTOSTART=1 ./aos listen external-dispatch --limit 5 >"$COMM_READ" 2>/dev/null
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
cleanup_isolated_daemon "$COMM_ROOT"
rm -rf "$COMM_ROOT" "$COMM_REGISTER" "$COMM_WHO" "$COMM_SEND" "$COMM_READ"
aos_process_cleanup_release_serial_lock
trap - EXIT

echo
if [ "$FAILS" -eq 0 ]; then
    echo "external-command-dispatch: all checks passed"
else
    echo "external-command-dispatch: $FAILS failure(s)"
    exit 1
fi
