#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-display-topology.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT
source "$ROOT/tests/lib/agent-workspace-fixtures/common.sh"

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
AOS_TOPOLOGY_FIXTURE="$ROOT/shared/schemas/fixtures/display-topology-v1/valid/uuid-members.json" \
  AOS_STATE_ROOT="$TMP_ROOT/state" \
  AOS_PATH="$FAKE_AOS" \
  node "$ROOT/scripts/aos-see-native.mjs" capture \
    --interactive --save --mode ax --workspace topology --name interactive \
    >"$TMP_ROOT/saved-interactive.json"
jq -e --slurpfile topology "$ROOT/shared/schemas/fixtures/display-topology-v1/valid/uuid-members.json" '
  .display_topology == $topology[0]
  and .state_id == "see_topology_fixture"
  and .state_id != .display_topology.identity
' "$TMP_ROOT/saved-interactive.json" >/dev/null
(
  cd "$ROOT"
  validate_agent_workspace_schema \
    "$TMP_ROOT/saved-region.json" \
    "$TMP_ROOT/saved-interactive.json"
)
jq '.display_topology.identity = 7' \
  "$TMP_ROOT/saved-interactive.json" \
  >"$TMP_ROOT/invalid-saved-interactive.json"
(
  cd "$ROOT"
  expect_agent_workspace_schema_rejects "$TMP_ROOT/invalid-saved-interactive.json"
)
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
if AOS_FAKE_OMIT_TOPOLOGY=1 \
  AOS_TOPOLOGY_FIXTURE="$ROOT/shared/schemas/fixtures/display-topology-v1/valid/uuid-members.json" \
  AOS_STATE_ROOT="$TMP_ROOT/state" \
  AOS_PATH="$FAKE_AOS" \
  node "$ROOT/scripts/aos-see-native.mjs" capture \
    --interactive --save --mode ax --workspace topology-interactive-missing --name interactive \
    >"$TMP_ROOT/interactive-missing.out" 2>"$TMP_ROOT/interactive-missing.err"; then
  echo "missing interactive display topology unexpectedly succeeded" >&2
  exit 1
fi
jq -e '.code == "DISPLAY_TOPOLOGY_MISSING"' "$TMP_ROOT/interactive-missing.err" >/dev/null

python3 - "$ROOT" <<'PY'
from pathlib import Path
import json
import re
import sys

from jsonschema import Draft202012Validator

root = Path(sys.argv[1])
pipeline = (root / "src/perceive/capture-pipeline.swift").read_text()
topology_owner = (root / "src/perceive/display-topology.swift").read_text()
models = (root / "src/perceive/models.swift").read_text()
saved_capture = (root / "scripts/lib/agent-workspace/capture.mjs").read_text()
native_capture = (root / "src/daemon/desktop-pixel-native.swift").read_text()

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
assert "captureNativeFramesThroughDaemon(" in capture_body
assert "topology: displayTopologySnapshot" in capture_body
assert "selectedDisplayIDs: selectedCaptureDisplayIDs" in capture_body
assert "windowIDsByDisplay: capturedWindowsByDisplay.mapValues(\\.windowID)" in capture_body
assert "content.displays.first" not in capture_body
assert "SCShareableContent" not in capture_body
assert "SCContentFilter" not in capture_body
assert "SCScreenshotManager" not in capture_body
assert "/usr/sbin/screencapture" not in capture_body
assert "interactiveImage" not in capture_body
assert "showInteractiveSelection(" in capture_body
assert "explicitSurface = CaptureSurfaceSelection(" in capture_body
assert 'kind: "region"' in capture_body
assert "if let surface = explicitSurface" in capture_body
assert "aosInteractiveSelectionGlobalBounds(" in capture_body
assert "targetDisplayIDs.count == 1" in capture_body
assert "if opts.region != nil || opts.interactive" in capture_body
assert capture_body.index("showInteractiveSelection(") < capture_body.index("captureNativeFramesThroughDaemon(")
assert capture_body.index("captureNativeFramesThroughDaemon(") < capture_body.index("// ── Capture loop ──")
assert "resolveCaptureSurface(opts: opts, displays: displays)" in capture_body
assert "buildSpatialTopology(displayTopology: displayTopologySnapshot)" in capture_body
assert "resp.display_topology = displayTopologySnapshot" in capture_body
assert "resp.state_id = makeAOSStateID()" in capture_body
assert "resp.state_id = displayTopologySnapshot.identity" not in capture_body

parser_body = pipeline.split("func parseCaptureArgs(_ args: [String])", 1)[1].split(
    "func resolveUTType(", 1
)[0]
assert '"--interactive cannot be combined with \\(conflicts.joined(separator: ", "))"' in parser_body
for option, flag in (
    ("opts.region != nil", "--region"),
    ("opts.canvasID != nil", "--canvas"),
    ("opts.channelID != nil", "--channel"),
    ("opts.windowOnly", "--window"),
    ("opts.crop != nil", "--crop"),
):
    assert f'({option}, "{flag}")' in parser_body
assert 'opts.target.hasPrefix("browser:")' in parser_body

selector_body = pipeline.split("func showInteractiveSelection(", 1)[1].split(
    "// MARK: - Command: list", 1
)[0]
assert "NSScreen.screens" not in selector_body
assert "aosInteractiveSelectionWindowBounds(" in selector_body
assert "mainDisplayHeight: mainDisplayHeight" in selector_body

observer_body = pipeline.split("func observeDisplayTopologySnapshot()", 1)[1].split(
    "func getCaptureDisplays(from snapshot:", 1
)[0]
assert "let observation = screens.compactMap" in observer_body
assert "activeDisplayIDs: activeDisplayIDs" in observer_body
assert "screenMap" not in observer_body
assert "return nativeFrame" not in observer_body
assert "?? 1" not in observer_body
assert "screen?." not in observer_body

daemon_capture_body = pipeline.split("func captureNativeFramesThroughDaemon(", 1)[1].split(
    "// MARK: - Argument Parsing", 1
)[0]
assert "topologyWire = try aosDisplayTopologyWireValue(topology)" in daemon_capture_body
assert '"display_topology": topologyWire' in daemon_capture_body
assert '"topology_ordinal": display.ordinal' in daemon_capture_body
assert '"topology_identity": topology.identity' not in daemon_capture_body
assert '"displays": displaysWire' in daemon_capture_body
assert '"display_ids": selectedDisplayIDs.map' in daemon_capture_body
assert "session.connectWithAutoStart" in daemon_capture_body
assert 'code: "DAEMON_UNREACHABLE"' in daemon_capture_body
assert "displayID == selectedDisplayIDs[frameIndex]" in daemon_capture_body
assert "expectedFrameIndex == selectedDisplayIDs.count" in daemon_capture_body
assert "aosCaptureDigest(accumulator.data) == digest" in daemon_capture_body
assert "DispatchTime.now().uptimeNanoseconds" in daemon_capture_body
assert "aosPublicCaptureForegroundBudgetMilliseconds" in daemon_capture_body
assert "multipliedReportingOverflow(by: 5)" in daemon_capture_body
assert "addingReportingOverflow(1_048_576)" in daemon_capture_body
assert "validateAOSCapturedDisplayPixelGeometry(" in capture_body
assert "func captureDisplay(" not in pipeline
assert "func captureWindow(" not in pipeline
assert "request.displayLayout?.geometry(" in native_capture
assert "aosDesktopPixelSourceDimensions(" in native_capture
assert "image.width == expectedWidth" in native_capture
assert "struct AOSDisplayCaptureProviderFact" in topology_owner
assert "func validateAOSDisplayCaptureAlignment(" in topology_owner
assert "func validateAOSCapturedDisplayPixelGeometry(" in topology_owner
assert "let pixelWidth = Int(exactly: pixelWidthValue)" in topology_owner
assert "let pixelHeight = Int(exactly: pixelHeightValue)" in topology_owner
assert "func validateAOSDisplayTopologyWireValue(" in topology_owner
assert "buildAOSDisplayTopologySnapshot(" in topology_owner

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
assert "function producesDisplayTopology(source, passthrough)" in saved_capture
assert "passthrough.includes('--interactive')" in saved_capture

manifest = json.loads((root / "manifests/commands/aos-commands.json").read_text())
see = next(command for command in manifest["commands"] if command["path"] == ["see"])
capture = next(form for form in see["forms"] if form["id"] == "see-capture")
region = next(arg for arg in capture["args"] if arg.get("token") == "--region")
perception = next(arg for arg in capture["args"] if arg.get("token") == "--perception")
interactive = next(arg for arg in capture["args"] if arg.get("token") == "--interactive")
see_list = next(form for form in see["forms"] if form["id"] == "see-list")
assert "display_topology" in region["summary"]
assert "exact direct display_topology" in perception["summary"]
assert "validated region pipeline" in interactive["summary"]
conflicts = {frozenset(group) for group in capture["constraints"]["conflicts"]}
for flag in ("region", "canvas", "channel", "window", "crop"):
    assert frozenset(("interactive", flag)) in conflicts
assert "spatial-topology 0.3.0" in see_list["summary"]
print("PASS static display-topology wiring")
PY
