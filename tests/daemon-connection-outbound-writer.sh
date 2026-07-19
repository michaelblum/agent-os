#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

swiftc -parse-as-library \
  "$ROOT/src/shared/response-envelope.swift" \
  "$ROOT/src/daemon/connection-outbound-writer.swift" \
  "$ROOT/tests/daemon-connection-outbound-writer.swift" \
  -o "$TMP/daemon-connection-outbound-writer"
"$TMP/daemon-connection-outbound-writer"

ROOT="$ROOT" node - <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(process.env.ROOT, 'src/daemon/unified.swift'), 'utf8');
assert.equal(source.includes('eventWriteQueue'), false, 'global event writer returned');
assert.match(source, /let outbound = AOSConnectionOutboundWriter\(connectionID: connectionID, fd: clientFD\)/);
assert.match(source, /outbound\.closeAndWait\(\)[\s\S]*close\(clientFD\)/);
assert.match(source, /map\(\\\.outbound\)/);
assert.match(source, /subscribers\[connectionID\]\?\.outbound[\s\S]*writer\?\.close\(reason: reason\)/);
assert.match(source, /errno == EAGAIN \|\| errno == EWOULDBLOCK[\s\S]*poll\(&descriptor/);
assert.equal(source.includes('subscribers[connectionID]?.fd'), false, 'voice event routing still looks up a raw fd');
assert.equal(source.includes('sendResponseJSON(to: clientFD'), false, 'daemon responses bypass the connection writer');
assert.equal(source.includes('_ = write(fd, ptr.baseAddress!'), false, 'event fanout still writes raw fd bytes');
console.log('daemon outbound source routing passed');
NODE
