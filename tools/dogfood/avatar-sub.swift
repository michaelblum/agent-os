// avatar-sub.swift -- Effect subscriber for the agent presence system.
//
// Connects to heads-up via `listen`, subscribes to channel events, and
// dispatches to behaviors in avatar-behaviors.swift.  Also handles
// click-following via CGEventTap (ported from avatar-follower.swift).
//
// This is NOT a daemon — it's a persistent client of the heads-up daemon.
//
// Build:  bash build-avatar.sh
// Run:    ./avatar-sub   (after heads-up daemon is running)

import Foundation
import CoreGraphics

// ============================================================================
// MARK: - State
// ============================================================================

enum AvatarState {
    case idle, roaming, following, tracing
    case possessingCursor, possessingKeyboard
    case docking, docked, undocking, transitioning
}

var avatarState: AvatarState = .roaming
var isAnimating: Bool = false
var occlusionGraceUntil: Date = .distantPast
var eventTap: CFMachPort? = nil

// ============================================================================
// MARK: - Channel Event Handling
// ============================================================================

/// Dispatch a channel event from the heads-up pub/sub.
/// The "actions" channel carries before/after events from agent_helpers.sh.
func handleChannelEvent(channel: String, data: [String: Any]) {
    guard channel == "actions" else { return }
    guard let eventType = data["type"] as? String else { return }

    moveID &+= 1
    let mid = moveID

    switch eventType {
    case "before":
        guard let action = data["action"] as? String else { return }
        switch action {
        case "type":
            if let target = data["target"] as? [String: Any],
               let bounds = target["bounds"] as? [Double], bounds.count >= 4 {
                DispatchQueue.global(qos: .userInteractive).async {
                    avatarState = .possessingKeyboard
                    behaviorPossessKeyboard(
                        target: (bounds[0], bounds[1], bounds[2], bounds[3]),
                        mid: mid
                    )
                }
            }
        case "click":
            DispatchQueue.global(qos: .userInteractive).async {
                avatarState = .possessingCursor
                behaviorPossessCursor(mid)
            }
        case "trace":
            if let target = data["target"] as? [String: Any],
               let bounds = target["bounds"] as? [Double], bounds.count >= 4 {
                DispatchQueue.global(qos: .userInteractive).async {
                    avatarState = .tracing
                    behaviorTrace(
                        bounds: (bounds[0], bounds[1], bounds[2], bounds[3]),
                        mid: mid
                    )
                    avatarState = .roaming
                }
            }
        case "fast_travel":
            if let to = data["to"] as? [Double], to.count >= 2 {
                DispatchQueue.global(qos: .userInteractive).async {
                    avatarState = .transitioning
                    behaviorFastTravel(toX: to[0], toY: to[1], mid: mid)
                    avatarState = .roaming
                }
            }
        default:
            break
        }

    case "after":
        guard let action = data["action"] as? String else { return }
        DispatchQueue.global(qos: .userInteractive).async {
            behaviorRelease(from: action == "type" ? "keyboard" : "mouse")
            avatarState = .roaming
        }

    case "dock":
        DispatchQueue.global(qos: .userInteractive).async {
            behaviorDock(mid)
        }

    case "undock":
        let (cx, cy) = getCursorCG()
        let toX = (data["to"] as? [Double])?[safe: 0] ?? cx
        let toY = (data["to"] as? [Double])?[safe: 1] ?? cy
        DispatchQueue.global(qos: .userInteractive).async {
            behaviorUndock(toX, toY, mid)
        }

    default:
        break
    }
}

// ============================================================================
// MARK: - CGEventTap (Click Following)
// ============================================================================

/// Event tap callback — handles click-follow, dock/undock via direct clicks.
func tapCB(_ proxy: CGEventTapProxy, _ type: CGEventType, _ event: CGEvent,
           _ refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = eventTap { CGEvent.tapEnable(tap: tap, enable: true) }
        return Unmanaged.passUnretained(event)
    }

    if type == .leftMouseDown {
        let p = event.location
        moveID &+= 1
        let mid = moveID

        switch avatarState {
        case .roaming, .idle:
            if isClickOnChat(p.x, p.y) {
                DispatchQueue.global(qos: .userInteractive).async { behaviorDock(mid) }
            } else {
                DispatchQueue.global(qos: .userInteractive).async { behaviorFollowClick(p.x, p.y, mid) }
            }
        case .docked:
            if !isClickOnChat(p.x, p.y) {
                DispatchQueue.global(qos: .userInteractive).async { behaviorUndock(p.x, p.y, mid) }
            }
            // Click INSIDE chat while docked -> do nothing
        case .docking, .undocking, .transitioning:
            break  // ignore clicks during transitions
        case .possessingCursor, .possessingKeyboard, .following, .tracing:
            break  // ignore clicks during agent-driven behaviors
        }
    }
    return Unmanaged.passUnretained(event)
}

func startEventTap() {
    let mask = CGEventMask(1 << CGEventType.leftMouseDown.rawValue)
               | CGEventMask(1 << CGEventType.tapDisabledByTimeout.rawValue)
               | CGEventMask(1 << CGEventType.tapDisabledByUserInput.rawValue)

    guard let tap = CGEvent.tapCreate(
        tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
        eventsOfInterest: mask,
        callback: tapCB, userInfo: nil
    ) else {
        FileHandle.standardError.write("Event tap failed. Click-follow disabled (grant Accessibility permission).\n".data(using: .utf8)!)
        return  // subscriber + channel events still work without click-follow
    }
    eventTap = tap
    let src = CFMachPortCreateRunLoopSource(nil, tap, 0)!
    CFRunLoopAddSource(CFRunLoopGetCurrent(), src, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
}

// ============================================================================
// MARK: - Subscriber Connection
// ============================================================================

/// Connect to heads-up daemon, send subscribe, and read channel events forever.
/// Runs on a background thread — the main thread runs CFRunLoop for the event tap.
func startSubscriber() {
    DispatchQueue.global(qos: .userInitiated).async {
        let fd = connectSock()
        guard fd >= 0 else {
            FileHandle.standardError.write("avatar-sub: Cannot connect to heads-up. Running click-follow only.\n".data(using: .utf8)!)
            return
        }

        // Subscribe to receive channel events
        let req = "{\"action\":\"subscribe\"}\n"
        req.withCString { ptr in _ = write(fd, ptr, strlen(ptr)) }

        // Read and discard the subscribe response
        var responseBuf = [UInt8](repeating: 0, count: 4096)
        _ = read(fd, &responseBuf, responseBuf.count)

        FileHandle.standardError.write("avatar-sub: subscribed to heads-up events.\n".data(using: .utf8)!)

        // Event loop: read newline-delimited JSON
        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 4096)

        while true {
            let n = read(fd, &chunk, chunk.count)
            guard n > 0 else {
                FileHandle.standardError.write("avatar-sub: heads-up connection closed.\n".data(using: .utf8)!)
                break
            }
            buffer.append(contentsOf: chunk[0..<n])

            while let newlineIndex = buffer.firstIndex(of: UInt8(ascii: "\n")) {
                let lineData = Data(buffer[buffer.startIndex..<newlineIndex])
                buffer = Data(buffer[buffer.index(after: newlineIndex)...])

                guard !lineData.isEmpty,
                      let json = try? JSONSerialization.jsonObject(with: lineData) as? [String: Any],
                      let type = json["type"] as? String else { continue }

                if type == "channel",
                   let channel = json["channel"] as? String,
                   let data = json["data"] as? [String: Any] {
                    handleChannelEvent(channel: channel, data: data)
                }
                // Other event types (canvas events) are ignored for now
            }
        }

        close(fd)
    }
}

// ============================================================================
// MARK: - Safe Array Subscript
// ============================================================================

extension Array {
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

// ============================================================================
// MARK: - Entry Point
// ============================================================================

@main
struct AvatarSub {
    static func main() {
        // Auto-create avatar canvas if it doesn't exist
        let path = NSString(string: "~/Documents/GitHub/agent-os/tools/dogfood/avatar.html").expandingTildeInPath
        sendOneShot("{\"action\":\"create\",\"id\":\"\(avatarID)\",\"at\":[200,200,\(fullSize),\(fullSize)],\"url\":\"file://\(path)\"}")
        Thread.sleep(forTimeInterval: 0.5)

        // Sync position with actual canvas
        queryAvatar()
        queryChat()
        ensureChatOnTop()

        // Start subsystems
        startBackgroundMonitor()    // occlusion detection (from avatar-behaviors.swift)
        startSubscriber()           // heads-up channel events
        startEventTap()             // click following (non-fatal if it fails)

        FileHandle.standardError.write("""
            avatar-sub running.
              Click anywhere         \u{2192} avatar follows (1.2s ease)
              Click chat widget      \u{2192} avatar docks (surge \u{2192} fly \u{2192} spin-park)
              Click inside (docked)  \u{2192} stays parked
              Click outside (docked) \u{2192} undock + fly to click
              Chat covers avatar     \u{2192} escapes and parks
              Channel events         \u{2192} possess cursor/keyboard, trace, fast-travel
              Ctrl+C to stop.
            \n
            """.data(using: .utf8)!)

        // Keep main thread alive — event tap uses CFRunLoop sources,
        // but if tap failed we still need to stay alive for the subscriber.
        // A far-future timer keeps the run loop from exiting.
        let keepAlive = CFRunLoopTimerCreateWithHandler(nil, CFAbsoluteTimeGetCurrent() + 86400, 86400, 0, 0) { _ in }
        CFRunLoopAddTimer(CFRunLoopGetCurrent(), keepAlive, .commonModes)
        CFRunLoopRun()
    }
}
