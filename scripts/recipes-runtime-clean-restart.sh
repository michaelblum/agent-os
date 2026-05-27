#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AOS="${AOS:-$ROOT/aos}"
MODE="${MODE:-repo}"

"$AOS" service restart --mode "$MODE" >/dev/null
"$AOS" ready --json
