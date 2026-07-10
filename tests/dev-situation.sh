#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FAILS=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; FAILS=$((FAILS + 1)); }

TMPDIR="$(mktemp -d "${TMPDIR:-/tmp}/aos-dev-situation.XXXXXX")"
trap 'rm -rf "$TMPDIR"' EXIT

REPO="$TMPDIR/repo"
export REPO
mkdir -p "$REPO"
git -C "$REPO" init -q
git -C "$REPO" config user.email "dev-situation@example.invalid"
git -C "$REPO" config user.name "Dev Situation Test"
printf 'one\n' > "$REPO/file.txt"
git -C "$REPO" add file.txt
git -C "$REPO" commit -q -m "initial"
git -C "$REPO" branch -M main
git -C "$REPO" update-ref refs/remotes/origin/main HEAD
printf 'two\n' >> "$REPO/file.txt"
git -C "$REPO" stash push -q -m "preserve test stash"
HEAD="$(git -C "$REPO" rev-parse HEAD)"
export HEAD

FAKE_AOS="$TMPDIR/aos"
FAKE_LOG="$TMPDIR/fake-aos.log"
FAKE_GH="$TMPDIR/aos-dev-gh"
cat > "$FAKE_AOS" <<SH
#!/usr/bin/env bash
set -euo pipefail
cmd="\$*"
printf '%s\n' "\$cmd" >> "$FAKE_LOG"
case "\$cmd" in
  "ready --json")
    printf '%s\n' '{"status":"ok","ready":true,"phase":"ready"}'
    ;;
  "status --json")
    if [[ "\${FAKE_AOS_FAIL_STATUS:-0}" == "1" ]]; then
      echo "status exploded" >&2
      exit 7
    fi
    printf '%s\n' '{"status":"ok","runtime":{"daemon_running":true}}'
    ;;
  *)
    echo "unexpected fake aos invocation: \$cmd" >&2
    exit 64
    ;;
esac
SH
chmod +x "$FAKE_AOS"

cat > "$FAKE_GH" <<SH
#!/usr/bin/env bash
set -euo pipefail
cmd="\$*"
printf '%s\n' "\$cmd" >> "$FAKE_LOG"
if [[ "\${FAKE_GH_SLEEP:-0}" == "1" ]]; then
  sleep 1
fi
case "\$cmd" in
  "context --json")
    printf '%s\n' '{"status":"success","authority":"gh_cli","repository":"michaelblum/agent-os","default_branch":"main"}'
    ;;
  "issue list --state open --limit 2 --json")
    printf '%s\n' '[{"number":414,"state":"OPEN"},{"number":411,"state":"OPEN"}]'
    ;;
  "issue list --state all --limit 3 --json")
    printf '%s\n' '[{"number":414,"state":"OPEN"},{"number":411,"state":"OPEN"},{"number":407,"state":"CLOSED"}]'
    ;;
  "pr list --state open --limit 4 --json")
    printf '%s\n' '[{"number":415,"state":"OPEN"}]'
    ;;
  *)
    echo "unexpected fake gh invocation: \$cmd" >&2
    exit 64
    ;;
esac
SH
chmod +x "$FAKE_GH"

if OUT="$(AOS_DEV_SITUATION_AOS_PATH="$FAKE_AOS" AOS_DEV_SITUATION_GH_PATH="$FAKE_GH" node scripts/aos-dev-situation.mjs --repo "$REPO" --issue-limit 2 --recent-issue-limit 3 --pr-limit 4 --json 2>/dev/null)" python3 - <<'PY'
import json
import os
from pathlib import Path

data = json.loads(os.environ["OUT"])
sources = {item["id"]: item for item in data["sources"]}
assert data["status"] == "success", data
assert data["schema_version"] == 1, data
assert Path(data["repo"]).resolve() == Path(os.environ["REPO"]).resolve(), data
assert data["git"]["branch"] == "main", data
assert data["git"]["head"] == data["git"]["origin_main"], data
assert data["git"]["ahead_of_origin_main"] == 0, data
assert data["git"]["behind_origin_main"] == 0, data
assert data["summary"]["clean"] is True, data
assert data["summary"]["synced_with_origin_main"] is True, data
assert data["summary"]["open_issue_count"] == 2, data
assert data["summary"]["open_issue_count_limit"] == 2, data
assert data["summary"]["open_issue_count_limit_reached"] is True, data
assert data["summary"]["open_pr_count"] == 1, data
assert data["summary"]["open_pr_count_limit"] == 4, data
assert data["summary"]["open_pr_count_limit_reached"] is False, data
assert data["summary"]["stash_count"] == 1, data
assert data["summary"]["runtime_ready"] is True, data
assert "notes" not in data["summary"], data["summary"]
assert data["successor_note"]["status"] == "missing", data["successor_note"]
assert data["successor_note"]["note"] is None, data["successor_note"]
execution = data["agent_execution"]
assert execution["status"] == "retired", execution
assert execution["authority"] == "repo_dox_and_installable_skills", execution
assert execution["execution_surface"] is None, execution
assert execution["default_engine"] is None, execution
assert execution["native_custom_agents_enabled"] is False, execution
assert execution["codex_config_registration_allowed"] is False, execution
assert execution["roles_dir"] is None, execution
assert execution["team_doc"] is None, execution
assert execution["registered_roles"] == [], execution
assert execution["routing_scope"] == [], execution
assert execution["standing_authorization_intent"] is False, execution
assert execution["ask_user_if_runtime_requires_turn_authorization"] is False, execution
assert execution["fail_closed_without_registered_role"] is False, execution
assert execution["fail_closed_without_session_authorization"] is False, execution
assert execution["direct_specialist_fallback_allowed"] is False, execution
assert execution["extra_mutation_authorized"] is False, execution
assert execution["source_status"]["retirement"], execution
for removed_key in ["standing_user_intent", "runtime_gate", "fail_closed", "authorization_scope"]:
    assert removed_key not in execution, execution
assert "runtime" in data and "ready" in data["runtime"] and "status" in data["runtime"], data
assert "ready" not in data["github"] and "status" not in data["github"], data["github"]
for key, source_id in {
    "summary.clean": "git_status",
    "summary.synced_with_origin_main": "git_ahead_behind",
    "summary.open_issue_count": "github_open_issues",
    "summary.open_issue_count_limit": "github_open_issues",
    "summary.open_issue_count_limit_reached": "github_open_issues",
    "summary.open_pr_count": "github_open_prs",
    "summary.open_pr_count_limit": "github_open_prs",
    "summary.open_pr_count_limit_reached": "github_open_prs",
    "summary.stash_count": "git_stashes",
    "summary.runtime_ready": "aos_ready",
    "agent_execution.status": "agent_execution_policy",
    "agent_execution.registered_roles": "agent_execution_policy",
    "agent_execution.routing_scope": "agent_execution_policy",
    "agent_execution.standing_authorization_intent": "agent_execution_policy",
    "agent_execution.ask_user_if_runtime_requires_turn_authorization": "agent_execution_policy",
    "agent_execution.fail_closed_without_registered_role": "agent_execution_policy",
    "agent_execution.fail_closed_without_session_authorization": "agent_execution_policy",
    "agent_execution.direct_specialist_fallback_allowed": "agent_execution_policy",
    "agent_execution.extra_mutation_authorized": "agent_execution_policy",
}.items():
    assert source_id in data["source_trace"][key], (key, data["source_trace"].get(key))
for source_id in [
    "git_status",
    "git_head",
    "git_origin_main",
    "git_ahead_behind",
    "git_local_branches",
    "git_remote_branches",
    "git_stashes",
    "github_context",
    "github_open_issues",
    "github_recent_issues",
    "github_open_prs",
    "aos_ready",
    "aos_status",
    "successor_note",
    "agent_execution_policy",
]:
    assert sources[source_id]["status"] == "success", sources[source_id]
PY
then
    pass "dev situation emits sourced live-orientation packet"
else
    fail "dev situation packet shape or summary drifted"
fi

if TEXT="$(AOS_DEV_SITUATION_AOS_PATH="$FAKE_AOS" AOS_DEV_SITUATION_GH_PATH="$FAKE_GH" node scripts/aos-dev-situation.mjs --repo "$REPO" --issue-limit 2 --recent-issue-limit 3 --pr-limit 4 2>/dev/null)" \
    && grep -q '^Agent execution: retired$' <<< "$TEXT"; then
    pass "dev situation text output names agent execution state"
else
    fail "dev situation text output omitted agent execution state"
fi

VALID_NOTE="$TMPDIR/valid-successor-note.json"
cat > "$VALID_NOTE" <<JSON
{
  "role": "maintainer",
  "active_epic": {
    "id": "#426",
    "source": "GitHub issue #426",
    "why": "Keep the dev-stack continuity lane easy to resume."
  },
  "current_slice": "Add successor-note continuity to dev situation.",
  "next_step": "Run focused tests and commit the checkpoint.",
  "side_missions": [
    {
      "id": "provider-runner-routing",
      "status": "parked",
      "why_started": "The current provider-runner lane needed durable readback in dev situation.",
      "current_ref": "local transcript note",
      "enough_for_now": "Treat it as parked until a later slice needs deeper provider execution telemetry.",
      "return_condition": "Return when a later slice needs real AOS-owned child execution.",
      "next_step": "Keep implementation local for this slice."
    }
  ],
  "expires_when": "git.head == $HEAD"
}
JSON

if OUT="$(REPO="$REPO" BODY_FILE="$VALID_NOTE" node --input-type=module <<'JS' 2>/dev/null
import fs from 'node:fs';
import { writeSuccessorNote } from './scripts/aos-successor-note.mjs';

const result = writeSuccessorNote(process.env.REPO, 'maintainer', fs.readFileSync(process.env.BODY_FILE, 'utf8'));
if (!result.ok) process.exit(1);
process.stdout.write(`${JSON.stringify(result)}\n`);
JS
)" python3 - <<'PY'
import json
import os
from pathlib import Path

data = json.loads(os.environ["OUT"])
path = Path(os.environ["REPO"]) / ".runtime/dev/successor/maintainer.json"
stored = json.loads(path.read_text())
assert data["status"] == "ok", data
assert data["role"] == "maintainer", data
assert data["path"] == ".runtime/dev/successor/maintainer.json", data
assert data["bytes"] <= data["max_bytes"], data
assert stored["active_epic"]["id"] == "#426", stored
assert stored["side_missions"][0]["id"] == "provider-runner-routing", stored
PY
then
    pass "successor note writer stores compact validated note"
else
    fail "successor note writer did not store a valid note"
fi

if OUT="$(AOS_DEV_SITUATION_AOS_PATH="$FAKE_AOS" AOS_DEV_SITUATION_GH_PATH="$FAKE_GH" node scripts/aos-dev-situation.mjs --repo "$REPO" --issue-limit 2 --recent-issue-limit 3 --pr-limit 4 --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
note = data["successor_note"]
assert note["status"] == "valid", note
assert note["authority"] == "local_breadcrumb", note
assert note["note"]["role"] == "maintainer", note
assert note["note"]["active_epic"]["id"] == "#426", note
assert note["note"]["side_missions"][0]["status"] == "parked", note
assert note["expires"]["status"] == "current", note
assert "successor_note" in data["source_trace"]["successor_note.status"], data["source_trace"]
PY
then
    pass "dev situation includes valid successor note as local breadcrumb"
else
    fail "dev situation did not include valid successor note"
fi

INVALID_NOTE="$TMPDIR/invalid-successor-note.json"
printf '%s\n' '{"role":"maintainer"}' > "$INVALID_NOTE"
if ERR="$(REPO="$REPO" BODY_FILE="$INVALID_NOTE" node --input-type=module <<'JS' 2>&1 >/dev/null
import fs from 'node:fs';
import { writeSuccessorNote } from './scripts/aos-successor-note.mjs';

const result = writeSuccessorNote(process.env.REPO, 'maintainer', fs.readFileSync(process.env.BODY_FILE, 'utf8'));
if (result.ok) process.exit(0);
process.stderr.write(`${JSON.stringify({ code: 'INVALID_NOTE', error: `successor note ${result.status}`, details: result.errors })}\n`);
process.exit(1);
JS
)"; then
    fail "successor note writer should reject missing required fields"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["code"] == "INVALID_NOTE", data
assert any("current_slice" in item for item in data["details"]), data
PY
then
    pass "successor note writer rejects missing required fields"
else
    fail "successor note writer invalid-note error drifted: $ERR"
fi

printf '%s\n' '{"role":"maintainer"}' > "$REPO/.runtime/dev/successor/maintainer.json"
if OUT="$(AOS_DEV_SITUATION_AOS_PATH="$FAKE_AOS" AOS_DEV_SITUATION_GH_PATH="$FAKE_GH" node scripts/aos-dev-situation.mjs --repo "$REPO" --issue-limit 2 --recent-issue-limit 3 --pr-limit 4 --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
note = data["successor_note"]
assert note["status"] == "invalid", note
assert note["note"] is None, note
assert any("current_slice" in item for item in note["errors"]), note
assert data["status"] == "success", data
PY
then
    pass "dev situation labels invalid successor note without promoting it"
else
    fail "dev situation invalid-note handling drifted"
fi

cat > "$REPO/.runtime/dev/successor/maintainer.json" <<JSON
{
  "role": "maintainer",
  "active_epic": {
    "id": "#426",
    "source": "GitHub issue #426",
    "why": "Keep the dev-stack continuity lane easy to resume."
  },
  "current_slice": "Add successor-note continuity to dev situation.",
  "next_step": "Run focused tests and commit the checkpoint.",
  "side_missions": [],
  "expires_when": "git.head == 0000000"
}
JSON
if OUT="$(AOS_DEV_SITUATION_AOS_PATH="$FAKE_AOS" AOS_DEV_SITUATION_GH_PATH="$FAKE_GH" node scripts/aos-dev-situation.mjs --repo "$REPO" --issue-limit 2 --recent-issue-limit 3 --pr-limit 4 --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
note = data["successor_note"]
assert note["status"] == "stale", note
assert note["note"]["role"] == "maintainer", note
assert note["expires"]["status"] == "stale", note
assert data["status"] == "success", data
PY
then
    pass "dev situation labels stale successor note"
else
    fail "dev situation stale-note handling drifted"
fi

OVERSIZED_NOTE="$TMPDIR/oversized-successor-note.json"
{
    printf '%s' '{"role":"maintainer","active_epic":{"id":"#426","source":"GitHub issue #426","why":"x"},"current_slice":"'
    head -c 5000 /dev/zero | tr '\0' a
    printf '%s\n' '","next_step":"x","side_missions":[],"expires_when":"git.head == '"$HEAD"'"}'
} > "$OVERSIZED_NOTE"
if ERR="$(REPO="$REPO" BODY_FILE="$OVERSIZED_NOTE" node --input-type=module <<'JS' 2>&1 >/dev/null
import fs from 'node:fs';
import { writeSuccessorNote } from './scripts/aos-successor-note.mjs';

const result = writeSuccessorNote(process.env.REPO, 'maintainer', fs.readFileSync(process.env.BODY_FILE, 'utf8'));
if (result.ok) process.exit(0);
const code = result.status === 'oversized' ? 'OVERSIZED_NOTE' : 'INVALID_NOTE';
process.stderr.write(`${JSON.stringify({ code, error: `successor note ${result.status}`, details: result.errors })}\n`);
process.exit(1);
JS
)"; then
    fail "successor note writer should reject oversized notes"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["code"] == "OVERSIZED_NOTE", data
assert "max is" in data["details"][0], data
PY
then
    pass "successor note writer rejects oversized notes"
else
    fail "successor note writer oversized-note error drifted: $ERR"
fi

cp "$OVERSIZED_NOTE" "$REPO/.runtime/dev/successor/maintainer.json"
if OUT="$(AOS_DEV_SITUATION_AOS_PATH="$FAKE_AOS" AOS_DEV_SITUATION_GH_PATH="$FAKE_GH" node scripts/aos-dev-situation.mjs --repo "$REPO" --issue-limit 2 --recent-issue-limit 3 --pr-limit 4 --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
note = data["successor_note"]
assert note["status"] == "oversized", note
assert note["note"] is None, note
assert note["bytes"] > note["max_bytes"], note
assert data["status"] == "success", data
PY
then
    pass "dev situation labels oversized successor note"
else
    fail "dev situation oversized-note handling drifted"
fi

if ERR="$(./aos help dev situation --json 2>&1 >/dev/null)"; then
    fail "aos help dev situation should not resolve after dev command removal"
elif echo "$ERR" | grep -q '"code" : "UNKNOWN_COMMAND"'; then
    pass "aos help dev situation is retired from the AOS command surface"
else
    fail "aos help dev situation returned unexpected error: $ERR"
fi

if ERR="$(node scripts/aos-dev-situation.mjs --bogus 2>&1 >/dev/null)"; then
    fail "maintainer situation should reject unknown flags"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["code"] == "UNKNOWN_FLAG", data
assert "Unknown maintainer situation flag" in data["error"], data
PY
then
    pass "maintainer situation rejects unknown flags"
else
    fail "maintainer situation unknown flag error drifted: $ERR"
fi

if grep -q '^context --json$' "$FAKE_LOG" \
    && grep -q '^issue list --state open --limit 2 --json$' "$FAKE_LOG" \
    && grep -q '^pr list --state open --limit 4 --json$' "$FAKE_LOG"; then
    pass "maintainer situation uses direct GitHub helper source commands"
else
    fail "maintainer situation did not call expected direct GitHub helper source commands"
fi

if OUT="$(AOS_DEV_SITUATION_AOS_PATH="$FAKE_AOS" AOS_DEV_SITUATION_GH_PATH="$FAKE_GH" FAKE_AOS_FAIL_STATUS=1 node scripts/aos-dev-situation.mjs --repo "$REPO" --issue-limit 2 --recent-issue-limit 3 --pr-limit 4 --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
sources = {item["id"]: item for item in data["sources"]}
assert data["status"] == "partial", data
assert sources["aos_status"]["status"] == "failed", sources["aos_status"]
assert sources["aos_status"]["exit_code"] == 7, sources["aos_status"]
assert "status exploded" in sources["aos_status"]["note"], sources["aos_status"]
assert data["runtime"]["status"] is None, data["runtime"]
assert data["runtime"]["ready"]["ready"] is True, data["runtime"]
assert data["summary"]["runtime_ready"] is True, data["summary"]
assert "notes" not in data["summary"], data["summary"]
PY
then
    pass "dev situation marks source failure partial without synthesizing missing runtime facts"
else
    fail "dev situation partial-failure behavior drifted"
fi

if OUT="$(AOS_DEV_SITUATION_AOS_PATH="$FAKE_AOS" AOS_DEV_SITUATION_GH_PATH="$FAKE_GH" AOS_DEV_SITUATION_TIMEOUT_MS=1000 AOS_DEV_SITUATION_DEADLINE_MS=150 FAKE_GH_SLEEP=1 node scripts/aos-dev-situation.mjs --repo "$REPO" --issue-limit 2 --recent-issue-limit 3 --pr-limit 4 --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
sources = {item["id"]: item for item in data["sources"]}
failed = [item for item in data["sources"] if item["status"] == "failed"]
assert data["status"] == "partial", data
assert failed, data
assert any(item["exit_code"] == 124 for item in failed), failed
assert any("deadline" in item.get("note", "") for item in failed), failed
assert sources["github_context"]["exit_code"] == 124, sources["github_context"]
assert sources["github_open_issues"]["exit_code"] == 124, sources["github_open_issues"]
assert data["github"]["context"] is None, data["github"]
assert sources["aos_ready"]["status"] == "success", sources["aos_ready"]
assert sources["aos_status"]["status"] == "success", sources["aos_status"]
assert data["summary"]["runtime_ready"] is True, data["summary"]
PY
then
    pass "dev situation isolates runtime probes from a slow GitHub collector"
else
    fail "dev situation global deadline behavior drifted"
fi

echo
if [[ "$FAILS" -eq 0 ]]; then
    echo "dev-situation: all checks passed"
    exit 0
fi

echo "dev-situation: $FAILS failure(s)"
exit 1
