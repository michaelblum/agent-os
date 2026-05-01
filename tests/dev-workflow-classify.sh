#!/usr/bin/env bash
# dev-workflow-classify.sh — verify manifest-backed developer workflow classification.

set -euo pipefail

FAILS=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILS=$((FAILS + 1)); }

# --- 1. dev help exposes the classify surface. ---
if OUT="$(./aos help dev --json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
forms = {form["id"]: form for form in data["forms"]}
assert "dev-build" in forms, forms
assert "dev-classify" in forms, forms
assert "dev-recommend" in forms, forms
assert "dev-surface" in forms, forms
assert forms["dev-classify"]["execution"]["read_only"] is True, forms["dev-classify"]
assert forms["dev-classify"]["output"]["supports_json_flag"] is True, forms["dev-classify"]
assert forms["dev-recommend"]["execution"]["read_only"] is True, forms["dev-recommend"]
assert forms["dev-recommend"]["output"]["supports_json_flag"] is True, forms["dev-recommend"]
assert forms["dev-surface"]["execution"]["mutates_state"] is True, forms["dev-surface"]
assert forms["dev-surface"]["execution"]["auto_starts_daemon"] is True, forms["dev-surface"]
assert "--ttl" in [arg["token"] for arg in forms["dev-surface"]["args"] if arg["kind"] == "flag"], forms["dev-surface"]
PY
then
    pass "dev help exposes classify/recommend/surface workflow forms"
else
    fail "dev help workflow form contract failed"
fi

# --- 2. Explicit Swift + toolkit + schema paths match the expected rules. ---
if OUT="$(./aos dev classify --json src/main.swift packages/toolkit/components/inspector-panel/index.js shared/schemas/dev-workflow-rules.schema.json 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
rules = {match["id"]: match for match in data["matches"]}
assert data["status"] == "ok", data
assert "swift-binary-source" in rules, rules
assert "toolkit-canvas-surface" in rules, rules
assert "schema-contract" in rules, rules
assert rules["swift-binary-source"]["human_handoff"]["resume_command"] == ["./aos", "ready", "--post-permission"]
assert rules["toolkit-canvas-surface"]["actions"][0]["kind"] == "classify_only"
assert all(action.get("command") != ["bash", "build.sh", "--no-restart"] for action in data["recommended_actions"]), data["recommended_actions"]
PY
then
    pass "explicit paths classify into expected workflow rules"
else
    fail "explicit path classification failed"
fi

# --- 3. Recommendations collapse overlapping workflow actions into an ordered plan. ---
if OUT="$(./aos dev recommend --json src/commands/dev.swift 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
steps = data["steps"]
commands = [step.get("command") for step in steps]
assert data["status"] == "ok", data
assert data["matched_rules"] == ["swift-binary-source", "dev-build-surface"], data["matched_rules"]
assert commands[0] == ["./aos", "dev", "build", "--no-restart", "--json"], commands
assert commands[1] == ["./aos", "ready"], commands
assert all(command != ["bash", "build.sh", "--no-restart"] for command in commands), commands
assert data["human_handoffs"][0]["resume_command"] == ["./aos", "ready", "--post-permission"], data["human_handoffs"]
PY
then
    pass "dev recommend emits ordered de-duplicated workflow plan"
else
    fail "dev recommend ordered plan failed"
fi

# --- 4. Ready checks collapse when command preflight covers the same capabilities. ---
MANIFEST="$(mktemp "${TMPDIR:-/tmp}/aos-dev-workflow-collapse.XXXXXX.json")"
trap 'rm -f "$MANIFEST"' EXIT
cat >"$MANIFEST" <<'JSON'
{
  "id": "aos/dev-workflow-rules",
  "version": 1,
  "summary": "Focused ready collapse fixture.",
  "default_entry_path": "agent/dev",
  "rules": [
    {
      "id": "observe-preflight",
      "summary": "Daemon-backed observe commands own their capability preflight.",
      "match": {
        "paths": [
          "src/perceive/observe.swift"
        ]
      },
      "entry_path": "agent/dev/testing/headless",
      "actions": [
        {
          "id": "ready",
          "kind": "ready_check",
          "command": [
            "./aos",
            "ready"
          ],
          "required_capabilities": [
            {
              "id": "runtime.daemon",
              "scope": "daemon"
            },
            {
              "id": "perception.ax",
              "scope": "daemon"
            }
          ],
          "mutates_runtime": true,
          "reason": "Observe used to require a standalone readiness check."
        },
        {
          "id": "observe",
          "kind": "test",
          "command": [
            "./aos",
            "see",
            "observe",
            "--depth",
            "1"
          ],
          "requires": [
            "ready"
          ],
          "mutates_runtime": false,
          "reason": "The command registry exposes equivalent capability preflight metadata."
        }
      ]
    }
  ]
}
JSON
if OUT="$(./aos dev recommend --json --manifest "$MANIFEST" src/perceive/observe.swift 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
steps = data["steps"]
collapsed = data["collapsed_actions"]
assert data["status"] == "ok", data
assert [step["id"] for step in steps] == ["observe"], steps
assert steps[0]["command"] == ["./aos", "see", "observe", "--depth", "1"], steps
assert steps[0]["requires"] == [], steps
assert collapsed and collapsed[0]["id"] == "ready", collapsed
assert collapsed[0]["covered_by_command"] == ["./aos", "see", "observe", "--depth", "1"], collapsed
PY
then
    pass "dev recommend collapses ready checks covered by command preflight"
else
    fail "dev recommend ready collapse failed"
fi

# --- 5. App subtree paths route only to local-contract delegation. ---
if OUT="$(./aos dev classify --json apps/example/feature.js 2>/dev/null)" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
rules = {match["id"]: match for match in data["matches"]}
assert data["status"] == "ok", data
assert "app-subtree-local-contract" in rules, rules
assert data["unmatched_paths"] == [], data["unmatched_paths"]
rule = rules["app-subtree-local-contract"]
assert rule["entry_path"] == "agent/dev", rule
assert rule["actions"][0]["kind"] == "classify_only", rule["actions"]
assert "nearest subtree AGENTS.md" in rule["control_surface"]["preferred"], rule["control_surface"]
serialized = json.dumps(rule)
assert "radial" not in serialized.lower(), serialized
assert "sigil" not in serialized.lower(), serialized
PY
then
    pass "dev classify routes app subtree changes to local-contract delegation"
else
    fail "app subtree local-contract classification failed"
fi

# --- 6. Default text mode is concise and non-JSON. ---
OUT="$(./aos dev classify src/main.swift 2>/dev/null)"
if [[ "$OUT" != \{* ]] && echo "$OUT" | grep -q 'swift-binary-source'; then
    pass "dev classify default output is text"
else
    fail "dev classify default output mismatch: $OUT"
fi

OUT="$(./aos dev recommend src/commands/dev.swift 2>/dev/null)"
if [[ "$OUT" != \{* ]] && echo "$OUT" | grep -q 'AOS dev workflow recommendation' && echo "$OUT" | grep -q './aos dev build --no-restart --json'; then
    pass "dev recommend default output is text"
else
    fail "dev recommend default output mismatch: $OUT"
fi

echo
if [ "$FAILS" -eq 0 ]; then
    echo "dev-workflow-classify: all checks passed"
    exit 0
else
    echo "dev-workflow-classify: $FAILS failure(s)"
    exit 1
fi
