#!/usr/bin/env bash
set -euo pipefail

AOS="${AOS:-./aos}"

"$AOS" status >/dev/null
for _ in $(seq 1 20); do
  if "$AOS" show list --json >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done
bash packages/toolkit/components/canvas-inspector/launch.sh >/dev/null
bash packages/toolkit/components/spatial-telemetry/launch.sh >/dev/null

echo "Display debug battery launched:"
echo "- spatial-telemetry (flush bottom-left of main visible bounds)"
echo "- canvas-inspector (flush bottom-right of main visible bounds)"
echo ""
echo "Useful probes:"
echo "  ./aos show eval --id spatial-telemetry --js 'JSON.stringify(window.__spatialTelemetryState?.snapshot)'"
echo "  ./aos show eval --id canvas-inspector --js 'JSON.stringify(window.__canvasInspectorState)'"
echo ""
echo "If Sigil is running, its mark heartbeat should appear automatically within a few seconds."
