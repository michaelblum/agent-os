#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ "${AOS_AGENT_PROVIDER_SDK_SMOKE:-}" != "1" ]]; then
    echo "SKIP: set AOS_AGENT_PROVIDER_SDK_SMOKE=1 to run the real provider SDK smoke"
    exit 0
fi

if [[ -z "${OPENAI_API_KEY:-}" && -z "${OPENAI_BASE_URL:-}" ]]; then
    echo "FAIL: set OPENAI_API_KEY for OpenAI, or OPENAI_BASE_URL plus provider-compatible auth for a custom endpoint" >&2
    exit 1
fi

python3 - <<'PY'
import importlib.util

if importlib.util.find_spec("agents") is None:
    raise SystemExit("FAIL: Python module 'agents' is not importable; install openai-agents in the caller environment")
if importlib.util.find_spec("openai.types.shared") is None:
    raise SystemExit("FAIL: Python module 'openai.types.shared' is not importable; install a compatible openai package")

import agents
from openai.types.shared import Reasoning

missing = []
for name in ("Agent", "ModelSettings", "Runner"):
    if not callable(getattr(agents, name, None)):
        missing.append(f"agents.{name}")
if not callable(getattr(agents.Runner, "run_sync", None)):
    missing.append("agents.Runner.run_sync")
if not callable(Reasoning):
    missing.append("openai.types.shared.Reasoning")
if missing:
    raise SystemExit("FAIL: provider SDK is missing required runtime surface: " + ", ".join(missing))
PY

MODEL="${AOS_AGENT_PROVIDER_SMOKE_MODEL:-}"
if [[ -z "$MODEL" ]]; then
    MODEL="$(
        ROOT="$ROOT" python3 - <<'PY'
import os
import pathlib
import re

root = pathlib.Path(os.environ["ROOT"])
text = (root / ".codex/agents/explorer.toml").read_text()
match = re.search(r'^model\s*=\s*"([^"]+)"', text, re.MULTILINE)
if not match:
    raise SystemExit("Could not find explorer model in .codex/agents/explorer.toml")
print(match.group(1))
PY
    )"
fi

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-agents-provider-smoke.XXXXXX")"
cleanup() {
    rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

FIXTURE="$TMP_ROOT/repo"
mkdir -p "$FIXTURE/.codex/agents" "$FIXTURE/.docks/profiles/smoke-profile" "$FIXTURE/scripts/aos_agents"
cp "$ROOT/scripts/aos_agents/runner.py" "$FIXTURE/scripts/aos_agents/runner.py"

cat >"$FIXTURE/.docks/profiles/active-profile.json" <<'JSON'
{
  "schema_version": 1,
  "active_profile": "provider-sdk-smoke",
  "profile_packs": ["smoke-profile"],
  "header": {
    "profile": "provider SDK smoke",
    "workflow": "isolated fixture",
    "migration_posture": "contract smoke",
    "runtime_posture": "provider execution only",
    "delegation": "AOS-owned runner",
    "authority": "tests/aos-agents-runner-integration.sh",
    "stale_pools": "none"
  }
}
JSON

cat >"$FIXTURE/.docks/profiles/smoke-profile/profile.md" <<'MD'
# Provider SDK Smoke Profile

Return concise output for the integration smoke.
MD

for role in explorer reviewer validator historian; do
    effort="low"
    if [[ "$role" == "reviewer" ]]; then
        effort="medium"
    fi
    cat >"$FIXTURE/.codex/agents/$role.toml" <<EOF
name = "$role"
description = "$role smoke role"
model = "$MODEL"
model_reasoning_effort = "$effort"
sandbox_mode = "read-only"

developer_instructions = """
You are a read-only smoke-test agent.
Return only the requested smoke token.
"""
EOF
done

(
    cd "$FIXTURE"
    git init -q
    git config user.email "aos-smoke@example.invalid"
    git config user.name "AOS Provider SDK Smoke"
    git add .codex .docks
    git commit -q -m "provider sdk smoke fixture"
)

TASK="Return exactly this token and no other text: AOS_PROVIDER_SDK_SMOKE_OK"
OUTPUT="$(
    OPENAI_AGENTS_DISABLE_TRACING=1 \
    "$ROOT/./aos" dev agents \
        --repo "$FIXTURE" \
        --role explorer \
        --task "$TASK" \
        --execute \
        --max-turns "${AOS_AGENT_PROVIDER_SMOKE_MAX_TURNS:-1}" \
        --json
)"

OUTPUT="$OUTPUT" FIXTURE="$FIXTURE" python3 - <<'PY'
import json
import os
from pathlib import Path

data = json.loads(os.environ["OUTPUT"])
fixture = Path(os.environ["FIXTURE"]).resolve()
runtime_root = fixture / ".runtime/dev/aos-agents"
output_dir = Path(data["output_dir"])
summary_path = Path(data["summary_path"])
result_path = Path(data["result_path"])

assert data["status"] == "completed", data
assert data["engine"] == "provider-sdk", data
assert data["role"] == "explorer", data
assert output_dir.is_relative_to(runtime_root), data
assert summary_path == output_dir / "summary.json", data
assert result_path == output_dir / "result.json", data
assert "AOS_PROVIDER_SDK_SMOKE_OK" in data["final_output"], data

summary = json.loads(summary_path.read_text())
result = json.loads(result_path.read_text())
assert summary["status"] == "completed", summary
assert summary["engine"] == "provider-sdk", summary
assert summary["role"] == "explorer", summary
assert summary["execute"] is True, summary
assert result["status"] == "completed", result
assert result["engine"] == "provider-sdk", result
assert result["role"] == "explorer", result
assert "AOS_PROVIDER_SDK_SMOKE_OK" in result["final_output"], result
PY

echo "PASS: real provider SDK smoke completed through ./aos dev agents with model $MODEL"
