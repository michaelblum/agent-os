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

FAKE_AOS="$TMPDIR/aos"
FAKE_LOG="$TMPDIR/fake-aos.log"
cat > "$FAKE_AOS" <<SH
#!/usr/bin/env bash
set -euo pipefail
cmd="\$*"
printf '%s\n' "\$cmd" >> "$FAKE_LOG"
case "\$cmd" in
  "dev gh context --json")
    printf '%s\n' '{"status":"success","authority":"gh_cli","repository":"michaelblum/agent-os","default_branch":"main"}'
    ;;
  "dev gh issue list --state open --limit 2 --json")
    printf '%s\n' '[{"number":414,"state":"OPEN"},{"number":411,"state":"OPEN"}]'
    ;;
  "dev gh issue list --state all --limit 3 --json")
    printf '%s\n' '[{"number":414,"state":"OPEN"},{"number":411,"state":"OPEN"},{"number":407,"state":"CLOSED"}]'
    ;;
  "dev gh pr list --state open --limit 4 --json")
    printf '%s\n' '[{"number":415,"state":"OPEN"}]'
    ;;
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

if OUT="$(AOS_DEV_SITUATION_AOS_PATH="$FAKE_AOS" node scripts/aos-dev-situation.mjs --repo "$REPO" --issue-limit 2 --recent-issue-limit 3 --pr-limit 4 --json 2>/dev/null)" python3 - <<'PY'
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
assert data["summary"]["open_pr_count"] == 1, data
assert data["summary"]["stash_count"] == 1, data
assert data["summary"]["runtime_ready"] is True, data
assert "notes" not in data["summary"], data["summary"]
assert "runtime" in data and "ready" in data["runtime"] and "status" in data["runtime"], data
assert "ready" not in data["github"] and "status" not in data["github"], data["github"]
for key, source_id in {
    "summary.clean": "git_status",
    "summary.synced_with_origin_main": "git_ahead_behind",
    "summary.open_issue_count": "github_open_issues",
    "summary.open_pr_count": "github_open_prs",
    "summary.stash_count": "git_stashes",
    "summary.runtime_ready": "aos_ready",
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
]:
    assert sources[source_id]["status"] == "success", sources[source_id]
PY
then
    pass "dev situation emits sourced live-orientation packet"
else
    fail "dev situation packet shape or summary drifted"
fi

if OUT="$(./aos help dev situation --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
forms = {form["id"]: form for form in data["forms"]}
assert set(forms) == {"dev-situation"}, forms
tokens = {arg.get("token") for arg in forms["dev-situation"]["args"]}
assert {"--repo", "--issue-limit", "--recent-issue-limit", "--pr-limit", "--json"} <= tokens, tokens
assert forms["dev-situation"]["execution"]["read_only"] is True, forms["dev-situation"]
PY
then
    pass "dev situation help route exposes sourced orientation form"
else
    fail "dev situation help route drifted"
fi

if grep -q '^dev gh context --json$' "$FAKE_LOG" \
    && grep -q '^dev gh issue list --state open --limit 2 --json$' "$FAKE_LOG" \
    && grep -q '^dev gh pr list --state open --limit 4 --json$' "$FAKE_LOG"; then
    pass "dev situation dogfoods ./aos dev gh source commands"
else
    fail "dev situation did not call expected ./aos dev gh source commands"
fi

if OUT="$(AOS_DEV_SITUATION_AOS_PATH="$FAKE_AOS" FAKE_AOS_FAIL_STATUS=1 node scripts/aos-dev-situation.mjs --repo "$REPO" --issue-limit 2 --recent-issue-limit 3 --pr-limit 4 --json 2>/dev/null)" python3 - <<'PY'
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

if ERR="$(./aos dev situation --bogus 2>&1 >/dev/null)"; then
    fail "dev situation should reject unknown flags"
elif echo "$ERR" | grep -q '"code" : "UNKNOWN_FLAG"'; then
    pass "dev situation rejects unknown flags"
else
    fail "dev situation unknown flag error drifted: $ERR"
fi

echo
if [[ "$FAILS" -eq 0 ]]; then
    echo "dev-situation: all checks passed"
    exit 0
fi

echo "dev-situation: $FAILS failure(s)"
exit 1
