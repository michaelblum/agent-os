#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FAILS=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; FAILS=$((FAILS + 1)); }

if OUT="$(./aos dev classify --json --paths src/main.swift,packages/toolkit/runtime/canvas.js,shared/schemas/input-event-v2.schema.json,docs/guides/example.md 2>/dev/null)" python3 - <<'PY'
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

if OUT="$(./aos dev recommend --json --files docs/guides/example.md 2>/dev/null)" python3 - <<'PY'
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

if OUT="$(./aos dev recommend --json --files tests/lib/visual-harness.sh 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "visual-harness-primitives" in summary["rule_ids"], data
assert "tests" in summary["rule_ids"], data
commands = {item["command"] for item in data["next_commands"]}
assert {
    "bash tests/visual-harness-boundary.sh",
    "bash tests/visual-harness-canonical-url-primitives.sh",
    "bash tests/visual-harness-content-preflight.sh",
    "bash tests/harness-composability-contracts.sh",
} <= commands, data
assert summary["requires_swift_build"] is False, data
assert summary["tcc_identity_sensitive"] is False, data
PY
then
    pass "dev recommend routes visual harness primitive changes to deterministic battery"
else
    fail "dev recommend visual harness primitive routing drifted"
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

if OUT="$(./aos dev recommend --json --files scripts/aos-do-native.mjs 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "command-surface-implementations" in summary["rule_ids"], data
assert "unclassified" not in summary["rule_ids"], data
assert summary["hot_swappable"] is True, data
assert summary["requires_swift_build"] is False, data
assert summary["tcc_identity_sensitive"] is False, data
commands = {item["command"] for item in data["next_commands"]}
assert {
    "bash tests/external-command-dispatch.sh",
    "bash tests/external-parser-flags.sh",
    "bash tests/help-contract.sh",
} <= commands, data
PY
then
    pass "dev recommend routes external command wrappers to hot-swappable command-surface checks"
else
    fail "dev recommend external command wrapper routing drifted"
fi

if OUT="$(./aos dev recommend --json --files manifests/commands/source/aos/03-see-01-capture.json scripts/generate-command-manifests.mjs tests/command-manifest-generation.sh 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "command-surface-manifests" in summary["rule_ids"], data
assert "unclassified" not in summary["rule_ids"], data
assert summary["hot_swappable"] is True, data
assert summary["requires_swift_build"] is False, data
commands = {item["command"] for item in data["next_commands"]}
assert {
    "bash tests/command-manifest-generation.sh",
    "node --test tests/schemas/aos-external-command-manifest-v0.test.mjs",
    "bash tests/external-command-dispatch.sh",
    "bash tests/help-contract.sh",
} <= commands, data
PY
then
    pass "dev recommend routes command source and generator edits to manifest generation checks"
else
    fail "dev recommend command source/generator routing drifted"
fi

if OUT="$(./aos dev recommend --json --files scripts/aos_agents/runner.py 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
commands = {item["command"] for item in data["next_commands"]}
assert "aos-agent-runner" in summary["rule_ids"], data
assert "bash tests/aos-agents-runner.sh" in commands, data
assert "bash tests/dev-workflow-router.sh" in commands, data
assert "bash tests/dev-audit.sh" in commands, data
assert summary["hot_swappable"] is True, data
assert summary["tcc_identity_sensitive"] is False, data
PY
then
    pass "dev recommend routes AOS agent runner changes to focused command-surface checks"
else
    fail "dev recommend AOS agent runner routing drifted"
fi

if OUT="$(./aos dev recommend --json --files packages/cli/verbs/gate-ask.js 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "command-surface-implementations" in summary["rule_ids"], data
assert "unclassified" not in summary["rule_ids"], data
assert summary["hot_swappable"] is True, data
assert summary["requires_swift_build"] is False, data
assert summary["tcc_identity_sensitive"] is False, data
commands = {item["command"] for item in data["next_commands"]}
assert {
    "bash tests/external-command-dispatch.sh",
    "bash tests/external-parser-flags.sh",
    "bash tests/help-contract.sh",
} <= commands, data
PY
then
    pass "dev recommend routes package CLI commands to command-surface checks"
else
    fail "dev recommend package CLI command routing drifted"
fi

if OUT="$(./aos dev recommend --json --files scripts/sign-aos-runtime 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "command-surface-implementations" in summary["rule_ids"], data
assert "unclassified" not in summary["rule_ids"], data
assert summary["hot_swappable"] is True, data
assert summary["requires_swift_build"] is False, data
assert summary["tcc_identity_sensitive"] is False, data
commands = {item["command"] for item in data["next_commands"]}
assert {
    "bash tests/external-command-dispatch.sh",
    "bash tests/external-parser-flags.sh",
    "bash tests/help-contract.sh",
} <= commands, data
PY
then
    pass "dev recommend routes runtime signing script to command-surface checks"
else
    fail "dev recommend runtime signing command routing drifted"
fi

if OUT="$(./aos dev recommend --json --files packages/gateway/dist/doctor-cli.js 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
summary = data["summary"]
assert "package-gateway" in summary["rule_ids"], data
assert "command-surface-implementations" in summary["rule_ids"], data
assert "unclassified" not in summary["rule_ids"], data
assert summary["hot_swappable"] is True, data
assert summary["requires_swift_build"] is False, data
assert summary["tcc_identity_sensitive"] is False, data
commands = {item["command"] for item in data["next_commands"]}
assert {
    "cd packages/gateway && npm test",
    "bash tests/external-command-dispatch.sh",
    "bash tests/external-parser-flags.sh",
    "bash tests/help-contract.sh",
} <= commands, data
PY
then
    pass "dev recommend routes gateway doctor CLI to package and command-surface checks"
else
    fail "dev recommend gateway doctor CLI routing drifted"
fi

if OUT="$(node - <<'NODE'
const { spawnSync } = require('node:child_process');
const manifest = require('./manifests/commands/aos-external-commands.json');
const targets = [...new Set(
  manifest.commands
    .flatMap((command) => command.argv_prefix || [])
    .filter((arg) => /^(scripts|packages)\//.test(arg))
)].sort();
const result = spawnSync('./aos', ['dev', 'classify', '--json', '--files', ...targets], { encoding: 'utf8' });
if (result.stderr) process.stderr.write(result.stderr);
if (result.stdout) process.stdout.write(result.stdout);
process.exit(result.status ?? 1);
NODE
)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert data["files"], data
for item in data["files"]:
    rules = set(item["rules"])
    assert "command-surface-implementations" in rules or "aos-agent-runner" in rules, item
    assert "unclassified" not in rules, item
    assert item["hot_swappable"] is True, item
    assert item["tcc_identity_sensitive"] is False, item
summary = data["summary"]
assert summary["requires_swift_build"] is False, summary
assert summary["tcc_identity_sensitive"] is False, summary
PY
then
    pass "dev classify routes every external manifest implementation target to command-surface checks"
else
    fail "dev classify external manifest implementation target routing drifted"
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

if ERR="$(./aos dev recommend --base --json 2>&1 >/dev/null)"; then
    fail "dev recommend should reject missing --base values before a flag"
elif echo "$ERR" | grep -q '"code" : "MISSING_ARG"'; then
    pass "dev recommend treats flag-after---base as missing value"
else
    fail "dev recommend missing --base error mismatch: $ERR"
fi

if ERR="$(node scripts/aos-dev-workflow.mjs audit --repo --json 2>&1 >/dev/null)"; then
    fail "dev audit should reject missing --repo values before a flag"
elif echo "$ERR" | grep -q '"code" : "MISSING_ARG"'; then
    pass "dev audit treats flag-after---repo as missing value"
else
    fail "dev audit missing --repo error mismatch: $ERR"
fi

if OUT="$(./aos help dev --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
forms = {form["id"]: form for form in data["forms"]}
assert {"dev-classify", "dev-recommend", "dev-build", "dev-afk-dry-run", "dev-afk-launch-attempt", "dev-afk-session-trigger", "dev-audit", "dev-capabilities", "dev-docks", "dev-agents", "dev-subagent", "dev-gh"} <= set(forms), forms
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
trigger_tokens = {arg.get("token") for arg in forms["dev-afk-session-trigger"]["args"]}
assert {"--packet", "--afk-work-queue", "--queue-run-fixture", "--afk-authorization", "--sleep-lease", "--provider", "--dock", "--repo", "--timestamp", "--out", "--result-route", "--idempotence-salt", "--existing-receipt", "--replacement-for", "--dry-run", "--supervised-live-launch", "--afk-live-launch", "--sleep-lease-live-launch", "--warm-dock-tui-reuse", "--i-am-present", "--provider-launch-dry-run", "--bridge-visibility-fixture", "--cleanup-proof-fixture", "--provider-session-id", "--launch-observed-at", "--codex-home-fixture", "--codex-home", "--json"} <= trigger_tokens, trigger_tokens
assert "--live" not in trigger_tokens, trigger_tokens
assert "--launch-provider" not in trigger_tokens, trigger_tokens
assert "--start" not in trigger_tokens, trigger_tokens
assert "experimental" in forms["dev-afk-session-trigger"]["args"][0]["summary"].lower(), forms["dev-afk-session-trigger"]
audit_tokens = {arg.get("token") for arg in forms["dev-audit"]["args"]}
assert {"--manifest", "--repo", "--json"} <= audit_tokens, audit_tokens
capability_tokens = {arg.get("token") for arg in forms["dev-capabilities"]["args"]}
assert {"--manifest", "--repo", "--role", "--entry-path", "--json"} <= capability_tokens, capability_tokens
dock_tokens = {arg.get("token") for arg in forms["dev-docks"]["args"]}
assert {"--dock-root", "--capabilities-manifest", "--entry-path", "--repo", "--json"} <= dock_tokens, dock_tokens
agents_tokens = {arg.get("token") for arg in forms["dev-agents"]["args"]}
assert {"--self-test", "--runtime-info", "--list-runs", "--read-run", "--native-dispatch", "--complete-native-run", "--result-file", "--check-patch", "--apply-patch", "--i-approve-checkout-mutation", "--engine", "--role", "--task", "--execute", "--patch-output", "--context-file", "--max-turns", "--repo", "--json"} <= agents_tokens, agents_tokens
subagent_tokens = {arg.get("token") for arg in forms["dev-subagent"]["args"]}
assert {"--agents-root", "--role", "--prompt", "--prompt-file", "--transcript", "--transcript-file", "--repo", "--json"} <= subagent_tokens, subagent_tokens
gh_tokens = {arg.get("token") for arg in forms["dev-gh"]["args"]}
assert {"--repo", "--cwd", "--json", "--body-file", "--pr"} <= gh_tokens, gh_tokens
PY
then
    pass "dev help exposes classify/recommend/build/afk commands/audit/capabilities/docks/agents/subagent/gh"
else
    fail "dev help missing workflow router forms"
fi

if OUT="$(./aos dev agents --self-test --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["self_test"] == "pass", data
assert data["default_engine"] == "provider-sdk", data
assert set(data["engines"]) == {"provider-sdk"}, data
assert data["retired_engines"]["native-codex"]["retired"] is True, data
assert set(data["roles"]) == {"explorer", "reviewer", "validator", "historian"}, data
assert all(item["sandbox_mode"] == "read-only" for item in data["roles"].values()), data
PY
then
    pass "dev agents self-test runs through external command manifest"
else
    fail "dev agents self-test route drifted"
fi

if ERR="$(./aos dev subagent list --json 2>&1 >/dev/null)"; then
    fail "dev subagent should be retired"
elif echo "$ERR" | grep -q "RETIRED_SUBAGENT_COMMAND"; then
    pass "dev subagent fails closed with retired-command error"
else
    fail "dev subagent retired-command error mismatch: $ERR"
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
assert "prototype" in json.dumps(form).lower(), form
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
assert "prototype" in json.dumps(form).lower(), form
PY
then
    pass "dev afk-launch-attempt help stays experimental and hides provider launch"
else
    fail "dev afk-launch-attempt help drifted"
fi

PACKET="$(mktemp "${TMPDIR:-/tmp}/aos-afk-dry-run.XXXXXX")"
cat > "$PACKET" <<JSON
{
  "packet_id": "dev-wrapper-afk-dry-run",
  "source_artifact": "docs/design/work-cards/afk-dev-dry-run-command-v0.md",
  "requested_recipient": "gdi",
  "cwd": "$PWD",
  "worktree": "$PWD",
  "required_start_ref": "HEAD",
  "provider_hint": "codex",
  "result_route": [{"kind": "local_artifact_path", "ref": "stdout"}],
  "external_publication_policy": "local-only",
  "goal": "verify external dev afk-dry-run wrapper"
}
JSON
if OUT="$(./aos dev afk-dry-run --packet "$PACKET" --provider codex --dock gdi --json --timestamp 2026-05-22T20:00:00.000Z 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["final_status"] == "failed", data
assert data["transfer"]["packet_id_or_ref"] == "dev-wrapper-afk-dry-run", data
assert data["dispatch"]["selected_provider"] == "codex", data
assert data["dispatch"]["selected_dock_profile"]["status"] == "missing_with_reason", data
assert "dock profile not found" in data["dispatch"]["selected_dock_profile"]["reason"], data
PY
then
    pass "dev afk-dry-run runs through external command manifest and fails closed on retired dock profiles"
else
    fail "dev afk-dry-run external wrapper drifted: ${OUT:-}"
fi
rm -f "$PACKET"

PACKET="$(mktemp "${TMPDIR:-/tmp}/aos-afk-launch-attempt.XXXXXX")"
cat > "$PACKET" <<JSON
{
  "packet_id": "dev-wrapper-afk-launch-attempt",
  "source_artifact": "docs/design/work-cards/afk-dev-launch-attempt-command-v0.md",
  "requested_recipient": "gdi",
  "cwd": "$PWD",
  "worktree": "$PWD",
  "required_start_ref": "HEAD",
  "provider_hint": "codex",
  "result_route": [{"kind": "local_artifact_path", "ref": "stdout"}],
  "external_publication_policy": "local-only",
  "goal": "verify external dev afk-launch-attempt wrapper"
}
JSON
if OUT="$(./aos dev afk-launch-attempt --packet "$PACKET" --provider codex --dock gdi --json --timestamp 2026-05-22T20:00:00.000Z 2>&1 >/dev/null)"; then
    fail "dev afk-launch-attempt should fail closed when the retired gdi dock contract is missing"
elif OUT="$OUT" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["record_type"] == "aos.afk_launch_attempt", data
assert data["lifecycle_state"] == "failed", data
assert ".docks/gdi/inbound-contract.json" in data["error"], data
PY
then
    pass "dev afk-launch-attempt routes through external command manifest and fails closed on retired dock contract"
else
    fail "dev afk-launch-attempt external wrapper drifted: ${OUT:-}"
fi
rm -f "$PACKET"

if OUT="$(./aos help dev afk-session-trigger --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
forms = {form["id"]: form for form in data["forms"]}
form = forms["dev-afk-session-trigger"]
tokens = {arg.get("token") for arg in form["args"]}
assert {"--packet", "--afk-work-queue", "--queue-run-fixture", "--afk-authorization", "--sleep-lease", "--provider", "--dock", "--repo", "--timestamp", "--out", "--result-route", "--idempotence-salt", "--existing-receipt", "--replacement-for", "--dry-run", "--supervised-live-launch", "--afk-live-launch", "--sleep-lease-live-launch", "--warm-dock-tui-reuse", "--i-am-present", "--provider-launch-dry-run", "--bridge-visibility-fixture", "--cleanup-proof-fixture", "--provider-session-id", "--launch-observed-at", "--codex-home-fixture", "--codex-home", "--json"} <= tokens, tokens
assert "--live" not in tokens, tokens
assert "--launch-provider" not in tokens, tokens
assert "--start" not in tokens, tokens
assert "--afk-live-launch" in form["usage"], form
assert "--afk-authorization" in form["usage"], form
assert "experimental" in json.dumps(form).lower(), form
assert "prototype" in json.dumps(form).lower(), form
PY
then
    pass "dev afk-session-trigger help stays experimental and exposes guarded live launch"
else
    fail "dev afk-session-trigger help drifted"
fi

PACKET="$(mktemp "${TMPDIR:-/tmp}/aos-afk-session-trigger.XXXXXX")"
cat > "$PACKET" <<JSON
{
  "packet_id": "dev-wrapper-afk-session-trigger",
  "source_artifact": "docs/design/work-cards/afk-dev-session-trigger-dry-run-command-v0.md",
  "requested_recipient": "gdi",
  "cwd": "$PWD",
  "worktree": "$PWD",
  "required_start_ref": "HEAD",
  "provider_hint": "codex",
  "result_route": [{"kind": "local_artifact_path", "ref": "stdout"}],
  "external_publication_policy": "local-only",
  "goal": "verify external dev afk-session-trigger wrapper"
}
JSON
if OUT="$(./aos dev afk-session-trigger --packet "$PACKET" --provider codex --dock gdi --dry-run --json --timestamp 2026-05-22T20:00:00.000Z 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["record_type"] == "aos.afk_session_trigger_dry_run", data
assert data["status"] == "rejected", data
assert data["packet"]["packet_id"] == "dev-wrapper-afk-session-trigger", data
assert data["packet"]["validation_status"] == "invalid", data
assert data["dispatch"]["selected_provider"] == "codex", data
assert any(item["class"] == "unknown_dock" for item in data["mismatches"]), data
PY
then
    pass "dev afk-session-trigger runs through external command manifest and rejects retired dock profiles"
else
    fail "dev afk-session-trigger external wrapper drifted: ${OUT:-}"
fi
rm -f "$PACKET"

if OUT="$(./aos dev capabilities list --role foreman --entry-path aos_developer --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
ids = {item["id"] for item in data["capabilities"]}
assert data["status"] == "success", data
assert data["manifest"] == "docs/dev/agent-capabilities.json", data
assert "dev.github.issue_list" in ids, ids
assert "dev.github.pr_list" in ids, ids
assert "dev.github.issue_comment" in ids, ids
assert "dev.github.issue_create" in ids, ids
assert "dev.github.issue_close" in ids, ids
assert "dev.github.issue_edit" in ids, ids
assert "dev.github.label_list" in ids, ids
assert "dev.github.pr_comment" in ids, ids
assert "dev.github.pr_create" in ids, ids
assert "dev.github.pr_merge" in ids, ids
assert "dev.github.pr_checks" in ids, ids
assert "dev.agents" in ids, ids
assert "dev.build.aos" in ids, ids
assert "dev.test.schema_node" in ids, ids
assert all("adapter_kind" in item for item in data["capabilities"]), data
PY
then
    pass "dev capabilities list discovers canonical manifest"
else
    fail "dev capabilities list did not expose expected manifest entries"
fi

if ERR="$(./aos dev capabilities list --role --json 2>&1 >/dev/null)"; then
    fail "dev capabilities list should reject missing --role values before a flag"
elif echo "$ERR" | grep -q '"code" : "MISSING_ARG"'; then
    pass "dev capabilities list treats flag-after---role as missing value"
else
    fail "dev capabilities list missing --role error mismatch: $ERR"
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

if OUT="$(./aos dev capabilities explain dev.github.pr_comment --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
capability = data["capability"]
assert capability["id"] == "dev.github.pr_comment", data
assert capability["adapter"]["kind"] == "aos_cli", data
assert capability["mutability"]["class"] == "external_write", data
assert capability["mutability"]["requires_body_file"] is True, data
assert capability["execution"]["raw_process"] is False, data
PY
then
    pass "dev capabilities explain returns PR comment metadata"
else
    fail "dev capabilities explain did not return expected PR comment metadata"
fi

if OUT="$(./aos dev capabilities explain dev.github.pr_create --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
capability = data["capability"]
assert capability["id"] == "dev.github.pr_create", data
assert capability["adapter"]["kind"] == "aos_cli", data
assert capability["mutability"]["class"] == "external_write", data
assert capability["mutability"]["requires_body_file"] is True, data
assert capability["execution"]["raw_process"] is False, data
PY
then
    pass "dev capabilities explain returns PR create metadata"
else
    fail "dev capabilities explain did not return expected PR create metadata"
fi

if OUT="$(./aos dev capabilities explain dev.github.issue_create --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
capability = data["capability"]
assert capability["id"] == "dev.github.issue_create", data
assert capability["adapter"]["kind"] == "aos_cli", data
assert capability["mutability"]["class"] == "external_write", data
assert capability["mutability"]["requires_body_file"] is True, data
assert capability["execution"]["raw_process"] is False, data
PY
then
    pass "dev capabilities explain returns issue create metadata"
else
    fail "dev capabilities explain did not return expected issue create metadata"
fi

if OUT="$(./aos dev capabilities explain dev.agents --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
capability = data["capability"]
assert capability["id"] == "dev.agents", data
assert capability["adapter"]["kind"] == "aos_cli", data
assert capability["adapter"]["command"] == ["./aos", "dev", "agents"], data
assert capability["mutability"]["class"] == "read_only", data
assert capability["execution"]["network"] == "forbidden", data
assert capability["execution"]["raw_process"] is False, data
PY
then
    pass "dev capabilities explain returns AOS agent runner metadata"
else
    fail "dev capabilities explain did not return expected AOS agent runner metadata"
fi

if OUT="$(./aos dev capabilities explain dev.github.issue_close --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
capability = data["capability"]
assert capability["id"] == "dev.github.issue_close", data
assert capability["adapter"]["kind"] == "aos_cli", data
assert capability["mutability"]["class"] == "external_write", data
assert capability["mutability"]["requires_body_file"] is False, data
assert capability["execution"]["raw_process"] is False, data
PY
then
    pass "dev capabilities explain returns issue close metadata"
else
    fail "dev capabilities explain did not return expected issue close metadata"
fi

if OUT="$(./aos dev capabilities explain dev.github.issue_edit --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
capability = data["capability"]
assert capability["id"] == "dev.github.issue_edit", data
assert capability["adapter"]["kind"] == "aos_cli", data
assert capability["mutability"]["class"] == "external_write", data
assert capability["mutability"]["requires_explicit_assignment"] is True, data
assert capability["mutability"]["requires_human_approval"] is False, data
assert capability["mutability"]["requires_body_file"] is False, data
assert capability["execution"]["audit"] == "required", data
assert capability["execution"]["raw_process"] is False, data
PY
then
    pass "dev capabilities explain returns issue edit metadata"
else
    fail "dev capabilities explain did not return expected issue edit metadata"
fi

if OUT="$(./aos dev capabilities explain dev.github.label_list --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
capability = data["capability"]
assert capability["id"] == "dev.github.label_list", data
assert capability["adapter"]["kind"] == "aos_cli", data
assert capability["mutability"]["class"] == "read_only", data
assert capability["mutability"]["requires_body_file"] is False, data
assert capability["execution"]["raw_process"] is False, data
PY
then
    pass "dev capabilities explain returns label list metadata"
else
    fail "dev capabilities explain did not return expected label list metadata"
fi

if OUT="$(./aos dev capabilities explain dev.github.pr_merge --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
capability = data["capability"]
assert capability["id"] == "dev.github.pr_merge", data
assert capability["adapter"]["kind"] == "aos_cli", data
assert capability["mutability"]["class"] == "external_write", data
assert capability["mutability"]["requires_body_file"] is False, data
assert capability["execution"]["raw_process"] is False, data
PY
then
    pass "dev capabilities explain returns PR merge metadata"
else
    fail "dev capabilities explain did not return expected PR merge metadata"
fi

if ERR="$(./aos dev capabilities explain no.such.capability --json 2>&1 >/dev/null)"; then
    fail "dev capabilities explain should reject unknown capability ids"
elif echo "$ERR" | grep -q '"code" : "UNKNOWN_CAPABILITY"'; then
    pass "dev capabilities explain rejects unknown capability ids"
else
    fail "dev capabilities explain unknown id error mismatch: $ERR"
fi

if ERR="$(./aos dev capabilities explain dev.github.issue_comment extra --json 2>&1 >/dev/null)"; then
    fail "dev capabilities explain should reject extra positional args"
elif echo "$ERR" | grep -q '"code" : "UNKNOWN_ARG"' \
    && echo "$ERR" | grep -q 'Unknown dev capabilities argument: extra'; then
    pass "dev capabilities explain rejects extra positional args"
else
    fail "dev capabilities explain extra positional error mismatch: $ERR"
fi

if OUT="$(./aos dev docks list --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
names = {item["name"] for item in data["docks"]}
assert data["status"] == "success", data
assert data["dock_root"] == ".docks", data
assert names == {"foreman"}, names
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
assert "dev.github.issue_list" in ids, ids
assert "dev.github.pr_list" in ids, ids
assert "dev.github.issue_comment" in ids, ids
assert "dev.github.issue_create" in ids, ids
assert "dev.github.issue_close" in ids, ids
assert "dev.github.issue_edit" in ids, ids
assert "dev.github.label_list" in ids, ids
assert "dev.github.pr_comment" in ids, ids
assert "dev.github.pr_create" in ids, ids
assert "dev.github.pr_merge" in ids, ids
assert "dev.github.pr_checks" in ids, ids
assert "dev.agents" in ids, ids
assert "dev.build.aos" in ids, ids
PY
then
    pass "dev docks capabilities resolves foreman envelope"
else
    fail "dev docks capabilities did not resolve foreman envelope"
fi

if ERR="$(./aos dev docks explain foreman extra --json 2>&1 >/dev/null)"; then
    fail "dev docks explain should reject extra positional args"
elif echo "$ERR" | grep -q '"code" : "UNKNOWN_ARG"' \
    && echo "$ERR" | grep -q 'Unknown dev docks argument: extra'; then
    pass "dev docks explain rejects extra positional args"
else
    fail "dev docks explain extra positional error mismatch: $ERR"
fi

if ERR="$(./aos dev docks capabilities foreman extra --json 2>&1 >/dev/null)"; then
    fail "dev docks capabilities should reject extra positional args"
elif echo "$ERR" | grep -q '"code" : "UNKNOWN_ARG"' \
    && echo "$ERR" | grep -q 'Unknown dev docks argument: extra'; then
    pass "dev docks capabilities rejects extra positional args"
else
    fail "dev docks capabilities extra positional error mismatch: $ERR"
fi

if ERR="$(./aos dev docks capabilities gdi --json 2>&1 >/dev/null)"; then
    fail "dev docks capabilities should reject retired gdi dock profile"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["code"] == "UNKNOWN_DOCK", data
assert data["error"] == "Unknown dock profile: gdi", data
PY
then
    pass "dev docks capabilities rejects retired gdi profile"
else
    fail "dev docks capabilities gdi error mismatch: ${ERR:-}"
fi

if ERR="$(./aos dev docks capabilities operator --json 2>&1 >/dev/null)"; then
    fail "dev docks capabilities should reject retired operator dock profile"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["code"] == "UNKNOWN_DOCK", data
assert data["error"] == "Unknown dock profile: operator", data
PY
then
    pass "dev docks capabilities rejects retired operator profile"
else
    fail "dev docks capabilities operator error mismatch: ${ERR:-}"
fi

if ERR="$(./aos dev docks capabilities operator --entry-path aos_developer --json 2>&1 >/dev/null)"; then
    fail "dev docks capabilities should reject retired operator assigned path"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["code"] == "UNKNOWN_DOCK", data
assert data["error"] == "Unknown dock profile: operator", data
PY
then
    pass "dev docks capabilities rejects retired operator assigned path"
else
    fail "dev docks capabilities operator assigned path error mismatch: ${ERR:-}"
fi

if ERR="$(./aos dev docks capabilities operator --entry-path --json 2>&1 >/dev/null)"; then
    fail "dev docks capabilities should reject missing --entry-path values before a flag"
elif echo "$ERR" | grep -q '"code" : "MISSING_ARG"'; then
    pass "dev docks capabilities treats flag-after---entry-path as missing value"
else
    fail "dev docks capabilities missing --entry-path error mismatch: $ERR"
fi

TMPDIR="$(mktemp -d)"
OLD_PATH="$PATH"
export GH_ARGS_LOG="$TMPDIR/gh-args.log"
export GH_BODY_LOG="$TMPDIR/gh-body.log"
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
    body_file="${cmd##* --body-file }"
    cat "$body_file" >> "$GH_BODY_LOG"
    printf '\n---\n' >> "$GH_BODY_LOG"
    echo "https://github.com/michaelblum/agent-os/issues/298#issuecomment-test"
    exit 0
fi
if [[ "$cmd" == issue\ create\ --repo\ michaelblum/agent-os\ --title\ Strategic\ follow-up\ --body-file\ *\ --label\ governance\ --label\ follow-up\ --assignee\ @me\ --milestone\ v1 ]]; then
    echo "https://github.com/michaelblum/agent-os/issues/411"
    exit 0
fi
if [[ "$cmd" == "issue close 411 --repo michaelblum/agent-os --reason completed" ]]; then
    echo "✓ Closed issue michaelblum/agent-os#411"
    exit 0
fi
if [[ "$cmd" == issue\ edit\ 407\ --repo\ michaelblum/agent-os\ --remove-label\ lane:active\ --add-label\ lane:parked\ --add-assignee\ @me\ --remove-assignee\ old-owner\ --milestone\ v1\ --title\ Parked\ ledger\ --body-file\ * ]]; then
    echo "https://github.com/michaelblum/agent-os/issues/407"
    exit 0
fi
if [[ "$cmd" == "issue view 298 --repo michaelblum/agent-os --json number,title,state,url,body,labels,comments" ]]; then
    echo '{"number":298,"title":"Governance ledger","state":"OPEN","url":"https://github.com/michaelblum/agent-os/issues/298","labels":[],"comments":[]}'
    exit 0
fi
if [[ "$cmd" == issue\ view\ 298\ --repo\ michaelblum/agent-os\ --json\ number,title,state,url,body,labels,comments\ --template\ * ]]; then
    echo "#298 Governance ledger"
    echo "https://github.com/michaelblum/agent-os/issues/298"
    exit 0
fi
if [[ "$cmd" == "issue view 298 --repo michaelblum/agent-os" ]]; then
    echo "GraphQL: Projects (classic) is being deprecated. (repository.issue.projectCards)" >&2
    exit 1
fi
if [[ "$cmd" == issue\ view\ 298\ --repo\ michaelblum/agent-os\ --json\ *projectCards* ]]; then
    echo "GraphQL: Projects (classic) is being deprecated. (repository.issue.projectCards)" >&2
    exit 1
fi
if [[ "$cmd" == "issue list --repo michaelblum/agent-os --state all --limit 20 --label bug --label docs --search semantic target --milestone v0 --json number,title,state,url,createdAt,updatedAt,labels,assignees,author" ]]; then
    echo '[{"number":399,"title":"Track semantic target cleanup","state":"CLOSED","url":"https://github.com/michaelblum/agent-os/issues/399"}]'
    exit 0
fi
if [[ "$cmd" == "label list --repo michaelblum/agent-os --limit 10 --search governance --sort name --order desc --json name,description,color,isDefault,url" ]]; then
    echo '[{"name":"governance","description":"Governance and coordination","color":"5319e7","isDefault":false,"url":"https://github.com/michaelblum/agent-os/labels/governance"}]'
    exit 0
fi
if [[ "$cmd" == "pr view 298 --repo michaelblum/agent-os --json number,title,state,url,headRefName,baseRefName,isDraft,reviewDecision,body,comments,reviews" ]]; then
    echo '{"number":298,"title":"Review target","state":"OPEN","reviewDecision":"CHANGES_REQUESTED"}'
    exit 0
fi
if [[ "$cmd" == "pr list --repo michaelblum/agent-os --state all --limit 30 --author michaelblum --base main --head gdi/example --draft --json number,title,state,url,createdAt,updatedAt,headRefName,baseRefName,isDraft,labels,author" ]]; then
    echo '[{"number":404,"title":"Reuse semantic target primitives","state":"MERGED","headRefName":"gdi/example","baseRefName":"main","isDraft":true}]'
    exit 0
fi
if [[ "$cmd" == "pr checks 298 --repo michaelblum/agent-os --json name,state,bucket,link,startedAt,completedAt,workflow" ]]; then
    echo '[{"name":"unit","state":"failure","bucket":"fail","link":"https://github.com/michaelblum/agent-os/actions/runs/987","workflow":"CI"}]'
    exit 0
fi
if [[ "$cmd" == "pr checks 299 --repo michaelblum/agent-os --json name,state,bucket,link,startedAt,completedAt,workflow" ]]; then
    echo '[{"name":"lint","state":"failure","bucket":"fail","link":"https://github.com/michaelblum/agent-os/actions/runs/988","workflow":"CI"}]'
    echo "checks failed" >&2
    exit 1
fi
if [[ "$cmd" == pr\ create\ --repo\ michaelblum/agent-os\ --base\ main\ --head\ foreman/dev-gh-pr-create-v0\ --title\ Add\ PR\ create\ --body-file\ * ]]; then
    body_file="${cmd##* --body-file }"
    cat "$body_file" >> "$GH_BODY_LOG"
    printf '\n---\n' >> "$GH_BODY_LOG"
    echo "https://github.com/michaelblum/agent-os/pull/433"
    exit 0
fi
if [[ "$cmd" == "pr view https://github.com/michaelblum/agent-os/pull/433 --repo michaelblum/agent-os --json number,url,state,headRefName,baseRefName" ]]; then
    echo '{"number":433,"url":"https://github.com/michaelblum/agent-os/pull/433","state":"OPEN","headRefName":"foreman/dev-gh-pr-create-v0","baseRefName":"main"}'
    exit 0
fi
if [[ "$cmd" == pr\ merge\ 410\ --repo\ michaelblum/agent-os\ --merge\ --match-head-commit\ abc123\ --body-file\ * ]]; then
    echo "Merged pull request #410"
    exit 0
fi
if [[ "$cmd" == "run view 987 --repo michaelblum/agent-os --log-failed" ]]; then
    echo "unit failed log"
    exit 0
fi
if [[ "$cmd" == "run view 988 --repo michaelblum/agent-os --log-failed" ]]; then
    echo "lint failed log"
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

if ERR="$(node scripts/aos-dev-gh.mjs context --repo --json 2>&1 >/dev/null)"; then
    fail "dev gh context should reject missing --repo values before a flag"
elif echo "$ERR" | grep -q -- '--repo requires a GitHub repository'; then
    pass "dev gh context treats flag-after---repo as missing value"
else
    fail "dev gh context missing --repo error mismatch: $ERR"
fi

if ERR="$(./aos dev gh issue view 298 extra --json 2>&1 >/dev/null)"; then
    fail "dev gh issue view should reject extra positional args"
elif echo "$ERR" | grep -q 'Unknown dev gh issue argument: extra'; then
    pass "dev gh issue view rejects extra positional args"
else
    fail "dev gh issue view extra positional error mismatch: $ERR"
fi

: > "$GH_ARGS_LOG"
if OUT="$(./aos dev gh issue view 298 2>/dev/null)" &&
   echo "$OUT" | grep -q "#298 Governance ledger" &&
   grep -q "issue view 298 --repo michaelblum/agent-os --json number,title,state,url,body,labels,comments --template" "$GH_ARGS_LOG" &&
   ! grep -q "projectCards" "$GH_ARGS_LOG"; then
    pass "dev gh issue view avoids deprecated projectCards on non-json output"
else
    fail "dev gh issue view did not force safe non-json fields"
fi

if OUT="$(./aos dev gh issue list --state all --limit 20 --label bug --label docs --search "semantic target" --milestone v0 --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data[0]["number"] == 399, data
assert data[0]["state"] == "CLOSED", data
PY
then
    pass "dev gh issue list forwards filtered inventory queries"
else
    fail "dev gh issue list did not forward expected filtered query"
fi

if ERR="$(./aos dev gh issue list --limit --json 2>&1 >/dev/null)"; then
    fail "dev gh issue list should reject missing --limit values before a flag"
elif echo "$ERR" | grep -q -- '--limit requires a numeric result limit'; then
    pass "dev gh issue list treats flag-after---limit as missing value"
else
    fail "dev gh issue list missing --limit error mismatch: $ERR"
fi

if ERR="$(./aos dev gh issue view 298 --state all --json 2>&1 >/dev/null)"; then
    fail "dev gh issue view should reject list-only flags with a targeted error"
elif echo "$ERR" | grep -q -- '--state is only valid for list subcommands'; then
    pass "dev gh issue view rejects list-only flags with a targeted error"
else
    fail "dev gh issue view list-only flag error mismatch: $ERR"
fi

if ERR="$(./aos dev gh issue list --base main --json 2>&1 >/dev/null)"; then
    fail "dev gh issue list should reject PR-only flags"
elif echo "$ERR" | grep -q -- 'Unknown dev gh flag: --base'; then
    pass "dev gh issue list rejects PR-only flags"
else
    fail "dev gh issue list PR-only flag error mismatch: $ERR"
fi

BODY="$TMPDIR/comment.md"
printf 'accepted state\n' > "$BODY"
: > "$GH_ARGS_LOG"
: > "$GH_BODY_LOG"
if OUT="$(./aos dev gh issue comment 298 --body-file "$BODY" 2>/dev/null)" &&
   grep -q "issue comment 298 --repo michaelblum/agent-os --body-file $BODY" "$GH_ARGS_LOG" &&
   grep -q "accepted state" "$GH_BODY_LOG" &&
   echo "$OUT" | grep -q "issuecomment-test"; then
    pass "dev gh issue comment shells out to gh with body-file"
else
    fail "dev gh issue comment did not shell out through expected gh invocation"
fi

: > "$GH_ARGS_LOG"
: > "$GH_BODY_LOG"
if OUT="$(printf 'stdin accepted\n' | ./aos dev gh issue comment 298 --body-file - 2>/dev/null)" &&
   grep -q "issue comment 298 --repo michaelblum/agent-os --body-file " "$GH_ARGS_LOG" &&
   ! grep -q -- "--body-file -" "$GH_ARGS_LOG" &&
   grep -q "stdin accepted" "$GH_BODY_LOG" &&
   echo "$OUT" | grep -q "issuecomment-test"; then
    pass "dev gh issue comment materializes stdin body-file"
else
    fail "dev gh issue comment did not materialize stdin body-file"
fi

: > "$GH_ARGS_LOG"
: > "$GH_BODY_LOG"
if OUT="$(printf 'dev stdin accepted\n' | ./aos dev gh issue comment 298 --body-file /dev/stdin 2>/dev/null)" &&
   grep -q "issue comment 298 --repo michaelblum/agent-os --body-file " "$GH_ARGS_LOG" &&
   ! grep -q -- "--body-file /dev/stdin" "$GH_ARGS_LOG" &&
   grep -q "dev stdin accepted" "$GH_BODY_LOG" &&
   echo "$OUT" | grep -q "issuecomment-test"; then
    pass "dev gh issue comment materializes /dev/stdin body-file"
else
    fail "dev gh issue comment did not materialize /dev/stdin body-file"
fi

if ERR="$(./aos dev gh issue comment 298 extra --body-file "$BODY" 2>&1 >/dev/null)"; then
    fail "dev gh issue comment should reject extra positional args"
elif echo "$ERR" | grep -q 'Unknown dev gh issue argument: extra'; then
    pass "dev gh issue comment rejects extra positional args"
else
    fail "dev gh issue comment extra positional error mismatch: $ERR"
fi

if ERR="$(./aos dev gh issue comment 298 --body-file --json 2>&1 >/dev/null)"; then
    fail "dev gh issue comment should reject missing --body-file values before a flag"
elif echo "$ERR" | grep -q -- '--body-file requires a path or -'; then
    pass "dev gh issue comment treats flag-after---body-file as missing value"
else
    fail "dev gh issue comment missing --body-file error mismatch: $ERR"
fi

: > "$GH_ARGS_LOG"
if OUT="$(./aos dev gh issue create --title "Strategic follow-up" --body-file "$BODY" --label governance --label follow-up --assignee @me --milestone v1 2>/dev/null)" &&
   grep -q "issue create --repo michaelblum/agent-os --title Strategic follow-up --body-file $BODY --label governance --label follow-up --assignee @me --milestone v1" "$GH_ARGS_LOG" &&
   echo "$OUT" | grep -q "issues/411"; then
    pass "dev gh issue create shells out to gh with title and body-file"
else
    fail "dev gh issue create did not shell out through expected gh invocation"
fi

if ERR="$(./aos dev gh issue create --body-file "$BODY" 2>&1 >/dev/null)"; then
    fail "dev gh issue create should require --title"
elif echo "$ERR" | grep -q -- 'dev gh issue create requires --title <title>'; then
    pass "dev gh issue create requires an explicit title"
else
    fail "dev gh issue create missing title error mismatch: $ERR"
fi

if ERR="$(./aos dev gh issue create --title "Strategic follow-up" --body-file --json 2>&1 >/dev/null)"; then
    fail "dev gh issue create should reject missing --body-file values before a flag"
elif echo "$ERR" | grep -q -- '--body-file requires a path or -'; then
    pass "dev gh issue create treats flag-after---body-file as missing value"
else
    fail "dev gh issue create missing --body-file error mismatch: $ERR"
fi

if ERR="$(./aos dev gh issue create --title "Strategic follow-up" --body-file "$TMPDIR/missing-issue-body.md" 2>&1 >/dev/null)"; then
    fail "dev gh issue create should reject missing body files"
elif echo "$ERR" | grep -q -- 'Missing issue body file:'; then
    pass "dev gh issue create rejects missing body files"
else
    fail "dev gh issue create missing body file error mismatch: $ERR"
fi

: > "$GH_ARGS_LOG"
if OUT="$(./aos dev gh issue close 411 --reason completed 2>/dev/null)" &&
   grep -q "issue close 411 --repo michaelblum/agent-os --reason completed" "$GH_ARGS_LOG" &&
   echo "$OUT" | grep -q "Closed issue"; then
    pass "dev gh issue close shells out with explicit reason"
else
    fail "dev gh issue close did not shell out through expected gh invocation"
fi

if ERR="$(./aos dev gh issue close current --reason completed 2>&1 >/dev/null)"; then
    fail "dev gh issue close should require a numeric issue"
elif echo "$ERR" | grep -q -- 'Issue number must be numeric for close: current'; then
    pass "dev gh issue close rejects non-numeric issues"
else
    fail "dev gh issue close non-numeric issue error mismatch: $ERR"
fi

if ERR="$(./aos dev gh issue close 411 --body-file "$BODY" 2>&1 >/dev/null)"; then
    fail "dev gh issue close should reject body files"
elif echo "$ERR" | grep -q -- 'dev gh issue close does not accept --body-file'; then
    pass "dev gh issue close rejects body files"
else
    fail "dev gh issue close body-file error mismatch: $ERR"
fi

: > "$GH_ARGS_LOG"
if OUT="$(./aos dev gh issue edit 407 --remove-label lane:active --add-label lane:parked --add-assignee @me --remove-assignee old-owner --milestone v1 --title "Parked ledger" --body-file "$BODY" 2>/dev/null)" &&
   grep -q "issue edit 407 --repo michaelblum/agent-os --remove-label lane:active --add-label lane:parked --add-assignee @me --remove-assignee old-owner --milestone v1 --title Parked ledger --body-file $BODY" "$GH_ARGS_LOG" &&
   echo "$OUT" | grep -q "issues/407"; then
    pass "dev gh issue edit shells out with explicit lifecycle flags"
else
    fail "dev gh issue edit did not shell out through expected gh invocation"
fi

if ERR="$(./aos dev gh issue edit 2>&1 >/dev/null)"; then
    fail "dev gh issue edit should require an issue number"
elif echo "$ERR" | grep -q -- 'dev gh issue edit requires exactly one issue number'; then
    pass "dev gh issue edit requires an issue number"
else
    fail "dev gh issue edit missing issue error mismatch: $ERR"
fi

if ERR="$(./aos dev gh issue edit current --add-label lane:parked 2>&1 >/dev/null)"; then
    fail "dev gh issue edit should require a numeric issue"
elif echo "$ERR" | grep -q -- 'Issue number must be numeric for edit: current'; then
    pass "dev gh issue edit rejects non-numeric issues"
else
    fail "dev gh issue edit non-numeric issue error mismatch: $ERR"
fi

if ERR="$(./aos dev gh issue edit 407 2>&1 >/dev/null)"; then
    fail "dev gh issue edit should reject no-op edits"
elif echo "$ERR" | grep -q -- 'dev gh issue edit requires at least one edit flag'; then
    pass "dev gh issue edit rejects no-op edits"
else
    fail "dev gh issue edit no-op error mismatch: $ERR"
fi

if ERR="$(./aos dev gh issue edit 407 --body-file "$TMPDIR/missing-issue-edit-body.md" 2>&1 >/dev/null)"; then
    fail "dev gh issue edit should reject missing body files"
elif echo "$ERR" | grep -q -- 'Missing issue body file:'; then
    pass "dev gh issue edit rejects missing body files"
else
    fail "dev gh issue edit missing body file error mismatch: $ERR"
fi

if OUT="$(./aos dev gh label list --limit 10 --search governance --sort name --order desc --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data[0]["name"] == "governance", data
assert data[0]["isDefault"] is False, data
PY
then
    pass "dev gh label list forwards filtered label inventory queries"
else
    fail "dev gh label list did not forward expected filtered query"
fi

if ERR="$(./aos dev gh label list --limit --json 2>&1 >/dev/null)"; then
    fail "dev gh label list should reject missing --limit values before a flag"
elif echo "$ERR" | grep -q -- '--limit requires a numeric result limit'; then
    pass "dev gh label list treats flag-after---limit as missing value"
else
    fail "dev gh label list missing --limit error mismatch: $ERR"
fi

if ERR="$(./aos dev gh label list --label bug --json 2>&1 >/dev/null)"; then
    fail "dev gh label list should reject issue-list label filters"
elif echo "$ERR" | grep -q -- '--label is only valid for issue create and issue/PR list subcommands'; then
    pass "dev gh label list rejects issue-list label filters"
else
    fail "dev gh label list label filter error mismatch: $ERR"
fi

if ERR="$(./aos dev gh pr comment 298 extra --body-file "$BODY" 2>&1 >/dev/null)"; then
    fail "dev gh pr comment should reject extra positional args"
elif echo "$ERR" | grep -q 'Unknown dev gh pr argument: extra'; then
    pass "dev gh pr comment rejects extra positional args"
else
    fail "dev gh pr comment extra positional error mismatch: $ERR"
fi

if OUT="$(./aos dev gh pr list --state all --limit 30 --author michaelblum --base main --head gdi/example --draft --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data[0]["number"] == 404, data
assert data[0]["headRefName"] == "gdi/example", data
assert data[0]["isDraft"] is True, data
PY
then
    pass "dev gh pr list forwards filtered PR inventory queries"
else
    fail "dev gh pr list did not forward expected filtered query"
fi

if ERR="$(./aos dev gh pr list --base --json 2>&1 >/dev/null)"; then
    fail "dev gh pr list should reject missing --base values before a flag"
elif echo "$ERR" | grep -q -- '--base requires a base branch name'; then
    pass "dev gh pr list treats flag-after---base as missing value"
else
    fail "dev gh pr list missing --base error mismatch: $ERR"
fi

if OUT="$(./aos dev gh pr view 298 --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["number"] == 298, data
assert data["reviewDecision"] == "CHANGES_REQUESTED", data
PY
then
    pass "dev gh pr view includes reviewDecision in JSON output"
else
    fail "dev gh pr view did not request reviewDecision JSON"
fi

: > "$GH_ARGS_LOG"
: > "$GH_BODY_LOG"
if OUT="$(./aos dev gh pr create --base main --head foreman/dev-gh-pr-create-v0 --title "Add PR create" --body-file "$BODY" --json 2>/dev/null)" &&
   OUT="$OUT" python3 - <<'PY' &&
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert data["authority"] == "gh_cli", data
assert data["number"] == 433, data
assert data["url"] == "https://github.com/michaelblum/agent-os/pull/433", data
assert data["state"] == "OPEN", data
assert data["head"] == "foreman/dev-gh-pr-create-v0", data
assert data["base"] == "main", data
PY
   grep -q "pr create --repo michaelblum/agent-os --base main --head foreman/dev-gh-pr-create-v0 --title Add PR create --body-file $BODY" "$GH_ARGS_LOG" &&
   grep -q "pr view https://github.com/michaelblum/agent-os/pull/433 --repo michaelblum/agent-os --json number,url,state,headRefName,baseRefName" "$GH_ARGS_LOG" &&
   grep -q "accepted state" "$GH_BODY_LOG" &&
   ! grep -q "accepted state" "$GH_ARGS_LOG"; then
    pass "dev gh pr create shells out with body-file and returns JSON readback"
else
    fail "dev gh pr create did not dispatch through expected body-file flow"
fi

if ERR="$(./aos dev gh pr create --base main --head foreman/dev-gh-pr-create-v0 --body-file "$BODY" --json 2>&1 >/dev/null)"; then
    fail "dev gh pr create should require --title"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["code"] == "MISSING_ARG", data
assert data["error"] == "dev gh pr create requires --title <title>", data
PY
then
    pass "dev gh pr create requires structured --title"
else
    fail "dev gh pr create missing title error mismatch: $ERR"
fi

if ERR="$(./aos dev gh pr create --head foreman/dev-gh-pr-create-v0 --title "Add PR create" --body-file "$BODY" --json 2>&1 >/dev/null)"; then
    fail "dev gh pr create should require --base"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["code"] == "MISSING_ARG", data
assert data["error"] == "dev gh pr create requires --base <branch>", data
PY
then
    pass "dev gh pr create requires structured --base"
else
    fail "dev gh pr create missing base error mismatch: $ERR"
fi

if ERR="$(./aos dev gh pr create --base main --title "Add PR create" --body-file "$BODY" --json 2>&1 >/dev/null)"; then
    fail "dev gh pr create should require --head"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["code"] == "MISSING_ARG", data
assert data["error"] == "dev gh pr create requires --head <branch>", data
PY
then
    pass "dev gh pr create requires structured --head"
else
    fail "dev gh pr create missing head error mismatch: $ERR"
fi

if ERR="$(./aos dev gh pr create --base main --head foreman/dev-gh-pr-create-v0 --title "Add PR create" --json 2>&1 >/dev/null)"; then
    fail "dev gh pr create should require --body-file"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["code"] == "MISSING_ARG", data
assert data["error"] == "dev gh pr create requires --body-file <path|->", data
PY
then
    pass "dev gh pr create requires structured --body-file"
else
    fail "dev gh pr create missing body-file error mismatch: $ERR"
fi

if ERR="$(./aos dev gh pr create --base main --head foreman/dev-gh-pr-create-v0 --title "Add PR create" --body-file --json 2>&1 >/dev/null)"; then
    fail "dev gh pr create should reject missing --body-file values before a flag"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["code"] == "MISSING_ARG", data
assert data["error"] == "--body-file requires a path or -", data
PY
then
    pass "dev gh pr create treats flag-after---body-file as structured missing value"
else
    fail "dev gh pr create missing body-file value error mismatch: $ERR"
fi

: > "$GH_ARGS_LOG"
if OUT="$(./aos dev gh pr merge 410 --merge --match-head-commit abc123 --body-file "$BODY" 2>/dev/null)" &&
   grep -q "pr merge 410 --repo michaelblum/agent-os --merge --match-head-commit abc123 --body-file $BODY" "$GH_ARGS_LOG" &&
   echo "$OUT" | grep -q "Merged pull request #410"; then
    pass "dev gh pr merge shells out with explicit strategy and head guard"
else
    fail "dev gh pr merge did not shell out through expected gh invocation"
fi

if ERR="$(./aos dev gh pr merge 410 --match-head-commit abc123 2>&1 >/dev/null)"; then
    fail "dev gh pr merge should require an explicit merge strategy"
elif echo "$ERR" | grep -q -- 'dev gh pr merge requires one of --squash, --merge, or --rebase'; then
    pass "dev gh pr merge requires an explicit strategy"
else
    fail "dev gh pr merge missing strategy error mismatch: $ERR"
fi

if ERR="$(./aos dev gh pr merge 410 --merge --squash 2>&1 >/dev/null)"; then
    fail "dev gh pr merge should reject multiple merge strategies"
elif echo "$ERR" | grep -q -- 'dev gh pr merge accepts exactly one merge strategy'; then
    pass "dev gh pr merge rejects multiple strategies"
else
    fail "dev gh pr merge multiple strategy error mismatch: $ERR"
fi

if ERR="$(./aos dev gh pr merge current --merge 2>&1 >/dev/null)"; then
    fail "dev gh pr merge should require a numeric PR"
elif echo "$ERR" | grep -q -- 'PR number must be numeric for merge: current'; then
    pass "dev gh pr merge rejects non-numeric PR identifiers"
else
    fail "dev gh pr merge non-numeric PR error mismatch: $ERR"
fi

if ERR="$(./aos dev gh pr merge 410 --merge --auto 2>&1 >/dev/null)"; then
    fail "dev gh pr merge should reject --auto"
elif echo "$ERR" | grep -q -- 'Unknown dev gh flag: --auto'; then
    pass "dev gh pr merge rejects --auto"
else
    fail "dev gh pr merge --auto error mismatch: $ERR"
fi

if ERR="$(./aos dev gh pr merge 410 --merge --delete-branch 2>&1 >/dev/null)"; then
    fail "dev gh pr merge should reject --delete-branch"
elif echo "$ERR" | grep -q -- 'Unknown dev gh flag: --delete-branch'; then
    pass "dev gh pr merge rejects --delete-branch"
else
    fail "dev gh pr merge --delete-branch error mismatch: $ERR"
fi

if ERR="$(./aos dev gh pr merge 410 --merge --body-file "$TMPDIR/missing-pr-merge-body.md" 2>&1 >/dev/null)"; then
    fail "dev gh pr merge should reject missing body files"
elif echo "$ERR" | grep -q -- 'Missing PR merge body file:'; then
    pass "dev gh pr merge rejects missing body files"
else
    fail "dev gh pr merge missing body file error mismatch: $ERR"
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

if ERR="$(./aos dev gh ci inspect --pr --json 2>&1 >/dev/null)"; then
    fail "dev gh ci inspect should reject missing --pr values before a flag"
elif echo "$ERR" | grep -q -- '--pr requires a PR number'; then
    pass "dev gh ci inspect treats flag-after---pr as missing value"
else
    fail "dev gh ci inspect missing --pr error mismatch: $ERR"
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

if OUT="$(./aos dev gh ci inspect --pr 299 --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "success", data
assert data["checks_exit_code"] == 1, data
assert "checks failed" in data["checks_stderr"], data
assert data["checks"][0]["name"] == "lint", data
assert data["failed_logs"][0]["source"] == "github_actions", data
assert data["failed_logs"][0]["run_id"] == "988", data
assert "lint failed log" in data["failed_logs"][0]["stdout"], data
PY
then
    pass "dev gh ci inspect captures logs when pr checks exits non-zero with JSON"
else
    fail "dev gh ci inspect skipped logs after non-zero pr checks"
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
