#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FAILS=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; FAILS=$((FAILS + 1)); }

if OUT="$(./aos dev classify --json --paths src/main.swift,packages/toolkit/runtime/canvas.js,shared/schemas/input-event-v2.schema.json,docs/recipes/example.md 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert data["status"] == "success"
assert data["diff_base"] == "explicit"
assert "swift-core" in summary["rule_ids"], summary
assert "toolkit-components" in summary["rule_ids"], summary
assert "schemas" in summary["rule_ids"], summary
assert "docs-only" in summary["rule_ids"], summary
assert summary["requires_swift_build"] is True, summary
assert summary["tcc_identity_sensitive"] is True, summary
assert summary["hot_swappable"] is False, summary
assert any(item["command"] == "./aos dev build" for item in summary["commands"]), summary
assert any(item["command"] == "./aos ready" for item in summary["verification"]), summary
PY
then
    pass "dev classify aggregates manifest-backed workflow classes"
else
    fail "dev classify did not report expected aggregate classes"
fi

if OUT="$(./aos dev recommend --json --files docs/recipes/example.md 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["next_commands"] == [], data
assert data["verification"] == [], data
assert data["notes"], data
assert data["summary"]["rule_ids"] == ["docs-only"], data
PY
then
    pass "dev recommend keeps docs-only changes out of runtime loops"
else
    fail "dev recommend docs-only routing drifted"
fi

if OUT="$(./aos dev classify --json --files unknown/path.txt 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["summary"]["rule_ids"] == ["unclassified"], data
assert data["summary"]["actions"] == ["inspect_manually"], data
PY
then
    pass "dev classify reports unmatched paths through fallback"
else
    fail "dev classify fallback routing drifted"
fi

if OUT="$(./aos dev classify --json --files apps/example/feature.js 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["summary"]["rule_ids"] == ["app-subtree-local-contract"], data
assert data["summary"]["actions"] == ["read_local_contract"], data
assert "nearest subtree AGENTS.md" in data["summary"]["notes"][0], data
assert "sigil" not in json.dumps(data).lower(), data
PY
then
    pass "dev classify routes app subtree changes to local contracts"
else
    fail "dev classify app local-contract routing drifted"
fi

if OUT="$(./aos dev recommend --json --files docs/api/aos.md 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "command-contract-docs" in summary["rule_ids"], data
assert any(item["command"] == "bash tests/help-contract.sh" for item in data["next_commands"]), data
PY
then
    pass "dev recommend routes command-contract docs to help verification"
else
    fail "dev recommend command-contract docs routing drifted"
fi

if ERR="$(./aos dev recommend --json --base definitely-not-a-ref 2>&1 >/dev/null)"; then
    fail "dev recommend should reject invalid --base refs"
elif echo "$ERR" | grep -q '"code" : "INVALID_BASE_REF"'; then
    pass "dev recommend rejects invalid --base refs"
else
    fail "dev recommend invalid --base error mismatch: $ERR"
fi

if OUT="$(./aos help dev --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
forms = {form["id"]: form for form in data["forms"]}
assert {"dev-classify", "dev-recommend", "dev-build", "dev-afk-dry-run", "dev-afk-launch-attempt", "dev-audit", "dev-capabilities", "dev-docks", "dev-gh"} <= set(forms), forms
tokens = {arg.get("token") for arg in forms["dev-classify"]["args"]}
assert {"--paths", "--files", "--base", "--manifest", "--repo", "--json"} <= tokens, tokens
recommend_tokens = {arg.get("token") for arg in forms["dev-recommend"]["args"]}
assert {"--paths", "--files", "--base", "--manifest", "--repo", "--json"} <= recommend_tokens, recommend_tokens
afk_tokens = {arg.get("token") for arg in forms["dev-afk-dry-run"]["args"]}
assert {"--packet", "--provider", "--dock", "--repo", "--timestamp", "--out", "--json"} <= afk_tokens, afk_tokens
assert "--allow-provider-launch" not in afk_tokens, afk_tokens
assert "experimental" in forms["dev-afk-dry-run"]["args"][0]["summary"].lower(), forms["dev-afk-dry-run"]
launch_tokens = {arg.get("token") for arg in forms["dev-afk-launch-attempt"]["args"]}
assert {"--packet", "--provider", "--dock", "--repo", "--timestamp", "--out", "--json", "--duplicate-in-process", "--catalog-fixture", "--bridge-visibility-fixture", "--provider-session-id", "--launch-observed-at", "--codex-home-fixture", "--codex-home"} <= launch_tokens, launch_tokens
assert "--allow-provider-launch" not in launch_tokens, launch_tokens
assert "experimental" in forms["dev-afk-launch-attempt"]["args"][0]["summary"].lower(), forms["dev-afk-launch-attempt"]
audit_tokens = {arg.get("token") for arg in forms["dev-audit"]["args"]}
assert {"--manifest", "--repo", "--json"} <= audit_tokens, audit_tokens
capability_tokens = {arg.get("token") for arg in forms["dev-capabilities"]["args"]}
assert {"--manifest", "--repo", "--role", "--entry-path", "--json"} <= capability_tokens, capability_tokens
dock_tokens = {arg.get("token") for arg in forms["dev-docks"]["args"]}
assert {"--dock-root", "--capabilities-manifest", "--entry-path", "--repo", "--json"} <= dock_tokens, dock_tokens
gh_tokens = {arg.get("token") for arg in forms["dev-gh"]["args"]}
assert {"--repo", "--cwd", "--json", "--body-file", "--pr"} <= gh_tokens, gh_tokens
PY
then
    pass "dev help exposes classify/recommend/build/afk commands/audit/capabilities/docks/gh"
else
    fail "dev help missing workflow router forms"
fi

if OUT="$(./aos help dev afk-dry-run --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
forms = {form["id"]: form for form in data["forms"]}
form = forms["dev-afk-dry-run"]
tokens = {arg.get("token") for arg in form["args"]}
assert {"--packet", "--provider", "--dock", "--repo", "--timestamp", "--out", "--json"} <= tokens, tokens
assert "--allow-provider-launch" not in tokens, tokens
assert "session" not in form["usage"].lower(), form
assert "experimental" in json.dumps(form).lower(), form
PY
then
    pass "dev afk-dry-run help stays experimental and hides provider launch"
else
    fail "dev afk-dry-run help drifted"
fi

if OUT="$(./aos help dev afk-launch-attempt --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
forms = {form["id"]: form for form in data["forms"]}
form = forms["dev-afk-launch-attempt"]
tokens = {arg.get("token") for arg in form["args"]}
assert {"--packet", "--provider", "--dock", "--repo", "--timestamp", "--out", "--json", "--duplicate-in-process", "--catalog-fixture", "--bridge-visibility-fixture", "--provider-session-id", "--launch-observed-at", "--codex-home-fixture", "--codex-home"} <= tokens, tokens
assert "--allow-provider-launch" not in tokens, tokens
assert "session" not in form["usage"].lower(), form
assert "experimental" in json.dumps(form).lower(), form
PY
then
    pass "dev afk-launch-attempt help stays experimental and hides provider launch"
else
    fail "dev afk-launch-attempt help drifted"
fi

if OUT="$(./aos dev capabilities list --role foreman --entry-path aos_developer --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
ids = {item["id"] for item in data["capabilities"]}
assert data["status"] == "success", data
assert data["manifest"] == "docs/dev/agent-capabilities.json", data
assert "dev.github.issue_comment" in ids, ids
assert "dev.build.aos" in ids, ids
assert "dev.test.schema_node" in ids, ids
assert all("adapter_kind" in item for item in data["capabilities"]), data
PY
then
    pass "dev capabilities list discovers canonical manifest"
else
    fail "dev capabilities list did not expose expected manifest entries"
fi

if OUT="$(./aos dev capabilities explain dev.github.issue_comment --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
capability = data["capability"]
assert capability["id"] == "dev.github.issue_comment", data
assert capability["adapter"]["kind"] == "aos_cli", data
assert capability["mutability"]["class"] == "external_write", data
assert capability["mutability"]["requires_body_file"] is True, data
assert capability["execution"]["raw_process"] is False, data
PY
then
    pass "dev capabilities explain returns full capability metadata"
else
    fail "dev capabilities explain did not return expected capability metadata"
fi

if ERR="$(./aos dev capabilities explain no.such.capability --json 2>&1 >/dev/null)"; then
    fail "dev capabilities explain should reject unknown capability ids"
elif echo "$ERR" | grep -q '"code" : "UNKNOWN_CAPABILITY"'; then
    pass "dev capabilities explain rejects unknown capability ids"
else
    fail "dev capabilities explain unknown id error mismatch: $ERR"
fi

if OUT="$(./aos dev docks list --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
names = {item["name"] for item in data["docks"]}
assert data["status"] == "success", data
assert data["dock_root"] == ".docks", data
assert {"foreman", "gdi", "operator"} <= names, names
assert any(item["default_entry_path"] == "aos_developer" for item in data["docks"] if item["name"] == "foreman"), data
PY
then
    pass "dev docks list discovers canonical dock profiles"
else
    fail "dev docks list did not expose expected profiles"
fi

if OUT="$(./aos dev docks capabilities foreman --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
ids = {item["id"] for item in data["capabilities"]}
assert data["dock"] == "foreman", data
assert data["active_entry_path"] == "aos_developer", data
assert "dev.github.issue_comment" in ids, ids
assert "dev.build.aos" in ids, ids
PY
then
    pass "dev docks capabilities resolves foreman envelope"
else
    fail "dev docks capabilities did not resolve foreman envelope"
fi

if OUT="$(./aos dev docks capabilities gdi --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
ids = {item["id"] for item in data["capabilities"]}
assert "dev.github.issue_comment" not in ids, ids
assert "dev.build.aos" in ids, ids
assert "dev.test.schema_node" in ids, ids
PY
then
    pass "dev docks capabilities keeps GDI out of issue-comment writes"
else
    fail "dev docks capabilities allowed unexpected GDI external write"
fi

if OUT="$(./aos dev docks capabilities operator --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["dock"] == "operator", data
assert data["active_entry_path"] == "agent_harness", data
assert data["capabilities"] == [], data
PY
then
    pass "dev docks capabilities keeps operator default path narrow"
else
    fail "dev docks capabilities operator default path was too broad"
fi

if OUT="$(./aos dev docks capabilities operator --entry-path aos_developer --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
ids = {item["id"] for item in data["capabilities"]}
assert "dev.github.context" in ids, ids
assert "dev.github.ci_inspect" in ids, ids
assert "dev.github.issue_comment" not in ids, ids
assert all(item["mutability_class"] == "read_only" for item in data["capabilities"]), data
PY
then
    pass "dev docks capabilities allows operator assigned read-only dev path"
else
    fail "dev docks capabilities operator assigned path drifted"
fi

TMPDIR="$(mktemp -d)"
OLD_PATH="$PATH"
export GH_ARGS_LOG="$TMPDIR/gh-args.log"
trap 'PATH="$OLD_PATH"; rm -rf "$TMPDIR"' EXIT
cat > "$TMPDIR/gh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$GH_ARGS_LOG"
cmd="$*"
if [[ "$cmd" == "auth status" ]]; then
    echo "Logged in to github.com"
    exit 0
fi
if [[ "$cmd" == "repo view michaelblum/agent-os --json nameWithOwner,defaultBranchRef" ]]; then
    echo '{"nameWithOwner":"michaelblum/agent-os","defaultBranchRef":{"name":"main"}}'
    exit 0
fi
if [[ "$cmd" == "pr view --repo michaelblum/agent-os --json number,url,headRefName,baseRefName,state" ]]; then
    echo '{"number":298,"url":"https://github.com/michaelblum/agent-os/pull/298","headRefName":"codex/example","baseRefName":"main","state":"OPEN"}'
    exit 0
fi
if [[ "$cmd" == issue\ comment\ 298\ --repo\ michaelblum/agent-os\ --body-file\ * ]]; then
    echo "https://github.com/michaelblum/agent-os/issues/298#issuecomment-test"
    exit 0
fi
if [[ "$cmd" == "pr checks 298 --repo michaelblum/agent-os --json name,state,bucket,link,startedAt,completedAt,workflow" ]]; then
    echo '[{"name":"unit","state":"failure","bucket":"fail","link":"https://github.com/michaelblum/agent-os/actions/runs/987","workflow":"CI"}]'
    exit 0
fi
if [[ "$cmd" == "run view 987 --repo michaelblum/agent-os --log-failed" ]]; then
    echo "unit failed log"
    exit 0
fi
if [[ "$1" == "api" && "${2:-}" == "graphql" ]]; then
    echo '{"data":{"repository":{"pullRequest":{"number":298,"url":"https://github.com/michaelblum/agent-os/pull/298","reviewThreads":{"nodes":[{"isResolved":false,"isOutdated":false,"path":"src/example.swift","line":12,"startLine":null,"comments":{"nodes":[{"id":"c1","url":"https://github.com/comment","body":"Please fix this.","createdAt":"2026-05-13T00:00:00Z","author":{"login":"reviewer"}}]}}]}}}}}'
    exit 0
fi
echo "unexpected fake gh invocation: $cmd" >&2
exit 64
SH
chmod +x "$TMPDIR/gh"
export PATH="$TMPDIR:$PATH"

if OUT="$(./aos dev gh context --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["authority"] == "gh_cli", data
assert data["tool"] == "gh", data
assert data["repository"] == "michaelblum/agent-os", data
assert data["default_branch"] == "main", data
assert data["current_pr"]["number"] == 298, data
assert data["gh"]["available"] is True, data
assert data["gh"]["authenticated"] is True, data
PY
then
    pass "dev gh context uses local gh authority"
else
    fail "dev gh context did not report expected local gh state"
fi

BODY="$TMPDIR/comment.md"
printf 'accepted state\n' > "$BODY"
: > "$GH_ARGS_LOG"
if OUT="$(./aos dev gh issue comment 298 --body-file "$BODY" 2>/dev/null)" &&
   grep -q "issue comment 298 --repo michaelblum/agent-os --body-file $BODY" "$GH_ARGS_LOG" &&
   echo "$OUT" | grep -q "issuecomment-test"; then
    pass "dev gh issue comment shells out to gh with body-file"
else
    fail "dev gh issue comment did not shell out through expected gh invocation"
fi

if OUT="$(./aos dev gh ci inspect --json 2>/dev/null)"; then
    fail "dev gh ci inspect --json without inferable PR should fail"
elif OUT="$OUT" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "error", data
assert data["authority"] == "gh_cli", data
assert data["exit_code"] == 64, data
assert data["command"] == "gh pr view --repo michaelblum/agent-os --json number,url", data
assert "unexpected fake gh invocation" in data["stderr"], data
PY
then
    pass "dev gh ci inspect --json preserves JSON errors while inferring PR"
else
    fail "dev gh ci inspect --json did not emit parseable JSON error"
fi

if OUT="$(./aos dev gh ci inspect --pr 298 --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert data["checks"][0]["name"] == "unit", data
assert data["failed_logs"][0]["source"] == "github_actions", data
assert data["failed_logs"][0]["run_id"] == "987", data
assert "unit failed log" in data["failed_logs"][0]["stdout"], data
PY
then
    pass "dev gh ci inspect captures failed GitHub Actions logs"
else
    fail "dev gh ci inspect did not capture failed Actions logs"
fi

if OUT="$(./aos dev gh review-comments --json 2>/dev/null)"; then
    fail "dev gh review-comments --json without inferable PR should fail"
elif OUT="$OUT" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "error", data
assert data["authority"] == "gh_cli", data
assert data["exit_code"] == 64, data
assert data["command"] == "gh pr view --repo michaelblum/agent-os --json number,url", data
assert "unexpected fake gh invocation" in data["stderr"], data
PY
then
    pass "dev gh review-comments --json preserves JSON errors while inferring PR"
else
    fail "dev gh review-comments --json did not emit parseable JSON error"
fi

if OUT="$(./aos dev gh review-comments --pr 298 --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert data["thread_count"] == 1, data
assert data["unresolved_count"] == 1, data
assert data["threads"][0]["comments"][0]["author"] == "reviewer", data
PY
then
    pass "dev gh review-comments reads thread-level review state through gh GraphQL"
else
    fail "dev gh review-comments did not return thread-level review state"
fi

echo
if [[ "$FAILS" -eq 0 ]]; then
    echo "dev-workflow-router: all checks passed"
    exit 0
fi

echo "dev-workflow-router: $FAILS failure(s)"
exit 1
