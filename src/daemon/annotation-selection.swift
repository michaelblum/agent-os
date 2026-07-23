import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

let aosAnnotationMaximumPoints = 256
let aosAnnotationMaximumTextBytes = 4 * 1024

struct AOSAnnotationSelectionFailure: Error {
    let code: String
    let message: String
}

enum AOSAnnotationSelectionMode: String, CaseIterable {
    case point
    case rectangle
    case freehand
    case text
    case target

    static func parse(_ value: String) -> AOSAnnotationSelectionMode? {
        AOSAnnotationSelectionMode(rawValue: value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    }
}

func aosBoundAnnotationPoints(_ points: [CGPoint], limit: Int = aosAnnotationMaximumPoints) -> [CGPoint] {
    guard limit > 1, points.count > limit else { return points }
    let last = points.count - 1
    return (0..<limit).map { index in
        points[Int((Double(index) * Double(last) / Double(limit - 1)).rounded())]
    }
}

private func finitePoint(_ point: CGPoint) -> Bool {
    point.x.isFinite && point.y.isFinite
}

func aosAnnotationGeometry(mode: AOSAnnotationSelectionMode, screenPoints: [CGPoint]) -> [String: Any]? {
    let points = aosBoundAnnotationPoints(screenPoints.filter(finitePoint))
    guard !points.isEmpty else { return nil }
    let converted = points.map(screenPointToCG)
    switch mode {
    case .point, .text:
        return [
            "kind": "point",
            "coordinate_space": "desktop_points_top_left",
            "x": converted[0].x,
            "y": converted[0].y,
        ]
    case .rectangle:
        guard let last = converted.last else { return nil }
        return [
            "kind": "rectangle",
            "coordinate_space": "desktop_points_top_left",
            "x": min(converted[0].x, last.x),
            "y": min(converted[0].y, last.y),
            "width": abs(last.x - converted[0].x),
            "height": abs(last.y - converted[0].y),
        ]
    case .freehand:
        let minX = converted.map(\.x).min() ?? converted[0].x
        let minY = converted.map(\.y).min() ?? converted[0].y
        let maxX = converted.map(\.x).max() ?? converted[0].x
        let maxY = converted.map(\.y).max() ?? converted[0].y
        return [
            "kind": "freehand",
            "coordinate_space": "desktop_points_top_left",
            "points": converted.map { ["x": $0.x, "y": $0.y] },
            "bounds": [
                "x": minX,
                "y": minY,
                "width": maxX - minX,
                "height": maxY - minY,
            ],
        ]
    case .target:
        return nil
    }
}

private func number(_ value: Any?) -> CGFloat? {
    if let number = value as? NSNumber { return CGFloat(number.doubleValue) }
    return nil
}

func aosAnnotationWindowFacts(
    at point: CGPoint,
    windowList: [[String: Any]]? = nil,
    excludingPID: pid_t = getpid()
) -> [String: Any]? {
    let entries = windowList ?? (CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? [])
    for entry in entries {
        let ownerPID = (entry[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value ?? -1
        guard ownerPID != excludingPID,
              (entry[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
              let bounds = entry[kCGWindowBounds as String] as? [String: Any],
              let x = number(bounds["X"]),
              let y = number(bounds["Y"]),
              let width = number(bounds["Width"]),
              let height = number(bounds["Height"]),
              CGRect(x: x, y: y, width: width, height: height).contains(point) else { continue }
        let running = NSRunningApplication(processIdentifier: ownerPID)
        let applicationName: Any = (entry[kCGWindowOwnerName as String] as? String) ?? running?.localizedName ?? NSNull()
        let bundleID: Any = running?.bundleIdentifier ?? NSNull()
        return [
            "window_id": (entry[kCGWindowNumber as String] as? NSNumber)?.intValue ?? -1,
            "title": entry[kCGWindowName as String] as? String ?? NSNull(),
            "bounds": ["x": x, "y": y, "width": width, "height": height],
            "application": [
                "pid": Int(ownerPID),
                "name": applicationName,
                "bundle_id": bundleID,
            ],
        ]
    }
    return nil
}

func aosAnnotationPublicWindowFacts(_ window: [String: Any]?) -> [String: Any]? {
    guard let window,
          let windowID = window["window_id"],
          let title = window["title"],
          let bounds = window["bounds"] else { return nil }
    return [
        "window_id": windowID,
        "title": title,
        "bounds": bounds,
    ]
}

private final class AOSAnnotationTextField: NSTextField {
    var onCommit: ((String) -> Void)?
    var onCancel: (() -> Void)?

    override func insertNewline(_ sender: Any?) { onCommit?(stringValue) }
    override func cancelOperation(_ sender: Any?) { onCancel?() }
}

private final class AOSAnnotationSelectionView: NSView {
    let mode: AOSAnnotationSelectionMode
    let onComplete: ([CGPoint], String?) -> Void
    let onCancel: (String) -> Void
    private var points: [CGPoint] = []
    private var textField: AOSAnnotationTextField?

    init(
        frame: NSRect,
        mode: AOSAnnotationSelectionMode,
        onComplete: @escaping ([CGPoint], String?) -> Void,
        onCancel: @escaping (String) -> Void
    ) {
        self.mode = mode
        self.onComplete = onComplete
        self.onCancel = onCancel
        super.init(frame: frame)
        wantsLayer = true
    }

    required init?(coder: NSCoder) { nil }
    override var acceptsFirstResponder: Bool { true }

    private func screenPoint(_ event: NSEvent) -> CGPoint {
        window?.convertPoint(toScreen: event.locationInWindow) ?? event.locationInWindow
    }

    override func mouseDown(with event: NSEvent) {
        let point = screenPoint(event)
        if mode == .text {
            beginText(at: event.locationInWindow, screenPoint: point)
            return
        }
        points = [point]
        needsDisplay = true
    }

    override func mouseDragged(with event: NSEvent) {
        guard mode != .point, mode != .text, !points.isEmpty else { return }
        let point = screenPoint(event)
        if mode == .rectangle {
            points = [points[0], point]
        } else if let last = points.last, hypot(last.x - point.x, last.y - point.y) >= 2 {
            points.append(point)
            if points.count > aosAnnotationMaximumPoints * 2 {
                points = aosBoundAnnotationPoints(points)
            }
        }
        needsDisplay = true
    }

    override func mouseUp(with event: NSEvent) {
        guard mode != .text, let first = points.first else { return }
        let point = screenPoint(event)
        if mode == .point {
            onComplete([point], nil)
        } else if mode == .rectangle {
            onComplete([first, point], nil)
        } else {
            if points.last != point { points.append(point) }
            onComplete(aosBoundAnnotationPoints(points), nil)
        }
    }

    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 {
            onCancel("escape")
            return
        }
        super.keyDown(with: event)
    }

    private func beginText(at localPoint: CGPoint, screenPoint: CGPoint) {
        textField?.removeFromSuperview()
        points = [screenPoint]
        let width: CGFloat = min(320, max(160, bounds.width - 24))
        let origin = CGPoint(
            x: min(max(12, localPoint.x), max(12, bounds.width - width - 12)),
            y: min(max(12, localPoint.y - 34), max(12, bounds.height - 44))
        )
        let field = AOSAnnotationTextField(frame: NSRect(x: origin.x, y: origin.y, width: width, height: 30))
        field.placeholderString = "Annotation"
        field.font = .systemFont(ofSize: 14)
        field.focusRingType = .none
        field.onCommit = { [weak self] value in
            guard let self else { return }
            let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty, text.utf8.count <= aosAnnotationMaximumTextBytes else {
                NSSound.beep()
                return
            }
            self.onComplete(self.points, text)
        }
        field.onCancel = { [weak self] in self?.onCancel("escape") }
        addSubview(field)
        textField = field
        window?.makeFirstResponder(field)
        needsDisplay = true
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.black.withAlphaComponent(0.14).setFill()
        dirtyRect.fill()
        guard !points.isEmpty, let window else { return }
        let local = points.map { window.convertPoint(fromScreen: $0) }
        NSColor.white.withAlphaComponent(0.95).setStroke()
        let path = NSBezierPath()
        path.lineWidth = 2
        path.setLineDash([6, 4], count: 2, phase: 0)
        if mode == .rectangle, local.count > 1 {
            path.appendRect(NSRect(
                x: min(local[0].x, local[1].x),
                y: min(local[0].y, local[1].y),
                width: abs(local[1].x - local[0].x),
                height: abs(local[1].y - local[0].y)
            ))
        } else if mode == .freehand {
            path.move(to: local[0])
            for point in local.dropFirst() { path.line(to: point) }
        } else {
            path.appendOval(in: NSRect(x: local[0].x - 8, y: local[0].y - 8, width: 16, height: 16))
        }
        path.stroke()
    }
}

final class AOSAnnotationSelectionPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

protocol AOSAnnotationSelectionSession: AnyObject {
    var token: UUID { get }
    var owner: UUID { get }

    func start() throws
    func cancel(reason: String)
}

private final class AOSAnnotationGeometrySelectionSession: AOSAnnotationSelectionSession {
    let token = UUID()
    let owner: UUID
    let ref: String?
    let mode: AOSAnnotationSelectionMode

    private let emit: (String, [String: Any]) -> Void
    private let terminal: (UUID) -> Void
    private var panels: [AOSAnnotationSelectionPanel] = []
    private var finished = false
    private var originalApplication: NSRunningApplication?

    init(
        owner: UUID,
        ref: String?,
        mode: AOSAnnotationSelectionMode,
        emit: @escaping (String, [String: Any]) -> Void,
        terminal: @escaping (UUID) -> Void
    ) {
        self.owner = owner
        self.ref = ref
        self.mode = mode
        self.emit = emit
        self.terminal = terminal
    }

    func start() throws {
        var startupError: AOSAnnotationSelectionFailure?
        aosRunOnMainSync {
            guard mode != .target else {
                startupError = AOSAnnotationSelectionFailure(
                    code: "INVALID_ANNOTATION_MODE",
                    message: "semantic target selection requires its dedicated session"
                )
                return
            }
            guard !finished else {
                startupError = AOSAnnotationSelectionFailure(
                    code: "ANNOTATION_SELECTION_CANCELED",
                    message: "annotation selection was canceled before startup"
                )
                return
            }
            guard !NSScreen.screens.isEmpty else {
                startupError = AOSAnnotationSelectionFailure(code: "ANNOTATION_DISPLAY_UNAVAILABLE", message: "no display is available for annotation selection")
                return
            }
            originalApplication = NSWorkspace.shared.frontmostApplication
            for screen in NSScreen.screens {
                let panel = AOSAnnotationSelectionPanel(
                    contentRect: screen.frame,
                    styleMask: [.borderless],
                    backing: .buffered,
                    defer: false
                )
                panel.setFrame(screen.frame, display: true)
                panel.level = .screenSaver
                panel.isOpaque = false
                panel.backgroundColor = .clear
                panel.hasShadow = false
                panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
                panel.contentView = AOSAnnotationSelectionView(
                    frame: NSRect(origin: .zero, size: screen.frame.size),
                    mode: mode,
                    onComplete: { [weak self] points, text in self?.complete(points: points, text: text) },
                    onCancel: { [weak self] reason in self?.cancel(reason: reason) }
                )
                panels.append(panel)
                panel.orderFrontRegardless()
            }
            NSApp.activate(ignoringOtherApps: true)
            panels.first?.makeKey()
            panels.first?.makeFirstResponder(panels.first?.contentView)
            emit("selection_started", ["mode": mode.rawValue])
        }
        if let startupError { throw startupError }
    }

    func cancel(reason: String) {
        aosRunOnMainSync {
            guard !finished else { return }
            finished = true
            closePanels()
            emit("selection_canceled", ["reason": reason])
            terminal(token)
        }
    }

    private func complete(points: [CGPoint], text: String?) {
        guard !finished,
              let geometry = aosAnnotationGeometry(mode: mode, screenPoints: points) else {
            cancel(reason: "invalid_selection")
            return
        }
        finished = true
        let cgPoints = points.map(screenPointToCG)
        let targetPoint = cgPoints[cgPoints.count / 2]
        let window = aosAnnotationWindowFacts(at: targetPoint)
        let application: [String: Any]
        if let windowApplication = window?["application"] as? [String: Any] {
            application = windowApplication
        } else {
            let applicationName: Any = originalApplication?.localizedName ?? NSNull()
            let bundleID: Any = originalApplication?.bundleIdentifier ?? NSNull()
            application = [
                "pid": originalApplication.map { Int($0.processIdentifier) } ?? -1,
                "name": applicationName,
                "bundle_id": bundleID,
            ]
        }
        closePanels()
        emit("selection_completed", [
            "selection_id": "sel-\(UUID().uuidString.lowercased())",
            "mode": mode.rawValue,
            "geometry": geometry,
            "application": application,
            "window": aosAnnotationPublicWindowFacts(window) ?? NSNull(),
            "text": text ?? NSNull(),
        ])
        terminal(token)
    }

    private func closePanels() {
        for panel in panels { panel.orderOut(nil) }
        panels.removeAll()
        originalApplication?.activate()
    }
}

private func aosMakeAnnotationSelectionSession(
    owner: UUID,
    ref: String?,
    mode: AOSAnnotationSelectionMode,
    emit: @escaping (String, [String: Any]) -> Void,
    terminal: @escaping (UUID) -> Void
) -> any AOSAnnotationSelectionSession {
    switch mode {
    case .target:
        return AOSAnnotationTargetSelectionSession(
            owner: owner,
            ref: ref,
            emit: emit,
            terminal: terminal
        )
    case .point, .rectangle, .freehand, .text:
        return AOSAnnotationGeometrySelectionSession(
            owner: owner,
            ref: ref,
            mode: mode,
            emit: emit,
            terminal: terminal
        )
    }
}

final class AOSAnnotationSelectionTransport {
    typealias EventEmitter = (UUID, String, [String: Any], String?) -> Void

    private let lock = NSLock()
    private let emit: EventEmitter
    private var session: (any AOSAnnotationSelectionSession)?

    init(emit: @escaping EventEmitter) { self.emit = emit }

    func start(owner: UUID, mode value: String, ref: String?) throws {
        guard let mode = AOSAnnotationSelectionMode.parse(value) else {
            throw AOSAnnotationSelectionFailure(code: "INVALID_ANNOTATION_MODE", message: "annotation mode must be point, rectangle, freehand, text, or target")
        }
        lock.lock()
        guard session == nil else {
            lock.unlock()
            throw AOSAnnotationSelectionFailure(code: "ANNOTATION_SELECTION_BUSY", message: "an annotation selection is already active")
        }
        let next = aosMakeAnnotationSelectionSession(
            owner: owner,
            ref: ref,
            mode: mode,
            emit: { [emit] event, data in emit(owner, event, data, ref) },
            terminal: { [weak self] token in self?.didTerminate(token: token) }
        )
        session = next
        lock.unlock()
        do {
            try next.start()
        } catch {
            didTerminate(token: next.token)
            throw error
        }
    }

    func cancel(owner: UUID, reason: String) throws {
        lock.lock()
        guard let session, session.owner == owner else {
            lock.unlock()
            throw AOSAnnotationSelectionFailure(code: "ANNOTATION_SELECTION_NOT_OWNED", message: "this connection does not own annotation selection")
        }
        lock.unlock()
        session.cancel(reason: reason)
    }

    func connectionClosed(_ owner: UUID) {
        lock.lock()
        let owned = session?.owner == owner ? session : nil
        lock.unlock()
        owned?.cancel(reason: "owner_disconnect")
    }

    func shutdown() {
        lock.lock()
        let active = session
        lock.unlock()
        active?.cancel(reason: "daemon_shutdown")
    }

    private func didTerminate(token: UUID) {
        lock.lock()
        if session?.token == token { session = nil }
        lock.unlock()
    }
}
