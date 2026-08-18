#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test \
  tests/schemas/aos-screen-recording-v1.test.mjs \
  tests/screen-recording-contract.test.mjs \
  tests/screen-recording-fake.test.mjs

bash tests/swift-runtime-typecheck.sh
