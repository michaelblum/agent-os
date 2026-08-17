#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

node --test \
  tests/operation-control-contract.test.mjs \
  tests/operation-control-fake.test.mjs \
  tests/operation-resource-claims.test.mjs \
  tests/operation-host-control.test.mjs \
  tests/operation-owner-root.test.mjs \
  tests/operation-external-dispatch-binding.test.mjs \
  tests/operation-daemon-integration.test.mjs \
  tests/operation-native-projections.test.mjs

swift_sources=()
while IFS= read -r source; do
  swift_sources+=("$source")
done < <(find src -type f -name '*.swift' | sort)

ipc_sources=()
while IFS= read -r source; do
  ipc_sources+=("$source")
done < <(find shared/swift/ipc -type f -name '*.swift' | sort)

swiftc -parse-as-library -typecheck "${swift_sources[@]}" "${ipc_sources[@]}" -lsqlite3
