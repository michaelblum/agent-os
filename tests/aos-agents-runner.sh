#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-agents-runner.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

FIXTURE="$TMP_ROOT/repo"
MISSING_SDK="$TMP_ROOT/missing-sdk"
PRESENT_SDK="$TMP_ROOT/present-sdk"
SDK_RECORD="$TMP_ROOT/sdk-record.json"
mkdir -p "$FIXTURE/.codex/agents" "$FIXTURE/.docks/profiles/base" "$MISSING_SDK" "$PRESENT_SDK"

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
assert data["status"] == "ready", data
assert output_dir.is_dir(), output_dir
assert output_dir.is_relative_to(runtime_root), output_dir
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
assert data["status"] == "completed", data
assert data["final_output"] == "fake provider final output", data
assert output_dir.is_dir(), output_dir
assert output_dir.is_relative_to(runtime_root), output_dir
assert result_path == output_dir / "result.json", data
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

echo "aos-agents-runner: all checks passed"
