#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

python3 - "$ROOT" <<'PY'
import json
import os
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
shared = root / ".docks" / "hooks"
if shared.exists():
    raise SystemExit(f"FAIL: shared dock hook directory must stay deleted: {shared}")

for role in ("gdi", "foreman"):
    hooks_path = root / ".docks" / role / ".codex" / "hooks.json"
    payload = json.loads(hooks_path.read_text())
    commands = [
        hook.get("command", "")
        for entries in payload.get("hooks", {}).values()
        for matcher in entries
        for hook in matcher.get("hooks", [])
    ]
    expected_start = f".docks/{role}/hooks/session-start.sh"
    expected_stop = f".docks/{role}/hooks/stop.sh"
    if not any(expected_start in command for command in commands):
        raise SystemExit(f"FAIL: {role} hooks do not use isolated session-start script: {commands}")
    if not any(expected_stop in command for command in commands):
        raise SystemExit(f"FAIL: {role} hooks do not use isolated stop script: {commands}")
    if any(".docks/hooks/" in command or "AOS_DOCK_ROLE=" in command for command in commands):
        raise SystemExit(f"FAIL: {role} hooks still route through shared dock behavior: {commands}")

    expected_gender = {"gdi": "female", "foreman": "male"}[role]
    for script_name in ("session-start.sh", "stop.sh"):
        script_path = root / ".docks" / role / "hooks" / script_name
        if not os.access(script_path, os.X_OK):
            raise SystemExit(f"FAIL: {role} {script_name} is not executable")
        script = script_path.read_text()
        if ".agents/hooks/session-common.sh" not in script:
            raise SystemExit(f"FAIL: {role} {script_name} does not source shared session helper")
        if "aos_resolve_session_id" not in script:
            raise SystemExit(f"FAIL: {role} {script_name} does not use aos_resolve_session_id")
        if "AOS_DOCK_ROLE=" in script or ".docks/hooks/" in script:
            raise SystemExit(f"FAIL: {role} {script_name} still contains dock hook routing")
        if "python3" in script or "resolve_session_id()" in script:
            raise SystemExit(f"FAIL: {role} {script_name} still has duplicated session-id parsing")
        if f"--name {role} --role {role}" not in script:
            raise SystemExit(f"FAIL: {role} {script_name} does not keep role registration local")
        if f"--gender {expected_gender}" not in script:
            raise SystemExit(f"FAIL: {role} {script_name} does not keep voice gender local")
        if "--quality-tier premium" not in script:
            raise SystemExit(f"FAIL: {role} {script_name} does not keep voice tier local")
PY

TMPDIR_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-dock-hook-isolation.XXXXXX")"
trap 'rm -rf "$TMPDIR_ROOT"' EXIT

fake_aos="$TMPDIR_ROOT/aos"
log_file="$TMPDIR_ROOT/aos.log"
fake_bin="$TMPDIR_ROOT/bin"
clipboard_log="$TMPDIR_ROOT/clipboard.log"
mkdir -p "$fake_bin"
cat >"$fake_aos" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'ARGV:%s\n' "$*" >>"$AOS_FAKE_LOG"
if [[ "$*" == *"voice final-response"* ]]; then
  payload="$(cat || true)"
  printf 'STDIN:%s\n' "$payload" >>"$AOS_FAKE_LOG"
fi
exit 0
SH
chmod +x "$fake_aos"
cat >"$fake_bin/pbcopy" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
payload="$(cat || true)"
printf 'CLIPBOARD:%s:%s\n' "${AOS_FAKE_CLIPBOARD_ROLE:-unknown}" "$payload" >>"$AOS_FAKE_CLIPBOARD_LOG"
SH
chmod +x "$fake_bin/pbcopy"

payload='{"session_id":"019d99f3-0001-7000-b000-000000000001","last_assistant_message":"Do not speak this tail.\n\n(on clipboard)"}'
for role in gdi foreman; do
  out="$(printf '%s' "$payload" | AOS_DOCK_AOS_BIN="$fake_aos" AOS_FAKE_LOG="$log_file" bash ".docks/$role/hooks/session-start.sh")"
  python3 - "$out" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
if payload.get("continue") is not True:
    raise SystemExit(f"FAIL: expected SessionStart hook success JSON, got {payload}")
PY

  out="$(printf '%s' "$payload" | PATH="$fake_bin:$PATH" AOS_DOCK_AOS_BIN="$fake_aos" AOS_FAKE_LOG="$log_file" AOS_FAKE_CLIPBOARD_LOG="$clipboard_log" AOS_FAKE_CLIPBOARD_ROLE="$role" bash ".docks/$role/hooks/stop.sh")"
  python3 - "$out" <<'PY'
import json
import sys
payload = json.loads(sys.argv[1])
if payload.get("continue") is not True:
    raise SystemExit(f"FAIL: expected Stop hook success JSON, got {payload}")
PY
done

grep -q 'Handoff on clipboard!' "$log_file"
if grep -q 'Do not speak this tail' "$log_file"; then
  echo "FAIL: stop hooks must not pass the assistant tail to voice final-response" >&2
  exit 1
fi

python3 - "$clipboard_log" <<'PY'
import pathlib
import sys

text = pathlib.Path(sys.argv[1]).read_text()
entries = {}
for line in text.splitlines():
    if not line.startswith("CLIPBOARD:"):
        continue
    _, role, value = line.split(":", 2)
    entries[role] = value
if set(entries) != {"gdi", "foreman"}:
    raise SystemExit(f"FAIL: expected one clipboard handoff per dock role, got {entries!r}")
if entries["gdi"] != "Do not speak this tail.":
    raise SystemExit(f"FAIL: gdi clipboard handoff should copy the final message as-is: {entries['gdi']!r}")
if not entries["foreman"].startswith("/goal Do not speak this tail."):
    raise SystemExit(f"FAIL: foreman clipboard handoff must start with /goal: {entries['foreman']!r}")
for role, value in entries.items():
    if "(on clipboard)" in value:
        raise SystemExit(f"FAIL: {role} clipboard handoff must not include chat-only final reply marker: {value!r}")
PY

echo "PASS: dock hooks are role-local, keep clipboard handoffs clean, and speak only the handoff notice."
