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
mkdir -p "$FIXTURE/ai-agents/providers/codex" "$FIXTURE/.docks/profiles/base" "$FIXTURE/scripts/aos_agents" "$MISSING_SDK" "$PRESENT_SDK/openai/types" "$FAILING_SDK/openai/types"
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
default_openai_client = None
default_openai_api = None
default_openai_key = None


class Agent:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


class ModelSettings(dict):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)


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
                    "default_openai_api": default_openai_api,
                    "default_openai_key": default_openai_key,
                    "default_openai_client": getattr(default_openai_client, "kwargs", None),
                },
                sort_keys=True,
            )
        )
        return Result(final_output)


def set_tracing_disabled(value):
    global tracing_disabled
    tracing_disabled = bool(value)


def set_default_openai_api(value):
    global default_openai_api
    default_openai_api = value


def set_default_openai_key(value, use_for_tracing=True):
    global default_openai_key
    default_openai_key = {"value": value, "use_for_tracing": use_for_tracing}


def set_default_openai_client(value, use_for_tracing=True):
    global default_openai_client
    default_openai_client = value
    default_openai_client.kwargs["use_for_tracing"] = use_for_tracing
PY

cat >"$PRESENT_SDK/openai/__init__.py" <<'PY'
class AsyncOpenAI:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
PY
touch "$PRESENT_SDK/openai/types/__init__.py"
cat >"$PRESENT_SDK/openai/types/shared.py" <<'PY'
class Reasoning(dict):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
PY

cat >"$FAILING_SDK/agents.py" <<'PY'
tracing_disabled = False
default_openai_client = None
default_openai_api = None


class Agent:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


class ModelSettings(dict):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)


class Runner:
    @staticmethod
    def run_sync(starting_agent, input, **kwargs):
        raise RuntimeError("fake provider boom")


def set_tracing_disabled(value):
    global tracing_disabled
    tracing_disabled = bool(value)


def set_default_openai_api(value):
    global default_openai_api
    default_openai_api = value


def set_default_openai_client(value, use_for_tracing=True):
    global default_openai_client
    default_openai_client = value
    default_openai_client.kwargs["use_for_tracing"] = use_for_tracing
PY

cat >"$FAILING_SDK/openai/__init__.py" <<'PY'
class AsyncOpenAI:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
PY
touch "$FAILING_SDK/openai/types/__init__.py"
cat >"$FAILING_SDK/openai/types/shared.py" <<'PY'
class Reasoning(dict):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
PY

for role in explorer reviewer validator historian; do
    cat >"$FIXTURE/ai-agents/providers/codex/$role.toml" <<EOF
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

cat >"$FIXTURE/ai-agents/providers/codex/implementer.toml" <<'EOF'
name = "implementer"
model = "test-model"
model_reasoning_effort = "medium"
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

cat >"$FIXTURE/.gitignore" <<'EOF'
.runtime/
EOF
git -C "$FIXTURE" init -q
git -C "$FIXTURE" config user.email "test@example.invalid"
git -C "$FIXTURE" config user.name "AOS Test"
git -C "$FIXTURE" add .
git -C "$FIXTURE" commit -qm "fixture baseline"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; exit 1; }

if INTEGRATION_SKIP="$(bash tests/aos-agents-runner-integration.sh)"; then
    if grep -q "SKIP: set AOS_AGENT_PROVIDER_SDK_SMOKE=1" <<<"$INTEGRATION_SKIP"; then
        pass "provider SDK integration smoke is opt-in and skips by default"
    else
        fail "provider SDK integration smoke default output was not an opt-in skip"
    fi
else
    fail "provider SDK integration smoke skip path failed"
fi

python3 - <<'PY'
import json
from pathlib import Path

schema = json.loads(Path("docs/dev/aos-agents-summary.schema.json").read_text())
assert schema["$schema"] == "http://json-schema.org/draft-07/schema#", schema
assert schema["properties"]["status"]["enum"] == ["ready", "completed", "blocked", "error"], schema
assert schema["properties"]["engine"]["enum"] == ["provider-sdk"], schema
assert set(schema["required"]) == {
    "schema_version",
    "status",
    "engine",
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
assert "native_spawn_contract" not in schema["properties"], schema
assert "native_dispatch_path" not in schema["properties"], schema
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
assert data["default_engine"] == "provider-sdk", data
assert set(data["engines"]) == {"provider-sdk"}, data
assert data["retired_engines"]["native-codex"]["retired"] is True, data
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

if ERR="$(PYTHONPATH="$MISSING_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --engine provider-sdk --role implementer --task "write check" 2>&1 >/dev/null)"; then
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

if RUNTIME_INFO="$(AOS_AGENT_PROVIDER_BASE_URL="https://proxy.example/v1" AOS_AGENT_PROVIDER_API_KEY="proxy-key" PYTHONPATH="$PRESENT_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --runtime-info)"; then
    RUNTIME_INFO="$RUNTIME_INFO" FIXTURE="$FIXTURE" python3 - <<'PY'
import json
import os
from pathlib import Path

data = json.loads(os.environ["RUNTIME_INFO"])
fixture = Path(os.environ["FIXTURE"]).resolve()
assert data["status"] == "success", data
assert data["runtime"] == "aos-agents", data
assert data["runtime_root"] == str(fixture / ".runtime/dev/aos-agents"), data
assert set(data["engines"]) == {"provider-sdk"}, data
assert data["retired_engines"]["native-codex"]["retired"] is True, data
assert "ADR 0017" in data["retired_engines"]["native-codex"]["reason"], data
assert data["engines"]["provider-sdk"]["default"] is True, data
assert data["engines"]["provider-sdk"]["dependency"]["available"] is True, data
provider_env = data["engines"]["provider-sdk"]["dependency"]["provider_env"]
assert provider_env["base_url_configured"] is True, provider_env
assert provider_env["base_url_source"] == "AOS_AGENT_PROVIDER_BASE_URL", provider_env
assert provider_env["api_key_configured"] is True, provider_env
assert provider_env["api_key_source"] == "AOS_AGENT_PROVIDER_API_KEY", provider_env
assert provider_env["api"] == "chat_completions", provider_env
assert data["roles"]["implementer"]["default_execution"] == "patch artifact only", data
PY
    [ ! -e "$FIXTURE/.runtime" ] || fail "runtime-info created runtime state"
    pass "runtime-info reports provider default and retired native policy without runtime mutation"
else
    fail "runtime-info failed"
fi

if ERR="$(python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --runtime-info --role explorer 2>&1 >/dev/null)"; then
    fail "runtime-info with role unexpectedly succeeded"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["status"] == "error", data
assert "--runtime-info cannot be combined with --role" in data["error"], data
PY
then
    pass "runtime-info rejects role-specific mode flags"
else
    fail "runtime-info role exclusivity error was not clear JSON"
fi

if ERR="$(python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --runtime-info --engine provider-sdk 2>&1 >/dev/null)"; then
    fail "runtime-info with explicit engine unexpectedly succeeded"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["status"] == "error", data
assert "--runtime-info cannot be combined with --engine" in data["error"], data
PY
then
    pass "runtime-info rejects explicit engine flag"
else
    fail "runtime-info engine exclusivity error was not clear JSON"
fi

if ERR="$(python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --runtime-info --max-turns 1 2>&1 >/dev/null)"; then
    fail "runtime-info with explicit default max-turns unexpectedly succeeded"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["status"] == "error", data
assert "--runtime-info cannot be combined with --max-turns" in data["error"], data
PY
then
    pass "runtime-info rejects explicit default-valued max-turns"
else
    fail "runtime-info max-turns exclusivity error was not clear JSON"
fi

if ERR="$(python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --runtime-info --self-test 2>&1 >/dev/null)"; then
    fail "runtime-info with self-test unexpectedly succeeded"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["status"] == "error", data
assert "--runtime-info cannot be combined with --self-test" in data["error"], data
PY
then
    pass "runtime-info rejects self-test mode"
else
    fail "runtime-info self-test exclusivity error was not clear JSON"
fi

if PROVIDER_DEFAULT_READY="$(PYTHONPATH="$MISSING_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --role explorer --task "provider default plan")"; then
    PROVIDER_DEFAULT_READY="$PROVIDER_DEFAULT_READY" FIXTURE="$FIXTURE" python3 - <<'PY'
import json
import os
from pathlib import Path

data = json.loads(os.environ["PROVIDER_DEFAULT_READY"])
fixture = Path(os.environ["FIXTURE"]).resolve()
runtime_root = fixture / ".runtime/dev/aos-agents"
output_dir = Path(data["output_dir"])
summary_doc = json.loads(Path(data["summary_path"]).read_text())
assert data["status"] == "ready", data
assert data["engine"] == "provider-sdk", data
assert output_dir.is_relative_to(runtime_root), data
assert "native_spawn_contract" not in data, data
assert not (output_dir / "native-dispatch.json").exists(), output_dir
assert not (output_dir / "result.json").exists(), output_dir
assert summary_doc["engine"] == "provider-sdk", summary_doc
assert summary_doc["execute"] is False, summary_doc
PY
    pass "default provider planning is ready without invoking SDK or native dispatch"
else
    fail "default provider planning failed"
fi

if ERR="$(PYTHONPATH="$MISSING_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --engine native-codex --role explorer --task "native plan task" 2>&1 >/dev/null)"; then
    fail "retired native engine unexpectedly succeeded"
elif ERR="$ERR" FIXTURE="$FIXTURE" python3 - <<'PY'
import json
import os
from pathlib import Path

data = json.loads(os.environ["ERR"])
fixture = Path(os.environ["FIXTURE"])
assert data["status"] == "error", data
assert "native-codex is retired" in data["error"], data
assert not list((fixture / ".runtime").glob("**/native-dispatch.json")), fixture
PY
then
    pass "retired native engine fails closed before runtime mutation"
else
    fail "retired native engine error was not clear JSON"
fi

if ERR="$(python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --native-dispatch /tmp/old-native-run 2>&1 >/dev/null)"; then
    fail "retired native dispatch unexpectedly succeeded"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["status"] == "error", data
assert "native-codex dispatch/import is retired" in data["error"], data
PY
then
    pass "retired native dispatch flag fails closed"
else
    fail "retired native dispatch error was not clear JSON"
fi

if PATCH_READY="$(PYTHONPATH="$MISSING_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --engine provider-sdk --role implementer --task "patch check" --context-file scripts/aos_agents/README.md --patch-output)"; then
    PATCH_READY="$PATCH_READY" FIXTURE="$FIXTURE" python3 - <<'PY'
import json
import os
from pathlib import Path

data = json.loads(os.environ["PATCH_READY"])
fixture = Path(os.environ["FIXTURE"]).resolve()
runtime_root = fixture / ".runtime/dev/aos-agents"
output_dir = Path(data["output_dir"])
summary_path = Path(data["summary_path"])
assert data["status"] == "ready", data
assert data["engine"] == "provider-sdk", data
assert data["role"] == "implementer", data
assert data["context_files"] == ["scripts/aos_agents/README.md"], data
assert output_dir.is_relative_to(runtime_root), data
assert output_dir.parent == runtime_root / "runs" / "implementer", data
assert summary_path == output_dir / "summary.json", data
assert not (output_dir / "result.json").exists(), output_dir
assert not (output_dir / "patch.diff").exists(), output_dir
summary_doc = json.loads(summary_path.read_text())
assert summary_doc["status"] == "ready", summary_doc
assert summary_doc["engine"] == "provider-sdk", summary_doc
assert summary_doc["role"] == "implementer", summary_doc
assert summary_doc["execute"] is False, summary_doc
assert summary_doc["context_files"] == ["scripts/aos_agents/README.md"], summary_doc
PY
    pass "implementer patch-output planning writes ready summary without SDK or checkout mutation"
else
    fail "implementer patch-output planning failed"
fi

if ERR="$(PYTHONPATH="$MISSING_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --engine provider-sdk --role explorer --task "context needs patch output" --context-file scripts/aos_agents/README.md 2>&1 >/dev/null)"; then
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

if ERR="$(PYTHONPATH="$MISSING_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --engine provider-sdk --role implementer --task "bad context traversal" --context-file ../outside.md --patch-output --execute 2>&1 >/dev/null)"; then
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

if ERR="$(PYTHONPATH="$MISSING_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --engine provider-sdk --role implementer --task "bad absolute context" --context-file "$TMP_ROOT/outside.md" --patch-output --execute 2>&1 >/dev/null)"; then
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

if ERR="$(PYTHONPATH="$MISSING_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --engine provider-sdk --role explorer --task "sdk missing check" --execute 2>&1 >/dev/null)"; then
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
    [ ! -d "$FIXTURE/.runtime/dev/aos-agents/runs/explorer/sdk-missing-check-"* ] || fail "SDK-missing execute path created a run directory"
    pass "SDK-missing failure is clear and non-mutating"
else
    fail "SDK-missing error was not clear JSON"
fi

if READY="$(PYTHONPATH="$PRESENT_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --engine provider-sdk --role explorer --task "../../unsafe output task")"; then
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
assert data["engine"] == "provider-sdk", data
assert output_dir.is_dir(), output_dir
assert output_dir.is_relative_to(runtime_root), output_dir
assert summary_path == output_dir / "summary.json", data
summary_doc = json.loads(summary_path.read_text())
assert summary_doc["schema_version"] == 1, summary_doc
assert summary_doc["status"] == "ready", summary_doc
assert summary_doc["engine"] == "provider-sdk", summary_doc
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

if EXECUTED="$(AOS_AGENT_PROVIDER_BASE_URL="https://proxy.example/v1" AOS_AGENT_PROVIDER_API_KEY="proxy-key" AOS_AGENT_FAKE_SDK_RECORD="$SDK_RECORD" PYTHONPATH="$PRESENT_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --engine provider-sdk --role explorer --task "execute read-only task" --execute --max-turns 1)"; then
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
assert data["engine"] == "provider-sdk", data
assert data["final_output"] == "fake provider final output", data
assert output_dir.is_dir(), output_dir
assert output_dir.is_relative_to(runtime_root), output_dir
assert result_path == output_dir / "result.json", data
assert summary_path == output_dir / "summary.json", data
summary_doc = json.loads(summary_path.read_text())
assert summary_doc["schema_version"] == 1, summary_doc
assert summary_doc["status"] == "completed", summary_doc
assert summary_doc["engine"] == "provider-sdk", summary_doc
assert summary_doc["execute"] is True, summary_doc
assert summary_doc["result_path"] == str(result_path), summary_doc
result_doc = json.loads(result_path.read_text())
assert result_doc["status"] == "completed", result_doc
assert result_doc["engine"] == "provider-sdk", result_doc
assert result_doc["final_output"] == "fake provider final output", result_doc
assert result_doc["max_turns"] == 1, result_doc
record = json.loads(Path(os.environ["SDK_RECORD"]).read_text())
assert record["agent"]["name"] == "explorer", record
assert record["agent"]["model"] == "test-model", record
assert record["agent"]["model_settings"]["reasoning"]["effort"] == "low", record
assert "Read-only fixture instructions for explorer." in record["agent"]["instructions"], record
assert "Read-only fixture profile." in record["agent"]["instructions"], record
assert record["input"] == "execute read-only task", record
assert record["kwargs"] == {"max_turns": 1}, record
assert record["tracing_disabled"] is True, record
assert record["tracing_env"] == "1", record
assert record["default_openai_api"] == "chat_completions", record
assert record["default_openai_client"]["base_url"] == "https://proxy.example/v1", record
assert record["default_openai_client"]["api_key"] == "proxy-key", record
assert record["default_openai_client"]["use_for_tracing"] is False, record
Path(os.environ["RUNNER_READ_TARGET"]).write_text(str(output_dir))
PY
    pass "provider execution uses guarded SDK adapter and writes result.json under runtime path"
else
    fail "provider execution failed with fake SDK"
fi

if PATCHED="$(AOS_AGENT_FAKE_SDK_RECORD="$SDK_RECORD" PYTHONPATH="$PRESENT_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --engine provider-sdk --role implementer --task "produce trivial patch" --patch-output --execute --max-turns 1)"; then
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
assert data["engine"] == "provider-sdk", data
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
assert summary_doc["engine"] == "provider-sdk", summary_doc
assert summary_doc["role"] == "implementer", summary_doc
assert summary_doc["base_commit"], summary_doc
assert summary_doc["target_branch"], summary_doc
assert summary_doc["patch_path"] == str(patch_path), summary_doc
assert summary_doc["touched_paths"] == ["docs/example.md"], summary_doc
assert summary_doc["suggested_review_command"] == f"git apply --check {patch_path}", summary_doc
assert summary_doc["suggested_apply_command"] == f"git apply {patch_path}", summary_doc
result_doc = json.loads(result_path.read_text())
assert result_doc["status"] == "completed", result_doc
assert result_doc["engine"] == "provider-sdk", result_doc
assert result_doc["patch_path"] == str(patch_path), result_doc
assert result_doc["touched_paths"] == ["docs/example.md"], result_doc
record = json.loads(Path(os.environ["SDK_RECORD"]).read_text())
assert record["agent"]["name"] == "implementer", record
assert record["agent"]["model"] == "test-model", record
assert record["agent"]["model_settings"]["reasoning"]["effort"] == "medium", record
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

if CONTEXT_PATCHED="$(AOS_AGENT_FAKE_SDK_RECORD="$SDK_RECORD" PYTHONPATH="$PRESENT_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --engine provider-sdk --role implementer --task "produce contextual patch" --context-file scripts/aos_agents/README.md --patch-output --execute --max-turns 1)"; then
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
assert data["engine"] == "provider-sdk", data
assert data["context_files"] == ["scripts/aos_agents/README.md"], data
assert output_dir.is_relative_to(runtime_root), output_dir
assert patch_path == output_dir / "patch.diff", data
assert patch_path.is_file(), patch_path
summary_doc = json.loads(summary_path.read_text())
assert summary_doc["engine"] == "provider-sdk", summary_doc
assert summary_doc["context_files"] == ["scripts/aos_agents/README.md"], summary_doc
result_doc = json.loads(result_path.read_text())
assert result_doc["engine"] == "provider-sdk", result_doc
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
if ERR="$(AOS_AGENT_FAKE_SDK_RECORD="$SDK_RECORD" AOS_AGENT_FAKE_SDK_PATCH_FAILURE=1 PYTHONPATH="$PRESENT_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --engine provider-sdk --role implementer --task "$PATCH_ERROR_TASK" --patch-output --execute --max-turns 1 2>&1 >/dev/null)"; then
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
assert summary_doc["engine"] == "provider-sdk", summary_doc
assert summary_doc["role"] == "implementer", summary_doc
assert summary_doc["error"] == data["error"], summary_doc
assert summary_doc["result_path"] == str(result_path), summary_doc
assert "patch_path" not in summary_doc, summary_doc
result_doc = json.loads(result_path.read_text())
assert result_doc["status"] == "error", result_doc
assert result_doc["engine"] == "provider-sdk", result_doc
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
if ERR="$(PYTHONPATH="$FAILING_SDK" python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --engine provider-sdk --role explorer --task "$ERROR_TASK" --execute --max-turns 1 2>&1 >/dev/null)"; then
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
assert summary_doc["engine"] == "provider-sdk", summary_doc
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
assert data["count"] == len(data["runs"]), data
assert data["count"] >= 6, data
statuses = {item["summary"]["status"] for item in data["runs"]}
assert statuses == {"ready", "completed", "error"}, data
assert any(item["summary"].get("engine") == "provider-sdk" and item["summary"]["status"] == "completed" for item in data["runs"]), data
assert any(item["summary"].get("engine") == "provider-sdk" and item["summary"]["status"] == "ready" for item in data["runs"]), data
assert any(item["summary"].get("engine") == "provider-sdk" and item["summary"]["status"] == "ready" and item["role"] == "implementer" for item in data["runs"]), data
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

LEGACY_M2_DIR="$FIXTURE_REAL/.runtime/dev/aos-agents/runs/implementer/legacy-m2-no-engine"
mkdir -p "$LEGACY_M2_DIR"
printf '%s\n' \
    'diff --git a/scripts/aos_agents/README.md b/scripts/aos_agents/README.md' \
    '--- a/scripts/aos_agents/README.md' \
    '+++ b/scripts/aos_agents/README.md' \
    '@@ -1,3 +1,4 @@' \
    ' # Fixture AOS Agent Runner' \
    ' ' \
    ' The M1 read-only parity proof is recorded in the fixture report.' \
    '+legacy check patch fixture' \
    >"$LEGACY_M2_DIR/patch.diff"
cat >"$LEGACY_M2_DIR/summary.json" <<EOF
{
  "status": "completed",
  "role": "implementer",
  "output_dir": "$LEGACY_M2_DIR",
  "summary_path": "$LEGACY_M2_DIR/summary.json",
  "result_path": "$LEGACY_M2_DIR/result.json",
  "patch_path": "$LEGACY_M2_DIR/patch.diff"
}
EOF
cat >"$LEGACY_M2_DIR/result.json" <<EOF
{
  "status": "completed",
  "role": "implementer",
  "output_dir": "$LEGACY_M2_DIR",
  "summary_path": "$LEGACY_M2_DIR/summary.json",
  "patch_path": "$LEGACY_M2_DIR/patch.diff"
}
EOF
if ERR="$(python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --check-patch "$LEGACY_M2_DIR" 2>&1 >/dev/null)"; then
    fail "legacy M2 artifact without engine unexpectedly succeeded"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["status"] == "error", data
assert "summary.json engine must be one of" in data["error"], data
assert data["apply_check"] == "not_run", data
PY
then
    pass "legacy M2 patch artifacts without engine are intentionally rejected"
else
    fail "legacy M2 rejection error was not clear JSON"
fi

MISSING_PATCH_DIR="$FIXTURE_REAL/.runtime/dev/aos-agents/runs/implementer/missing-patch"
mkdir -p "$MISSING_PATCH_DIR"
cat >"$MISSING_PATCH_DIR/summary.json" <<EOF
{
  "status": "completed",
  "role": "implementer",
  "engine": "provider-sdk",
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
  "engine": "provider-sdk",
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
  "engine": "provider-sdk",
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
  "engine": "provider-sdk",
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
  "engine": "provider-sdk",
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
  "engine": "provider-sdk",
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
assert data["suggested_next"].startswith("After explicit checkout-mutation approval"), data
assert (fixture / "main-checkout-sentinel.txt").read_text() == "main checkout sentinel\n"
assert not (fixture / "docs" / "example.md").exists()
PY
    pass "check-patch passes for a valid fixture patch without checkout mutation"
else
    fail "check-patch valid fixture patch failed"
fi

if ERR="$(./aos dev agents --repo-root "$FIXTURE" --apply-patch "$(cat "$RUNNER_PATCH_TARGET")" --json 2>&1 >/dev/null)"; then
    fail "apply-patch without approval unexpectedly succeeded"
elif ERR="$ERR" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["ERR"])
assert data["status"] == "error", data
assert "--apply-patch requires --i-approve-checkout-mutation" in data["error"], data
PY
then
    pass "apply-patch requires explicit checkout mutation approval"
else
    fail "apply-patch missing approval error was not clear JSON"
fi

printf 'dirty sentinel\n' >"$FIXTURE/main-checkout-sentinel.txt"
if ERR="$(python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --apply-patch "$(cat "$RUNNER_PATCH_TARGET")" --i-approve-checkout-mutation 2>&1 >/dev/null)"; then
    fail "apply-patch dirty worktree unexpectedly succeeded"
elif ERR="$ERR" FIXTURE="$FIXTURE" python3 - <<'PY'
import json
import os
from pathlib import Path

data = json.loads(os.environ["ERR"])
fixture = Path(os.environ["FIXTURE"]).resolve()
assert data["status"] == "error", data
assert data["patch_exists"] is True, data
assert data["apply_check"] == "not_run", data
assert data["git_status_clean"] is False, data
assert " M main-checkout-sentinel.txt" in data["git_status_before"], data
assert "Worktree must be clean" in data["error"], data
assert not (fixture / "docs" / "example.md").exists(), data
PY
then
    pass "apply-patch rejects dirty worktree before apply-check or mutation"
else
    fail "apply-patch dirty worktree error was not clear JSON"
fi
printf 'main checkout sentinel\n' >"$FIXTURE/main-checkout-sentinel.txt"

if ERR="$(python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --apply-patch "$MISSING_PATCH_DIR" --i-approve-checkout-mutation 2>&1 >/dev/null)"; then
    fail "apply-patch missing patch.diff unexpectedly succeeded"
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
    pass "apply-patch rejects missing patch.diff"
else
    fail "apply-patch missing patch.diff error was not clear JSON"
fi

if ERR="$(python3 scripts/aos_agents/runner.py --repo-root "$FIXTURE" --apply-patch "$APPLY_FAIL_DIR" --i-approve-checkout-mutation 2>&1 >/dev/null)"; then
    fail "apply-patch failed apply-check unexpectedly succeeded"
elif ERR="$ERR" FIXTURE="$FIXTURE" python3 - <<'PY'
import json
import os
from pathlib import Path

data = json.loads(os.environ["ERR"])
fixture = Path(os.environ["FIXTURE"]).resolve()
assert data["status"] == "error", data
assert data["patch_exists"] is True, data
assert data["git_status_before"] == [], data
assert data["apply_check"] == "fail", data
assert "git apply --check failed" in data["error"], data
assert "patch does not apply" in data["apply_check_output"], data
assert not (fixture / "docs" / "example.md").exists(), data
PY
then
    pass "apply-patch rejects failed apply-check without checkout mutation"
else
    fail "apply-patch failed apply-check error was not clear JSON"
fi

if APPLY_PATCHED="$(./aos dev agents --repo-root "$FIXTURE" --apply-patch "$(cat "$RUNNER_PATCH_TARGET")" --i-approve-checkout-mutation --json)"; then
    APPLY_PATCHED="$APPLY_PATCHED" FIXTURE="$FIXTURE" python3 - <<'PY'
import json
import os
from pathlib import Path

data = json.loads(os.environ["APPLY_PATCHED"])
fixture = Path(os.environ["FIXTURE"]).resolve()
example = fixture / "docs" / "example.md"
assert data["status"] == "success", data
assert data["applied"] is True, data
assert data["apply_check"] == "pass", data
assert data["patch_exists"] is True, data
assert data["git_status_before"] == [], data
assert data["touched_paths"] == ["docs/example.md"], data
assert data["patch_path"].endswith("/patch.diff"), data
assert any(line.startswith("?? docs") for line in data["git_status_after"]), data
assert example.read_text() == "patch artifact smoke\n", data
PY
    if ! git -C "$FIXTURE" diff --cached --quiet; then
        fail "apply-patch staged checkout changes"
    fi
    rm -f "$FIXTURE/docs/example.md"
    rmdir "$FIXTURE/docs"
    if [ -n "$(git -C "$FIXTURE" status --porcelain)" ]; then
        fail "apply-patch fixture cleanup left dirty worktree"
    fi
    pass "apply-patch applies a valid fixture patch unstaged with explicit approval"
else
    fail "apply-patch valid fixture patch failed"
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

if ERR="$(./aos dev agents --engine provider-sdk --role implementer --task "write check" --json 2>&1 >/dev/null)"; then
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

if AOS_EXECUTED="$(AOS_AGENT_FAKE_SDK_RECORD="$SDK_RECORD" PYTHONPATH="$PRESENT_SDK" ./aos dev agents --engine provider-sdk --role explorer --task "execute through aos command surface" --execute --max-turns 1 --json)"; then
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

if AOS_PATCHED="$(AOS_AGENT_FAKE_SDK_RECORD="$SDK_RECORD" PYTHONPATH="$PRESENT_SDK" ./aos dev agents --engine provider-sdk --role implementer --task "patch through aos command surface" --context-file scripts/aos_agents/README.md --patch-output --execute --max-turns 1 --json)"; then
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
