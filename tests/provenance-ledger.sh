#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STATE_ROOT="$(mktemp -d -t aos-provenance-ledger.XXXXXX)"
trap 'rm -rf "$STATE_ROOT"' EXIT
export AOS_STATE_ROOT="$STATE_ROOT"
export AOS_RUNTIME_MODE=repo
export AOS_PROVENANCE_NOW="2026-05-29T12:00:00.000Z"

FAILS=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; FAILS=$((FAILS + 1)); }

record_payload() {
  local payload="$1"
  printf '%s' "$payload" | .docks/harness/post-tool-use-runner.sh post-tool-use gdi >/dev/null
}

if record_payload '{"session_id":"s1","provider":"codex","tool_name":"functions.exec_command","cmd":"bash tests/dev-workflow-router.sh","exit_code":0,"duration_ms":21,"stdout":"ok"}'; then
  pass "valid post-tool-use payload records without hook failure"
else
  fail "valid post-tool-use payload failed hook"
fi

if printf '{not json' | .docks/harness/post-tool-use-runner.sh post-tool-use gdi >/dev/null; then
  pass "malformed post-tool-use payload does not fail the hook"
else
  fail "malformed post-tool-use payload failed the hook"
fi

if record_payload '{"session_id":"s1","cmd":"curl http://localhost:64511/daemon?token=secret-value","exit_code":0}'; then
  pass "unknown sensitive command records as redacted metadata"
else
  fail "unknown sensitive command hook write failed"
fi

if record_payload '{"session_id":"s1","cmd":"bash tests/dev-workflow-router.sh --token super-secret","exit_code":0}'; then
  pass "allowlisted-looking command with a secret argument records as redacted metadata"
else
  fail "allowlisted-looking command with a secret argument hook write failed"
fi

if AOS_PROVENANCE_EVENT_BYTES=32 record_payload '{"cmd":"./aos dev recommend --json --files scripts/aos-dev-workflow.mjs","stdout":"this output is deliberately large enough to exceed the tiny cap"}'; then
  pass "over-limit payload records a bounded diagnostic"
else
  fail "over-limit payload failed the hook"
fi

if OUT="$(./aos dev provenance summary --dock gdi --state-root "$STATE_ROOT" --runtime-mode repo --json 2>/dev/null)" python3 - <<'PY'
import json, os
data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert data["retention"]["raw_retention_days"] == 14, data
assert data["retention"]["raw_cap_bytes"] == 33554432, data
commands = data["commands"]
assert any(item.get("summary") == "bash tests/dev-workflow-router.sh" for item in commands), data
redacted = [item for item in commands if item.get("redacted")]
assert redacted, data
assert "secret-value" not in json.dumps(data), data
assert data["diagnostics"].get("malformed_hook_payload") == 1, data
assert data["diagnostics"].get("payload_over_limit") == 1, data
assert data["bypass_signals"].get("direct-daemon-curl") == 1, data
assert data["token_telemetry"]["status"] == "unknown", data
PY
then
  pass "summary reports sanitized commands, diagnostics, retention, and unknown live token telemetry"
else
  fail "summary output did not match expected provenance accounting"
fi

if OUT="$(./aos dev provenance audit --dock gdi --state-root "$STATE_ROOT" --runtime-mode repo --files scripts/aos-dev-workflow.mjs --json 2>/dev/null)"; then
  fail "audit with missing recommendations and bypass signals should exit non-zero"
elif OUT="$OUT" python3 - <<'PY'
import json, os
data = json.loads(os.environ["OUT"])
assert data["status"] == "failed", data
assert data["compliance_status"] == "non_compliant", data
assert "missing_recommended_commands" in data["compliance_failures"], data
assert "lower_level_bypass_signals" in data["compliance_failures"], data
assert "scripts/aos-dev-workflow.mjs" in data["changed_files"], data
assert "bash tests/dev-workflow-router.sh" in data["observed_matching_commands"], data
assert data["missing_recommended_commands"], data
assert data["bypass_signals"].get("direct-daemon-curl") == 1, data
PY
then
  pass "audit fails deterministically for missing recommendations and bypass signals"
else
  fail "audit failure output did not include expected compliance evidence"
fi

if OUT="$(./aos dev provenance record --dock gdi --state-root "$STATE_ROOT" --runtime-mode repo --json --not-real value 2>&1 >/dev/null)"; then
  fail "record should reject unknown flags"
elif echo "$OUT" | grep -q '"code": "UNKNOWN_FLAG"'; then
  pass "record rejects unknown flags"
else
  fail "record unknown flag error mismatch: $OUT"
fi

if OUT="$(./aos dev provenance summary unexpected --dock gdi --state-root "$STATE_ROOT" --runtime-mode repo --json 2>&1 >/dev/null)"; then
  fail "summary should reject unexpected positional arguments"
elif echo "$OUT" | grep -q '"code": "UNKNOWN_ARG"'; then
  pass "summary rejects unexpected positional arguments"
else
  fail "summary positional argument error mismatch: $OUT"
fi

TELEMETRY="$STATE_ROOT/codex-rollout.jsonl"
cat >"$TELEMETRY" <<'JSONL'
{"type":"session_meta","payload":{"id":"codex-session-1","cwd":"/repo"}}
{"timestamp":"2026-05-29T12:00:01.000Z","payload":{"model":"gpt-5","type":"token_count","info":{"model_context_window":200000,"total_token_usage":{"total_tokens":1000}}}}
{"timestamp":"2026-05-29T12:00:02.000Z","payload":{"model":"gpt-5","type":"token_count","info":{"model_context_window":200000,"total_token_usage":{"total_tokens":1250}}}}
JSONL

if OUT="$(./aos dev provenance summary --dock gdi --state-root "$STATE_ROOT" --runtime-mode repo --telemetry-file "$TELEMETRY" --telemetry-provider codex --json 2>/dev/null)" python3 - <<'PY'
import json, os
data = json.loads(os.environ["OUT"])
telemetry = data["token_telemetry"]
assert telemetry["status"] == "available", telemetry
assert telemetry["provider"] == "codex", telemetry
assert telemetry["source_adapter"] == "packages/host/src/session-telemetry.ts", telemetry
assert telemetry["latest"]["used_tokens"]["value"] == 1250, telemetry
assert telemetry["latest"]["used_tokens"]["precision"] == "exact", telemetry
assert telemetry["delta"]["used_tokens"]["value"] == 250, telemetry
PY
then
  pass "summary reports exact token telemetry from an explicit Codex fixture"
else
  fail "summary did not report expected exact token telemetry"
fi

OLD_EVENTS="$STATE_ROOT/repo/provenance/repos"
mkdir -p "$OLD_EVENTS"
python3 - "$STATE_ROOT" <<'PY'
import pathlib, sys
root = pathlib.Path(sys.argv[1])
events = list((root / "repo" / "provenance" / "repos").glob("*/docks/gdi/events"))
if not events:
    raise SystemExit(1)
old_event = events[0] / "2026-05-01.jsonl"
old_event.write_text('{"type":"aos.dock.provenance.event","schema_version":"2026-05-dock-provenance-v0","observed_at":"2026-05-01T00:00:00.000Z","repo_key":"old","dock":"gdi","phase":"post-tool-use","event":"tool"}\n')
PY

BEFORE_DRY_RUN="$(find "$STATE_ROOT" -type f -print | sort | xargs stat -f '%N %z %m')"
if OUT="$(./aos dev provenance prune --dry-run --state-root "$STATE_ROOT" --runtime-mode repo --json 2>/dev/null)" python3 - <<'PY'
import json, os
data = json.loads(os.environ["OUT"])
assert data["mode"] == "dry-run", data
assert data["delete_count"] >= 1, data
assert all(not path.startswith("/") for path in [item["path"] for item in data["candidates"]]), data
PY
then
  pass "prune dry-run reports fixture-state candidates"
else
  fail "prune dry-run did not report expected candidates"
fi
AFTER_DRY_RUN="$(find "$STATE_ROOT" -type f -print | sort | xargs stat -f '%N %z %m')"
if [[ "$BEFORE_DRY_RUN" == "$AFTER_DRY_RUN" ]]; then
  pass "prune dry-run leaves fixture ledger files unchanged"
else
  fail "prune dry-run mutated fixture ledger files"
fi

if OUT="$(./aos dev provenance prune --apply --state-root "$STATE_ROOT" --runtime-mode repo --json 2>/dev/null)" python3 - <<'PY'
import json, os
data = json.loads(os.environ["OUT"])
assert data["mode"] == "apply", data
assert data["delete_count"] >= 1, data
PY
then
  pass "prune apply deletes only from fixture state root"
else
  fail "prune apply did not succeed"
fi

if OUT="$(./aos dev provenance summary --dock gdi --state-root "$STATE_ROOT" --runtime-mode repo --json 2>/dev/null)" python3 - <<'PY'
import json, os
data = json.loads(os.environ["OUT"])
assert data["retained_summary_count"] >= 1, data
assert data["event_count"] >= data["raw_event_count"], data
assert any(item.get("summary") == "bash tests/dev-workflow-router.sh" for item in data["commands"]), data
PY
then
  pass "summary reads retained daily summaries after raw event pruning"
else
  fail "summary did not use retained daily summaries after pruning"
fi

if grep -R "secret-value" "$STATE_ROOT" >/dev/null 2>&1; then
  fail "ledger persisted sensitive raw command text"
else
  pass "ledger did not persist sensitive raw command text"
fi

if grep -R "super-secret" "$STATE_ROOT" >/dev/null 2>&1; then
  fail "ledger persisted secret from allowlisted-looking command"
else
  pass "allowlisted-looking command did not persist secret argument"
fi

echo
if [[ "$FAILS" -eq 0 ]]; then
  echo "provenance-ledger: all checks passed"
  exit 0
fi

echo "provenance-ledger: $FAILS failure(s)"
exit 1
