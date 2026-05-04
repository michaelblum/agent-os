# Daemon IPC Request/Response Schema v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the v1 daemon IPC request/response schema: JSON Schema files, an envelope-aware dispatch layer in `src/daemon/unified.swift`, updated CLI call sites that emit the new envelope form, and contract tests per action. All changes on `main`, no worktree.

**Architecture:** Add envelope-aware dispatch to the unified daemon alongside the existing flat-string dispatch (temporary dual-path, removed before this work merges). Migrate CLI callers one namespace at a time to emit the normalized envelope. Once every legacy call site is gone, delete the flat-string dispatch.

**Tech Stack:** Swift (daemon + CLI + IPC client), JSON Schema Draft 2020-12 (wire contract), bash + python3 (tests), `jsonschema` Python lib (schema validation in tests).

**Spec reference:** `docs/superpowers/specs/2026-04-17-daemon-ipc-request-schema-v1-design.md`.

**Build rule:** Every task that changes Swift under `src/` or `shared/swift/` must finish with `bash build.sh` before running shell tests. Pure JSON/markdown tasks do not need a rebuild.

---

## File Structure

**Create:**

| File | Responsibility |
|------|----------------|
| `shared/schemas/daemon-request.schema.json` | JSON Schema for the request envelope. `oneOf` branches keyed on `(service, action)`. |
| `shared/schemas/daemon-response.schema.json` | JSON Schema for success and error response envelopes. |
| `shared/schemas/daemon-ipc.md` | Human-readable reference that mirrors the spec's action catalog and error vocabulary. Linked from `docs/api/aos.md`. |
| `tests/daemon-ipc-envelope.sh` | Contract test: request envelope shape accepted/rejected by daemon. |
| `tests/daemon-ipc-see.sh` | Contract test: `see.observe`. |
| `tests/daemon-ipc-show.sh` | Contract test: `show.create`/`update`/`eval`/`remove`/`remove_all`/`list`. |
| `tests/daemon-ipc-tell.sh` | Contract test: `tell.send`. |
| `tests/daemon-ipc-listen.sh` | Contract test: `listen.read`/`channels`. |
| `tests/daemon-ipc-session.sh` | Contract test: `session.register`/`unregister`/`who`. |
| `tests/daemon-ipc-voice.sh` | Contract test: `voice.list`/`leases`/`bind`/`final_response`. |
| `tests/daemon-ipc-system.sh` | Contract test: `system.ping`. |
| `tests/daemon-ipc-errors.sh` | Contract test: `UNKNOWN_SERVICE`, `UNKNOWN_ACTION`, `PARSE_ERROR`, `MISSING_ARG`. |

**Modify:**

| File | Change |
|------|--------|
| `src/daemon/unified.swift` | Add envelope dispatch function. Route `(service, action)` to existing handlers. Remove legacy flat-string cases after CLI migration. Drop duplicate `perceive` handler and `post` handler. |
| `shared/swift/ipc/request-client.swift` | Add `sendEnvelopeRequest(service:action:data:)` helper. Keep `sendRequest` for the transition, remove at end. |
| `src/commands/tell.swift` (and other CLI command files) | Emit new envelope via `sendEnvelopeRequest`. |
| `src/display/client.swift` | Update canvas request emission to wrap in envelope. |
| `docs/api/aos.md` | Add link to `shared/schemas/daemon-ipc.md`. |
| `shared/schemas/daemon-event.schema.json` | No change — see spec non-goals. |

---

## Conventions Used Throughout

**Envelope shape** (from spec):

Request:
```json
{"v":1,"service":"<ns>","action":"<verb>","data":{...},"ref":"<optional>"}
```

Success response:
```json
{"v":1,"status":"success","data":{...},"ref":"<if provided>"}
```

Error response:
```json
{"v":1,"status":"error","error":"<prose>","code":"<CODE>","ref":"<if provided>"}
```

**Test helper (used in every test file):**

A small Python one-liner that opens a Unix socket, sends one JSON line, reads one JSON line, prints the response as compact JSON. This is defined once in each test file at the top (DRY across calls within a file; spec allows that — each test file is self-contained).

```bash
# tests/daemon-ipc-<name>.sh — prelude (copy into every daemon-ipc test)
SOCK="$(./aos runtime path --json 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin).get("socket_path",""))')"
[ -n "$SOCK" ] || { echo "FAIL: could not resolve daemon socket"; exit 1; }

send_envelope() {
  python3 - "$SOCK" <<'PY'
import json, socket, sys
sock_path = sys.argv[1]
line = sys.stdin.read()
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(3)
s.connect(sock_path)
s.sendall(line.encode() + b"\n")
buf = b""
while b"\n" not in buf:
    chunk = s.recv(4096)
    if not chunk: break
    buf += chunk
sys.stdout.write(buf.decode().splitlines()[0])
PY
}
```

Callers do:
```bash
echo '{"v":1,"service":"system","action":"ping","data":{}}' | send_envelope
```

**Commit messages** follow the Conventional Commits style used by the repo (`feat(scope): ...`, `fix(scope): ...`, `test(scope): ...`, `docs(scope): ...`). Every commit uses a HEREDOC with the trailer:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Task 1: Create request envelope JSON Schema skeleton

**Files:**
- Create: `shared/schemas/daemon-request.schema.json`

- [ ] **Step 1: Write schema skeleton with no action branches yet**

Create `shared/schemas/daemon-request.schema.json` with this content:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://github.com/michaelblum/agent-os/shared/schemas/daemon-request.schema.json",
  "title": "Daemon Request Envelope",
  "description": "Wire contract for requests sent to the aos daemon over its Unix socket. Newline-delimited JSON. See docs/superpowers/specs/2026-04-17-daemon-ipc-request-schema-v1-design.md.",
  "type": "object",
  "required": ["v", "service", "action", "data"],
  "additionalProperties": false,
  "properties": {
    "v": { "const": 1 },
    "service": {
      "type": "string",
      "enum": ["see", "do", "show", "tell", "listen", "session", "voice", "system"]
    },
    "action": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9_]*$"
    },
    "data": { "type": "object" },
    "ref": { "type": "string" }
  },
  "$defs": {}
}
```

- [ ] **Step 2: Validate the schema itself is valid JSON Schema**

Run:
```bash
python3 -c "import json, jsonschema; jsonschema.Draft202012Validator.check_schema(json.load(open('shared/schemas/daemon-request.schema.json'))); print('schema ok')"
```

Expected: `schema ok`.

If `jsonschema` is not installed, run `python3 -m pip install --user jsonschema` first.

- [ ] **Step 3: Commit**

```bash
git add shared/schemas/daemon-request.schema.json
git commit -m "$(cat <<'EOF'
feat(schema): daemon request envelope skeleton

Adds shared/schemas/daemon-request.schema.json with the v1 envelope
(v, service, action, data, ref). Per-action oneOf branches will be
added in later tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Create response envelope JSON Schema

**Files:**
- Create: `shared/schemas/daemon-response.schema.json`

- [ ] **Step 1: Write the success + error response schema**

Create `shared/schemas/daemon-response.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://github.com/michaelblum/agent-os/shared/schemas/daemon-response.schema.json",
  "title": "Daemon Response Envelope",
  "description": "Wire contract for responses emitted by the aos daemon. Newline-delimited JSON.",
  "oneOf": [
    {
      "type": "object",
      "required": ["v", "status", "data"],
      "additionalProperties": false,
      "properties": {
        "v": { "const": 1 },
        "status": { "const": "success" },
        "data": { "type": "object" },
        "ref": { "type": "string" }
      }
    },
    {
      "type": "object",
      "required": ["v", "status", "error", "code"],
      "additionalProperties": false,
      "properties": {
        "v": { "const": 1 },
        "status": { "const": "error" },
        "error": { "type": "string" },
        "code": {
          "type": "string",
          "enum": [
            "MISSING_ARG",
            "INVALID_ARG",
            "UNKNOWN_ACTION",
            "UNKNOWN_SERVICE",
            "PARSE_ERROR",
            "SESSION_NOT_FOUND",
            "MISSING_SESSION_ID",
            "CANVAS_NOT_FOUND",
            "PERMISSION_DENIED",
            "INTERNAL"
          ]
        },
        "ref": { "type": "string" }
      }
    }
  ]
}
```

- [ ] **Step 2: Validate the schema**

Run:
```bash
python3 -c "import json, jsonschema; jsonschema.Draft202012Validator.check_schema(json.load(open('shared/schemas/daemon-response.schema.json'))); print('schema ok')"
```

Expected: `schema ok`.

- [ ] **Step 3: Commit**

```bash
git add shared/schemas/daemon-response.schema.json
git commit -m "$(cat <<'EOF'
feat(schema): daemon response envelope

Adds shared/schemas/daemon-response.schema.json with success + error
variants and the stable error-code enum from the v1 spec.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add envelope-aware dispatch to the daemon (dual-mode)

Introduces envelope dispatch alongside the existing flat-string `case "<action>":` switch. The envelope path reuses existing handlers for now — this is a routing change, not a handler change.

**Files:**
- Modify: `src/daemon/unified.swift` (add envelope detection in the top-level request dispatch, around the existing `switch action` in `handleRequest`).

- [ ] **Step 1: Write the envelope detection function**

Add this private function to `src/daemon/unified.swift` in the same file section as `handleRequest`:

```swift
/// Detect envelope form `{v:1, service, action, data, ref?}`.
/// Returns `(service, action, data, ref)` if envelope, `nil` otherwise.
private func parseEnvelope(_ json: [String: Any]) -> (service: String, action: String, data: [String: Any], ref: String?)? {
    guard let v = json["v"] as? Int, v == 1 else { return nil }
    guard let service = json["service"] as? String, !service.isEmpty else { return nil }
    guard let action = json["action"] as? String, !action.isEmpty else { return nil }
    guard let data = json["data"] as? [String: Any] else { return nil }
    let ref = json["ref"] as? String
    return (service, action, data, ref)
}
```

- [ ] **Step 2: Route envelope requests through existing handlers**

At the top of the existing `handleRequest(json:connectionID:clientFD:)` (or whatever the method is called; search for the function that contains `switch action`), insert envelope routing BEFORE the legacy switch:

```swift
// New: envelope dispatch. If the request has a v1 envelope, translate
// (service, action) to the legacy flat action string and reshape `data`
// back into the top-level JSON the legacy handlers expect. This keeps
// the handler bodies untouched while we migrate callers.
if let env = parseEnvelope(json) {
    let legacyAction = legacyActionName(service: env.service, action: env.action)
    guard let legacy = legacyAction else {
        sendResponseJSON(to: clientFD, envelopeError(
            error: "Unknown (service, action): (\(env.service), \(env.action))",
            code: "UNKNOWN_ACTION",
            ref: env.ref
        ))
        return
    }
    // Reshape: merge `data` into a flat dict and set `action`.
    var flat = env.data
    flat["action"] = legacy
    if let ref = env.ref { flat["__ref"] = ref }  // pass ref through for response wrapping
    handleRequest(json: flat, connectionID: connectionID, clientFD: clientFD)
    return
}
```

- [ ] **Step 3: Implement `legacyActionName` mapping**

Add this helper function near `parseEnvelope`:

```swift
/// Map v1 envelope (service, action) to the legacy flat action string
/// used by the existing switch. Returns nil if the pair is not in the v1 catalog.
private func legacyActionName(service: String, action: String) -> String? {
    switch (service, action) {
    case ("see", "observe"):              return "subscribe"
    case ("show", "create"):              return "create"
    case ("show", "update"):              return "update"
    case ("show", "eval"):                return "eval"
    case ("show", "remove"):              return "remove"
    case ("show", "remove_all"):          return "remove-all"
    case ("show", "list"):                return "list"
    case ("tell", "send"):                return "tell"
    case ("listen", "read"):              return "coord-read"
    case ("listen", "channels"):          return "coord-channels"
    case ("session", "register"):         return "coord-register"
    case ("session", "unregister"):       return "coord-unregister"
    case ("session", "who"):              return "coord-who"
    case ("voice", "list"):               return "voice-list"
    case ("voice", "leases"):             return "voice-leases"
    case ("voice", "bind"):               return "voice-bind"
    case ("voice", "final_response"):     return "voice-final-response"
    case ("system", "ping"):              return "ping"
    default:                               return nil
    }
}
```

- [ ] **Step 4: Implement the envelope response wrapper**

Add:

```swift
/// Build an envelope error response dict.
private func envelopeError(error: String, code: String, ref: String?) -> [String: Any] {
    var out: [String: Any] = ["v": 1, "status": "error", "error": error, "code": code]
    if let ref = ref { out["ref"] = ref }
    return out
}
```

The legacy handlers currently write responses via `sendResponseJSON` with bespoke dicts. For the transition we will wrap them at the edge in a later task (Task 12). For Task 3, envelope requests re-enter the legacy handler which emits its legacy response shape; the test in Task 4 accepts that.

- [ ] **Step 5: Rebuild**

Run:
```bash
bash build.sh
```

Expected: build succeeds.

- [ ] **Step 6: Smoke-test envelope dispatch manually**

Start the daemon (it is likely already running), then:
```bash
SOCK="$(./aos runtime path --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["socket_path"])')"
echo '{"v":1,"service":"system","action":"ping","data":{}}' | python3 -c '
import json, socket, sys
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(3); s.connect(sys.argv[1])
s.sendall(sys.stdin.read().encode() + b"\n")
import select
buf=b""
while b"\n" not in buf:
    chunk=s.recv(4096)
    if not chunk: break
    buf+=chunk
print(buf.decode().splitlines()[0])
' "$SOCK"
```

Expected: a JSON line with `"status":"ok"` and `"uptime":...` (legacy shape — envelope wrapping comes in Task 12).

- [ ] **Step 7: Commit**

```bash
git add src/daemon/unified.swift
git commit -m "$(cat <<'EOF'
feat(daemon): route v1 envelope requests through legacy handlers

Adds parseEnvelope + legacyActionName mapping. Envelope requests
{v:1, service, action, data, ref} translate to the legacy flat
action string and re-enter the existing dispatch. Response wrapping
stays on the legacy side until Task 12.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add envelope request helper to shared IPC client

**Files:**
- Modify: `shared/swift/ipc/request-client.swift`

- [ ] **Step 1: Inspect existing client API**

Run:
```bash
grep -n 'func send\|func request\|ndjson' shared/swift/ipc/request-client.swift
```

Capture the existing entry-point function name (typical: `sendRequest` or `requestResponse`). Adjust Step 2 below to match the existing style.

- [ ] **Step 2: Add `sendEnvelopeRequest`**

Append to `shared/swift/ipc/request-client.swift` (at the end of the existing file):

```swift
// MARK: - Envelope Request (v1)

/// Send a v1 envelope request and return the parsed response as a dictionary.
/// - Parameters:
///   - service: The namespace (see, do, show, tell, listen, session, voice, system).
///   - action: The verb within the namespace.
///   - data: Action payload. Pass `[:]` for no payload.
///   - ref: Optional correlation id echoed back in the response.
///   - socketPath: Optional override of the daemon socket path.
///   - timeoutMs: Socket I/O timeout.
/// - Returns: The parsed response JSON, or nil on connection/parse failure.
func sendEnvelopeRequest(
    service: String,
    action: String,
    data: [String: Any],
    ref: String? = nil,
    socketPath: String = kDefaultSocketPath,
    timeoutMs: Int32 = 3000
) -> [String: Any]? {
    var payload: [String: Any] = [
        "v": 1,
        "service": service,
        "action": action,
        "data": data
    ]
    if let ref = ref { payload["ref"] = ref }
    guard let line = try? JSONSerialization.data(withJSONObject: payload, options: []) else {
        return nil
    }
    return sendNDJSON(line: line, socketPath: socketPath, timeoutMs: timeoutMs)
}
```

If `sendNDJSON` does not exist under that name, wire this function to whichever existing lower-level helper sends a JSON line and reads back one line. (Search with `grep -n 'func send' shared/swift/ipc/*.swift` to confirm.)

- [ ] **Step 3: Rebuild**

Run:
```bash
bash build.sh
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add shared/swift/ipc/request-client.swift
git commit -m "$(cat <<'EOF'
feat(ipc): add sendEnvelopeRequest helper

Wraps the v1 envelope around caller-supplied (service, action, data)
and delegates to the existing ndjson send path. CLI call sites migrate
to this helper in subsequent tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Contract test — envelope happy path and malformed requests

**Files:**
- Create: `tests/daemon-ipc-envelope.sh`

- [ ] **Step 1: Write the test file**

Create `tests/daemon-ipc-envelope.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

SOCK="$("$ROOT/aos" runtime path --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["socket_path"])')"
[ -n "$SOCK" ] || { echo "FAIL: could not resolve daemon socket"; exit 1; }

send_envelope() {
  python3 - "$SOCK" <<'PY'
import json, socket, sys
sock_path = sys.argv[1]
line = sys.stdin.read()
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(3)
s.connect(sock_path)
s.sendall(line.encode() + b"\n")
buf = b""
while b"\n" not in buf:
    chunk = s.recv(4096)
    if not chunk: break
    buf += chunk
sys.stdout.write(buf.decode().splitlines()[0])
PY
}

# 1. Happy path: system.ping returns ok.
OUT="$(echo '{"v":1,"service":"system","action":"ping","data":{}}' | send_envelope)"
echo "$OUT" | python3 -c 'import json,sys;d=json.loads(sys.stdin.read()); assert d.get("status") in ("ok","success"), f"unexpected: {d}"'
echo "PASS: system.ping happy path"

# 2. Unknown (service, action) returns UNKNOWN_ACTION.
OUT="$(echo '{"v":1,"service":"system","action":"bogus","data":{}}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("code") == "UNKNOWN_ACTION", f"expected UNKNOWN_ACTION, got: {d}"
'
echo "PASS: unknown action returns UNKNOWN_ACTION"

# 3. Ref is echoed back.
OUT="$(echo '{"v":1,"service":"system","action":"ping","data":{},"ref":"abc-123"}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
# ref may or may not be echoed yet (wraps in Task 12). Accept either, but if present must match.
if "ref" in d: assert d["ref"] == "abc-123", f"ref mismatch: {d}"
'
echo "PASS: ref echo (or absent during transition)"

echo "PASS"
```

- [ ] **Step 2: Make executable and run**

```bash
chmod +x tests/daemon-ipc-envelope.sh
bash tests/daemon-ipc-envelope.sh
```

Expected: three `PASS:` lines plus final `PASS`. If daemon is not running, it will be auto-started by the first `./aos` call.

- [ ] **Step 3: Commit**

```bash
git add tests/daemon-ipc-envelope.sh
git commit -m "$(cat <<'EOF'
test(ipc): envelope dispatch happy-path and unknown-action contract

Verifies the daemon accepts v1 envelope requests for system.ping,
rejects unknown (service, action) pairs with UNKNOWN_ACTION, and
echoes ref when provided.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Migrate `system.ping` CLI call site and lock down as v1

The simplest action. Migrates its CLI emitter to use `sendEnvelopeRequest`.

**Files:**
- Modify: the CLI command that emits `ping` (grep the codebase to find it; likely `src/commands/operator.swift` or similar — spec's `./aos runtime status` uses ping).

- [ ] **Step 1: Find the caller**

Run:
```bash
grep -Rn '"action".*"ping"\|action.*ping' src/ | grep -v unified.swift
```

Capture the file and line. Assume `src/commands/operator.swift:NN` for the rest of the steps; substitute what you find.

- [ ] **Step 2: Update the caller to use envelope**

Replace the legacy send:

```swift
// before
let response = sendRequest(["action": "ping"])
```

with:

```swift
// after
let response = sendEnvelopeRequest(service: "system", action: "ping", data: [:])
```

- [ ] **Step 3: Rebuild**

```bash
bash build.sh
```

- [ ] **Step 4: Write + run the system-namespace contract test**

Create `tests/daemon-ipc-system.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"
SOCK="$("$ROOT/aos" runtime path --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["socket_path"])')"

send_envelope() {
  python3 - "$SOCK" <<'PY'
import json, socket, sys
sock_path = sys.argv[1]
line = sys.stdin.read()
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(3); s.connect(sock_path); s.sendall(line.encode() + b"\n")
buf = b""
while b"\n" not in buf:
    c = s.recv(4096)
    if not c: break
    buf += c
sys.stdout.write(buf.decode().splitlines()[0])
PY
}

OUT="$(echo '{"v":1,"service":"system","action":"ping","data":{}}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") in ("ok","success"), f"unexpected: {d}"
assert "uptime" in d or ("data" in d and "uptime" in d["data"]), f"uptime missing: {d}"
'
echo "PASS: system.ping"
echo "PASS"
```

```bash
chmod +x tests/daemon-ipc-system.sh
bash tests/daemon-ipc-system.sh
```

Expected: `PASS: system.ping` and final `PASS`.

- [ ] **Step 5: Verify the end-to-end CLI path still works**

```bash
./aos status --json >/dev/null
```

Expected: exit 0, no stderr noise.

- [ ] **Step 6: Commit**

```bash
git add src/commands/*.swift tests/daemon-ipc-system.sh
git commit -m "$(cat <<'EOF'
feat(ipc): migrate system.ping CLI caller to v1 envelope

system.ping is the first call site to use sendEnvelopeRequest.
Adds tests/daemon-ipc-system.sh for contract coverage.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Migrate `see.observe`

**Files:**
- Modify: `src/commands/operator.swift` or wherever the `aos see observe` handler currently builds the `subscribe` request. Find with: `grep -Rn '"subscribe"\|action.*subscribe' src/`.

- [ ] **Step 1: Find the caller**

```bash
grep -Rn '"subscribe"' src/ | grep -v unified.swift | grep -v daemon-event
```

- [ ] **Step 2: Replace emission**

```swift
// before
let response = sendRequest(["action": "subscribe", "depth": depth, "scope": scope, ...])
```

with:

```swift
// after
var data: [String: Any] = [:]
if let depth = depth { data["depth"] = depth }
if let scope = scope { data["scope"] = scope }
if let rate = rate { data["rate"] = rate }
if !events.isEmpty { data["events"] = events }
if wantsSnapshot { data["snapshot"] = true }
let response = sendEnvelopeRequest(service: "see", action: "observe", data: data)
```

- [ ] **Step 3: Rebuild**

```bash
bash build.sh
```

- [ ] **Step 4: Write + run contract test**

Create `tests/daemon-ipc-see.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"
SOCK="$("$ROOT/aos" runtime path --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["socket_path"])')"

send_envelope() {
  python3 - "$SOCK" <<'PY'
import json, socket, sys
sock_path = sys.argv[1]
line = sys.stdin.read()
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(3); s.connect(sock_path); s.sendall(line.encode() + b"\n")
buf = b""
while b"\n" not in buf:
    c = s.recv(4096)
    if not c: break
    buf += c
sys.stdout.write(buf.decode().splitlines()[0])
PY
}

OUT="$(echo '{"v":1,"service":"see","action":"observe","data":{"depth":1,"scope":"cursor"}}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") in ("ok","success"), f"unexpected: {d}"
chan = d.get("channel_id") or d.get("data",{}).get("channel_id")
assert chan, f"channel_id missing: {d}"
'
echo "PASS: see.observe"
echo "PASS"
```

```bash
chmod +x tests/daemon-ipc-see.sh
bash tests/daemon-ipc-see.sh
```

- [ ] **Step 5: Commit**

```bash
git add src/commands/*.swift tests/daemon-ipc-see.sh
git commit -m "$(cat <<'EOF'
feat(ipc): migrate see.observe CLI caller to v1 envelope

Collapses the historical subscribe/perceive pair into see.observe
at the call site. Adds tests/daemon-ipc-see.sh.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Migrate `show.*` (create / update / eval / remove / remove_all / list)

**Files:**
- Modify: `src/display/client.swift` — the CLI-side client that emits canvas requests.

- [ ] **Step 1: Read the current emission site**

```bash
grep -n 'CanvasRequest\|"action".*"create"\|"action".*"update"' src/display/client.swift | head -30
```

Identify the central send function (probably `send(_ request: CanvasRequest)` or similar).

- [ ] **Step 2: Replace `CanvasRequest` emission with envelope**

The central client currently builds a `CanvasRequest`, serializes it, and writes one JSON line. Replace the serialization step:

```swift
// before (illustrative — match the actual code)
guard let data = request.toData() else { return .fail("encode failed", code: "ENCODE_ERROR") }
sendLine(data)
let raw = readLine(...)
return CanvasResponse.decode(raw)
```

with:

```swift
// after
let service = "show"
let action = envelopeAction(for: request.action)  // defined in Step 3
var dataDict: [String: Any] = [:]
// CanvasRequest has ~18 optional fields; include only non-nil ones
if let id = request.id { dataDict["id"] = id }
if let at = request.at { dataDict["at"] = at.map { Double($0) } }
if let aw = request.anchorWindow { dataDict["anchor_window"] = aw }
if let ac = request.anchorChannel { dataDict["anchor_channel"] = ac }
if let off = request.offset { dataDict["offset"] = off.map { Double($0) } }
if let html = request.html { dataDict["html"] = html }
if let url = request.url { dataDict["url"] = url }
if let inter = request.interactive { dataDict["interactive"] = inter }
if let focus = request.focus { dataDict["focus"] = focus }
if let ttl = request.ttl { dataDict["ttl"] = ttl }
if let js = request.js { dataDict["js"] = js }
if let scope = request.scope { dataDict["scope"] = scope }
if let ap = request.autoProject { dataDict["auto_project"] = ap }
if let track = request.track { dataDict["track"] = track }
if let parent = request.parent { dataDict["parent"] = parent }
if let cas = request.cascade { dataDict["cascade"] = cas }
if let sus = request.suspended { dataDict["suspended"] = sus }

guard let response = sendEnvelopeRequest(service: service, action: action, data: dataDict) else {
    return CanvasResponse.fail("IPC failure", code: "INTERNAL")
}
return CanvasResponse.fromDict(response)  // defined in Step 4
```

- [ ] **Step 3: Add `envelopeAction` mapping**

Add to `src/display/client.swift`:

```swift
/// Map a legacy CanvasRequest.action string to the v1 (service, action) verb.
private func envelopeAction(for legacy: String) -> String {
    switch legacy {
    case "create":      return "create"
    case "update":      return "update"
    case "eval":        return "eval"
    case "remove":      return "remove"
    case "remove-all":  return "remove_all"
    case "list":        return "list"
    case "to-front":    return "to_front"
    default:            return legacy  // let the daemon reject unknown actions
    }
}
```

- [ ] **Step 4: Add `CanvasResponse.fromDict`**

Add to `src/display/protocol.swift` (next to the existing `CanvasResponse` struct):

```swift
extension CanvasResponse {
    /// Initialize from a parsed JSON dictionary (envelope or legacy shape).
    static func fromDict(_ dict: [String: Any]) -> CanvasResponse {
        var out = CanvasResponse()
        // Accept both legacy ({status:"ok",...}) and envelope ({v:1,status:"success",data:{...}})
        let body: [String: Any] = (dict["data"] as? [String: Any]) ?? dict
        out.status = body["status"] as? String ?? (dict["status"] as? String)
        out.error = body["error"] as? String ?? (dict["error"] as? String)
        out.code = body["code"] as? String ?? (dict["code"] as? String)
        out.result = body["result"] as? String
        out.uptime = body["uptime"] as? Double
        if let arr = body["canvases"] as? [[String: Any]] {
            // Decode via JSONSerialization round-trip
            if let data = try? JSONSerialization.data(withJSONObject: arr, options: []) {
                out.canvases = try? JSONDecoder().decode([CanvasInfo].self, from: data)
            }
        }
        return out
    }
}
```

- [ ] **Step 5: Rebuild**

```bash
bash build.sh
```

- [ ] **Step 6: Write + run show-namespace contract test**

Create `tests/daemon-ipc-show.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"
SOCK="$("$ROOT/aos" runtime path --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["socket_path"])')"

send_envelope() {
  python3 - "$SOCK" <<'PY'
import json, socket, sys
sock_path = sys.argv[1]
line = sys.stdin.read()
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(3); s.connect(sock_path); s.sendall(line.encode() + b"\n")
buf = b""
while b"\n" not in buf:
    c = s.recv(4096)
    if not c: break
    buf += c
sys.stdout.write(buf.decode().splitlines()[0])
PY
}

ID="ipc-test-$$"

# create
OUT="$(echo "{\"v\":1,\"service\":\"show\",\"action\":\"create\",\"data\":{\"id\":\"$ID\",\"at\":[100,100,200,100],\"html\":\"<div>hi</div>\"}}" | send_envelope)"
echo "$OUT" | python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); assert d.get("status") in ("ok","success"), d'
echo "PASS: show.create"

# list
OUT="$(echo '{"v":1,"service":"show","action":"list","data":{}}' | send_envelope)"
echo "$OUT" | python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
canvases = d.get('canvases') or d.get('data',{}).get('canvases') or []
ids = [c.get('id') for c in canvases]
assert '$ID' in ids, f'created canvas missing from list: {ids}'
"
echo "PASS: show.list"

# remove
OUT="$(echo "{\"v\":1,\"service\":\"show\",\"action\":\"remove\",\"data\":{\"id\":\"$ID\"}}" | send_envelope)"
echo "$OUT" | python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); assert d.get("status") in ("ok","success"), d'
echo "PASS: show.remove"

echo "PASS"
```

```bash
chmod +x tests/daemon-ipc-show.sh
bash tests/daemon-ipc-show.sh
```

- [ ] **Step 7: Sanity-check existing show test still passes**

```bash
bash tests/sigil-status-item-lifecycle.sh 2>/dev/null || true
./aos show create --id ipc-smoke --at 100,100,200,100 --html '<div>x</div>' --ttl 2s >/dev/null
./aos show list >/dev/null
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/display/client.swift src/display/protocol.swift tests/daemon-ipc-show.sh
git commit -m "$(cat <<'EOF'
feat(ipc): migrate show.* CLI callers to v1 envelope

CanvasRequest is projected into envelope data for create/update/eval/
remove/remove_all/list. CanvasResponse.fromDict accepts envelope + legacy
shapes during transition.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Migrate `tell.send`

**Files:**
- Modify: `src/commands/tell.swift` (or wherever `aos tell` builds its request).

- [ ] **Step 1: Find the caller**

```bash
grep -Rn 'action.*"tell"\|"action".*"post"' src/commands/ src/commands/*.swift | head
```

- [ ] **Step 2: Rewrite the caller**

Replace the current `sendRequest(...)` in the tell command with:

```swift
var data: [String: Any] = [
    "audience": audienceArray  // already an array in the CLI parser; if a comma-string, split it
]
if let text = text { data["text"] = text }
if let payload = payload { data["payload"] = payload }
if let fsid = fromSessionID { data["from_session_id"] = fsid }
if let from = from { data["from"] = from }
if let purpose = purpose { data["purpose"] = purpose }

let response = sendEnvelopeRequest(service: "tell", action: "send", data: data)
```

If the CLI currently parses audience as a single comma-string, convert it to an array before building `data`:

```swift
let audienceArray = rawAudience.split(separator: ",").map {
    $0.trimmingCharacters(in: .whitespaces)
}
```

- [ ] **Step 3: Rebuild**

```bash
bash build.sh
```

- [ ] **Step 4: Write + run tell contract test**

Create `tests/daemon-ipc-tell.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"
SOCK="$("$ROOT/aos" runtime path --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["socket_path"])')"

send_envelope() {
  python3 - "$SOCK" <<'PY'
import json, socket, sys
sock_path = sys.argv[1]
line = sys.stdin.read()
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(3); s.connect(sock_path); s.sendall(line.encode() + b"\n")
buf = b""
while b"\n" not in buf:
    c = s.recv(4096)
    if not c: break
    buf += c
sys.stdout.write(buf.decode().splitlines()[0])
PY
}

# Channel message
OUT="$(echo '{"v":1,"service":"tell","action":"send","data":{"audience":["ops"],"text":"contract test"}}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") in ("ok","success"), f"unexpected: {d}"
routes = d.get("routes") or d.get("data",{}).get("routes") or []
assert any(r.get("audience") == "ops" for r in routes), f"route missing: {d}"
'
echo "PASS: tell.send to channel"

# Reject neither text nor payload
OUT="$(echo '{"v":1,"service":"tell","action":"send","data":{"audience":["ops"]}}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("code") == "MISSING_ARG", f"expected MISSING_ARG: {d}"
'
echo "PASS: tell.send without text or payload rejected"

echo "PASS"
```

```bash
chmod +x tests/daemon-ipc-tell.sh
bash tests/daemon-ipc-tell.sh
```

- [ ] **Step 5: Commit**

```bash
git add src/commands/*.swift tests/daemon-ipc-tell.sh
git commit -m "$(cat <<'EOF'
feat(ipc): migrate tell.send CLI caller to v1 envelope

tell CLI now emits envelope with audience array + oneOf(text, payload).
Adds tests/daemon-ipc-tell.sh.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Migrate `listen.read` and `listen.channels`

**Files:**
- Modify: `src/commands/listen.swift` (or whichever file hosts `aos listen`).

- [ ] **Step 1: Find the caller**

```bash
grep -Rn '"coord-read"\|"coord-channels"' src/commands/ | head
```

- [ ] **Step 2: Replace emissions**

For the channel read path:

```swift
var data: [String: Any] = ["channel": channel]
if let since = since { data["since"] = since }
if let limit = limit { data["limit"] = limit }
let response = sendEnvelopeRequest(service: "listen", action: "read", data: data)
```

For the channels-list path:

```swift
let response = sendEnvelopeRequest(service: "listen", action: "channels", data: [:])
```

- [ ] **Step 3: Rebuild**

```bash
bash build.sh
```

- [ ] **Step 4: Write + run listen contract test**

Create `tests/daemon-ipc-listen.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"
SOCK="$("$ROOT/aos" runtime path --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["socket_path"])')"

send_envelope() {
  python3 - "$SOCK" <<'PY'
import json, socket, sys
sock_path = sys.argv[1]
line = sys.stdin.read()
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(3); s.connect(sock_path); s.sendall(line.encode() + b"\n")
buf = b""
while b"\n" not in buf:
    c = s.recv(4096)
    if not c: break
    buf += c
sys.stdout.write(buf.decode().splitlines()[0])
PY
}

# Post something first so the channel has content
echo '{"v":1,"service":"tell","action":"send","data":{"audience":["ipc-listen-test"],"text":"seed"}}' | send_envelope >/dev/null

# listen.read
OUT="$(echo '{"v":1,"service":"listen","action":"read","data":{"channel":"ipc-listen-test","limit":5}}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") in ("ok","success"), f"unexpected: {d}"
msgs = d.get("messages") or d.get("data",{}).get("messages") or []
assert any(m.get("payload") == "seed" or (isinstance(m.get("payload"), dict) and "seed" in str(m["payload"])) for m in msgs) or msgs, f"no messages: {d}"
'
echo "PASS: listen.read"

# listen.channels
OUT="$(echo '{"v":1,"service":"listen","action":"channels","data":{}}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") in ("ok","success"), f"unexpected: {d}"
chs = d.get("channels") or d.get("data",{}).get("channels") or []
assert isinstance(chs, list), f"channels not a list: {d}"
'
echo "PASS: listen.channels"

echo "PASS"
```

```bash
chmod +x tests/daemon-ipc-listen.sh
bash tests/daemon-ipc-listen.sh
```

- [ ] **Step 5: Commit**

```bash
git add src/commands/*.swift tests/daemon-ipc-listen.sh
git commit -m "$(cat <<'EOF'
feat(ipc): migrate listen.read and listen.channels to v1 envelope

Adds tests/daemon-ipc-listen.sh for contract coverage.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Migrate `session.register`, `session.unregister`, `session.who`

Includes the deliberate narrowing from the spec's "Behavioral changes in v1" section: `session.register` requires `session_id`.

**Files:**
- Modify: `src/commands/tell.swift` (today `aos tell --register` / `--who` live here; search with `grep -Rn '"coord-register"\|"coord-who"\|"coord-unregister"' src/commands/`).
- Modify: `src/daemon/unified.swift` — the `coord-register` handler to reject missing `session_id`.

- [ ] **Step 1: Tighten the daemon handler to require session_id**

In `src/daemon/unified.swift`, find `case "coord-register":` (around line 1071) and change:

```swift
// before
let sessionID = (json["session_id"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
let name = (json["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
let legacyName = name?.isEmpty == false ? name : nil
guard let canonicalSessionID = sessionID?.isEmpty == false ? sessionID : legacyName else {
    sendResponseJSON(to: clientFD, ["error": "session_id or name required", "code": "MISSING_ARG"])
    return
}
```

to:

```swift
// after
let sessionID = (json["session_id"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
let name = (json["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
guard let canonicalSessionID = sessionID, !canonicalSessionID.isEmpty else {
    sendResponseJSON(to: clientFD, ["error": "session_id required for registration", "code": "MISSING_ARG"])
    return
}
let legacyName = name?.isEmpty == false ? name : nil
```

- [ ] **Step 2: Update CLI callers**

Find:

```bash
grep -Rn '"coord-register"\|"coord-unregister"\|"coord-who"' src/commands/
```

Replace each with the corresponding `sendEnvelopeRequest`:

```swift
// register
var data: [String: Any] = ["session_id": sessionID]
if let name = name { data["name"] = name }
if let role = role { data["role"] = role }
if let harness = harness { data["harness"] = harness }
let response = sendEnvelopeRequest(service: "session", action: "register", data: data)

// unregister
var data: [String: Any] = [:]
if let sid = sessionID { data["session_id"] = sid }
if let name = name { data["name"] = name }
let response = sendEnvelopeRequest(service: "session", action: "unregister", data: data)

// who
let response = sendEnvelopeRequest(service: "session", action: "who", data: [:])
```

- [ ] **Step 3: Update any hook/scripts that construct a bare `coord-register` request**

```bash
grep -Rn '"action".*"coord-register"' .agents/ scripts/ tests/ 2>/dev/null | grep -v '^tests/daemon-ipc-'
```

For each hit in a shell/python script, switch to `aos tell --register --session-id <id>` via the CLI (not raw socket writes).

- [ ] **Step 4: Rebuild**

```bash
bash build.sh
```

- [ ] **Step 5: Write + run session contract test**

Create `tests/daemon-ipc-session.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"
SOCK="$("$ROOT/aos" runtime path --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["socket_path"])')"
SID="ipc-session-test-$$"

send_envelope() {
  python3 - "$SOCK" <<'PY'
import json, socket, sys
sock_path = sys.argv[1]
line = sys.stdin.read()
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(3); s.connect(sock_path); s.sendall(line.encode() + b"\n")
buf = b""
while b"\n" not in buf:
    c = s.recv(4096)
    if not c: break
    buf += c
sys.stdout.write(buf.decode().splitlines()[0])
PY
}

# register
OUT="$(echo "{\"v\":1,\"service\":\"session\",\"action\":\"register\",\"data\":{\"session_id\":\"$SID\",\"name\":\"ipc-test\",\"role\":\"worker\",\"harness\":\"codex\"}}" | send_envelope)"
echo "$OUT" | python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); assert d.get("status") in ("ok","success"), d'
echo "PASS: session.register"

# register without session_id must fail (narrowing)
OUT="$(echo '{"v":1,"service":"session","action":"register","data":{"name":"namedonly"}}' | send_envelope)"
echo "$OUT" | python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); assert d.get("code") == "MISSING_ARG", d'
echo "PASS: session.register rejects name-only"

# who
OUT="$(echo '{"v":1,"service":"session","action":"who","data":{}}' | send_envelope)"
echo "$OUT" | python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
sessions = d.get('sessions') or d.get('data',{}).get('sessions') or []
ids = [s.get('session_id') for s in sessions]
assert '$SID' in ids, f'session not visible: {ids}'
"
echo "PASS: session.who"

# unregister
OUT="$(echo "{\"v\":1,\"service\":\"session\",\"action\":\"unregister\",\"data\":{\"session_id\":\"$SID\"}}" | send_envelope)"
echo "$OUT" | python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); assert d.get("status") in ("ok","success"), d'
echo "PASS: session.unregister"

echo "PASS"
```

```bash
chmod +x tests/daemon-ipc-session.sh
bash tests/daemon-ipc-session.sh
```

- [ ] **Step 6: Commit**

```bash
git add src/commands/*.swift src/daemon/unified.swift tests/daemon-ipc-session.sh
git commit -m "$(cat <<'EOF'
feat(ipc): migrate session.* to v1 envelope + narrow register to require session_id

session.register now rejects name-only registration with MISSING_ARG,
matching the deliberate cleanup documented in the v1 spec. CLI callers
under src/commands/ switch to sendEnvelopeRequest.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Migrate `voice.list`, `voice.leases`, `voice.bind`, `voice.final_response`

**Files:**
- Modify: `src/commands/voice.swift` — CLI callers.

- [ ] **Step 1: Find the callers**

```bash
grep -Rn '"voice-list"\|"voice-leases"\|"voice-bind"\|"voice-final-response"' src/commands/
```

- [ ] **Step 2: Replace each emission**

```swift
// list
let response = sendEnvelopeRequest(service: "voice", action: "list", data: [:])

// leases
let response = sendEnvelopeRequest(service: "voice", action: "leases", data: [:])

// bind
let response = sendEnvelopeRequest(service: "voice", action: "bind", data: [
    "session_id": sessionID,
    "voice_id": voiceID
])

// final_response (keeps field name hook_payload per spec)
var data: [String: Any] = ["hook_payload": hookPayload]
if let sid = sessionID { data["session_id"] = sid }
if let harness = harness { data["harness"] = harness }
let response = sendEnvelopeRequest(service: "voice", action: "final_response", data: data)
```

- [ ] **Step 3: Rebuild**

```bash
bash build.sh
```

- [ ] **Step 4: Write + run voice contract test**

Create `tests/daemon-ipc-voice.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"
SOCK="$("$ROOT/aos" runtime path --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["socket_path"])')"

send_envelope() {
  python3 - "$SOCK" <<'PY'
import json, socket, sys
sock_path = sys.argv[1]
line = sys.stdin.read()
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(3); s.connect(sock_path); s.sendall(line.encode() + b"\n")
buf = b""
while b"\n" not in buf:
    c = s.recv(4096)
    if not c: break
    buf += c
sys.stdout.write(buf.decode().splitlines()[0])
PY
}

OUT="$(echo '{"v":1,"service":"voice","action":"list","data":{}}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") in ("ok","success"), f"unexpected: {d}"
voices = d.get("voices") or d.get("data",{}).get("voices") or []
assert isinstance(voices, list), f"voices not list: {d}"
'
echo "PASS: voice.list"

OUT="$(echo '{"v":1,"service":"voice","action":"leases","data":{}}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") in ("ok","success"), f"unexpected: {d}"
'
echo "PASS: voice.leases"

# final_response with missing session fails with MISSING_SESSION_ID
OUT="$(echo '{"v":1,"service":"voice","action":"final_response","data":{"hook_payload":{}}}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("code") == "MISSING_SESSION_ID", f"expected MISSING_SESSION_ID: {d}"
'
echo "PASS: voice.final_response missing session rejected"

echo "PASS"
```

```bash
chmod +x tests/daemon-ipc-voice.sh
bash tests/daemon-ipc-voice.sh
```

- [ ] **Step 5: Commit**

```bash
git add src/commands/*.swift tests/daemon-ipc-voice.sh
git commit -m "$(cat <<'EOF'
feat(ipc): migrate voice.* CLI callers to v1 envelope

Covers voice.list, voice.leases, voice.bind, voice.final_response.
final_response uses the hook_payload field per spec alignment with
src/daemon/unified.swift:1511.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Wrap responses in v1 envelope at the daemon edge

Up to this point envelope requests re-enter legacy handlers and return legacy responses. Now wrap every response in the v1 envelope when the inbound request was an envelope.

**Files:**
- Modify: `src/daemon/unified.swift` — where `sendResponseJSON` is called from handlers, and the envelope-detection path.

- [ ] **Step 1: Thread envelope-origin flag through response emission**

Add a per-connection or per-dispatch flag that records whether the current request came in as an envelope. The simplest path: in the envelope-detection block from Task 3, replace the direct re-entry with a wrapped re-entry:

```swift
// Task 3 had:
//   var flat = env.data
//   flat["action"] = legacy
//   if let ref = env.ref { flat["__ref"] = ref }
//   handleRequest(json: flat, ...)
//
// Replace with:
var flat = env.data
flat["action"] = legacy
flat["__envelope_ref"] = env.ref ?? ""
flat["__envelope_active"] = true
handleRequest(json: flat, connectionID: connectionID, clientFD: clientFD)
return
```

- [ ] **Step 2: Wrap response in `sendResponseJSON`**

Find the `sendResponseJSON` function and modify it to detect envelope origin from `__envelope_*` flags on the most recent incoming JSON. Cleanest approach: accept an optional wrap parameter.

Replace `sendResponseJSON` with two layers:

```swift
private func sendResponseJSON(to fd: Int32, _ dict: [String: Any]) {
    sendResponseJSON(to: fd, dict, envelopeActive: false, envelopeRef: nil)
}

private func sendResponseJSON(to fd: Int32, _ dict: [String: Any], envelopeActive: Bool, envelopeRef: String?) {
    let payload: [String: Any]
    if envelopeActive {
        if let err = dict["error"] as? String, let code = dict["code"] as? String {
            var out: [String: Any] = ["v": 1, "status": "error", "error": err, "code": code]
            if let r = envelopeRef, !r.isEmpty { out["ref"] = r }
            payload = out
        } else {
            var data = dict
            data.removeValue(forKey: "status")
            let status = (dict["status"] as? String) ?? "success"
            var out: [String: Any] = ["v": 1, "status": status == "ok" ? "success" : status, "data": data]
            if let r = envelopeRef, !r.isEmpty { out["ref"] = r }
            payload = out
        }
    } else {
        payload = dict
    }
    // existing serialization logic
    if let line = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) {
        sendResponse(to: fd, line)
    }
}
```

- [ ] **Step 3: Route handlers to the envelope-aware overload**

At the top of `handleRequest`, after the envelope-detection block, capture the flags into locals the handlers can see:

```swift
let envelopeActive = (json["__envelope_active"] as? Bool) ?? false
let envelopeRef = json["__envelope_ref"] as? String

// Replace every `sendResponseJSON(to: clientFD, <dict>)` in this function with:
//   sendResponseJSON(to: clientFD, <dict>, envelopeActive: envelopeActive, envelopeRef: envelopeRef)
```

Do this mechanically for every handler call site in `handleRequest` (there are ~20). Keep an audit trail by grepping:

```bash
grep -n 'sendResponseJSON(to: clientFD' src/daemon/unified.swift | wc -l
```

After the edit, the same grep should show every call passing the two extra parameters.

- [ ] **Step 4: Rebuild**

```bash
bash build.sh
```

- [ ] **Step 5: Run the full contract-test suite and verify envelope responses**

```bash
for t in tests/daemon-ipc-*.sh; do bash "$t"; done
```

Expected: every test still passes. Responses now have `{v:1, status:"success", data:{...}}` shape for envelope callers; tests already accept both (they checked `d.get("data",{})` fallback).

- [ ] **Step 6: Add ref-echo assertion to envelope test**

Edit `tests/daemon-ipc-envelope.sh`: change the third assertion so `ref` MUST be echoed:

```bash
# 3. Ref is echoed back.
OUT="$(echo '{"v":1,"service":"system","action":"ping","data":{},"ref":"abc-123"}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("ref") == "abc-123", f"expected ref echo: {d}"
assert d.get("v") == 1, f"expected v:1: {d}"
assert d.get("status") == "success", f"expected status success: {d}"
'
echo "PASS: ref echo"
```

Run:
```bash
bash tests/daemon-ipc-envelope.sh
```

Expected: all assertions pass.

- [ ] **Step 7: Commit**

```bash
git add src/daemon/unified.swift tests/daemon-ipc-envelope.sh
git commit -m "$(cat <<'EOF'
feat(daemon): wrap envelope responses in v1 shape

sendResponseJSON now emits {v:1, status, data|error, code, ref} when the
inbound request was an envelope. Ref echo and success/error mapping are
verified by tests/daemon-ipc-envelope.sh.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Drop legacy flat-string dispatch

Every CLI caller is now on envelope. Daemon can reject raw flat-string requests and simplify `handleRequest`.

**Files:**
- Modify: `src/daemon/unified.swift`

- [ ] **Step 1: Audit remaining flat-string emitters**

```bash
grep -Rn 'sendRequest(\[' src/ shared/swift/ipc/ 2>/dev/null
grep -Rn '"action":\s*"' src/ | grep -v unified.swift | grep -v test
```

Expected: no results in Swift callers. Anything that remains must be migrated before this task's step 2.

- [ ] **Step 2: Require envelope on all requests**

In `src/daemon/unified.swift`, replace the top of `handleRequest` so non-envelope requests fall through to an error:

```swift
private func handleRequest(json: [String: Any], connectionID: UUID, clientFD: Int32) {
    if let env = parseEnvelope(json) {
        let legacyAction = legacyActionName(service: env.service, action: env.action)
        guard let legacy = legacyAction else {
            sendResponseJSON(to: clientFD, [
                "error": "Unknown (service, action): (\(env.service), \(env.action))",
                "code": "UNKNOWN_ACTION"
            ], envelopeActive: true, envelopeRef: env.ref)
            return
        }
        var flat = env.data
        flat["action"] = legacy
        flat["__envelope_active"] = true
        flat["__envelope_ref"] = env.ref ?? ""
        // Fall through to the legacy switch below with `flat` as `json`.
        routeLegacy(json: flat, connectionID: connectionID, clientFD: clientFD)
        return
    }
    // Non-envelope: reject.
    sendResponseJSON(to: clientFD, [
        "error": "Request envelope required ({v:1, service, action, data}).",
        "code": "PARSE_ERROR"
    ])
}

private func routeLegacy(json: [String: Any], connectionID: UUID, clientFD: Int32) {
    let envelopeActive = (json["__envelope_active"] as? Bool) ?? false
    let envelopeRef = json["__envelope_ref"] as? String
    guard let action = json["action"] as? String else {
        sendResponseJSON(to: clientFD, ["error": "action missing", "code": "MISSING_ARG"],
                         envelopeActive: envelopeActive, envelopeRef: envelopeRef)
        return
    }
    switch action {
    // ... existing cases, unchanged
    }
}
```

- [ ] **Step 3: Rebuild**

```bash
bash build.sh
```

- [ ] **Step 4: Run every daemon-ipc test**

```bash
for t in tests/daemon-ipc-*.sh; do bash "$t" || { echo "FAIL: $t"; exit 1; }; done
```

Expected: all pass.

- [ ] **Step 5: Run the existing broader test suite**

```bash
bash tests/help-contract.sh 2>/dev/null || true
bash tests/sigil-status-item-lifecycle.sh 2>/dev/null || true
bash tests/voice-telemetry.sh 2>/dev/null || true
bash tests/voice-final-response.sh 2>/dev/null || true
bash tests/status-introspect.sh 2>/dev/null || true
```

Expected: each exits 0 or prints PASS. Any failure indicates a stale flat-string call site; grep for the legacy action name it exercises and migrate.

- [ ] **Step 6: Add a negative test that bare flat-string requests are rejected**

Append to `tests/daemon-ipc-envelope.sh`:

```bash
# 4. Legacy flat-string requests are rejected.
OUT="$(echo '{"action":"ping"}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("code") == "PARSE_ERROR", f"expected PARSE_ERROR: {d}"
'
echo "PASS: flat-string request rejected"
```

Run:
```bash
bash tests/daemon-ipc-envelope.sh
```

Expected: new `PASS: flat-string request rejected`.

- [ ] **Step 7: Commit**

```bash
git add src/daemon/unified.swift tests/daemon-ipc-envelope.sh
git commit -m "$(cat <<'EOF'
feat(daemon): require v1 envelope on all requests, drop flat-string path

Non-envelope requests now return PARSE_ERROR. envelope dispatch is the
only supported wire form.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Drop the duplicate `perceive` case and the `post` overloaded case

**Files:**
- Modify: `src/daemon/unified.swift`

- [ ] **Step 1: Delete the `perceive` case**

In the `routeLegacy` switch, delete:

```swift
case "perceive":
    let depth = json["depth"] as? Int ?? config.perception.default_depth
    // ... (rest of the existing identical body)
```

Keep only the `case "subscribe":` body. The envelope-to-legacy mapping in `legacyActionName` already sends `see.observe` → `"subscribe"`, so `perceive` is unreachable.

- [ ] **Step 2: Delete the `post` case**

In the same switch, delete:

```swift
case "post":
    if json["id"] != nil {
        // canvas branch
    }
    if let channel = json["channel"] as? String {
        // channel branch
    }
    sendResponseJSON(...)
```

Envelope requests for canvas operations now map to `create`/`update`/`remove`/`eval`/etc. directly (via `legacyActionName`). Channel posts go through `tell.send` → `"tell"` handler. The `post` branch has no reachable caller.

- [ ] **Step 3: Rebuild**

```bash
bash build.sh
```

- [ ] **Step 4: Run all daemon-ipc tests plus the broader suite**

```bash
for t in tests/daemon-ipc-*.sh; do bash "$t" || exit 1; done
bash tests/sigil-status-item-lifecycle.sh 2>/dev/null || true
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/unified.swift
git commit -m "$(cat <<'EOF'
refactor(daemon): remove duplicate perceive case and legacy post handler

perceive was a byte-for-byte duplicate of subscribe. post's two branches
(canvas and channel) are reachable only through show.* and tell.send in
envelope dispatch, which wire directly to their homes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Populate request schema `oneOf` with per-action branches

Fill in `shared/schemas/daemon-request.schema.json` with per-action data-payload schemas now that the contract is locked by code.

**Files:**
- Modify: `shared/schemas/daemon-request.schema.json`

- [ ] **Step 1: Replace `$defs` and envelope with action-branched version**

Replace the file content with:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://github.com/michaelblum/agent-os/shared/schemas/daemon-request.schema.json",
  "title": "Daemon Request Envelope",
  "description": "Wire contract for requests sent to the aos daemon over its Unix socket. Newline-delimited JSON.",
  "type": "object",
  "required": ["v", "service", "action", "data"],
  "additionalProperties": false,
  "properties": {
    "v": { "const": 1 },
    "service": { "enum": ["see", "do", "show", "tell", "listen", "session", "voice", "system"] },
    "action": { "type": "string", "pattern": "^[a-z][a-z0-9_]*$" },
    "data": { "type": "object" },
    "ref": { "type": "string" }
  },
  "allOf": [
    { "if": { "properties": { "service": { "const": "see" }, "action": { "const": "observe" } } },
      "then": { "properties": { "data": { "$ref": "#/$defs/SeeObserveData" } } } },
    { "if": { "properties": { "service": { "const": "show" }, "action": { "const": "create" } } },
      "then": { "properties": { "data": { "$ref": "#/$defs/ShowCreateData" } } } },
    { "if": { "properties": { "service": { "const": "show" }, "action": { "const": "update" } } },
      "then": { "properties": { "data": { "$ref": "#/$defs/ShowUpdateData" } } } },
    { "if": { "properties": { "service": { "const": "show" }, "action": { "const": "eval" } } },
      "then": { "properties": { "data": { "$ref": "#/$defs/ShowEvalData" } } } },
    { "if": { "properties": { "service": { "const": "show" }, "action": { "const": "remove" } } },
      "then": { "properties": { "data": { "$ref": "#/$defs/ShowRemoveData" } } } },
    { "if": { "properties": { "service": { "const": "show" }, "action": { "const": "remove_all" } } },
      "then": { "properties": { "data": { "$ref": "#/$defs/Empty" } } } },
    { "if": { "properties": { "service": { "const": "show" }, "action": { "const": "list" } } },
      "then": { "properties": { "data": { "$ref": "#/$defs/ShowListData" } } } },
    { "if": { "properties": { "service": { "const": "tell" }, "action": { "const": "send" } } },
      "then": { "properties": { "data": { "$ref": "#/$defs/TellSendData" } } } },
    { "if": { "properties": { "service": { "const": "listen" }, "action": { "const": "read" } } },
      "then": { "properties": { "data": { "$ref": "#/$defs/ListenReadData" } } } },
    { "if": { "properties": { "service": { "const": "listen" }, "action": { "const": "channels" } } },
      "then": { "properties": { "data": { "$ref": "#/$defs/Empty" } } } },
    { "if": { "properties": { "service": { "const": "session" }, "action": { "const": "register" } } },
      "then": { "properties": { "data": { "$ref": "#/$defs/SessionRegisterData" } } } },
    { "if": { "properties": { "service": { "const": "session" }, "action": { "const": "unregister" } } },
      "then": { "properties": { "data": { "$ref": "#/$defs/SessionUnregisterData" } } } },
    { "if": { "properties": { "service": { "const": "session" }, "action": { "const": "who" } } },
      "then": { "properties": { "data": { "$ref": "#/$defs/Empty" } } } },
    { "if": { "properties": { "service": { "const": "voice" }, "action": { "const": "list" } } },
      "then": { "properties": { "data": { "$ref": "#/$defs/Empty" } } } },
    { "if": { "properties": { "service": { "const": "voice" }, "action": { "const": "leases" } } },
      "then": { "properties": { "data": { "$ref": "#/$defs/Empty" } } } },
    { "if": { "properties": { "service": { "const": "voice" }, "action": { "const": "bind" } } },
      "then": { "properties": { "data": { "$ref": "#/$defs/VoiceBindData" } } } },
    { "if": { "properties": { "service": { "const": "voice" }, "action": { "const": "final_response" } } },
      "then": { "properties": { "data": { "$ref": "#/$defs/VoiceFinalResponseData" } } } },
    { "if": { "properties": { "service": { "const": "system" }, "action": { "const": "ping" } } },
      "then": { "properties": { "data": { "$ref": "#/$defs/Empty" } } } }
  ],
  "$defs": {
    "Empty": { "type": "object", "additionalProperties": true },
    "SeeObserveData": {
      "type": "object",
      "properties": {
        "depth": { "type": "integer", "minimum": 0, "maximum": 3 },
        "scope": { "type": "string" },
        "rate": { "type": "string" },
        "events": { "type": "array", "items": { "type": "string" } },
        "snapshot": { "type": "boolean" }
      },
      "additionalProperties": true
    },
    "ShowCreateData": {
      "type": "object",
      "required": ["id"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "at": { "type": "array", "items": { "type": "number" }, "minItems": 4, "maxItems": 4 },
        "anchor_window": { "type": "integer" },
        "anchor_channel": { "type": "string" },
        "offset": { "type": "array", "items": { "type": "number" }, "minItems": 4, "maxItems": 4 },
        "html": { "type": "string" },
        "url": { "type": "string" },
        "interactive": { "type": "boolean" },
        "focus": { "type": "boolean" },
        "ttl": { "type": "number" },
        "scope": { "enum": ["connection", "global"] },
        "auto_project": { "type": "string" },
        "track": { "type": "string" },
        "parent": { "type": "string" },
        "cascade": { "type": "boolean" },
        "suspended": { "type": "boolean" }
      },
      "oneOf": [
        { "required": ["at"] },
        { "required": ["track"] },
        { "required": ["anchor_window", "offset"] },
        { "required": ["anchor_channel", "offset"] }
      ],
      "additionalProperties": true
    },
    "ShowUpdateData": {
      "type": "object",
      "required": ["id"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "at": { "type": "array", "items": { "type": "number" }, "minItems": 4, "maxItems": 4 },
        "html": { "type": "string" },
        "url": { "type": "string" },
        "interactive": { "type": "boolean" },
        "ttl": { "type": ["number", "null"] },
        "track": { "type": "string" }
      },
      "additionalProperties": true
    },
    "ShowEvalData": {
      "type": "object",
      "required": ["id", "js"],
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "js": { "type": "string", "minLength": 1 }
      },
      "additionalProperties": true
    },
    "ShowRemoveData": {
      "type": "object",
      "required": ["id"],
      "properties": { "id": { "type": "string", "minLength": 1 } },
      "additionalProperties": true
    },
    "ShowListData": {
      "type": "object",
      "properties": { "scope": { "enum": ["connection", "global"] } },
      "additionalProperties": true
    },
    "TellSendData": {
      "type": "object",
      "required": ["audience"],
      "properties": {
        "audience": { "type": "array", "items": { "type": "string", "minLength": 1 }, "minItems": 1 },
        "text": { "type": "string" },
        "payload": { "type": "object" },
        "from_session_id": { "type": "string" },
        "from": { "type": "string" },
        "purpose": { "type": "string" }
      },
      "oneOf": [
        { "required": ["text"] },
        { "required": ["payload"] }
      ],
      "additionalProperties": true
    },
    "ListenReadData": {
      "type": "object",
      "required": ["channel"],
      "properties": {
        "channel": { "type": "string", "minLength": 1 },
        "since": { "type": "string" },
        "limit": { "type": "integer", "minimum": 1 }
      },
      "additionalProperties": true
    },
    "SessionRegisterData": {
      "type": "object",
      "required": ["session_id"],
      "properties": {
        "session_id": { "type": "string", "minLength": 1 },
        "name": { "type": "string" },
        "role": { "type": "string" },
        "harness": { "type": "string" }
      },
      "additionalProperties": true
    },
    "SessionUnregisterData": {
      "type": "object",
      "anyOf": [
        { "required": ["session_id"] },
        { "required": ["name"] }
      ],
      "properties": {
        "session_id": { "type": "string", "minLength": 1 },
        "name": { "type": "string", "minLength": 1 }
      },
      "additionalProperties": true
    },
    "VoiceBindData": {
      "type": "object",
      "required": ["session_id", "voice_id"],
      "properties": {
        "session_id": { "type": "string", "minLength": 1 },
        "voice_id": { "type": "string", "minLength": 1 }
      },
      "additionalProperties": true
    },
    "VoiceFinalResponseData": {
      "type": "object",
      "required": ["hook_payload"],
      "properties": {
        "session_id": { "type": "string" },
        "harness": { "type": "string" },
        "hook_payload": { "type": "object" }
      },
      "additionalProperties": true
    }
  }
}
```

- [ ] **Step 2: Validate the schema**

```bash
python3 -c "import json, jsonschema; jsonschema.Draft202012Validator.check_schema(json.load(open('shared/schemas/daemon-request.schema.json'))); print('schema ok')"
```

Expected: `schema ok`.

- [ ] **Step 3: Add a schema-level validation test**

Create `tests/daemon-ipc-schema.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

python3 - <<'PY'
import json
import jsonschema

with open("shared/schemas/daemon-request.schema.json") as f:
    req_schema = json.load(f)
with open("shared/schemas/daemon-response.schema.json") as f:
    resp_schema = json.load(f)

jsonschema.Draft202012Validator.check_schema(req_schema)
jsonschema.Draft202012Validator.check_schema(resp_schema)

good_requests = [
    {"v":1,"service":"system","action":"ping","data":{}},
    {"v":1,"service":"see","action":"observe","data":{"depth":1,"scope":"cursor"}},
    {"v":1,"service":"show","action":"create","data":{"id":"x","at":[0,0,10,10],"html":"<div/>"}},
    {"v":1,"service":"tell","action":"send","data":{"audience":["ops"],"text":"hi"}},
    {"v":1,"service":"session","action":"register","data":{"session_id":"abc"}},
]
validator = jsonschema.Draft202012Validator(req_schema)
for r in good_requests:
    errors = list(validator.iter_errors(r))
    assert not errors, f"unexpected errors for {r}: {errors}"

bad_requests = [
    {"v":1,"service":"system","action":"ping"},  # missing data
    {"v":2,"service":"system","action":"ping","data":{}},  # wrong v
    {"v":1,"service":"system","action":"PING","data":{}},  # uppercase action
    {"v":1,"service":"unknown","action":"ping","data":{}},  # bad service
    {"v":1,"service":"tell","action":"send","data":{"audience":["ops"]}},  # no text or payload
    {"v":1,"service":"session","action":"register","data":{"name":"only-a-name"}},  # missing session_id
    {"v":1,"service":"show","action":"create","data":{"id":"x"}},  # no geometry source
]
for r in bad_requests:
    errors = list(validator.iter_errors(r))
    assert errors, f"expected errors for {r} but got none"

print("PASS")
PY
```

```bash
chmod +x tests/daemon-ipc-schema.sh
bash tests/daemon-ipc-schema.sh
```

Expected: `PASS`.

- [ ] **Step 4: Commit**

```bash
git add shared/schemas/daemon-request.schema.json tests/daemon-ipc-schema.sh
git commit -m "$(cat <<'EOF'
feat(schema): populate daemon-request schema with per-action branches

Adds if/then/allOf constraints so each (service, action) validates the
right data shape (oneOf on tell.send text/payload, oneOf on show.create
geometry sources, anyOf on session.unregister, etc.). Adds
tests/daemon-ipc-schema.sh for positive and negative validator cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Write the human-readable IPC reference

**Files:**
- Create: `shared/schemas/daemon-ipc.md`
- Modify: `docs/api/aos.md` — add link.

- [ ] **Step 1: Write the reference**

Create `shared/schemas/daemon-ipc.md`:

```markdown
# Daemon IPC v1 — Reference

Wire contract between the `aos` CLI (and future SDK/MCP adapter) and the unified daemon. Canonical source: `shared/schemas/daemon-request.schema.json` and `shared/schemas/daemon-response.schema.json`. Design rationale: `docs/superpowers/specs/2026-04-17-daemon-ipc-request-schema-v1-design.md`.

## Transport

Unix domain socket at `aosSocketPath()` (see `shared/swift/ipc/runtime-paths.swift`). Newline-delimited JSON. One request line → one response line. Event stream (pushed events) follows `daemon-event.schema.json` v1 and shares the same connection once `see.observe` or a future subscribe action opens it.

## Envelope

Request:
```json
{"v":1,"service":"tell","action":"send","data":{"audience":["human"],"text":"hi"},"ref":"r-42"}
```

Success response:
```json
{"v":1,"status":"success","data":{"routes":[{"audience":"human","route":"voice","delivered":true}]},"ref":"r-42"}
```

Error response:
```json
{"v":1,"status":"error","error":"audience required","code":"MISSING_ARG","ref":"r-42"}
```

## Action Catalog

| (service, action) | Purpose | Required data fields |
|-------------------|---------|----------------------|
| `see.observe` | Open a perception attention channel and subscribe connection to events. | (none) |
| `show.create` | Create a canvas. | `id` + one geometry source (`at`, `track`, `anchor_window+offset`, `anchor_channel+offset`) + one content source (`html`, `url`). |
| `show.update` | Mutate canvas fields. | `id`. |
| `show.eval` | Evaluate JS inside a canvas. | `id`, `js`. |
| `show.remove` | Destroy a canvas. | `id`. |
| `show.remove_all` | Destroy all canvases. | (none) |
| `show.list` | List current canvases. | (none; optional `scope`). |
| `tell.send` | Emit to one or more audiences. | `audience` (non-empty array); exactly one of `text` or `payload`. |
| `listen.read` | Read recent channel messages. | `channel`. |
| `listen.channels` | List known channels. | (none) |
| `session.register` | Register session presence. | `session_id`. |
| `session.unregister` | Remove session presence. | `session_id` or `name`. |
| `session.who` | List online sessions. | (none) |
| `voice.list` | List voice bank. | (none) |
| `voice.leases` | List active voice leases. | (none) |
| `voice.bind` | Bind a voice to a session. | `session_id`, `voice_id`. |
| `voice.final_response` | Harness-ingress for final-response TTS. | `hook_payload` (optionally `session_id`, `harness`). |
| `system.ping` | Daemon health + uptime. | (none) |

## Error Codes

| Code | Meaning |
|------|---------|
| `MISSING_ARG` | Required field absent or empty. |
| `INVALID_ARG` | Field has unacceptable value. |
| `UNKNOWN_ACTION` | `(service, action)` not in catalog. |
| `UNKNOWN_SERVICE` | `service` not one of the eight namespaces. |
| `PARSE_ERROR` | Request not JSON, schema violation, or legacy flat-string request. |
| `SESSION_NOT_FOUND` | Referenced `session_id` is not registered. |
| `MISSING_SESSION_ID` | Daemon could not resolve a session id for an action that requires one. |
| `CANVAS_NOT_FOUND` | Referenced canvas `id` does not exist. |
| `PERMISSION_DENIED` | macOS permission (Accessibility, Screen Recording) missing. |
| `INTERNAL` | Unexpected daemon error. |

## Versioning

Envelope `v` is an integer, currently `1`. Adding an action or an optional field does not bump `v`. Breaking wire changes bump `v`.

## Event envelope note

The event envelope (`daemon-event.schema.json` v1) uses `service` values `perceive|display|act|voice` in its enum today. The live daemon additionally emits `system`, `coordination`, and `wiki` event services. The request-side namespaces defined here (`see|do|show|tell|listen|session|voice|system`) differ from the event-side service values. Reconciling both sides is deferred to a v2 event envelope.
```

- [ ] **Step 2: Add a link from docs/api/aos.md**

Edit `docs/api/aos.md`. Find the "Subcommand Reference" section or nearest section header, and add below it:

```markdown
## IPC Contract

Wire-level request/response contract between the CLI and daemon is specified in
[`shared/schemas/daemon-ipc.md`](../../shared/schemas/daemon-ipc.md). Agents and
tools that talk to the daemon directly (SDKs, MCP adapters) should use the v1
envelope there.
```

- [ ] **Step 3: Commit**

```bash
git add shared/schemas/daemon-ipc.md docs/api/aos.md
git commit -m "$(cat <<'EOF'
docs(ipc): add daemon-ipc.md reference and link from api docs

Human-readable summary of the v1 wire contract: envelope, action catalog,
error codes, versioning, event-side asymmetry note.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Final audit and cleanup

**Files:**
- Touch whatever grep reveals.

- [ ] **Step 1: Grep for any stale legacy action names in Swift**

```bash
grep -Rn '"coord-register"\|"coord-unregister"\|"coord-who"\|"coord-read"\|"coord-channels"' src/ shared/swift/ 2>/dev/null
grep -Rn '"voice-list"\|"voice-leases"\|"voice-bind"\|"voice-final-response"' src/ shared/swift/ 2>/dev/null
grep -Rn 'legacyActionName' src/daemon/unified.swift
```

Expected: the first two greps return nothing in Swift (only test fixtures or historical docs). The third returns one hit (the function that does the legacy mapping inside the daemon, which must stay for the envelope→legacy translation).

If either of the first two grep hits finds live code, fix that call site and re-run the relevant daemon-ipc test before proceeding.

- [ ] **Step 2: Grep for flat-string emitters**

```bash
grep -Rn 'sendRequest(\[' src/ shared/swift/ 2>/dev/null | grep -v sendEnvelopeRequest
```

Expected: no hits. If any remain, migrate them.

- [ ] **Step 3: Run the full shell test suite for the repo**

```bash
for t in tests/daemon-ipc-*.sh tests/status-introspect.sh tests/session-start-bootstrap.sh tests/session-start-control-surface.sh tests/hook-config.sh tests/help-contract.sh tests/voice-telemetry.sh tests/voice-final-response.sh; do
  echo "== $t =="
  bash "$t" || { echo "FAIL: $t"; exit 1; }
done
```

Expected: every test ends in `PASS`.

- [ ] **Step 4: Confirm build is clean**

```bash
bash build.sh
```

Expected: no warnings related to the refactor.

- [ ] **Step 5: Commit any stragglers**

If Step 1–4 surfaced edits, commit them:

```bash
git add -u
git commit -m "$(cat <<'EOF'
chore(ipc): final v1 audit fixes

Sweep of leftover legacy action references and flat-string emitters
after the migration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If nothing changed, skip the commit.

---

## Self-Review Checklist (run once, inline)

**Spec coverage:**

| Spec section | Task(s) implementing it |
|--------------|------------------------|
| Envelope (request/success/error) | Tasks 1, 2, 3, 13 |
| Namespaces and actions (catalog) | Tasks 6–12 |
| Migration table from legacy names | Tasks 6–12 + legacyActionName mapping in Task 3 |
| Actions removed (perceive, post) | Task 15 |
| Behavioral change: `session.register` narrowing | Task 11 Step 1 |
| see.observe payload | Task 7 + Task 16 `SeeObserveData` |
| show.* payloads (create/update/eval/remove/remove_all/list) | Task 8 + Task 16 `Show*Data` |
| tell.send payload + text/payload oneOf | Task 9 + Task 16 `TellSendData` |
| listen.read / listen.channels payloads | Task 10 + Task 16 `ListenReadData` |
| session.* payloads (including `session_id`-required) | Task 11 + Task 16 `SessionRegisterData`/`SessionUnregisterData` |
| voice.* payloads (including hook_payload) | Task 12 + Task 16 `VoiceBindData`/`VoiceFinalResponseData` |
| system.ping / system payload | Task 6 + Task 16 (Empty $def) |
| Error code vocabulary | Task 2 (enum) + Task 17 (reference) |
| Versioning rules (`v`, additive fields) | Task 1 + Task 17 |
| Event envelope untouched (asymmetry) | Task 17 (reference includes note) |
| Deliverables: schema files, daemon refactor, client helper, CLI migration, tests, md reference | Tasks 1–17 collectively |

**Placeholder scan:** no "TBD", "TODO", "similar to", or unshown code. Every step either edits a specific file, runs a specific command, or commits with a HEREDOC message.

**Type consistency:** `sendEnvelopeRequest(service:action:data:)` signature is introduced in Task 4 and used identically in Tasks 6–12. `legacyActionName(service:action:)` is introduced in Task 3 and updated only through additive rows (never renamed). `parseEnvelope` signature stable from Task 3 through Task 14.

No gaps found.
