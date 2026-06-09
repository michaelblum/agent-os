#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-agents-runner.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

FIXTURE="$TMP_ROOT/repo"
FIXTURE_REAL=""
MISSING_SDK="$TMP_ROOT/missing-sdk"
PRESENT_SDK="$TMP_ROOT/present-sdk"
FAILING_SDK="$TMP_ROOT/failing-sdk"
SDK_RECORD="$TMP_ROOT/sdk-record.json"
AOS_CLEANUP_TARGET="$TMP_ROOT/aos-output-dir.txt"
AOS_PATCH_CLEANUP_TARGET="$TMP_ROOT/aos-patch-output-dir.txt"
RUNNER_READ_TARGET="$TMP_ROOT/runner-output-dir.txt"
RUNNER_PATCH_TARGET="$TMP_ROOT/runner-patch-output-dir.txt"
mkdir -p "$FIXTURE/.codex/agents" "$FIXTURE/.docks/profiles/base" "$FIXTURE/scripts/aos_agents" "$MISSING_SDK" "$PRESENT_SDK" "$FAILING_SDK"
FIXTURE_REAL="$(cd "$FIXTURE" && pwd -P)"
printf 'main checkout sentinel\n' >"$FIXTURE/main-checkout-sentinel.txt"
cat >"$FIXTURE/scripts/aos_agents/README.md" <<'EOF'
# Fixture AOS Agent Runner

The M1 read-only parity proof is recorded in the fixture report.
EOF

cat >"$MISSING_SDK/agents.py" <<'PY'
raise ModuleNotFoundError("forced missing agents SDK for aos agent runner test")
PY

cat >"$PRESENT_SDK/agents.py" <<'PY'
import json
import os
from pathlib import Path

tracing_disabled = False


class Agent:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


class Result:
    def __init__(self, final_output):
        self.final_output = final_output


class Runner:
    @staticmethod
    def run_sync(starting_agent, input, **kwargs):
        final_output = "fake provider final output"
        if starting_agent.kwargs.get("name") == "implementer":
            if os.environ.get("AOS_AGENT_FAKE_SDK_PATCH_FAILURE") == "1":
                final_output = "not a unified diff\nIMPLEMENTER DONE. no files changed"
            else:
                final_output = """diff --git a/docs/example.md b/docs/example.md
new file mode 100644
index 0000000..8ab686e
--- /dev/null
+++ b/docs/example.md
@@ -0,0 +1 @@
+patch artifact smoke
"""
        Path(os.environ["AOS_AGENT_FAKE_SDK_RECORD"]).write_text(
            json.dumps(
                {
                    "agent": starting_agent.kwargs,
                    "input": input,
                    "kwargs": kwargs,
                    "tracing_disabled": tracing_disabled,
                    "tracing_env": os.environ.get("OPENAI_AGENTS_DISABLE_TRACING"),
                },
                sort_keys=True,
            )
        )
        return Result(final_output)


def set_tracing_disabled(value):
    global tracing_disabled
    tracing_disabled = bool(value)
PY

cat >"$FAILING_SDK/agents.py" <<'PY'
tracing_disabled = False


class Agent:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


class Runner:
    @staticmethod
    def run_sync(starting_agent, input, **kwargs):
        raise RuntimeError("fake provider boom")


def set_tracing_disabled(value):
    global tracing_disabled
    tracing_disabled = bool(value)
PY

for role in explorer reviewer validator historian; do
    cat >"$FIXTURE/.codex/agents/$role.toml" <<EOF
name = "$role"
model = "test-model"
model_reasoning_effort = "low"
sandbox_mode = "read-only"
description = "$role fixture"
developer_instructions = """
Read-only fixture instructions for $role.
"""
EOF
done

cat >"$FIXTURE/.codex/agents/implementer.toml" <<'EOF'
name = "implementer"
model = "test-model"
description = "write-capable fixture"
developer_instructions = """
Write-capable fixture instructions.
"""
EOF

cat >"$FIXTURE/.docks/profiles/active-profile.json" <<'EOF'
{
  "schema_version": 1,
  "active_profile": "test-profile",
  "profile_packs": ["base"],
  "header": {
    "profile": "test"
  }
}
EOF

cat >"$FIXTURE/.docks/profiles/base/profile.md" <<'EOF'
# Test Profile

Read-only fixture profile.
EOF

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; exit 1; }

python3 - <<'PY'
import json
from pathlib import Path

schema = json.loads(Path("docs/dev/aos-agents-summary.schema.json").read_text())
assert schema["$schema"] == "http://json-schema.org/draft-07/schema#", schema
assert schema["properties"]["status"]["enum"] == ["ready", "completed", "error"], schema
assert set(schema["required"]) == {
    "schema_version",
    "status",
    "role",
    "agent_spec",
    "active_profile",
    "task_hash",
    "execute",
    "max_turns",
    "base_commit",
    "target_branch",
    "output_dir",
    "summary_path",
}, schema
assert "implementer" in schema["properties"]["role"]["enum"], schema
assert "context_files" in schema["properties"], schema
error_clause = schema["allOf"][2]["then"]
assert error_clause["not"] == {"required": ["patch_path"]}, schema
PY
pass "summary schema documents the runtime artifact contract"

if SELF_TEST="$(python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --self-test)"; then
    SELF_TEST="$SELF_TEST" FIXTURE="$FIXTURE" python3 - <<'PY'
import json
import os
from pathlib import Path

data = json.loads(os.environ["SELF_TEST"])
fixture = Path(os.environ["FIXTURE"]).resolve()
runtime_root = fixture / ".runtime/dev/aos-agents"
assert data["self_test"] == "pass", data
assert data["runtime_root"] == str(runtime_root), data
assert set(data["roles"]) == {"explorer", "reviewer", "validator", "historian"}, data
assert all(role["sandbox_mode"] == "read-only" for role in data["roles"].values()), data
sample = Path(data["sample_output_dir"])
assert sample.is_relative_to(runtime_root), sample
PY
    pass "self-test loads only explicit read-only roles"
else
    fail "self-test failed"
fi

if ERR="$(PYTHONPATH="$MISSING_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --role implementer --task "write check" 2>&1 >/dev/null)"; then
    fail "write-capable implementer role unexpectedly succeeded"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["status"] == "error", data
assert "Role 'implementer' is not enabled" in data["error"], data
PY
then
    [ ! -e "$FIXTURE/.runtime" ] || fail "implementer rejection created runtime state"
    pass "write-capable roles are rejected before runtime mutation"
else
    fail "implementer rejection error was not clear JSON"
fi

if ERR="$(PYTHONPATH="$MISSING_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --role implementer --task "patch check" --patch-output 2>&1 >/dev/null)"; then
    fail "implementer patch-output without execute unexpectedly succeeded"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["status"] == "error", data
assert "--patch-output requires --execute" in data["error"], data
PY
then
    pass "patch-output mode requires explicit provider execution"
else
    fail "patch-output without execute error was not clear JSON"
fi

if ERR="$(PYTHONPATH="$MISSING_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --role explorer --task "context needs patch output" --context-file scripts/aos_agents/README.md 2>&1 >/dev/null)"; then
    fail "context-file without patch-output unexpectedly succeeded"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["status"] == "error", data
assert "--context-file is only enabled with --patch-output" in data["error"], data
PY
then
    pass "context-file is restricted to patch-output mode"
else
    fail "context-file without patch-output error was not clear JSON"
fi

if ERR="$(PYTHONPATH="$MISSING_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --role implementer --task "bad context traversal" --context-file ../outside.md --patch-output --execute 2>&1 >/dev/null)"; then
    fail "context-file traversal unexpectedly succeeded"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["status"] == "error", data
assert "--context-file escaped repo root" in data["error"], data
PY
then
    pass "context-file rejects path traversal before provider execution"
else
    fail "context-file traversal error was not clear JSON"
fi

if ERR="$(PYTHONPATH="$MISSING_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --role implementer --task "bad absolute context" --context-file "$TMP_ROOT/outside.md" --patch-output --execute 2>&1 >/dev/null)"; then
    fail "absolute context-file unexpectedly succeeded"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["status"] == "error", data
assert "--context-file must be repo-relative" in data["error"], data
PY
then
    pass "context-file rejects absolute paths outside repo"
else
    fail "absolute context-file error was not clear JSON"
fi

if ERR="$(PYTHONPATH="$MISSING_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --role explorer --task "sdk missing check" 2>&1 >/dev/null)"; then
    fail "missing SDK path unexpectedly succeeded"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["status"] == "error", data
assert "OpenAI Agents SDK is not installed" in data["error"], data
assert "Install it outside this runner" in data["error"], data
PY
then
    [ ! -e "$FIXTURE/.runtime" ] || fail "SDK-missing path created runtime state"
    pass "SDK-missing failure is clear and non-mutating"
else
    fail "SDK-missing error was not clear JSON"
fi

if READY="$(PYTHONPATH="$PRESENT_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --role explorer --task "../../unsafe output task")"; then
    READY="$READY" FIXTURE="$FIXTURE" python3 - <<'PY'
import json
import os
from pathlib import Path

data = json.loads(os.environ["READY"])
fixture = Path(os.environ["FIXTURE"]).resolve()
runtime_root = fixture / ".runtime/dev/aos-agents"
output_dir = Path(data["output_dir"])
summary_path = Path(data["summary_path"])
assert data["status"] == "ready", data
assert output_dir.is_dir(), output_dir
assert output_dir.is_relative_to(runtime_root), output_dir
assert summary_path == output_dir / "summary.json", data
summary_doc = json.loads(summary_path.read_text())
assert summary_doc["schema_version"] == 1, summary_doc
assert summary_doc["status"] == "ready", summary_doc
assert summary_doc["execute"] is False, summary_doc
assert summary_doc["task_hash"] == "64375183f2e5", summary_doc
assert ".." not in output_dir.name, output_dir
assert output_dir.name == "unsafe-output-task-64375183f2e5", output_dir
assert not (output_dir / "result.json").exists(), output_dir
PY
    pass "provider-ready skeleton plans only inside deterministic runtime path"
else
    fail "provider-ready skeleton failed with import sentinel"
fi

if EXECUTED="$(AOS_AGENT_FAKE_SDK_RECORD="$SDK_RECORD" PYTHONPATH="$PRESENT_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --role explorer --task "execute read-only task" --execute --max-turns 1)"; then
    EXECUTED="$EXECUTED" FIXTURE="$FIXTURE" SDK_RECORD="$SDK_RECORD" RUNNER_READ_TARGET="$RUNNER_READ_TARGET" python3 - <<'PY'
import json
import os
from pathlib import Path

data = json.loads(os.environ["EXECUTED"])
fixture = Path(os.environ["FIXTURE"]).resolve()
runtime_root = fixture / ".runtime/dev/aos-agents"
output_dir = Path(data["output_dir"])
result_path = Path(data["result_path"])
summary_path = Path(data["summary_path"])
assert data["status"] == "completed", data
assert data["final_output"] == "fake provider final output", data
assert output_dir.is_dir(), output_dir
assert output_dir.is_relative_to(runtime_root), output_dir
assert result_path == output_dir / "result.json", data
assert summary_path == output_dir / "summary.json", data
summary_doc = json.loads(summary_path.read_text())
assert summary_doc["schema_version"] == 1, summary_doc
assert summary_doc["status"] == "completed", summary_doc
assert summary_doc["execute"] is True, summary_doc
assert summary_doc["result_path"] == str(result_path), summary_doc
result_doc = json.loads(result_path.read_text())
assert result_doc["status"] == "completed", result_doc
assert result_doc["final_output"] == "fake provider final output", result_doc
assert result_doc["max_turns"] == 1, result_doc
record = json.loads(Path(os.environ["SDK_RECORD"]).read_text())
assert record["agent"]["name"] == "explorer", record
assert record["agent"]["model"] == "test-model", record
assert "Read-only fixture instructions for explorer." in record["agent"]["instructions"], record
assert "Read-only fixture profile." in record["agent"]["instructions"], record
assert record["input"] == "execute read-only task", record
assert record["kwargs"] == {"max_turns": 1}, record
assert record["tracing_disabled"] is True, record
assert record["tracing_env"] == "1", record
Path(os.environ["RUNNER_READ_TARGET"]).write_text(str(output_dir))
PY
    pass "provider execution uses guarded SDK adapter and writes result.json under runtime path"
else
    fail "provider execution failed with fake SDK"
fi

if PATCHED="$(AOS_AGENT_FAKE_SDK_RECORD="$SDK_RECORD" PYTHONPATH="$PRESENT_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --role implementer --task "produce trivial patch" --patch-output --execute --max-turns 1)"; then
    PATCHED="$PATCHED" FIXTURE="$FIXTURE" SDK_RECORD="$SDK_RECORD" python3 - <<'PY'
import json
import os
from pathlib import Path

data = json.loads(os.environ["PATCHED"])
fixture = Path(os.environ["FIXTURE"]).resolve()
runtime_root = fixture / ".runtime/dev/aos-agents"
output_dir = Path(data["output_dir"])
summary_path = Path(data["summary_path"])
result_path = Path(data["result_path"])
patch_path = Path(data["patch_path"])
assert data["status"] == "completed", data
assert data["role"] == "implementer", data
assert output_dir.is_relative_to(runtime_root), output_dir
assert output_dir.parent == runtime_root / "runs" / "implementer", output_dir
assert summary_path == output_dir / "summary.json", data
assert result_path == output_dir / "result.json", data
assert patch_path == output_dir / "patch.diff", data
assert patch_path.is_file(), patch_path
assert patch_path.read_text().startswith("diff --git a/docs/example.md b/docs/example.md"), patch_path.read_text()
assert data["touched_paths"] == ["docs/example.md"], data
summary_doc = json.loads(summary_path.read_text())
assert summary_doc["status"] == "completed", summary_doc
assert summary_doc["role"] == "implementer", summary_doc
assert summary_doc["base_commit"], summary_doc
assert summary_doc["target_branch"], summary_doc
assert summary_doc["patch_path"] == str(patch_path), summary_doc
assert summary_doc["touched_paths"] == ["docs/example.md"], summary_doc
assert summary_doc["suggested_review_command"] == f"git apply --check {patch_path}", summary_doc
assert summary_doc["suggested_apply_command"] == f"git apply {patch_path}", summary_doc
result_doc = json.loads(result_path.read_text())
assert result_doc["status"] == "completed", result_doc
assert result_doc["patch_path"] == str(patch_path), result_doc
assert result_doc["touched_paths"] == ["docs/example.md"], result_doc
record = json.loads(Path(os.environ["SDK_RECORD"]).read_text())
assert record["agent"]["name"] == "implementer", record
instructions = record["agent"]["instructions"]
assert "Patch-Only Output Contract" in instructions, record
assert "Return a true unified diff only" in instructions, record
assert "overrides any role instruction to include IMPLEMENTER DONE" in instructions, record
assert "must start with `diff --git a/... b/...`" in instructions, record
assert "include `--- a/...`" in instructions, record
assert "include `+++ b/...`" in instructions, record
assert "include `@@` hunks" in instructions, record
assert "no `*** Begin Patch`" in instructions, record
assert "no `*** Update File`" in instructions, record
assert "no `apply_patch`" in instructions, record
assert "Do not include prose before or after the diff" in instructions, record
assert "Do not wrap the diff in Markdown fences" in instructions, record
assert "Source Context" not in instructions, record
assert (fixture / "main-checkout-sentinel.txt").read_text() == "main checkout sentinel\n"
assert not (fixture / "docs" / "example.md").exists()
PY
    pass "implementer patch-output writes patch artifacts under runtime root without checkout mutation"
else
    fail "implementer patch-output execution failed with fake SDK"
fi

if CONTEXT_PATCHED="$(AOS_AGENT_FAKE_SDK_RECORD="$SDK_RECORD" PYTHONPATH="$PRESENT_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --role implementer --task "produce contextual patch" --context-file scripts/aos_agents/README.md --patch-output --execute --max-turns 1)"; then
    CONTEXT_PATCHED="$CONTEXT_PATCHED" FIXTURE="$FIXTURE" SDK_RECORD="$SDK_RECORD" RUNNER_PATCH_TARGET="$RUNNER_PATCH_TARGET" python3 - <<'PY'
import json
import os
from pathlib import Path

data = json.loads(os.environ["CONTEXT_PATCHED"])
fixture = Path(os.environ["FIXTURE"]).resolve()
runtime_root = fixture / ".runtime/dev/aos-agents"
output_dir = Path(data["output_dir"])
summary_path = Path(data["summary_path"])
result_path = Path(data["result_path"])
patch_path = Path(data["patch_path"])
assert data["status"] == "completed", data
assert data["context_files"] == ["scripts/aos_agents/README.md"], data
assert output_dir.is_relative_to(runtime_root), output_dir
assert patch_path == output_dir / "patch.diff", data
assert patch_path.is_file(), patch_path
summary_doc = json.loads(summary_path.read_text())
assert summary_doc["context_files"] == ["scripts/aos_agents/README.md"], summary_doc
result_doc = json.loads(result_path.read_text())
assert result_doc["context_files"] == ["scripts/aos_agents/README.md"], result_doc
record = json.loads(Path(os.environ["SDK_RECORD"]).read_text())
instructions = record["agent"]["instructions"]
assert "Source Context" in instructions, record
assert "BEGIN FILE scripts/aos_agents/README.md" in instructions, record
assert "The M1 read-only parity proof is recorded in the fixture report." in instructions, record
assert "END FILE scripts/aos_agents/README.md" in instructions, record
assert (fixture / "main-checkout-sentinel.txt").read_text() == "main checkout sentinel\n"
assert not (fixture / "docs" / "example.md").exists()
Path(os.environ["RUNNER_PATCH_TARGET"]).write_text(str(output_dir))
PY
    pass "implementer patch-output includes bounded repo source context without checkout mutation"
else
    fail "implementer patch-output with context failed with fake SDK"
fi

PATCH_ERROR_TASK="produce invalid patch output"
if ERR="$(AOS_AGENT_FAKE_SDK_RECORD="$SDK_RECORD" AOS_AGENT_FAKE_SDK_PATCH_FAILURE=1 PYTHONPATH="$PRESENT_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --role implementer --task "$PATCH_ERROR_TASK" --patch-output --execute --max-turns 1 2>&1 >/dev/null)"; then
    fail "implementer patch-output extraction failure unexpectedly succeeded"
elif ERR="$ERR" FIXTURE="$FIXTURE" PATCH_ERROR_TASK="$PATCH_ERROR_TASK" python3 - <<'PY'
import hashlib
import json
import os
from pathlib import Path

data = json.loads(os.environ["ERR"])
fixture = Path(os.environ["FIXTURE"]).resolve()
task = os.environ["PATCH_ERROR_TASK"]
task_hash = hashlib.sha256(task.encode("utf-8")).hexdigest()[:12]
runtime_root = fixture / ".runtime/dev/aos-agents"
output_dir = runtime_root / "runs/implementer" / f"produce-invalid-patch-output-{task_hash}"
summary_path = output_dir / "summary.json"
result_path = output_dir / "result.json"
patch_path = output_dir / "patch.diff"
assert data["status"] == "error", data
assert "Patch-output provider result did not contain a unified diff" in data["error"], data
assert output_dir.is_dir(), output_dir
assert summary_path.is_file(), summary_path
assert result_path.is_file(), result_path
assert not patch_path.exists(), patch_path
summary_doc = json.loads(summary_path.read_text())
assert summary_doc["status"] == "error", summary_doc
assert summary_doc["role"] == "implementer", summary_doc
assert summary_doc["error"] == data["error"], summary_doc
assert summary_doc["result_path"] == str(result_path), summary_doc
assert "patch_path" not in summary_doc, summary_doc
result_doc = json.loads(result_path.read_text())
assert result_doc["status"] == "error", result_doc
assert result_doc["role"] == "implementer", result_doc
assert result_doc["error"] == data["error"], result_doc
assert result_doc["extraction_error"] == "Patch-output provider result did not contain a unified diff", result_doc
assert result_doc["raw_final_output"] == "not a unified diff\nIMPLEMENTER DONE. no files changed", result_doc
assert "patch_path" not in result_doc, result_doc
assert (fixture / "main-checkout-sentinel.txt").read_text() == "main checkout sentinel\n"
assert not (fixture / "docs" / "example.md").exists()
PY
then
    pass "implementer patch-output extraction errors write inspectable result.json without patch or checkout mutation"
else
    fail "implementer patch-output extraction error did not produce diagnostic artifacts"
fi

ERROR_TASK="provider error task"
if ERR="$(PYTHONPATH="$FAILING_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --role explorer --task "$ERROR_TASK" --execute --max-turns 1 2>&1 >/dev/null)"; then
    fail "provider error path unexpectedly succeeded"
elif ERR="$ERR" FIXTURE="$FIXTURE" ERROR_TASK="$ERROR_TASK" python3 - <<'PY'
import hashlib
import json
import os
from pathlib import Path

data = json.loads(os.environ["ERR"])
fixture = Path(os.environ["FIXTURE"]).resolve()
task = os.environ["ERROR_TASK"]
task_hash = hashlib.sha256(task.encode("utf-8")).hexdigest()[:12]
output_dir = fixture / ".runtime/dev/aos-agents/runs/explorer" / f"provider-error-task-{task_hash}"
summary_path = output_dir / "summary.json"
result_path = output_dir / "result.json"
assert data["status"] == "error", data
assert "Provider execution failed: fake provider boom" in data["error"], data
assert output_dir.is_dir(), output_dir
assert summary_path.is_file(), summary_path
assert not result_path.exists(), result_path
summary_doc = json.loads(summary_path.read_text())
assert summary_doc["schema_version"] == 1, summary_doc
assert summary_doc["status"] == "error", summary_doc
assert summary_doc["execute"] is True, summary_doc
assert summary_doc["task_hash"] == task_hash, summary_doc
assert summary_doc["error"] == data["error"], summary_doc
assert "result_path" not in summary_doc, summary_doc
PY
then
    pass "provider execution errors write summary.json and no result.json"
else
    fail "provider error path did not produce clear JSON and error summary"
fi

if RUN_LIST="$(python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --list-runs)"; then
    RUN_LIST="$RUN_LIST" FIXTURE="$FIXTURE" python3 - <<'PY'
import json
import os
from pathlib import Path

data = json.loads(os.environ["RUN_LIST"])
fixture = Path(os.environ["FIXTURE"]).resolve()
runtime_root = fixture / ".runtime/dev/aos-agents"
assert data["status"] == "success", data
assert data["runtime_root"] == str(runtime_root), data
assert data["count"] == 6, data
statuses = {item["summary"]["status"] for item in data["runs"]}
assert statuses == {"ready", "completed", "error"}, data
assert any(item["role"] == "implementer" and item["summary"].get("patch_path") for item in data["runs"]), data
assert any(item["role"] == "implementer" and item["summary"].get("context_files") == ["scripts/aos_agents/README.md"] for item in data["runs"]), data
assert any(item["role"] == "implementer" and item["summary"]["status"] == "error" and item["result_exists"] for item in data["runs"]), data
assert all(Path(item["output_dir"]).is_relative_to(runtime_root) for item in data["runs"]), data
assert any(item["result_exists"] for item in data["runs"]), data
PY
    pass "artifact list readback enumerates existing runtime summaries without SDK"
else
    fail "artifact list readback failed"
fi

if RUN_READ="$(python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --read-run "$(cat "$RUNNER_READ_TARGET")")"; then
    RUN_READ="$RUN_READ" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["RUN_READ"])
assert data["status"] == "success", data
assert data["summary"]["status"] == "completed", data
assert data["result_exists"] is True, data
assert data["result"]["final_output"] == "fake provider final output", data
PY
    pass "artifact readback loads summary.json and result.json without SDK"
else
    fail "artifact readback failed"
fi

if ERR="$(python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --check-patch "$TMP_ROOT/outside-run" 2>&1 >/dev/null)"; then
    fail "check-patch outside runtime root unexpectedly succeeded"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["status"] == "error", data
assert "Run path escaped runtime root" in data["error"], data
PY
then
    pass "check-patch rejects paths outside runtime root"
else
    fail "check-patch outside runtime root error was not clear JSON"
fi

MISSING_PATCH_DIR="$FIXTURE_REAL/.runtime/dev/aos-agents/runs/implementer/missing-patch"
mkdir -p "$MISSING_PATCH_DIR"
cat >"$MISSING_PATCH_DIR/summary.json" <<EOF
{
  "status": "completed",
  "role": "implementer",
  "output_dir": "$MISSING_PATCH_DIR",
  "summary_path": "$MISSING_PATCH_DIR/summary.json",
  "result_path": "$MISSING_PATCH_DIR/result.json",
  "patch_path": "$MISSING_PATCH_DIR/patch.diff",
  "touched_paths": ["scripts/aos_agents/README.md"]
}
EOF
cat >"$MISSING_PATCH_DIR/result.json" <<EOF
{
  "status": "completed",
  "role": "implementer",
  "output_dir": "$MISSING_PATCH_DIR",
  "summary_path": "$MISSING_PATCH_DIR/summary.json",
  "patch_path": "$MISSING_PATCH_DIR/patch.diff",
  "touched_paths": ["scripts/aos_agents/README.md"]
}
EOF
if ERR="$(python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --check-patch "$MISSING_PATCH_DIR" 2>&1 >/dev/null)"; then
    fail "check-patch missing patch.diff unexpectedly succeeded"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["status"] == "error", data
assert data["patch_exists"] is False, data
assert data["apply_check"] == "not_run", data
assert "Missing patch.diff artifact" in data["error"], data
PY
then
    pass "check-patch rejects missing patch.diff"
else
    fail "check-patch missing patch.diff error was not clear JSON"
fi

MISMATCH_DIR="$FIXTURE_REAL/.runtime/dev/aos-agents/runs/implementer/mismatched-patch-path"
mkdir -p "$MISMATCH_DIR"
printf '%s\n' \
    'diff --git a/scripts/aos_agents/README.md b/scripts/aos_agents/README.md' \
    '--- a/scripts/aos_agents/README.md' \
    '+++ b/scripts/aos_agents/README.md' \
    '@@ -1,3 +1,4 @@' \
    ' # Fixture AOS Agent Runner' \
    ' ' \
    ' The M1 read-only parity proof is recorded in the fixture report.' \
    '+check patch fixture' \
    >"$MISMATCH_DIR/patch.diff"
cat >"$MISMATCH_DIR/summary.json" <<EOF
{
  "status": "completed",
  "role": "implementer",
  "output_dir": "$MISMATCH_DIR",
  "summary_path": "$MISMATCH_DIR/summary.json",
  "result_path": "$MISMATCH_DIR/result.json",
  "patch_path": "$MISMATCH_DIR/elsewhere.diff",
  "touched_paths": ["scripts/aos_agents/README.md"]
}
EOF
cat >"$MISMATCH_DIR/result.json" <<EOF
{
  "status": "completed",
  "role": "implementer",
  "output_dir": "$MISMATCH_DIR",
  "summary_path": "$MISMATCH_DIR/summary.json",
  "patch_path": "$MISMATCH_DIR/elsewhere.diff",
  "touched_paths": ["scripts/aos_agents/README.md"]
}
EOF
if ERR="$(python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --check-patch "$MISMATCH_DIR" 2>&1 >/dev/null)"; then
    fail "check-patch mismatched patch_path unexpectedly succeeded"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["status"] == "error", data
assert data["patch_exists"] is True, data
assert "summary.json patch_path mismatch" in data["error"], data
PY
then
    pass "check-patch rejects summary/result patch_path mismatch"
else
    fail "check-patch patch_path mismatch error was not clear JSON"
fi

APPLY_FAIL_DIR="$FIXTURE_REAL/.runtime/dev/aos-agents/runs/implementer/apply-check-failure"
mkdir -p "$APPLY_FAIL_DIR"
printf '%s\n' \
    'diff --git a/scripts/aos_agents/README.md b/scripts/aos_agents/README.md' \
    '--- a/scripts/aos_agents/README.md' \
    '+++ b/scripts/aos_agents/README.md' \
    '@@ -1,3 +1,3 @@' \
    ' # Fixture AOS Agent Runner' \
    ' ' \
    '-This line is not in the fixture.' \
    '+check patch fixture' \
    >"$APPLY_FAIL_DIR/patch.diff"
cat >"$APPLY_FAIL_DIR/summary.json" <<EOF
{
  "status": "completed",
  "role": "implementer",
  "output_dir": "$APPLY_FAIL_DIR",
  "summary_path": "$APPLY_FAIL_DIR/summary.json",
  "result_path": "$APPLY_FAIL_DIR/result.json",
  "patch_path": "$APPLY_FAIL_DIR/patch.diff",
  "touched_paths": ["scripts/aos_agents/README.md"]
}
EOF
cat >"$APPLY_FAIL_DIR/result.json" <<EOF
{
  "status": "completed",
  "role": "implementer",
  "output_dir": "$APPLY_FAIL_DIR",
  "summary_path": "$APPLY_FAIL_DIR/summary.json",
  "patch_path": "$APPLY_FAIL_DIR/patch.diff",
  "touched_paths": ["scripts/aos_agents/README.md"]
}
EOF
if ERR="$(python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --check-patch "$APPLY_FAIL_DIR" 2>&1 >/dev/null)"; then
    fail "check-patch apply-check failure unexpectedly succeeded"
elif ERR="$ERR" FIXTURE="$FIXTURE" python3 - <<'PY'
import json
import os
from pathlib import Path

data = json.loads(os.environ["ERR"])
fixture = Path(os.environ["FIXTURE"]).resolve()
assert data["status"] == "error", data
assert data["patch_exists"] is True, data
assert data["apply_check"] == "fail", data
assert "git apply --check failed" in data["error"], data
assert "patch does not apply" in data["apply_check_output"], data
assert (fixture / "scripts/aos_agents/README.md").read_text().endswith("fixture report.\n"), data
PY
then
    pass "check-patch reports git apply --check failure without checkout mutation"
else
    fail "check-patch apply-check failure was not clear JSON"
fi

if PATCH_CHECK="$(python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --check-patch "$(cat "$RUNNER_PATCH_TARGET")")"; then
    PATCH_CHECK="$PATCH_CHECK" FIXTURE="$FIXTURE" python3 - <<'PY'
import json
import os
from pathlib import Path

data = json.loads(os.environ["PATCH_CHECK"])
fixture = Path(os.environ["FIXTURE"]).resolve()
assert data["status"] == "success", data
assert data["patch_exists"] is True, data
assert data["apply_check"] == "pass", data
assert data["touched_paths"] == ["docs/example.md"], data
assert data["suggested_next"].startswith("After explicit Foreman approval"), data
assert (fixture / "main-checkout-sentinel.txt").read_text() == "main checkout sentinel\n"
assert not (fixture / "docs" / "example.md").exists()
PY
    pass "check-patch passes for a valid fixture patch without checkout mutation"
else
    fail "check-patch valid fixture patch failed"
fi

if AOS_SELF_TEST="$(./aos dev agents --self-test --json)"; then
    AOS_SELF_TEST="$AOS_SELF_TEST" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["AOS_SELF_TEST"])
assert data["self_test"] == "pass", data
assert set(data["roles"]) == {"explorer", "reviewer", "validator", "historian"}, data
PY
    pass "./aos dev agents routes self-test through the external command surface"
else
    fail "./aos dev agents self-test route failed"
fi

if ERR="$(./aos dev agents --role implementer --task "write check" --json 2>&1 >/dev/null)"; then
    fail "./aos dev agents implementer rejection unexpectedly succeeded"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["status"] == "error", data
assert "Role 'implementer' is not enabled" in data["error"], data
PY
then
    pass "./aos dev agents rejects write-capable roles before SDK checks"
else
    fail "./aos dev agents implementer rejection error was not clear JSON"
fi

if AOS_EXECUTED="$(AOS_AGENT_FAKE_SDK_RECORD="$SDK_RECORD" PYTHONPATH="$PRESENT_SDK" ./aos dev agents --role explorer --task "execute through aos command surface" --execute --max-turns 1 --json)"; then
    AOS_EXECUTED="$AOS_EXECUTED" SDK_RECORD="$SDK_RECORD" AOS_CLEANUP_TARGET="$AOS_CLEANUP_TARGET" python3 - <<'PY'
import json
import os
from pathlib import Path

data = json.loads(os.environ["AOS_EXECUTED"])
output_dir = Path(data["output_dir"])
summary_path = Path(data["summary_path"])
result_path = Path(data["result_path"])
assert data["status"] == "completed", data
assert output_dir.is_dir(), output_dir
assert summary_path == output_dir / "summary.json", data
assert result_path == output_dir / "result.json", data
summary_doc = json.loads(summary_path.read_text())
assert summary_doc["status"] == "completed", summary_doc
assert summary_doc["execute"] is True, summary_doc
record = json.loads(Path(os.environ["SDK_RECORD"]).read_text())
assert record["input"] == "execute through aos command surface", record
Path(os.environ["AOS_CLEANUP_TARGET"]).write_text(str(output_dir))
PY
    AOS_OUTPUT_DIR="$(cat "$AOS_CLEANUP_TARGET")"
    if AOS_READ="$(./aos dev agents --read-run "$AOS_OUTPUT_DIR" --json)"; then
        AOS_READ="$AOS_READ" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["AOS_READ"])
assert data["status"] == "success", data
assert data["summary"]["status"] == "completed", data
assert data["result_exists"] is True, data
assert data["result"]["final_output"] == "fake provider final output", data
PY
    else
        fail "./aos dev agents artifact read route failed"
    fi
    case "$AOS_OUTPUT_DIR" in
        "$ROOT/.runtime/dev/aos-agents/"*) rm -rf "$AOS_OUTPUT_DIR" ;;
        *) fail "./aos dev agents cleanup target escaped runtime root: $AOS_OUTPUT_DIR" ;;
    esac
    pass "./aos dev agents executes and reads artifacts through the external command surface"
else
    fail "./aos dev agents execution route failed with fake SDK"
fi

if AOS_PATCHED="$(AOS_AGENT_FAKE_SDK_RECORD="$SDK_RECORD" PYTHONPATH="$PRESENT_SDK" ./aos dev agents --role implementer --task "patch through aos command surface" --context-file scripts/aos_agents/README.md --patch-output --execute --max-turns 1 --json)"; then
    AOS_PATCHED="$AOS_PATCHED" ROOT="$ROOT" AOS_PATCH_CLEANUP_TARGET="$AOS_PATCH_CLEANUP_TARGET" python3 - <<'PY'
import json
import os
from pathlib import Path

data = json.loads(os.environ["AOS_PATCHED"])
root = Path(os.environ["ROOT"]).resolve()
runtime_root = root / ".runtime/dev/aos-agents"
output_dir = Path(data["output_dir"])
patch_path = Path(data["patch_path"])
assert data["status"] == "completed", data
assert data["role"] == "implementer", data
assert output_dir.is_relative_to(runtime_root), output_dir
assert output_dir.parent == runtime_root / "runs" / "implementer", output_dir
assert patch_path == output_dir / "patch.diff", data
assert patch_path.read_text().startswith("diff --git a/docs/example.md b/docs/example.md"), patch_path.read_text()
assert data["touched_paths"] == ["docs/example.md"], data
assert data["context_files"] == ["scripts/aos_agents/README.md"], data
Path(os.environ["AOS_PATCH_CLEANUP_TARGET"]).write_text(str(output_dir))
PY
    AOS_PATCH_OUTPUT_DIR="$(cat "$AOS_PATCH_CLEANUP_TARGET")"
    if AOS_PATCH_CHECK="$(./aos dev agents --check-patch "$AOS_PATCH_OUTPUT_DIR" --json)"; then
        AOS_PATCH_CHECK="$AOS_PATCH_CHECK" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["AOS_PATCH_CHECK"])
assert data["status"] == "success", data
assert data["patch_exists"] is True, data
assert data["apply_check"] == "pass", data
assert data["touched_paths"] == ["docs/example.md"], data
PY
    else
        fail "./aos dev agents check-patch route failed"
    fi
    case "$AOS_PATCH_OUTPUT_DIR" in
        "$ROOT/.runtime/dev/aos-agents/"*) rm -rf "$AOS_PATCH_OUTPUT_DIR" ;;
        *) fail "./aos dev agents patch cleanup target escaped runtime root: $AOS_PATCH_OUTPUT_DIR" ;;
    esac
    pass "./aos dev agents routes implementer patch-output artifacts and check-patch through the external command surface"
else
    fail "./aos dev agents implementer patch-output route failed with fake SDK"
fi

if AOS_LIST="$(./aos dev agents --list-runs --json)"; then
    AOS_LIST="$AOS_LIST" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["AOS_LIST"])
assert data["status"] == "success", data
assert "runtime_root" in data, data
assert isinstance(data["runs"], list), data
PY
    pass "./aos dev agents lists artifacts through the external command surface"
else
    fail "./aos dev agents artifact list route failed"
fi

echo "aos-agents-runner: all checks passed"
