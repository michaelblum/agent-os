#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-agents-runner.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

FIXTURE="$TMP_ROOT/repo"
MISSING_SDK="$TMP_ROOT/missing-sdk"
PRESENT_SDK="$TMP_ROOT/present-sdk"
FAILING_SDK="$TMP_ROOT/failing-sdk"
SDK_RECORD="$TMP_ROOT/sdk-record.json"
AOS_CLEANUP_TARGET="$TMP_ROOT/aos-output-dir.txt"
mkdir -p "$FIXTURE/.codex/agents" "$FIXTURE/.docks/profiles/base" "$MISSING_SDK" "$PRESENT_SDK" "$FAILING_SDK"

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
    final_output = "fake provider final output"


class Runner:
    @staticmethod
    def run_sync(starting_agent, input, **kwargs):
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
        return Result()


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
    "output_dir",
    "summary_path",
}, schema
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
    EXECUTED="$EXECUTED" FIXTURE="$FIXTURE" SDK_RECORD="$SDK_RECORD" python3 - <<'PY'
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
PY
    pass "provider execution uses guarded SDK adapter and writes result.json under runtime path"
else
    fail "provider execution failed with fake SDK"
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
    case "$AOS_OUTPUT_DIR" in
        "$ROOT/.runtime/dev/aos-agents/"*) rm -rf "$AOS_OUTPUT_DIR" ;;
        *) fail "./aos dev agents cleanup target escaped runtime root: $AOS_OUTPUT_DIR" ;;
    esac
    pass "./aos dev agents executes through the external command surface"
else
    fail "./aos dev agents execution route failed with fake SDK"
fi

echo "aos-agents-runner: all checks passed"
