#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-sigil-workbench-kb"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

mkdir -p "$ROOT/repo/wiki/aos/entities" "$ROOT/repo/wiki/aos/concepts"

cat >"$ROOT/repo/wiki/aos/entities/employer-brand-profile.md" <<'EOF'
---
type: entity
name: Employer Brand Profile
description: Canonical summary of a company's employer brand.
tags: [employer-brand, profile]
---

# Employer Brand Profile

## Purpose

Summarize the current employer brand using normalized evidence and reusable dimensions.
EOF

cat >"$ROOT/repo/wiki/aos/concepts/employer-brand-workflow-map.md" <<'EOF'
---
type: concept
name: Employer Brand Workflow Map
description: Links the workflow sequence to the canonical profile artifact.
tags: [employer-brand, workflow]
---

# Employer Brand Workflow Map

## Related

- [Employer Brand Profile](../entities/employer-brand-profile.md)
EOF

./aos wiki reindex >/dev/null

aos_test_start_daemon "$ROOT" toolkit packages/toolkit sigil apps/sigil \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

LAUNCH_OUT="$ROOT/launch.out"
AOS="$(pwd)/aos" \
AOS_BIN="$(pwd)/aos" \
AOS_RUNTIME_MODE=repo \
MODE=repo \
bash apps/sigil/workbench/launch.sh >"$LAUNCH_OUT"

./aos show wait \
  --id sigil-workbench \
  --js 'window.__sigilWorkbenchState && window.__sigilWorkbenchState.activationCount === 1 && window.__sigilWorkbenchState.lastActivation && window.__sigilWorkbenchState.lastActivation.title === "Studio"' \
  --timeout 10s >/dev/null

./aos show post --id sigil-workbench --event '{"type":"tabs/activate","payload":{"name":"wiki-kb"}}' >/dev/null
./aos show post --id sigil-workbench --event '{"type":"wiki-kb/reveal","payload":{"id":"aos/entities/employer-brand-profile.md","view":"graph"}}' >/dev/null

./aos show wait \
  --id sigil-workbench \
  --js 'document.querySelector(".aos-tab[data-active=\"true\"]")?.textContent === "Knowledge Base" && document.querySelector(".wiki-kb-sidebar-name")?.textContent === "Employer Brand Profile" && window.__sigilWorkbenchState?.lastWikiSelection?.path === "aos/entities/employer-brand-profile.md"' \
  --timeout 10s >/dev/null

python3 - "$LAUNCH_OUT" <<'PY'
import json
import pathlib
import subprocess
import sys

launch_out = pathlib.Path(sys.argv[1]).read_text()
if "Sigil workbench launched." not in launch_out:
    raise SystemExit(f"FAIL: launcher did not report success:\n{launch_out}")

payload = json.loads(subprocess.check_output([
    "./aos", "show", "eval", "--id", "sigil-workbench", "--js",
    "JSON.stringify({"
    "tab: document.querySelector('.aos-tab[data-active=\"true\"]')?.textContent ?? null,"
    "status: document.querySelector('.wiki-kb-status')?.textContent ?? '',"
    "sidebar: document.querySelector('.wiki-kb-sidebar-name')?.textContent ?? '',"
    "related: [...document.querySelectorAll('.wiki-kb-related-link')].map((el) => el.textContent.trim()),"
    "selection: window.__sigilWorkbenchState?.lastWikiSelection ?? null"
    "})"
], text=True))
state = json.loads(payload["result"])

if state["tab"] != "Knowledge Base":
    raise SystemExit(f"FAIL: wrong active tab: {state}")
if state["sidebar"] != "Employer Brand Profile":
    raise SystemExit(f"FAIL: KB sidebar did not reveal target node: {state}")
if "2 nodes" not in state["status"] or "1 links" not in state["status"]:
    raise SystemExit(f"FAIL: unexpected KB graph status: {state}")
if "Employer Brand Workflow Map" not in state["related"]:
    raise SystemExit(f"FAIL: expected related node missing: {state}")
selection = state.get("selection") or {}
if selection.get("path") != "aos/entities/employer-brand-profile.md":
    raise SystemExit(f"FAIL: workbench state did not mirror wiki selection: {state}")

print("PASS")
PY
