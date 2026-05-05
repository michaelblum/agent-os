#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

node Employer_Brand_Audit/scripts/employer-brand-demo.mjs
open Employer_Brand_Audit/demo.html
