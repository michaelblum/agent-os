# Input Tap Readiness Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the daemon input tap a first-class readiness signal across `aos service`, `aos permissions check`, `aos status`, `aos doctor`, the session-start hook, and the daemon auto-start path. Tracking: issue #109. Spec: `docs/superpowers/specs/2026-04-24-input-tap-readiness-contract-design.md`.

**Architecture:** The daemon's `system.ping` response is extended with a structured `input_tap` block (status, attempts, listen_access, post_access, last_error_at) and a `permissions` block (accessibility) sourced **from inside the daemon process**. A small shared parsing/guidance helper module (`src/shared/input-tap-health.swift`) is consumed by `service.swift` (lifecycle readiness probe with 5s budget and stricter exit codes) and `operator.swift` (permissions check / status / doctor / preflight gate). The CLI auto-start path tolerates socket-reachable degraded so non-input commands keep working when the tap retries.

**Tech Stack:** Swift (`src/`, `shared/swift/ipc/`), Bash test scripts (`tests/`), Python 3 mock daemon (`tests/lib/mock-daemon.py`), JSON Schema (`shared/schemas/`), launchd (read-only — not invoked from CI tests).

**Conventions:**
- Build the binary with `bash build.sh` only when Swift sources change.
- Commit messages must NOT include `Co-Authored-By: Claude ...` or `Generated with Claude Code` (per `AGENTS.md`).
- Default branch is `main`; this work lands directly on `main` unless the executor opts into a worktree.
- `./aos help <cmd>` is the canonical CLI syntax reference if anything in this plan looks stale.

---

## Task 1: Daemon system.ping payload + schemas + ping shape test

**Files:**
- Modify: `tests/daemon-ipc-system.sh`
- Modify: `src/perceive/daemon.swift`
- Modify: `src/daemon/unified.swift` (around line 1518–1545, the `case "ping":` handler)
- Modify: `shared/schemas/daemon-response.schema.json`
- Modify: `shared/schemas/daemon-ipc.md` (around line 98–115, the `system.ping` payload section)

### Steps

- [ ] **Step 1.1: Extend tests/daemon-ipc-system.sh with new payload assertions**

Locate the existing assertion block in `tests/daemon-ipc-system.sh` (lines 44–54) and replace it with the expanded assertions:

```bash
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") in ("ok", "success"), f"unexpected status: {d}"
payload = d.get("data", d)
assert "uptime" in payload, f"uptime missing: {d}"
assert isinstance(payload.get("pid"), int), f"pid missing: {d}"
assert payload.get("mode") in ("repo", "installed"), f"mode missing: {d}"
assert isinstance(payload.get("socket_path"), str) and payload["socket_path"], f"socket_path missing: {d}"

# Legacy flat fields preserved
assert payload.get("input_tap_status") in ("active", "retrying", "unavailable"), f"input_tap_status missing: {d}"
assert isinstance(payload.get("input_tap_attempts"), int), f"input_tap_attempts missing: {d}"

# New nested input_tap block
tap = payload.get("input_tap")
assert isinstance(tap, dict), f"input_tap block missing: {d}"
assert tap.get("status") in ("active", "retrying", "unavailable"), f"input_tap.status missing: {d}"
assert tap["status"] == payload["input_tap_status"], f"flat/nested mismatch: {d}"
assert isinstance(tap.get("attempts"), int), f"input_tap.attempts missing: {d}"
assert tap["attempts"] == payload["input_tap_attempts"], f"flat/nested mismatch: {d}"
assert isinstance(tap.get("listen_access"), bool), f"input_tap.listen_access missing: {d}"
assert isinstance(tap.get("post_access"), bool), f"input_tap.post_access missing: {d}"
assert tap.get("last_error_at") is None or isinstance(tap.get("last_error_at"), str), f"input_tap.last_error_at must be string-or-null: {d}"

# New nested permissions block
perms = payload.get("permissions")
assert isinstance(perms, dict), f"permissions block missing: {d}"
assert isinstance(perms.get("accessibility"), bool), f"permissions.accessibility missing: {d}"
'
echo "PASS: system.ping"
```

- [ ] **Step 1.2: Run the test, verify it fails**

Run: `bash tests/daemon-ipc-system.sh`

Expected: assertion fails with `input_tap block missing` (the daemon does not emit the nested block yet). The test must fail before we implement.

- [ ] **Step 1.3: Add lastEventTapErrorAt and listen/post helpers to PerceptionEngine**

Edit `src/perceive/daemon.swift`. Add a stored property near the other tap state (around line 38) and helpers right after the existing `inputTapStatus`/`inputTapAttempts` computed properties (around line 48):

```swift
    private var eventTap: CFMachPort?
    private var eventTapRetryTimer: DispatchSourceTimer?
    private var eventTapStartAttempts: Int = 0
    private var lastEventTapErrorAt: Date?

    var inputTapStatus: String {
        if eventTap != nil { return "active" }
        if eventTapRetryTimer != nil { return "retrying" }
        return "unavailable"
    }

    var inputTapAttempts: Int {
        eventTapStartAttempts
    }

    var inputTapLastErrorAt: Date? {
        lastEventTapErrorAt
    }

    var inputTapListenAccess: Bool {
        if #available(macOS 10.15, *) {
            return CGPreflightListenEventAccess()
        }
        return true
    }

    var inputTapPostAccess: Bool {
        if #available(macOS 10.15, *) {
            return CGPreflightPostEventAccess()
        }
        return true
    }

    var daemonAccessibilityGranted: Bool {
        AXIsProcessTrusted()
    }
```

Then update `logEventTapFailure` (currently at line 141) so it stamps `lastEventTapErrorAt` on every failure:

```swift
    private func logEventTapFailure() {
        lastEventTapErrorAt = Date()
        let ax = AXIsProcessTrusted()
        if #available(macOS 10.15, *) {
            let listen = CGPreflightListenEventAccess()
            let post = CGPreflightPostEventAccess()
            fputs(
                "Warning: CGEventTap failed — input tap unavailable (AX=\(ax) listen=\(listen) post=\(post)); retrying on main run loop\n",
                stderr
            )
        } else {
            fputs(
                "Warning: CGEventTap failed — input tap unavailable (AX=\(ax)); retrying on main run loop\n",
                stderr
            )
        }
    }
```

- [ ] **Step 1.4: Extend the unified daemon ping response**

Edit `src/daemon/unified.swift` at the `case "ping":` block (around line 1518). Replace the response-building block with a version that adds the nested blocks alongside the flat fields:

```swift
        case "ping":
            let uptime = Date().timeIntervalSince(startTime)
            let perceptionChannels = perception.attention.channelCount
            subscriberLock.lock()
            let subscriberCount = subscribers.count
            subscriberLock.unlock()
            let mode = aosCurrentRuntimeMode()
            let pid = Int(getpid())
            let startedAt = ISO8601DateFormatter().string(from: startTime)

            let lastErrorAt: Any = perception.inputTapLastErrorAt.map {
                ISO8601DateFormatter().string(from: $0)
            } ?? NSNull()

            var response: [String: Any] = [
                "status": "ok",
                "uptime": uptime,
                "pid": pid,
                "mode": mode.rawValue,
                "socket_path": socketPath,
                "started_at": startedAt,
                "perception_channels": perceptionChannels,
                "subscribers": subscriberCount,
                // Legacy flat fields preserved
                "input_tap_status": perception.inputTapStatus,
                "input_tap_attempts": perception.inputTapAttempts,
                // New nested input_tap block
                "input_tap": [
                    "status": perception.inputTapStatus,
                    "attempts": perception.inputTapAttempts,
                    "listen_access": perception.inputTapListenAccess,
                    "post_access": perception.inputTapPostAccess,
                    "last_error_at": lastErrorAt,
                ] as [String: Any],
                // New nested permissions block (daemon-sourced)
                "permissions": [
                    "accessibility": perception.daemonAccessibilityGranted,
                ] as [String: Any],
            ]
            if let lockOwnerPID = aosDaemonLockOwnerPID(for: mode) {
                response["lock_owner_pid"] = lockOwnerPID
            }
            if let port = contentServer?.assignedPort, port > 0 {
                response["content_port"] = Int(port)
            }
            sendResponseJSON(to: clientFD, response, envelopeActive: envelopeActive, envelopeRef: envelopeRef)
```

- [ ] **Step 1.5: Build the binary**

Run: `bash build.sh`

Expected: build succeeds with no errors. If the compiler complains about `NSNull` not conforming to something needed by JSONSerialization, replace `NSNull()` with `nil as String?` only where allowed; the nested-dict literal accepts `NSNull` because we're going through `JSONSerialization` which encodes it as JSON `null`.

- [ ] **Step 1.6: Run the test, verify it passes**

Run: `bash tests/daemon-ipc-system.sh`

Expected: `PASS: system.ping` and `PASS`.

- [ ] **Step 1.7: Update the response schema**

Edit `shared/schemas/daemon-response.schema.json`. Find the `system.ping` response payload definition (search for `input_tap_status`) and add the nested blocks. If the schema doesn't already break out per-action payloads, add the new fields to the generic data-payload definition:

```json
{
  "input_tap_status": { "type": "string", "enum": ["active", "retrying", "unavailable"] },
  "input_tap_attempts": { "type": "integer", "minimum": 0 },
  "input_tap": {
    "type": "object",
    "additionalProperties": false,
    "required": ["status", "attempts", "listen_access", "post_access", "last_error_at"],
    "properties": {
      "status": { "type": "string", "enum": ["active", "retrying", "unavailable"] },
      "attempts": { "type": "integer", "minimum": 0 },
      "listen_access": { "type": "boolean" },
      "post_access": { "type": "boolean" },
      "last_error_at": { "type": ["string", "null"], "format": "date-time" }
    }
  },
  "permissions": {
    "type": "object",
    "additionalProperties": true,
    "required": ["accessibility"],
    "properties": {
      "accessibility": { "type": "boolean" }
    }
  }
}
```

If the existing schema lists `input_tap_status` only inside a comment or markdown table (not as JSON Schema properties), match the existing convention rather than introducing a new structure.

- [ ] **Step 1.8: Update the schema doc**

Edit `shared/schemas/daemon-ipc.md`. Find the `system.ping` payload section (around line 98–115) and append documentation for the new fields. Add this block immediately after the existing `input_tap_attempts` line:

```markdown
- `input_tap` (object) — daemon-sourced structured view of the global input tap. Always present.
  - `status` — `active`, `retrying`, or `unavailable`. Mirrors the flat `input_tap_status` field.
  - `attempts` — startup attempt count. Mirrors the flat `input_tap_attempts` field.
  - `listen_access` (bool) — `CGPreflightListenEventAccess()` evaluated **inside the daemon process**. The CLI must not fabricate this from its own preflight.
  - `post_access` (bool) — `CGPreflightPostEventAccess()` evaluated inside the daemon.
  - `last_error_at` (string|null) — ISO 8601 timestamp of the most recent `CGEventTap` failure. `null` when no failure has occurred since daemon start.
- `permissions` (object) — daemon-sourced TCC view. Always present.
  - `accessibility` (bool) — `AXIsProcessTrusted()` evaluated inside the daemon.
```

- [ ] **Step 1.9: Commit**

```bash
git add tests/daemon-ipc-system.sh src/perceive/daemon.swift src/daemon/unified.swift shared/schemas/daemon-response.schema.json shared/schemas/daemon-ipc.md
git commit -m "feat(daemon): add structured input_tap and permissions blocks to system.ping

Daemon-sourced view of input tap subsystem and TCC accessibility, alongside
existing flat fields. Closes the source-of-truth gap that lets a launchd-managed
daemon report ready while its event tap retries indefinitely.

Refs #109."
```

---

## Task 2: Shared input-tap parsing & guidance helpers

**Files:**
- Create: `src/shared/input-tap-health.swift`

### Steps

- [ ] **Step 2.1: Create the helper file**

Write `src/shared/input-tap-health.swift`:

```swift
// input-tap-health.swift — Parsing helpers and recovery guidance for daemon
// input-tap health, shared by service lifecycle (verifyServiceReadiness) and
// operator.swift (permissions check, status, doctor, do-family preflight).

import Foundation

// MARK: - Parsed Health View

struct InputTapHealth {
    let status: String           // "active", "retrying", "unavailable"
    let attempts: Int
    let listenAccess: Bool
    let postAccess: Bool
    let lastErrorAt: String?
}

struct DaemonPermissions {
    let accessibility: Bool
}

struct DaemonHealthView {
    let inputTap: InputTapHealth
    let permissions: DaemonPermissions
}

// MARK: - Ping Payload Parser

/// Parse a `system.ping` response payload into a daemon health view.
/// Accepts either the envelope-wrapped form (`{data: {...}}`) or the flat payload.
/// Returns nil if required fields are missing or malformed.
func parseDaemonHealthView(from response: [String: Any]) -> DaemonHealthView? {
    let payload = (response["data"] as? [String: Any]) ?? response
    guard let tap = payload["input_tap"] as? [String: Any],
          let status = tap["status"] as? String,
          let attempts = tap["attempts"] as? Int,
          let listenAccess = tap["listen_access"] as? Bool,
          let postAccess = tap["post_access"] as? Bool else {
        return nil
    }
    let lastErrorAt = tap["last_error_at"] as? String
    let perms = (payload["permissions"] as? [String: Any]) ?? [:]
    let accessibility = (perms["accessibility"] as? Bool) ?? false
    return DaemonHealthView(
        inputTap: InputTapHealth(
            status: status,
            attempts: attempts,
            listenAccess: listenAccess,
            postAccess: postAccess,
            lastErrorAt: lastErrorAt
        ),
        permissions: DaemonPermissions(accessibility: accessibility)
    )
}

// MARK: - Service Readiness Outcome

enum ServiceReadinessOutcome {
    case ok(view: DaemonHealthView)
    case inputTapInactive(view: DaemonHealthView)
    case socketUnreachable
}

extension ServiceReadinessOutcome {
    var statusString: String {
        switch self {
        case .ok: return "ok"
        case .inputTapInactive, .socketUnreachable: return "degraded"
        }
    }

    var reason: String? {
        switch self {
        case .ok: return nil
        case .inputTapInactive: return "input_tap_not_active"
        case .socketUnreachable: return "socket_unreachable"
        }
    }

    var exitCode: Int32 {
        switch self {
        case .ok: return 0
        case .inputTapInactive, .socketUnreachable: return 1
        }
    }

    var view: DaemonHealthView? {
        switch self {
        case .ok(let view), .inputTapInactive(let view): return view
        case .socketUnreachable: return nil
        }
    }
}

// MARK: - Recovery Guidance

enum RecoveryGuidanceContext {
    /// Generic context: the user is anywhere except mid-`service restart`.
    case `default`
    /// `service restart` has just completed and reported a degraded tap.
    /// We omit the "./aos service restart" line to avoid telling the user to
    /// re-run the exact command that just failed.
    case afterServiceRestart
}

/// Multi-line recovery text matching the spec's two recovery shapes.
/// `attempts` is included in the headline line.
func inputTapRecoveryGuidance(
    context: RecoveryGuidanceContext,
    status: String,
    attempts: Int
) -> String {
    let headline: String
    switch context {
    case .default:
        headline = "Input tap is not active (status=\(status), attempts=\(attempts))."
    case .afterServiceRestart:
        headline = "Input tap is still not active after service restart (status=\(status), attempts=\(attempts))."
    }
    var lines = [headline, "Try:"]
    if context != .afterServiceRestart {
        lines.append("  ./aos service restart              # restart the managed daemon and re-check readiness")
    }
    lines.append("  ./aos permissions setup --once     # refresh macOS permission onboarding")
    lines.append("  ./aos serve --idle-timeout none    # temporary foreground fallback for this session")
    return lines.joined(separator: "\n")
}

/// Recovery list for JSON output. Mirrors the text guidance, one entry per
/// recommended command, in the same order.
func inputTapRecoveryCommands(context: RecoveryGuidanceContext) -> [String] {
    var cmds: [String] = []
    if context != .afterServiceRestart {
        cmds.append("./aos service restart")
    }
    cmds.append("./aos permissions setup --once")
    cmds.append("./aos serve --idle-timeout none")
    return cmds
}

/// Sub-guidance appended when the daemon reports listen_access or post_access
/// as false. Points the operator at the System Settings pane and shows the
/// resolved daemon binary path so they grant access to the right binary.
func inputMonitoringSubGuidance(
    listenAccess: Bool,
    postAccess: Bool,
    daemonBinaryPath: String
) -> String {
    """
    Daemon lacks Input Monitoring access (listen=\(listenAccess), post=\(postAccess)).
    Open System Settings > Privacy & Security > Input Monitoring and grant access to the daemon binary:
      \(daemonBinaryPath)
    """
}
```

- [ ] **Step 2.2: Build the binary**

Run: `bash build.sh`

Expected: build succeeds. The new file is picked up automatically because `build.sh` globs `src/**/*.swift`.

- [ ] **Step 2.3: Commit**

```bash
git add src/shared/input-tap-health.swift
git commit -m "feat(shared): add input-tap-health helpers for ping parsing and guidance

Introduces InputTapHealth, DaemonPermissions, DaemonHealthView, and
ServiceReadinessOutcome plus shared recovery-guidance text. Consumed by the
service lifecycle readiness probe and by operator commands in subsequent
commits.

Refs #109."
```

---

## Task 3: Service lifecycle readiness building blocks

**Files:**
- Modify: `src/commands/service.swift` (add `verifyServiceReadiness`, response builder, hidden `_verify-readiness` subcommand)
- Modify: `shared/swift/ipc/request-client.swift` (drop terminationStatus gate in `startManagedDaemon`)

This task adds the building blocks but does **not** yet rewire `installAOSService`/`startAOSService`/restart through them. That's Task 4. Splitting keeps the diffs reviewable.

### Steps

- [ ] **Step 3.1: Add verifyServiceReadiness to service.swift**

Edit `src/commands/service.swift`. Add a new section at the end of the file (before the final brace, after `// MARK: - Utility`):

```swift
// MARK: - Readiness Probe

/// Block-and-poll the daemon socket for up to `budgetMs` milliseconds,
/// classifying the daemon's input-tap subsystem.
///
/// - Returns:
///   - `.ok(view)` when the socket is reachable and `input_tap.status == "active"`.
///   - `.inputTapInactive(view)` when the socket is reachable but the tap is
///     `retrying` or `unavailable` after the budget.
///   - `.socketUnreachable` when the budget elapses without any successful ping.
func verifyServiceReadiness(mode: AOSRuntimeMode, budgetMs: Int = 5000) -> ServiceReadinessOutcome {
    let socketPath = aosSocketPath(for: mode)
    let deadline = Date().addingTimeInterval(Double(budgetMs) / 1000.0)
    let pollIntervalUs: UInt32 = 100_000  // 100 ms

    var lastView: DaemonHealthView? = nil

    while Date() < deadline {
        if let response = sendEnvelopeRequest(
            service: "system",
            action: "ping",
            data: [:],
            socketPath: socketPath,
            timeoutMs: 250
        ), let view = parseDaemonHealthView(from: response) {
            lastView = view
            if view.inputTap.status == "active" {
                return .ok(view: view)
            }
        }
        usleep(pollIntervalUs)
    }

    if let view = lastView {
        return .inputTapInactive(view: view)
    }
    return .socketUnreachable
}
```

- [ ] **Step 3.2: Extend ServiceStatusResponse**

Still in `src/commands/service.swift`. Replace the existing `ServiceStatusResponse` struct (lines 9–23) with:

```swift
private struct ServiceInputTapBlock: Encodable {
    let status: String
    let attempts: Int
    let listen_access: Bool
    let post_access: Bool
}

private struct ServiceStatusResponse: Encodable {
    let status: String
    let mode: String
    let installed: Bool
    let running: Bool
    let pid: Int?
    let launchd_label: String
    let actual_binary_path: String?
    let expected_binary_path: String
    let actual_log_path: String?
    let expected_log_path: String
    let plist_path: String
    let state_dir: String
    let reason: String?
    let input_tap: ServiceInputTapBlock?
    let recovery: [String]?
    let notes: [String]
}
```

`reason`, `input_tap`, and `recovery` are optional and are `nil` for healthy responses (not encoded thanks to the implicit Encodable behavior — but we want them omitted, so set them to nil rather than empty).

To get the omission behavior on JSON output, the existing `jsonString` helper already uses `JSONEncoder()` with default options which encodes `nil` Optionals as `"key": null`. To omit them entirely, set the encoder's `keyEncodingStrategy` is not enough — we need a custom `encode(to:)` or use `Optional<T>` and `if let` writing. Simplest: switch this struct to a manual `encode(to:)`:

```swift
private struct ServiceStatusResponse: Encodable {
    let status: String
    let mode: String
    let installed: Bool
    let running: Bool
    let pid: Int?
    let launchd_label: String
    let actual_binary_path: String?
    let expected_binary_path: String
    let actual_log_path: String?
    let expected_log_path: String
    let plist_path: String
    let state_dir: String
    let reason: String?
    let input_tap: ServiceInputTapBlock?
    let recovery: [String]?
    let notes: [String]

    private enum CodingKeys: String, CodingKey {
        case status, mode, installed, running, pid, launchd_label
        case actual_binary_path, expected_binary_path
        case actual_log_path, expected_log_path
        case plist_path, state_dir
        case reason, input_tap, recovery, notes
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(status, forKey: .status)
        try c.encode(mode, forKey: .mode)
        try c.encode(installed, forKey: .installed)
        try c.encode(running, forKey: .running)
        try c.encodeIfPresent(pid, forKey: .pid)
        try c.encode(launchd_label, forKey: .launchd_label)
        try c.encodeIfPresent(actual_binary_path, forKey: .actual_binary_path)
        try c.encode(expected_binary_path, forKey: .expected_binary_path)
        try c.encodeIfPresent(actual_log_path, forKey: .actual_log_path)
        try c.encode(expected_log_path, forKey: .expected_log_path)
        try c.encode(plist_path, forKey: .plist_path)
        try c.encode(state_dir, forKey: .state_dir)
        try c.encodeIfPresent(reason, forKey: .reason)
        try c.encodeIfPresent(input_tap, forKey: .input_tap)
        try c.encodeIfPresent(recovery, forKey: .recovery)
        try c.encode(notes, forKey: .notes)
    }
}
```

Now find every call site that constructs `ServiceStatusResponse` (currently in `currentAOSServiceStatus` around line 207, which is the only one) and update it to pass `reason: nil, input_tap: nil, recovery: nil` since `service status` itself is read-only and does not surface tap state per the spec:

```swift
    return ServiceStatusResponse(
        status: notes.isEmpty ? "ok" : "degraded",
        mode: mode.rawValue,
        installed: installed,
        running: running,
        pid: pid,
        launchd_label: serviceLabel(for: mode),
        actual_binary_path: actualBinaryPath,
        expected_binary_path: paths.binaryPath,
        actual_log_path: actualLogPath,
        expected_log_path: paths.stderrLogPath,
        plist_path: paths.plistPath,
        state_dir: paths.logDir,
        reason: nil,
        input_tap: nil,
        recovery: nil,
        notes: notes
    )
```

- [ ] **Step 3.3: Add a readiness response builder**

Still in `src/commands/service.swift`. After the `verifyServiceReadiness` function added in Step 3.1, add:

```swift
/// Build a ServiceStatusResponse from a readiness outcome by overlaying
/// readiness fields onto the launchd-state response.
private func readinessResponse(
    outcome: ServiceReadinessOutcome,
    mode: AOSRuntimeMode,
    context: RecoveryGuidanceContext
) -> ServiceStatusResponse {
    let base = currentAOSServiceStatus(mode: mode)
    let inputTap: ServiceInputTapBlock?
    if let view = outcome.view {
        inputTap = ServiceInputTapBlock(
            status: view.inputTap.status,
            attempts: view.inputTap.attempts,
            listen_access: view.inputTap.listenAccess,
            post_access: view.inputTap.postAccess
        )
    } else {
        inputTap = nil
    }

    var notes = base.notes
    if case .inputTapInactive(let view) = outcome {
        notes.append(inputTapRecoveryGuidance(
            context: context,
            status: view.inputTap.status,
            attempts: view.inputTap.attempts
        ))
        if !view.inputTap.listenAccess || !view.inputTap.postAccess {
            notes.append(inputMonitoringSubGuidance(
                listenAccess: view.inputTap.listenAccess,
                postAccess: view.inputTap.postAccess,
                daemonBinaryPath: aosExpectedBinaryPath(program: "aos", mode: mode)
            ))
        }
    } else if case .socketUnreachable = outcome {
        notes.append("Daemon socket was not reachable within the readiness budget.")
    }

    let recovery: [String]?
    if case .inputTapInactive = outcome {
        recovery = inputTapRecoveryCommands(context: context)
    } else {
        recovery = nil
    }

    return ServiceStatusResponse(
        status: outcome.statusString,
        mode: base.mode,
        installed: base.installed,
        running: base.running,
        pid: base.pid,
        launchd_label: base.launchd_label,
        actual_binary_path: base.actual_binary_path,
        expected_binary_path: base.expected_binary_path,
        actual_log_path: base.actual_log_path,
        expected_log_path: base.expected_log_path,
        plist_path: base.plist_path,
        state_dir: base.state_dir,
        reason: outcome.reason,
        input_tap: inputTap,
        recovery: recovery,
        notes: notes
    )
}

private func emitReadinessAndExit(
    outcome: ServiceReadinessOutcome,
    mode: AOSRuntimeMode,
    context: RecoveryGuidanceContext,
    asJSON: Bool
) -> Never {
    let response = readinessResponse(outcome: outcome, mode: mode, context: context)
    if asJSON {
        print(jsonString(response))
    } else {
        print("mode=\(response.mode) installed=\(response.installed) running=\(response.running) pid=\(response.pid?.description ?? "none") label=\(response.launchd_label) status=\(response.status)\(response.reason.map { " reason=\($0)" } ?? "")")
        if let tap = response.input_tap {
            print("input_tap status=\(tap.status) attempts=\(tap.attempts) listen=\(tap.listen_access) post=\(tap.post_access)")
        }
        for note in response.notes where !note.isEmpty {
            print(note)
        }
    }
    exit(Int32(outcome.exitCode))
}
```

- [ ] **Step 3.4: Add the hidden _verify-readiness subcommand**

Still in `src/commands/service.swift`. Find the `serviceCommand` switch (around line 36) and add a case **before** the `default` arm:

```swift
    case "_verify-readiness":
        let options = parseServiceOptions(subArgs, usage: "aos service _verify-readiness [--mode repo|installed] [--json] [--budget-ms N]", extraFlags: ["--budget-ms"])
        let outcome = verifyServiceReadiness(mode: options.mode, budgetMs: options.budgetMs)
        emitReadinessAndExit(outcome: outcome, mode: options.mode, context: .default, asJSON: options.asJSON)
```

Update `ServiceCommandOptions` and `parseServiceOptions` to support `--budget-ms`:

```swift
private struct ServiceCommandOptions {
    let mode: AOSRuntimeMode
    let asJSON: Bool
    let tailCount: Int
    let budgetMs: Int
}

private func parseServiceOptions(_ args: [String], usage: String, extraFlags: [String] = []) -> ServiceCommandOptions {
    var asJSON = false
    var mode: AOSRuntimeMode? = nil
    var tailCount = 200
    var budgetMs = 5000
    var i = 0

    while i < args.count {
        switch args[i] {
        case "--json":
            asJSON = true
        case "--mode":
            i += 1
            guard i < args.count, let parsed = AOSRuntimeMode(rawValue: args[i]) else {
                exitError("--mode must be 'repo' or 'installed'", code: "INVALID_ARG")
            }
            mode = parsed
        case "--tail" where extraFlags.contains("--tail"):
            i += 1
            guard i < args.count, let value = Int(args[i]) else {
                exitError("--tail requires an integer", code: "INVALID_ARG")
            }
            tailCount = value
        case "--budget-ms" where extraFlags.contains("--budget-ms"):
            i += 1
            guard i < args.count, let value = Int(args[i]), value > 0 else {
                exitError("--budget-ms requires a positive integer", code: "INVALID_ARG")
            }
            budgetMs = value
        default:
            exitError("Unknown flag: \(args[i])", code: "UNKNOWN_FLAG")
        }
        i += 1
    }

    return ServiceCommandOptions(
        mode: mode ?? aosCurrentRuntimeMode(),
        asJSON: asJSON,
        tailCount: tailCount,
        budgetMs: budgetMs
    )
}
```

The leading underscore on `_verify-readiness` matches the existing `_internal-*` convention (see `src/commands/voice.swift:20-24`) for test-only entry points; it is intentionally not surfaced in `aos help service`.

- [ ] **Step 3.5: Drop the terminationStatus gate in startManagedDaemon**

Edit `shared/swift/ipc/request-client.swift`. The current block at lines 88–94 returns `false` whenever `aos service start --json` exits non-zero. Under the new lifecycle contract, `service start` exits non-zero when the input tap is not active, even though the socket is reachable and non-input commands would work. Replace lines 88–94 with:

```swift
        // service start exits non-zero when the input tap is not active even
        // though the socket is reachable; non-input commands should still
        // auto-start successfully. Forward stderr for diagnostics, but let the
        // socket poll below be the arbiter of success.
        if proc.terminationStatus != 0 {
            let data = stderrPipe.fileHandleForReading.readDataToEndOfFile()
            if let text = String(data: data, encoding: .utf8), !text.isEmpty {
                fputs("ipc: service start exited \(proc.terminationStatus): \(text)", stderr)
            }
        }
        return true
```

- [ ] **Step 3.6: Build the binary**

Run: `bash build.sh`

Expected: build succeeds.

- [ ] **Step 3.7: Smoke test — verify-readiness emits the expected JSON**

Run: `./aos service _verify-readiness --json --budget-ms 1000`

Expected on a healthy daemon: exit 0, JSON includes `"status": "ok"`, `"input_tap": {"status": "active", ...}`, no `reason` field.

If your local daemon's tap is currently bad, expect exit 1 with `"reason": "input_tap_not_active"`.

If no daemon is running, expect exit 1 with `"reason": null` and `"status": "degraded"` — wait, that's wrong. Re-check: `socketUnreachable` produces `reason = "socket_unreachable"`. So expect `"reason": "socket_unreachable"` in that case.

- [ ] **Step 3.8: Commit**

```bash
git add src/commands/service.swift shared/swift/ipc/request-client.swift
git commit -m "feat(service): add verifyServiceReadiness probe and emit helpers

Adds a 5s block-and-poll readiness classifier (ok / inputTapInactive /
socketUnreachable), a response builder that overlays readiness fields onto
the existing launchd-state response, and a hidden _verify-readiness
subcommand for tests. Drops the request-client auto-start exit-code gate so
non-input commands keep auto-starting against a daemon with a degraded tap.

Refs #109."
```

---

## Task 4: Refactor service install / start / restart to enforce the readiness contract

**Files:**
- Modify: `src/commands/service.swift` (replace `installAOSService`, `startAOSService`, restart path inside `serviceCommand`)

### Steps

- [ ] **Step 4.1: Refactor installAOSService**

In `src/commands/service.swift`, replace the existing `installAOSService` (around line 114) with:

```swift
private func installAOSService(asJSON: Bool, mode: AOSRuntimeMode) {
    let paths = aosServicePaths(mode: mode)
    guardBinaryExists(paths.binaryPath)
    do {
        try FileManager.default.createDirectory(atPath: paths.logDir, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(atPath: paths.launchAgentsDir, withIntermediateDirectories: true)
        let plistData = try PropertyListSerialization.data(
            fromPropertyList: aosServicePlist(paths: paths),
            format: .xml,
            options: 0
        )
        try plistData.write(to: URL(fileURLWithPath: paths.plistPath))
    } catch {
        exitError("Failed to write launch agent plist: \(error)", code: "WRITE_ERROR")
    }
    launchctlBootstrap(paths.plistPath, tolerateAlreadyBootstrapped: true)
    launchctlKickstart(serviceLabel(for: mode))

    let outcome = verifyServiceReadiness(mode: mode)
    emitReadinessAndExit(outcome: outcome, mode: mode, context: .default, asJSON: asJSON)
}
```

- [ ] **Step 4.2: Refactor startAOSService**

Replace the existing `startAOSService` (around line 134) with:

```swift
private func startAOSService(asJSON: Bool, mode: AOSRuntimeMode) {
    let paths = aosServicePaths(mode: mode)
    guardBinaryExists(paths.binaryPath)
    if !FileManager.default.fileExists(atPath: paths.plistPath) {
        // First-run: install + bootstrap + kickstart, then run the same
        // readiness probe. installAOSService exits via emitReadinessAndExit,
        // so control does not return.
        installAOSService(asJSON: asJSON, mode: mode)
        return
    }
    if !isServiceLoaded(label: serviceLabel(for: mode)) {
        launchctlBootstrap(paths.plistPath)
    }
    launchctlKickstart(serviceLabel(for: mode))

    let outcome = verifyServiceReadiness(mode: mode)
    emitReadinessAndExit(outcome: outcome, mode: mode, context: .default, asJSON: asJSON)
}
```

- [ ] **Step 4.3: Update the restart switch arm**

Find the `serviceCommand` switch (around line 47) and replace the `restart` arm with:

```swift
    case "restart":
        let options = parseServiceOptions(subArgs, usage: "aos service restart [--mode repo|installed] [--json]")
        stopAOSService(asJSON: false, mode: options.mode, emitStatus: false)
        let paths = aosServicePaths(mode: options.mode)
        guardBinaryExists(paths.binaryPath)
        if !FileManager.default.fileExists(atPath: paths.plistPath) {
            installAOSService(asJSON: options.asJSON, mode: options.mode)
            return
        }
        if !isServiceLoaded(label: serviceLabel(for: options.mode)) {
            launchctlBootstrap(paths.plistPath)
        }
        launchctlKickstart(serviceLabel(for: options.mode))
        let outcome = verifyServiceReadiness(mode: options.mode)
        emitReadinessAndExit(
            outcome: outcome,
            mode: options.mode,
            context: .afterServiceRestart,
            asJSON: options.asJSON
        )
```

The restart arm intentionally does **not** call `startAOSService` directly because we need to pass `.afterServiceRestart` as the recovery-guidance context (so the recovery list omits the redundant `./aos service restart` line). The duplicated launchctl boilerplate is small and explicit; do not factor it into a helper that hides the context choice.

- [ ] **Step 4.4: Build the binary**

Run: `bash build.sh`

Expected: build succeeds.

- [ ] **Step 4.5: Manual smoke test — happy path**

Run: `./aos service restart --json`

Expected on a normal repo workstation with a healthy tap: exit 0, JSON output includes `"status": "ok"`, `"input_tap": {"status": "active", ...}`, no `reason`.

Check the exit code: `echo $?` → `0`.

- [ ] **Step 4.6: Manual smoke test — non-input auto-start still works**

Run a non-input command that auto-starts the daemon:

```bash
./aos service stop
./aos see list --json | head -5
```

Expected: the `see list` command auto-starts the daemon via `service start` and returns topology JSON. Even if the tap status is `retrying` momentarily during startup, the auto-start path no longer rejects on non-zero exit.

- [ ] **Step 4.7: Commit**

```bash
git add src/commands/service.swift
git commit -m "feat(service): route install/start/restart through readiness probe

install/start/restart now block-and-poll system.ping for up to 5s after
launchctl kickstart, exit non-zero when the input tap is not active, and
include a structured input_tap block, reason field, and recovery hints in
the response. service status remains read-only and unchanged.

Refs #109."
```

---

## Task 5: Mock daemon fixture + permissions check changes

**Files:**
- Create: `tests/lib/mock-daemon.py`
- Create: `tests/input-tap-readiness.sh`
- Modify: `src/commands/operator.swift`

### Steps

- [ ] **Step 5.1: Create the mock daemon fixture**

Write `tests/lib/mock-daemon.py`:

```python
#!/usr/bin/env python3
"""Mock daemon socket server for input-tap readiness tests.

Speaks the v1 IPC envelope on a configurable Unix socket path. Responds to
system.ping with a payload whose input_tap and permissions blocks are filled
from CLI flags, so tests can exercise the daemon-aware reporting layer
without requiring a real CGEventTap failure or launchd round-trip.

Usage:
  mock-daemon.py --socket PATH [--tap-status STATUS] [--listen-access BOOL]
                 [--post-access BOOL] [--accessibility BOOL] [--attempts N]
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import threading
import time
from typing import Any


def parse_bool(value: str) -> bool:
    return value.lower() in ("1", "true", "yes")


def build_ping_payload(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "status": "ok",
        "uptime": 1.0,
        "pid": os.getpid(),
        "mode": args.mode,
        "socket_path": args.socket,
        "started_at": "2026-04-24T00:00:00Z",
        "perception_channels": 0,
        "subscribers": 0,
        "input_tap_status": args.tap_status,
        "input_tap_attempts": args.attempts,
        "input_tap": {
            "status": args.tap_status,
            "attempts": args.attempts,
            "listen_access": parse_bool(args.listen_access),
            "post_access": parse_bool(args.post_access),
            "last_error_at": None if args.tap_status == "active" else "2026-04-24T00:00:00Z",
        },
        "permissions": {
            "accessibility": parse_bool(args.accessibility),
        },
    }


def handle_request(line: bytes, args: argparse.Namespace) -> bytes:
    try:
        req = json.loads(line.decode())
    except Exception:
        return json.dumps({"v": 1, "status": "error", "error": "bad envelope", "code": "BAD_ENVELOPE"}).encode() + b"\n"
    svc = req.get("service")
    action = req.get("action")
    ref = req.get("ref")
    if (svc, action) == ("system", "ping"):
        resp: dict[str, Any] = {
            "v": 1,
            "status": "success",
            "data": build_ping_payload(args),
        }
        if ref is not None:
            resp["ref"] = ref
        return json.dumps(resp).encode() + b"\n"
    err: dict[str, Any] = {
        "v": 1,
        "status": "error",
        "error": f"mock daemon: unsupported (service, action): ({svc}, {action})",
        "code": "UNKNOWN_ACTION",
    }
    if ref is not None:
        err["ref"] = ref
    return json.dumps(err).encode() + b"\n"


def serve_client(conn: socket.socket, args: argparse.Namespace) -> None:
    try:
        with conn:
            buf = b""
            conn.settimeout(2.0)
            while True:
                chunk = conn.recv(4096)
                if not chunk:
                    return
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    if not line.strip():
                        continue
                    conn.sendall(handle_request(line, args))
    except (BrokenPipeError, ConnectionResetError, socket.timeout):
        return


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--socket", required=True)
    parser.add_argument("--mode", default="repo", choices=("repo", "installed"))
    parser.add_argument("--tap-status", default="active",
                        choices=("active", "retrying", "unavailable"))
    parser.add_argument("--attempts", type=int, default=1)
    parser.add_argument("--listen-access", default="true")
    parser.add_argument("--post-access", default="true")
    parser.add_argument("--accessibility", default="true")
    args = parser.parse_args()

    if os.path.exists(args.socket):
        os.unlink(args.socket)
    os.makedirs(os.path.dirname(args.socket), exist_ok=True)

    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(args.socket)
    server.listen(8)
    server.settimeout(0.5)

    sys.stdout.write(f"mock-daemon ready socket={args.socket} tap={args.tap_status}\n")
    sys.stdout.flush()

    try:
        while True:
            try:
                conn, _ = server.accept()
            except socket.timeout:
                continue
            t = threading.Thread(target=serve_client, args=(conn, args), daemon=True)
            t.start()
    except KeyboardInterrupt:
        pass
    finally:
        try:
            server.close()
        finally:
            if os.path.exists(args.socket):
                try:
                    os.unlink(args.socket)
                except OSError:
                    pass


if __name__ == "__main__":
    main()
```

Make it executable:

```bash
chmod +x tests/lib/mock-daemon.py
```

- [ ] **Step 5.2: Sanity-check the mock fixture**

Smoke-test the fixture by hand:

```bash
TMPSOCK=$(mktemp -d)/aos.sock
python3 tests/lib/mock-daemon.py --socket "$TMPSOCK" --tap-status retrying --listen-access false --post-access false &
MOCK_PID=$!
sleep 0.3
echo '{"v":1,"service":"system","action":"ping","data":{}}' | python3 -c '
import socket, sys, os
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect(os.environ["TMPSOCK"])
s.sendall(sys.stdin.read().encode() + b"\n")
print(s.recv(4096).decode().rstrip())
'
kill $MOCK_PID
rm -rf "$(dirname "$TMPSOCK")"
```

Export `TMPSOCK` for the inline Python: `export TMPSOCK="$TMPSOCK"`. Expected: a JSON line with `data.input_tap.status == "retrying"` and `data.input_tap.listen_access == false`.

- [ ] **Step 5.3: Write the failing input-tap-readiness test (permissions check piece)**

Create `tests/input-tap-readiness.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

# Spin up the mock under an isolated AOS_STATE_ROOT so this test never touches
# the developer's real daemon.
PREFIX="aos-input-tap-readiness"
STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$STATE_ROOT"
SOCK="$STATE_ROOT/repo/sock"
mkdir -p "$(dirname "$SOCK")"

cleanup() {
  if [[ -n "${MOCK_PID:-}" ]] && kill -0 "$MOCK_PID" 2>/dev/null; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
  fi
  rm -rf "$STATE_ROOT"
}
trap cleanup EXIT

python3 tests/lib/mock-daemon.py \
    --socket "$SOCK" \
    --tap-status retrying \
    --listen-access false \
    --post-access false \
    --attempts 3 \
    --accessibility true \
    >"$STATE_ROOT/mock.stdout" 2>"$STATE_ROOT/mock.stderr" &
MOCK_PID=$!

# Wait for the mock to bind.
for _ in $(seq 1 20); do
  if [[ -S "$SOCK" ]]; then break; fi
  sleep 0.1
done
if ! [[ -S "$SOCK" ]]; then
  echo "FAIL: mock daemon did not bind socket $SOCK"
  exit 1
fi

# permissions check should report ready_for_testing=false sourced from the daemon view.
OUT="$(./aos permissions check --json)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") == "degraded", f"status: {d}"
dv = d.get("daemon_view", {})
assert dv.get("reachable") is True, f"daemon_view.reachable: {d}"
tap = dv.get("input_tap", {})
assert tap.get("status") == "retrying", f"daemon_view.input_tap.status: {d}"
assert tap.get("listen_access") is False, f"daemon_view.input_tap.listen_access: {d}"
assert tap.get("post_access") is False, f"daemon_view.input_tap.post_access: {d}"
assert d.get("ready_for_testing") is False, f"ready_for_testing: {d}"
assert d.get("ready_source") == "daemon", f"ready_source: {d}"

# Recovery notes must mention the inactive-tap headline + restart command.
notes = d.get("notes", [])
joined = "\n".join(notes)
assert "Input tap is not active" in joined, f"missing tap headline: {notes}"
assert "./aos service restart" in joined, f"missing restart suggestion: {notes}"
'
echo "PASS: permissions check (degraded tap)"

echo "PASS"
```

Make it executable:

```bash
chmod +x tests/input-tap-readiness.sh
```

- [ ] **Step 5.4: Run the test, verify it fails**

Run: `bash tests/input-tap-readiness.sh`

Expected: failure on the `daemon_view.reachable is True` or earlier assertion, because `permissions check` does not yet emit the new fields. The test must fail before we implement.

- [ ] **Step 5.5: Refactor permissions check in operator.swift**

Edit `src/commands/operator.swift`. Locate the `permissionsCheckCommand` block (around line 565) and the response model (around line 105). Replace with the new shape.

First, replace the `PermissionsState` and add the new view structs near the top of the file (around line 10):

```swift
private struct PermissionsState: Encodable {
    let accessibility: Bool
    let screen_recording: Bool
}

private struct DaemonViewBlock: Encodable {
    let reachable: Bool
    let accessibility: Bool?
    let input_tap: PermissionsInputTapBlock?
}

private struct PermissionsInputTapBlock: Encodable {
    let status: String
    let attempts: Int
    let listen_access: Bool
    let post_access: Bool
}

private struct CLIViewBlock: Encodable {
    let accessibility: Bool
    let screen_recording: Bool
    let listen_access: Bool
    let post_access: Bool
}

private struct DisagreementEntry: Encodable {
    let cli: Bool
    let daemon: Bool
}
```

Replace `PermissionsResponse` (around line 105–113) with:

```swift
private struct PermissionsResponse: Encodable {
    let status: String
    let permissions: PermissionsState
    let daemon_view: DaemonViewBlock
    let cli_view: CLIViewBlock
    let requirements: [PermissionRequirement]
    let setup: PermissionsSetupState
    let missing_permissions: [String]
    let ready_for_testing: Bool
    let ready_source: String
    let disagreement: [String: DisagreementEntry]?
    let notes: [String]
}
```

- [ ] **Step 5.6: Add CLI-side preflight helpers**

Still in `src/commands/operator.swift`. Add helpers next to `preflightScreenRecordingAccess` (around line 842):

```swift
private func preflightListenEventAccess() -> Bool {
    if #available(macOS 10.15, *) {
        return CGPreflightListenEventAccess()
    }
    return true
}

private func preflightPostEventAccess() -> Bool {
    if #available(macOS 10.15, *) {
        return CGPreflightPostEventAccess()
    }
    return true
}
```

- [ ] **Step 5.7: Wire daemon-sourced permissions check**

Replace `permissionsCheckCommand` (around line 565) with:

```swift
private func permissionsCheckCommand(args: [String], usage: String) {
    guard args.allSatisfy({ $0 == "--json" }) else {
        let unknown = args.first(where: { $0 != "--json" }) ?? ""
        exitError("Unknown flag: \(unknown). Usage: \(usage)", code: "UNKNOWN_FLAG")
    }

    let cliPermissions = currentPermissionsState()
    let cliView = CLIViewBlock(
        accessibility: cliPermissions.accessibility,
        screen_recording: cliPermissions.screen_recording,
        listen_access: preflightListenEventAccess(),
        post_access: preflightPostEventAccess()
    )

    let mode = aosCurrentRuntimeMode()
    let daemonView: DaemonViewBlock
    var daemonHealth: DaemonHealthView? = nil
    if let response = sendEnvelopeRequest(
        service: "system",
        action: "ping",
        data: [:],
        socketPath: aosSocketPath(for: mode),
        timeoutMs: 250
    ), let view = parseDaemonHealthView(from: response) {
        daemonHealth = view
        daemonView = DaemonViewBlock(
            reachable: true,
            accessibility: view.permissions.accessibility,
            input_tap: PermissionsInputTapBlock(
                status: view.inputTap.status,
                attempts: view.inputTap.attempts,
                listen_access: view.inputTap.listenAccess,
                post_access: view.inputTap.postAccess
            )
        )
    } else {
        daemonView = DaemonViewBlock(reachable: false, accessibility: nil, input_tap: nil)
    }

    let setup = currentPermissionsSetupState(permissions: cliPermissions)

    var requirements = currentPermissionRequirements(permissions: cliPermissions)
    requirements.append(PermissionRequirement(
        id: "listen_access",
        granted: daemonHealth?.inputTap.listenAccess ?? cliView.listen_access,
        required_for: ["global input tap", "perception"],
        setup_trigger: "Input Monitoring TCC grant"
    ))
    requirements.append(PermissionRequirement(
        id: "post_access",
        granted: daemonHealth?.inputTap.postAccess ?? cliView.post_access,
        required_for: ["synthetic events (aos do click/type)"],
        setup_trigger: "Input Monitoring TCC grant"
    ))

    let readyForTesting: Bool
    let readySource: String
    if let view = daemonHealth {
        readyForTesting = view.permissions.accessibility
            && view.inputTap.status == "active"
            && setup.setup_completed
        readySource = "daemon"
    } else {
        readyForTesting = cliPermissions.accessibility
            && cliPermissions.screen_recording
            && setup.setup_completed
        readySource = "cli"
    }

    let missing = missingPermissionIDsFor(
        daemon: daemonHealth,
        cli: cliView
    )

    var disagreement: [String: DisagreementEntry] = [:]
    if let view = daemonHealth {
        if view.permissions.accessibility != cliView.accessibility {
            disagreement["accessibility"] = DisagreementEntry(cli: cliView.accessibility, daemon: view.permissions.accessibility)
        }
        if view.inputTap.listenAccess != cliView.listen_access {
            disagreement["listen_access"] = DisagreementEntry(cli: cliView.listen_access, daemon: view.inputTap.listenAccess)
        }
        if view.inputTap.postAccess != cliView.post_access {
            disagreement["post_access"] = DisagreementEntry(cli: cliView.post_access, daemon: view.inputTap.postAccess)
        }
    }

    var notes: [String] = []
    if !cliPermissions.accessibility {
        notes.append("Accessibility permission is not granted (CLI view).")
    }
    if !cliPermissions.screen_recording {
        notes.append("Screen Recording permission is not granted.")
    }
    if !setup.marker_exists {
        notes.append("Permission onboarding has not been completed for this runtime identity.")
    } else if !setup.bundle_matches_current {
        notes.append("Permission onboarding marker belongs to a different app bundle path.")
    }
    if let command = setup.recommended_command {
        notes.append("Run '\(command)' before interactive testing.")
    }
    if daemonHealth == nil {
        notes.append("Daemon unreachable; readiness computed from CLI preflights only.")
    } else if let view = daemonHealth, view.inputTap.status != "active" {
        notes.append(inputTapRecoveryGuidance(
            context: .default,
            status: view.inputTap.status,
            attempts: view.inputTap.attempts
        ))
        if !view.inputTap.listenAccess || !view.inputTap.postAccess {
            notes.append(inputMonitoringSubGuidance(
                listenAccess: view.inputTap.listenAccess,
                postAccess: view.inputTap.postAccess,
                daemonBinaryPath: aosExpectedBinaryPath(program: "aos", mode: mode)
            ))
        }
    }

    let response = PermissionsResponse(
        status: notes.isEmpty ? "ok" : "degraded",
        permissions: cliPermissions,
        daemon_view: daemonView,
        cli_view: cliView,
        requirements: requirements,
        setup: setup,
        missing_permissions: missing,
        ready_for_testing: readyForTesting,
        ready_source: readySource,
        disagreement: disagreement.isEmpty ? nil : disagreement,
        notes: notes
    )
    print(jsonString(response))
}

private func missingPermissionIDsFor(daemon: DaemonHealthView?, cli: CLIViewBlock) -> [String] {
    var missing: [String] = []
    let accessibility = daemon?.permissions.accessibility ?? cli.accessibility
    let listen = daemon?.inputTap.listenAccess ?? cli.listen_access
    let post = daemon?.inputTap.postAccess ?? cli.post_access
    if !accessibility { missing.append("accessibility") }
    if !cli.screen_recording { missing.append("screen_recording") }
    if !listen { missing.append("listen_access") }
    if !post { missing.append("post_access") }
    return missing
}
```

The `disagreement` field is omitted from the JSON when empty thanks to `Optional`. The default `JSONEncoder` encodes `nil` as `null`; if you need it to be absent rather than `null`, switch `PermissionsResponse` to a manual `encode(to:)` that uses `encodeIfPresent` for `disagreement` (mirror what we did for `ServiceStatusResponse` in Task 3).

- [ ] **Step 5.8: Make disagreement omission explicit (manual encode)**

Add a manual `encode(to:)` to `PermissionsResponse` so `disagreement` is omitted, not null, when empty:

```swift
private struct PermissionsResponse: Encodable {
    let status: String
    let permissions: PermissionsState
    let daemon_view: DaemonViewBlock
    let cli_view: CLIViewBlock
    let requirements: [PermissionRequirement]
    let setup: PermissionsSetupState
    let missing_permissions: [String]
    let ready_for_testing: Bool
    let ready_source: String
    let disagreement: [String: DisagreementEntry]?
    let notes: [String]

    private enum CodingKeys: String, CodingKey {
        case status, permissions, daemon_view, cli_view, requirements, setup
        case missing_permissions, ready_for_testing, ready_source
        case disagreement, notes
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(status, forKey: .status)
        try c.encode(permissions, forKey: .permissions)
        try c.encode(daemon_view, forKey: .daemon_view)
        try c.encode(cli_view, forKey: .cli_view)
        try c.encode(requirements, forKey: .requirements)
        try c.encode(setup, forKey: .setup)
        try c.encode(missing_permissions, forKey: .missing_permissions)
        try c.encode(ready_for_testing, forKey: .ready_for_testing)
        try c.encode(ready_source, forKey: .ready_source)
        try c.encodeIfPresent(disagreement, forKey: .disagreement)
        try c.encode(notes, forKey: .notes)
    }
}
```

- [ ] **Step 5.9: Build the binary**

Run: `bash build.sh`

Expected: build succeeds.

- [ ] **Step 5.10: Run the test, verify it passes**

Run: `bash tests/input-tap-readiness.sh`

Expected: `PASS: permissions check (degraded tap)` and `PASS`.

- [ ] **Step 5.11: Commit**

```bash
git add tests/lib/mock-daemon.py tests/input-tap-readiness.sh src/commands/operator.swift
git commit -m "feat(permissions): daemon-sourced view in permissions check + mock fixture

permissions check (and the preflight alias) now ping the running daemon and
source accessibility, listen_access, post_access, and input_tap status from
its system.ping response, falling back to CLI preflights only when the
daemon is unreachable. ready_for_testing/ready_source are computed from the
authoritative source, and disagreement between CLI and daemon views is
surfaced explicitly.

Adds a Python mock-daemon test fixture and a tests/input-tap-readiness.sh
shell test that exercises the new behavior without launchd or TCC
manipulation.

Refs #109."
```

---

## Task 6: status, doctor, session-start hook

**Files:**
- Modify: `src/commands/operator.swift` (status, doctor, runtime state nested input_tap, recovery notes)
- Modify: `.agents/hooks/session-start.sh` (snapshot line + one-line pointer)
- Modify: `tests/input-tap-readiness.sh` (extend to assert status output)

### Steps

- [ ] **Step 6.1: Extend RuntimeState with the nested input_tap block**

In `src/commands/operator.swift`. Add a nested struct near other runtime-side structs (around line 33):

```swift
private struct RuntimeInputTapBlock: Encodable {
    let status: String
    let attempts: Int
    let listen_access: Bool
    let post_access: Bool
    let last_error_at: String?
}
```

Modify `RuntimeState` (around line 33–57) to add the nested block — keep the flat fields untouched:

```swift
private struct RuntimeState: Encodable {
    let mode: String
    let state_dir: String
    let other_mode_state_dir: String
    let daemon_running: Bool
    let daemon_pid: Int?
    let serving_pid: Int?
    let lock_owner_pid: Int?
    let service_pid: Int?
    let ownership_state: String
    let socket_path: String
    let socket_exists: Bool
    let socket_reachable: Bool
    let other_mode_socket_path: String
    let other_mode_socket_reachable: Bool
    let uptime_seconds: Double?
    let event_tap_expected: Bool
    let input_tap_status: String?
    let input_tap_attempts: Int?
    let input_tap: RuntimeInputTapBlock?
    let installed_app_path: String
    let installed_app_exists: Bool
    let legacy_state_dir: String
    let legacy_state_items: [String]
    let repo_artifacts: [String]
}
```

- [ ] **Step 6.2: Extend DaemonHealthState and ping forwarding**

In `src/commands/operator.swift`. Replace `DaemonHealthState` (around line 163) with a richer view tied to the shared parser:

```swift
private struct DaemonHealthState {
    let servingPID: Int?
    let uptime: Double?
    let inputTapStatus: String?
    let inputTapAttempts: Int?
    let inputTapListenAccess: Bool?
    let inputTapPostAccess: Bool?
    let inputTapLastErrorAt: String?
    let daemonAccessibility: Bool?
}
```

Replace `fetchDaemonHealth` (around line 725) with:

```swift
private func fetchDaemonHealth(socketPath: String) -> DaemonHealthState? {
    guard let response = sendEnvelopeRequest(service: "system", action: "ping", data: [:], socketPath: socketPath, timeoutMs: 250) else {
        return nil
    }
    let payload = (response["data"] as? [String: Any]) ?? response
    let view = parseDaemonHealthView(from: response)
    return DaemonHealthState(
        servingPID: payload["pid"] as? Int,
        uptime: payload["uptime"] as? Double,
        inputTapStatus: view?.inputTap.status ?? (payload["input_tap_status"] as? String),
        inputTapAttempts: view?.inputTap.attempts ?? (payload["input_tap_attempts"] as? Int),
        inputTapListenAccess: view?.inputTap.listenAccess,
        inputTapPostAccess: view?.inputTap.postAccess,
        inputTapLastErrorAt: view?.inputTap.lastErrorAt,
        daemonAccessibility: view?.permissions.accessibility
    )
}
```

The pre-existing flat-field fallbacks let very old daemons that haven't been rebuilt still populate the legacy `inputTapStatus`/`inputTapAttempts` fields.

- [ ] **Step 6.3: Update currentRuntimeState to populate the nested input_tap**

In `currentRuntimeState` (around line 604). Replace the `RuntimeState(...)` initializer with:

```swift
    let inputTapBlock: RuntimeInputTapBlock?
    if let status = health?.inputTapStatus,
       let attempts = health?.inputTapAttempts,
       let listen = health?.inputTapListenAccess,
       let post = health?.inputTapPostAccess {
        inputTapBlock = RuntimeInputTapBlock(
            status: status,
            attempts: attempts,
            listen_access: listen,
            post_access: post,
            last_error_at: health?.inputTapLastErrorAt
        )
    } else {
        inputTapBlock = nil
    }

    return RuntimeState(
        mode: mode.rawValue,
        state_dir: aosStateDir(for: mode),
        other_mode_state_dir: aosStateDir(for: mode.other),
        daemon_running: daemonRunning,
        daemon_pid: daemonPID,
        serving_pid: servingPID,
        lock_owner_pid: lockOwnerPID,
        service_pid: servicePID,
        ownership_state: ownershipState,
        socket_path: socketPath,
        socket_exists: socketExists,
        socket_reachable: socketReachable,
        other_mode_socket_path: otherModeSocketPath,
        other_mode_socket_reachable: otherSocketReachable,
        uptime_seconds: health?.uptime,
        event_tap_expected: true,
        input_tap_status: health?.inputTapStatus,
        input_tap_attempts: health?.inputTapAttempts,
        input_tap: inputTapBlock,
        installed_app_path: aosInstallAppPath(),
        installed_app_exists: FileManager.default.fileExists(atPath: aosInstallAppPath()),
        legacy_state_dir: aosLegacyStateDir(),
        legacy_state_items: legacyStateItems(),
        repo_artifacts: repoArtifactList()
    )
```

- [ ] **Step 6.4: Update the status text-mode one-liner to include tap=<value>**

In `statusCommand` (around line 261). Replace the line construction with:

```swift
    let tapValue: String
    if !runtime.socket_reachable {
        tapValue = "unknown"
    } else {
        tapValue = runtime.input_tap_status ?? "unknown"
    }
    let daemonState = runtime.socket_reachable ? "reachable" : (runtime.daemon_running ? "running" : "down")
    var line = "status=\(response.status) mode=\(runtime.mode) daemon=\(daemonState) pid=\(runtime.daemon_pid.map { String($0) } ?? "?") tap=\(tapValue) focused_app=\(focusedApp) displays=\(displays) windows=\(windows) channels=\(channels) stale_canvases=\(staleCanvasCount)"
    if let git {
        let ahead = git.ahead_of_origin_main.map { String($0) } ?? "?"
        line += " branch=\(git.branch) ahead=\(ahead) dirty=\(git.dirty_files)"
    }
    print(line)
```

- [ ] **Step 6.5: Add Input Monitoring sub-guidance to status notes**

Still in `statusCommand`. After the existing `notes.append(contentsOf: runtimeHealthNotes(runtime))` line (around line 197), add:

```swift
    if runtime.socket_reachable, let tap = runtime.input_tap, tap.status != "active" {
        notes.append(inputTapRecoveryGuidance(
            context: .default,
            status: tap.status,
            attempts: tap.attempts
        ))
        if !tap.listen_access || !tap.post_access {
            notes.append(inputMonitoringSubGuidance(
                listenAccess: tap.listen_access,
                postAccess: tap.post_access,
                daemonBinaryPath: aosExpectedBinaryPath(program: "aos", mode: aosCurrentRuntimeMode())
            ))
        }
    }
```

The existing `runtimeHealthNotes` function already adds `"Perception input tap is not active (status=\(tapStatus))."` so we're not duplicating that one-liner; this block adds the explicit recovery guidance plus the targeted Input Monitoring hint.

- [ ] **Step 6.6: Extend doctor with ready_for_testing and ready_source**

In `src/commands/operator.swift`. Update `DoctorResponse` (around line 93–103):

```swift
private struct DoctorResponse: Encodable {
    let status: String
    let platform: DoctorPlatform
    let identity: RuntimeIdentityState
    let permissions: PermissionsState
    let permissions_requirements: [PermissionRequirement]
    let permissions_setup: PermissionsSetupState
    let runtime: RuntimeState
    let aos_service: LaunchAgentState
    let ready_for_testing: Bool
    let ready_source: String
    let notes: [String]
}
```

In `doctorCommand` (around line 274–356), replace the response-building section near the bottom with:

```swift
    let mode = aosCurrentRuntimeMode()
    let setup = currentPermissionsSetupState(permissions: permissions)
    let readyForTesting: Bool
    let readySource: String
    if runtime.socket_reachable, let tap = runtime.input_tap, let daemonAcc = fetchDaemonHealth(socketPath: aosSocketPath(for: mode))?.daemonAccessibility {
        readyForTesting = daemonAcc && tap.status == "active" && setup.setup_completed
        readySource = "daemon"
    } else {
        readyForTesting = permissions.accessibility && permissions.screen_recording && setup.setup_completed
        readySource = "cli"
    }

    if runtime.socket_reachable, let tap = runtime.input_tap, tap.status != "active" {
        notes.append(inputTapRecoveryGuidance(
            context: .default,
            status: tap.status,
            attempts: tap.attempts
        ))
        if !tap.listen_access || !tap.post_access {
            notes.append(inputMonitoringSubGuidance(
                listenAccess: tap.listen_access,
                postAccess: tap.post_access,
                daemonBinaryPath: aosExpectedBinaryPath(program: "aos", mode: mode)
            ))
        }
    }

    let version = ProcessInfo.processInfo.operatingSystemVersion
    let identity = aosCurrentRuntimeIdentity(program: "aos")
    let response = DoctorResponse(
        status: notes.isEmpty ? "ok" : "degraded",
        platform: DoctorPlatform(
            os: "macOS",
            version: "\(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
        ),
        identity: RuntimeIdentityState(
            program: identity.program,
            mode: identity.mode,
            executable_path: identity.executable_path,
            state_dir: identity.state_dir,
            socket_path: identity.socket_path,
            build_timestamp: identity.build_timestamp,
            repo_root: identity.repo_root,
            git_commit: identity.git_commit,
            bundle_version: identity.bundle_version,
            bundle_build: identity.bundle_build
        ),
        permissions: permissions,
        permissions_requirements: permissionRequirements,
        permissions_setup: permissionsSetup,
        runtime: runtime,
        aos_service: aosService,
        ready_for_testing: readyForTesting,
        ready_source: readySource,
        notes: notes
    )
    print(jsonString(response))
```

The duplicate `fetchDaemonHealth` call inside doctor is a small perf cost paid once per `doctor` invocation; not worth caching.

- [ ] **Step 6.7: Extend the readiness test with status assertions**

Append to `tests/input-tap-readiness.sh` before `echo "PASS"`:

```bash
# status --json should expose runtime.input_tap with daemon-sourced fields.
OUT="$(./aos status --json)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
runtime = d.get("runtime", {})
tap = runtime.get("input_tap")
assert isinstance(tap, dict), f"runtime.input_tap missing: {d}"
assert tap.get("status") == "retrying", f"runtime.input_tap.status: {tap}"
assert tap.get("listen_access") is False, f"listen_access: {tap}"
assert tap.get("post_access") is False, f"post_access: {tap}"

notes = d.get("notes", [])
joined = "\n".join(notes)
assert "Input tap is not active" in joined, f"missing tap headline: {notes}"
assert "Input Monitoring" in joined, f"missing Input Monitoring sub-guidance: {notes}"
'
echo "PASS: status --json (degraded tap)"

# status (text) one-liner should include tap=retrying.
OUT_TEXT="$(./aos status 2>&1 | head -1)"
case "$OUT_TEXT" in
  *"tap=retrying"*) echo "PASS: status text one-liner" ;;
  *) echo "FAIL: status text one-liner missing tap=retrying: $OUT_TEXT"; exit 1 ;;
esac
```

- [ ] **Step 6.8: Build and run the readiness test**

Run:

```bash
bash build.sh
bash tests/input-tap-readiness.sh
```

Expected: all three PASS lines, then final `PASS`.

- [ ] **Step 6.9: Update the session-start hook**

Edit `.agents/hooks/session-start.sh`. Find the Python block that prints the snapshot line (around lines 119–137) and replace with:

```bash
echo "## Snapshot"
if [ -x "$AOS" ]; then
  STATUS="$(printf '%s' "$AOS_DOCTOR_JSON" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    mode = d.get('identity',{}).get('mode','?')
    status = d.get('status','?')
    runtime = d.get('runtime', {})
    pid = runtime.get('daemon_pid','?')
    acc = d.get('permissions',{}).get('accessibility', False)
    scr = d.get('permissions',{}).get('screen_recording', False)
    commit = d.get('identity',{}).get('git_commit','?')
    socket_reachable = runtime.get('socket_reachable', False)
    tap_block = runtime.get('input_tap')
    if not socket_reachable:
        tap_value = 'unknown'
    elif isinstance(tap_block, dict):
        tap_value = tap_block.get('status', 'unknown')
    else:
        tap_value = runtime.get('input_tap_status', 'unknown')
    print(f'mode={mode} status={status} pid={pid} startup=${AOS_STARTUP_STATE} commit={commit} acc={\"ok\" if acc else \"NO\"} scr={\"ok\" if scr else \"NO\"} tap={tap_value}')
except Exception:
    print('aos doctor failed to parse')
" 2>/dev/null || echo "aos not running or not built")"
  echo "aos=$STATUS"
else
  echo "aos=missing"
fi

# When tap is non-active and the daemon is reachable, point at status for full
# guidance. Skip when daemon=unreachable: the daemon-recovery story is the
# bigger signal in that case.
if [ -x "$AOS" ]; then
  TAP_PTR="$(printf '%s' "$AOS_DOCTOR_JSON" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    runtime = d.get('runtime', {})
    if not runtime.get('socket_reachable', False):
        sys.exit(0)
    tap_block = runtime.get('input_tap')
    status = tap_block.get('status') if isinstance(tap_block, dict) else runtime.get('input_tap_status')
    if status and status != 'active':
        print(f\"input_tap inactive (status={status}) — run './aos service restart' (see './aos status' for full guidance)\")
except Exception:
    pass
" 2>/dev/null)"
  if [ -n "$TAP_PTR" ]; then
    echo "$TAP_PTR"
  fi
fi
```

- [ ] **Step 6.10: Manual smoke-test the hook**

Run the hook directly to confirm the new line:

```bash
.agents/hooks/session-start.sh
```

Expected: a snapshot block ending with `tap=active` (or `tap=retrying` if your tap is currently bad). When the tap is non-active, an additional line below the snapshot reads `input_tap inactive (status=retrying) — run './aos service restart' ...`.

- [ ] **Step 6.11: Commit**

```bash
git add src/commands/operator.swift .agents/hooks/session-start.sh tests/input-tap-readiness.sh
git commit -m "feat(status,doctor,hook): surface daemon input_tap as a first-class field

status JSON gains runtime.input_tap; status text one-liner gains tap=<value>.
doctor gains ready_for_testing and ready_source. Both append explicit recovery
guidance plus an Input Monitoring sub-hint when the daemon's listen/post
access is denied. Session-start hook now prints tap=<value> alongside acc/scr
and adds a one-line pointer to ./aos status when the tap is inactive.

Refs #109."
```

---

## Task 7: do-family preflight error path (INPUT_TAP_NOT_ACTIVE)

**Files:**
- Modify: `src/commands/operator.swift` (`ensureInteractivePreflight`)
- Modify: `tests/input-tap-readiness.sh` (add do click assertion)
- Modify: `shared/schemas/daemon-ipc.md` (add the new error code to the vocabulary)

### Steps

- [ ] **Step 7.1: Append the do click assertion to the readiness test**

Append to `tests/input-tap-readiness.sh` before `echo "PASS"`:

```bash
# do click should fail at the preflight gate with INPUT_TAP_NOT_ACTIVE.
set +e
DO_OUT="$(./aos do click 500,300 2>&1)"
DO_RC=$?
set -e
if [ "$DO_RC" -eq 0 ]; then
  echo "FAIL: do click unexpectedly exited 0 against degraded tap: $DO_OUT"
  exit 1
fi
case "$DO_OUT" in
  *INPUT_TAP_NOT_ACTIVE*) echo "PASS: do click exits with INPUT_TAP_NOT_ACTIVE" ;;
  *) echo "FAIL: do click error code missing INPUT_TAP_NOT_ACTIVE: $DO_OUT (rc=$DO_RC)"; exit 1 ;;
esac
```

- [ ] **Step 7.2: Run the test, verify it fails**

Run: `bash tests/input-tap-readiness.sh`

Expected: failure on the new `INPUT_TAP_NOT_ACTIVE` assertion. The current `ensureInteractivePreflight` exits with `PERMISSIONS_SETUP_REQUIRED` if at all, not the new code.

- [ ] **Step 7.3: Widen ensureInteractivePreflight**

In `src/commands/operator.swift`. Replace `ensureInteractivePreflight` (around line 386) with:

```swift
func ensureInteractivePreflight(command: String) {
    if ProcessInfo.processInfo.environment["AOS_BYPASS_PREFLIGHT"] == "1" {
        return
    }

    let permissions = currentPermissionsState()
    let setup = currentPermissionsSetupState(permissions: permissions)
    guard setup.setup_completed else {
        let missing = missingPermissionIDs(permissions)
        let details = missing.isEmpty
            ? "Permissions appear granted, but onboarding has not been completed for this runtime identity."
            : "Missing permissions: \(missing.joined(separator: ", "))."
        let nextStep = setup.recommended_command ?? "aos permissions setup --once"
        exitError(
            "\(command) requires upfront permissions onboarding. \(details) Run '\(nextStep)' before interactive testing.",
            code: "PERMISSIONS_SETUP_REQUIRED"
        )
    }

    // If the daemon is reachable, gate on its tap state. An "active" tap is
    // the only signal that input commands will actually work.
    let mode = aosCurrentRuntimeMode()
    if let response = sendEnvelopeRequest(
        service: "system",
        action: "ping",
        data: [:],
        socketPath: aosSocketPath(for: mode),
        timeoutMs: 250
    ), let view = parseDaemonHealthView(from: response), view.inputTap.status != "active" {
        let guidance = inputTapRecoveryGuidance(
            context: .default,
            status: view.inputTap.status,
            attempts: view.inputTap.attempts
        )
        var message = "\(command) requires an active input tap, but the daemon reports input_tap.status=\(view.inputTap.status). \(guidance)"
        if !view.inputTap.listenAccess || !view.inputTap.postAccess {
            message += "\n" + inputMonitoringSubGuidance(
                listenAccess: view.inputTap.listenAccess,
                postAccess: view.inputTap.postAccess,
                daemonBinaryPath: aosExpectedBinaryPath(program: "aos", mode: mode)
            )
        }
        exitError(message, code: "INPUT_TAP_NOT_ACTIVE")
    }
}
```

When the daemon is unreachable, `ensureInteractivePreflight` keeps the existing pre-change behavior (the daemon will be auto-started by the per-command socket connection a moment later; if startup itself is broken the failure will be visible at that layer with daemon-side error codes).

- [ ] **Step 7.4: Build and run the test**

Run:

```bash
bash build.sh
bash tests/input-tap-readiness.sh
```

Expected: all PASS lines including `PASS: do click exits with INPUT_TAP_NOT_ACTIVE`.

- [ ] **Step 7.5: Document the new error code**

Edit `shared/schemas/daemon-ipc.md`. Find the error-code table (around line 65–75). Add a row:

```markdown
| `INPUT_TAP_NOT_ACTIVE` | Daemon is reachable but its global input tap is not active. Emitted by `do`-family preflight when the daemon's `system.ping` reports `input_tap.status != "active"`, and surfaced as `reason` in service install/start/restart responses when the tap-inactive branch is hit. |
```

- [ ] **Step 7.6: Commit**

```bash
git add src/commands/operator.swift tests/input-tap-readiness.sh shared/schemas/daemon-ipc.md
git commit -m "feat(do): gate do-family preflight on daemon input_tap status

ensureInteractivePreflight now pings the daemon when reachable and exits
with the new INPUT_TAP_NOT_ACTIVE error code when input_tap.status is not
active. Preserves the existing PERMISSIONS_SETUP_REQUIRED path for unsetup
runtimes; adds explicit recovery guidance and the Input Monitoring sub-hint
when listen/post access is denied.

Refs #109."
```

---

## Task 8: readiness classifier integration test + api docs

**Files:**
- Create: `tests/input-tap-readiness-classifier.sh`
- Modify: `docs/api/aos.md`

### Steps

- [ ] **Step 8.1: Add a classifier integration test using the hidden subcommand**

Create `tests/input-tap-readiness-classifier.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

PREFIX="aos-readiness-classifier"
STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$STATE_ROOT"
SOCK="$STATE_ROOT/repo/sock"
mkdir -p "$(dirname "$SOCK")"

cleanup() {
  if [[ -n "${MOCK_PID:-}" ]] && kill -0 "$MOCK_PID" 2>/dev/null; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
  fi
  rm -rf "$STATE_ROOT"
}
trap cleanup EXIT

start_mock() {
  local status="$1"
  python3 tests/lib/mock-daemon.py \
      --socket "$SOCK" \
      --tap-status "$status" \
      --listen-access true \
      --post-access true \
      --accessibility true \
      >"$STATE_ROOT/mock.stdout" 2>"$STATE_ROOT/mock.stderr" &
  MOCK_PID=$!
  for _ in $(seq 1 20); do
    if [[ -S "$SOCK" ]]; then return 0; fi
    sleep 0.1
  done
  echo "FAIL: mock did not bind"; exit 1
}

stop_mock() {
  if kill -0 "$MOCK_PID" 2>/dev/null; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
  fi
  rm -f "$SOCK"
}

# Case 1: active tap -> outcome ok, exit 0.
start_mock active
set +e
OUT="$(./aos service _verify-readiness --json --budget-ms 1000)"
RC=$?
set -e
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") == "ok", d
assert d.get("input_tap", {}).get("status") == "active", d
assert "reason" not in d or d.get("reason") is None, d
'
[ "$RC" -eq 0 ] || { echo "FAIL: active case exit=$RC"; exit 1; }
echo "PASS: classifier active -> ok"
stop_mock

# Case 2: retrying tap -> outcome inputTapInactive, exit 1.
start_mock retrying
set +e
OUT="$(./aos service _verify-readiness --json --budget-ms 1000)"
RC=$?
set -e
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") == "degraded", d
assert d.get("reason") == "input_tap_not_active", d
assert d.get("input_tap", {}).get("status") == "retrying", d
'
[ "$RC" -eq 1 ] || { echo "FAIL: retrying case exit=$RC"; exit 1; }
echo "PASS: classifier retrying -> input_tap_not_active"
stop_mock

# Case 3: no mock listening -> outcome socketUnreachable, exit 1.
# (Mock not started; rely on the empty $SOCK.)
rm -f "$SOCK"
set +e
OUT="$(./aos service _verify-readiness --json --budget-ms 500)"
RC=$?
set -e
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") == "degraded", d
assert d.get("reason") == "socket_unreachable", d
assert d.get("input_tap") is None, d
'
[ "$RC" -eq 1 ] || { echo "FAIL: unreachable case exit=$RC"; exit 1; }
echo "PASS: classifier unreachable -> socket_unreachable"

echo "PASS"
```

Make it executable:

```bash
chmod +x tests/input-tap-readiness-classifier.sh
```

- [ ] **Step 8.2: Run the classifier test**

Run: `bash tests/input-tap-readiness-classifier.sh`

Expected: all three PASS lines (`active -> ok`, `retrying -> input_tap_not_active`, `unreachable -> socket_unreachable`) followed by final `PASS`.

If the third case fails because `service _verify-readiness` finds a different reachable daemon (e.g. your real one), confirm `AOS_STATE_ROOT` is being honored — `aosSocketPath(for:)` should resolve to `$AOS_STATE_ROOT/repo/sock`. If the resolution doesn't honor `AOS_STATE_ROOT` for hidden subcommands, the test won't isolate; check `shared/swift/ipc/runtime-paths.swift` and ensure no special-case shortcut bypasses the override.

- [ ] **Step 8.3: Add a "daemon-aware readiness" section to docs/api/aos.md**

Edit `docs/api/aos.md`. Append a new section near the existing service/permissions documentation:

```markdown
## Daemon-aware readiness

The daemon's `system.ping` response carries a structured `input_tap` block
and a `permissions` block sourced from inside the daemon process. Because
the launchd-managed daemon is a different process from the CLI, its TCC
grants can diverge from the CLI's. The fields below are the canonical view
when judging whether the daemon can actually observe and inject input.

```json
"input_tap": {
  "status": "active",        // active | retrying | unavailable
  "attempts": 1,
  "listen_access": true,     // CGPreflightListenEventAccess() in daemon
  "post_access": true,       // CGPreflightPostEventAccess() in daemon
  "last_error_at": null      // ISO-8601 of most recent CGEventTap failure
},
"permissions": {
  "accessibility": true      // AXIsProcessTrusted() in daemon
}
```

Consumers:
- `aos permissions check --json` exposes `daemon_view`, `cli_view`,
  `ready_source`, and `disagreement` fields. `ready_for_testing` is computed
  from the daemon view when reachable and from the CLI view as fallback.
- `aos status --json` exposes `runtime.input_tap` (full block) plus the
  legacy flat `runtime.input_tap_status` / `runtime.input_tap_attempts`.
- `aos status` text mode includes `tap=<status>` in the one-line summary.
- `aos doctor --json` exposes top-level `ready_for_testing` and
  `ready_source`.
- `aos service install`, `start`, and `restart` block-and-poll for up to 5s
  after launchctl kickstart and exit non-zero with `reason: "input_tap_not_active"`
  or `"socket_unreachable"` when the daemon is not fully ready.
- `aos do click/type/...` preflight exits with `INPUT_TAP_NOT_ACTIVE` when
  the daemon is reachable but its tap is inactive.

Test entry point: `aos service _verify-readiness [--json] [--budget-ms N]`
runs the readiness probe against the running daemon and emits the same
response shape `service install/start/restart` produce. Used by
`tests/input-tap-readiness-classifier.sh`. Not advertised in user help.
```

- [ ] **Step 8.4: Run the full test suite for the readiness work**

Run:

```bash
bash tests/daemon-ipc-system.sh
bash tests/input-tap-readiness.sh
bash tests/input-tap-readiness-classifier.sh
```

Expected: all three pass.

- [ ] **Step 8.5: Commit**

```bash
git add tests/input-tap-readiness-classifier.sh docs/api/aos.md
git commit -m "test,docs: classifier integration test + daemon-aware readiness section

tests/input-tap-readiness-classifier.sh exercises verifyServiceReadiness via
the hidden _verify-readiness subcommand against the Python mock for active /
retrying / unreachable cases. docs/api/aos.md gains a daemon-aware readiness
section documenting the new ping fields and consumer behavior.

Refs #109."
```

---

## Task 9: Schema contract governance doc + cross-references

**Files:**
- Create: `shared/schemas/CONTRACT-GOVERNANCE.md`
- Modify: `shared/schemas/daemon-ipc.md` (add a "See also" pointer near the top)
- Modify: `docs/api/aos.md` (add a "See also" line in the Daemon-aware readiness section from Task 8.3)

### Steps

- [ ] **Step 9.1: Create the governance doc**

Write `shared/schemas/CONTRACT-GOVERNANCE.md`:

```markdown
# Schema & IPC Contract Governance

This document captures the rule the input-tap readiness contract (issue #109)
established for daemon ↔ CLI capability surfaces. Future schema/IPC changes
should follow it.

## Rule

1. **Daemon-owned capabilities must be daemon-sourced.** Capabilities that
   live inside the daemon process (CGEventTap state, AX permissions evaluated
   by the daemon, channel state, etc.) must be reported by the daemon. The
   CLI must not fabricate these from its own preflight calls — it can only
   forward what the daemon says.

2. **CLI fallbacks must label their source.** When the daemon is unreachable
   and the CLI falls back to its own probe, the consumer-facing payload must
   make the source explicit (e.g. `ready_source: "cli"` vs `"daemon"`). No
   silent merging of daemon-evaluated and CLI-evaluated views.

3. **Lifecycle commands that claim readiness must fail on degraded
   daemon-owned capability state.** `aos service install/start/restart` and
   any future "make it ready" lifecycle verb cannot exit 0 when a
   daemon-owned readiness check is reporting degraded.

4. **Compatibility fields may be preserved, but new structured fields are
   the forward contract.** Flat legacy fields (e.g. top-level
   `input_tap_status`) can stay byte-for-byte for compatibility, but new
   consumers should bind to the structured nested block (e.g. `input_tap.*`).
   Don't expand the legacy flat surface.

5. **Tests must cover both happy path and degraded daemon-reported state.**
   A single happy-path assertion is insufficient. Use the mock-daemon
   fixture (`tests/lib/mock-daemon.py`) to drive degraded states without a
   real launchd lifecycle.

## Where this rule was established

- Spec: `docs/superpowers/specs/2026-04-24-input-tap-readiness-contract-design.md`
- Plan: `docs/superpowers/plans/2026-04-24-input-tap-readiness-contract.md`
- Tracking: GitHub issue #109

## Out of scope (intentionally)

- CODEOWNERS for `shared/schemas/`
- Snapshot-pinned compatibility tests
- Schema versioning automation

These can be revisited if the contract starts drifting again.
```

- [ ] **Step 9.2: Cross-reference from `shared/schemas/daemon-ipc.md`**

Edit `shared/schemas/daemon-ipc.md`. Add a "See also" line near the top of
the file (immediately under the document title or top-level heading):

```markdown
> **See also:** [`CONTRACT-GOVERNANCE.md`](./CONTRACT-GOVERNANCE.md) for the
> rules governing daemon ↔ CLI capability contracts.
```

If a "See also" / "Related" block already exists at the top, append the
governance link to it instead of creating a new block.

- [ ] **Step 9.3: Cross-reference from `docs/api/aos.md`**

Edit `docs/api/aos.md`. In the "Daemon-aware readiness" section added in
Task 8.3, append a final paragraph:

```markdown
The contract rules these consumers follow live in
[`shared/schemas/CONTRACT-GOVERNANCE.md`](../../shared/schemas/CONTRACT-GOVERNANCE.md).
```

Adjust the relative path to whatever resolves from `docs/api/aos.md`'s
actual location to `shared/schemas/CONTRACT-GOVERNANCE.md`. Verify by
opening the rendered file or by `ls` from the linked path.

- [ ] **Step 9.4: Verify the doc exists and links resolve**

Run:

```bash
ls shared/schemas/CONTRACT-GOVERNANCE.md
grep -n "CONTRACT-GOVERNANCE" shared/schemas/daemon-ipc.md docs/api/aos.md
```

Expected: file exists, two grep hits (one in each consumer doc).

- [ ] **Step 9.5: Commit**

```bash
git add shared/schemas/CONTRACT-GOVERNANCE.md shared/schemas/daemon-ipc.md docs/api/aos.md
git commit -m "docs(schemas): capture daemon ↔ CLI contract rule in CONTRACT-GOVERNANCE.md

Codifies the rule established by the input-tap readiness work (issue #109):
daemon-owned capabilities are daemon-sourced, CLI fallbacks label their
source, lifecycle commands fail on degraded daemon-owned state, legacy flat
fields stay for compatibility while new structured fields are the forward
contract, and tests cover both happy and degraded daemon-reported states.

Closes #109."
```

---

## Task 10: File SDK readiness follow-on GitHub issue

**Files:**
- None modified locally. Issue is filed via `gh`.

### Steps

- [ ] **Step 10.1: Verify the previous tasks landed**

```bash
git log --oneline -n 12
```

Expected: commits from Tasks 1–9 are present on the branch (or `main`). If
anything is missing, do not file the follow-on issue yet — close the gap
first. The follow-on issue references the daemon-side contract; filing it
before the daemon-side contract lands would mislead downstream consumers.

- [ ] **Step 10.2: File the SDK readiness uptake issue**

Run:

```bash
gh issue create \
  --title "SDK readiness uptake: consume runtime.input_tap and ready_source" \
  --label "sdk,readiness" \
  --body "$(cat <<'EOF'
## Context

Issue #109 landed the daemon-side input-tap readiness contract. The daemon's
`system.ping` now exposes a structured `input_tap` block and a `permissions`
block. `aos status`, `aos doctor`, and `aos permissions check` now expose
`runtime.input_tap`, `ready_for_testing`, `ready_source`, and `disagreement`
fields. `aos service install/start/restart` fail on degraded daemon-owned
state, and `aos do` preflight gates on `INPUT_TAP_NOT_ACTIVE`.

The SDK / packaged consumer surface has not yet picked up these signals.
This issue tracks that uptake.

## Surfaces to update

- `packages/gateway/` — gateway should expose the daemon-aware readiness
  signal to its consumers and gate command-execution APIs on
  `input_tap.status == "active"` for input-class verbs.
- `packages/host/` — host-level readiness reporting should include the
  daemon view and label the source.
- TypeScript SDK clients (any consumer that talks to `aos` over IPC or
  HTTP) — surface `runtime.input_tap`, `ready_source`, and daemon-vs-CLI
  source attribution to SDK callers, and add SDK-level capability
  preconditions that mirror the CLI preflight gates.

## Acceptance criteria

- Gateway and host readiness payloads include `input_tap.status`,
  `ready_for_testing`, and `ready_source` (or equivalent labeled fields).
- Input-class SDK calls (click/type/scroll) fail fast with a structured
  error when the daemon reports input_tap not active, mirroring the CLI's
  `INPUT_TAP_NOT_ACTIVE` semantics.
- Existing happy-path SDK tests are joined by at least one degraded-state
  test driven by `tests/lib/mock-daemon.py` (or a TS equivalent).
- Contract rules in `shared/schemas/CONTRACT-GOVERNANCE.md` are followed:
  daemon-sourced when reachable, labeled CLI fallback when not.

## Non-goals

- Re-implementing the daemon-side probe in the SDK.
- Adding new readiness taxonomy beyond what the daemon exposes.
- Schema versioning automation.

## References

- Spec: `docs/superpowers/specs/2026-04-24-input-tap-readiness-contract-design.md`
- Plan: `docs/superpowers/plans/2026-04-24-input-tap-readiness-contract.md`
- Governance: `shared/schemas/CONTRACT-GOVERNANCE.md`
EOF
)"
```

If `--label sdk,readiness` fails because either label does not yet exist,
either create the labels first (`gh label create sdk` and
`gh label create readiness`) or rerun without the `--label` flag and apply
labels through the GitHub UI. Do not skip filing the issue.

- [ ] **Step 10.3: Capture the new issue number**

`gh issue create` prints a URL when it succeeds. Note the issue number for
any post-merge cross-link. No commit is required — this task only files a
follow-on issue and produces no local artifacts.

---

## Self-review checklist (executor: skim before opening PR)

After all tasks land, the executor should verify the following before closing #109:

- **Spec coverage:**
  - AC1 (`service restart` no longer silently succeeds when tap retries): Task 4. Verified by manual smoke test in 4.5–4.6 and by classifier test in Task 8.
  - AC2 (`permissions check` / `doctor` surface listen/post access): Tasks 5 (permissions check) and 6 (doctor).
  - AC3 (`status` classifies inactive tap as a blocker): Task 6 (`tap=<value>` in one-liner + recovery notes).
  - AC4 (recovery guidance is explicit): shared helper in Task 2 used by Tasks 4–7.
  - AC5 (regression test for `input_tap_status=retrying` daemon): Tasks 5 + 6 + 7 + 8 (mock-daemon + classifier).

- **Governance:** `shared/schemas/CONTRACT-GOVERNANCE.md` exists, captures the five-rule contract, and is referenced from `shared/schemas/daemon-ipc.md` and `docs/api/aos.md` (Task 9).

- **Follow-on tracker filed:** SDK readiness uptake issue created via `gh issue create` (Task 10) and the issue number captured for cross-linking.

- **Files touched matches the spec's "Files touched" list, plus the governance doc and its cross-references.**

- **Commit messages contain no `Co-Authored-By: Claude ...` or `Generated with Claude Code` lines.** (`AGENTS.md` forbids these.)

- **`./aos help` does not mention `_verify-readiness`** (it is intentionally hidden).

- **Existing tests still pass:**

```bash
bash tests/daemon-ipc-system.sh
bash tests/daemon-ipc-envelope.sh
bash tests/daemon-ipc-show.sh
```

If any unrelated daemon-ipc test now fails, investigate whether the ping payload change broke it.

- **Manual UX smoke** on a workstation with a healthy tap:

```bash
./aos status                         # expect tap=active in one-liner
./aos doctor --json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["ready_for_testing"], d["ready_source"])'
                                     # expect: True daemon
./aos service restart                # expect exit 0, tap=active
echo $?                              # expect 0
./aos permissions check --json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["ready_for_testing"], d["ready_source"], d.get("disagreement"))'
                                     # expect: True daemon None (or absent disagreement)
```
