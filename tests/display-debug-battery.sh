#!/usr/bin/env bash
set -euo pipefail

AOS="${AOS:-./aos}"

"$AOS" status >/dev/null
bash packages/toolkit/components/canvas-inspector/launch.sh >/dev/null
bash packages/toolkit/components/spatial-telemetry/launch.sh >/dev/null

echo "Display debug battery launched:"
echo "- canvas-inspector"
echo "- spatial-telemetry"
echo ""
echo "Useful probes:"
echo "  ./aos show eval --id spatial-telemetry --js 'JSON.stringify(window.__spatialTelemetryState?.snapshot)'"
echo "  ./aos show eval --id canvas-inspector --js 'JSON.stringify(window.__canvasInspectorState)'"
echo ""
echo "If Sigil is running, its mark heartbeat should appear automatically within a few seconds."
