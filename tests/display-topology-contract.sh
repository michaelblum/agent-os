#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-display-topology.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

swiftc -Onone \
  "$ROOT/src/perceive/display-topology.swift" \
  "$ROOT/tests/lib/display-topology-identity-harness.swift" \
  -o "$TMP_ROOT/display-topology-identity-harness"
HARNESS_OUTPUT="$("$TMP_ROOT/display-topology-identity-harness")"
printf '%s\n' "$HARNESS_OUTPUT"
UUID_FIXTURE_ID="$(jq -r '.identity' "$ROOT/shared/schemas/fixtures/display-topology-v1/valid/uuid-members.json")"
FALLBACK_FIXTURE_ID="$(jq -r '.identity' "$ROOT/shared/schemas/fixtures/display-topology-v1/valid/fallback-member.json")"
grep -Fx "fixture_identity=$UUID_FIXTURE_ID" <<<"$HARNESS_OUTPUT" >/dev/null
grep -Fx "fallback_fixture_identity=$FALLBACK_FIXTURE_ID" <<<"$HARNESS_OUTPUT" >/dev/null

FAKE_AOS="$TMP_ROOT/fake-aos"
cat >"$FAKE_AOS" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

[[ "${1:-}" == "__see" && "${2:-}" == "capture" ]] || exit 2
out=""
shift 2
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--out" ]]; then
    out="${2:-}"
    shift 2
    continue
  fi
  shift
done
[[ -n "$out" ]] || exit 3
mkdir -p "$(dirname "$out")"
printf 'offline display topology fixture\n' >"$out"
python3 - "$out" <<'PY'
import json
import os
import sys

payload = {
    "status": "success",
    "state_id": "see_topology_fixture",
    "files": [sys.argv[1]],
}
if os.environ.get("AOS_FAKE_OMIT_TOPOLOGY") != "1":
    with open(os.environ["AOS_TOPOLOGY_FIXTURE"], encoding="utf-8") as handle:
        payload["display_topology"] = json.load(handle)
print(json.dumps(payload))
PY
SH
chmod +x "$FAKE_AOS"
AOS_TOPOLOGY_FIXTURE="$ROOT/shared/schemas/fixtures/display-topology-v1/valid/uuid-members.json" \
  AOS_STATE_ROOT="$TMP_ROOT/state" \
  AOS_PATH="$FAKE_AOS" \
  node "$ROOT/scripts/aos-see-native.mjs" capture \
    --region 0,0,10,10 --save --mode ax --workspace topology --name region \
    >"$TMP_ROOT/saved-region.json"
jq -e '
  .display_topology.schema == "aos.display-topology.v1"
  and .display_topology.identity == $identity
  and .state_id != .display_topology.identity
' --arg identity "$UUID_FIXTURE_ID" "$TMP_ROOT/saved-region.json" >/dev/null
if AOS_FAKE_OMIT_TOPOLOGY=1 \
  AOS_TOPOLOGY_FIXTURE="$ROOT/shared/schemas/fixtures/display-topology-v1/valid/uuid-members.json" \
  AOS_STATE_ROOT="$TMP_ROOT/state" \
  AOS_PATH="$FAKE_AOS" \
  node "$ROOT/scripts/aos-see-native.mjs" capture \
    --region 0,0,10,10 --save --mode ax --workspace topology-missing --name region \
    >"$TMP_ROOT/missing.out" 2>"$TMP_ROOT/missing.err"; then
  echo "missing display topology unexpectedly succeeded" >&2
  exit 1
fi
jq -e '.code == "DISPLAY_TOPOLOGY_MISSING"' "$TMP_ROOT/missing.err" >/dev/null

python3 - "$ROOT" <<'PY'
from pathlib import Path
import json
import re
import sys

from jsonschema import Draft202012Validator

root = Path(sys.argv[1])
pipeline = (root / "src/perceive/capture-pipeline.swift").read_text()
models = (root / "src/perceive/models.swift").read_text()
saved_capture = (root / "scripts/lib/agent-workspace/capture.mjs").read_text()

schema = json.loads((root / "shared/schemas/display-topology-v1.schema.json").read_text())
validator = Draft202012Validator(schema)
for fixture in sorted((root / "shared/schemas/fixtures/display-topology-v1/valid").glob("*.json")):
    validator.validate(json.loads(fixture.read_text()))

assert "func buildSpatialTopology(displayTopology: AOSDisplayTopologySnapshot)" in pipeline
spatial_body = pipeline.split(
    "func buildSpatialTopology(displayTopology: AOSDisplayTopologySnapshot)", 1
)[1].split("func seeListCommand()", 1)[0]
for forbidden in (
    "getCaptureDisplays()",
    "observeDisplayTopologySnapshot()",
    "NSScreen.screens",
    "CGGetActiveDisplayList",
    "CGDisplayCreateUUIDFromDisplayID",
):
    assert forbidden not in spatial_body, forbidden

capture_body = pipeline.split("func captureCommand(args: [String]) async", 1)[1]
assert capture_body.count("observeDisplayTopologySnapshot()") == 1
assert "let displays = getCaptureDisplays(from: displayTopologySnapshot)" in capture_body
assert "resolveCaptureSurface(opts: opts, displays: displays)" in capture_body
assert "buildSpatialTopology(displayTopology: displayTopologySnapshot)" in capture_body
assert "resp.display_topology = displayTopologySnapshot" in capture_body
assert "resp.state_id = makeAOSStateID()" in capture_body
assert "resp.state_id = displayTopologySnapshot.identity" not in capture_body

list_body = pipeline.split("func seeListCommand()", 1)[1].split(
    "// MARK: - Command: cursor", 1
)[0]
assert list_body.count("observeDisplayTopologySnapshot()") == 1
assert "buildSpatialTopology(displayTopology: displayTopology)" in list_body

assert "let display_topology: AOSDisplayTopologySnapshot" in models
assert "var display_topology: AOSDisplayTopologySnapshot?" in models
assert re.search(r'version:\s*"0\.3\.0"', pipeline)
assert "capture.display_topology" in saved_capture
assert "DISPLAY_TOPOLOGY_MISSING" in saved_capture
assert "{ display_topology: displayTopology }" in saved_capture

manifest = json.loads((root / "manifests/commands/aos-commands.json").read_text())
see = next(command for command in manifest["commands"] if command["path"] == ["see"])
capture = next(form for form in see["forms"] if form["id"] == "see-capture")
region = next(arg for arg in capture["args"] if arg.get("token") == "--region")
perception = next(arg for arg in capture["args"] if arg.get("token") == "--perception")
see_list = next(form for form in see["forms"] if form["id"] == "see-list")
assert "display_topology" in region["summary"]
assert "exact direct display_topology" in perception["summary"]
assert "spatial-topology 0.3.0" in see_list["summary"]
print("PASS static display-topology wiring")
PY
