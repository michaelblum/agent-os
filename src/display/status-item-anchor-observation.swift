// status-item-anchor-observation.swift — Rebindable AppKit anchor observation.

import AppKit
import Foundation

struct AOSStatusItemAnchorObservationHost {
    let button: NSView
    let window: NSObject
}

final class AOSStatusItemAnchorObservation {
    private let center: NotificationCenter
    private let reacquisitionInterval: TimeInterval
    private let resolveHost: () -> AOSStatusItemAnchorObservationHost?
    private let readSignature: () -> String?
    private let onBoundsChanged: () -> Void
    private let onTopologyChanged: () -> Void
    private var hostTokens: [NSObjectProtocol] = []
    private var topologyToken: NSObjectProtocol?
    private var reacquisitionTimer: Timer?
    private weak var observedButton: NSView?
    private weak var observedWindow: NSObject?
    private var previousPostsFrameChangedNotifications: Bool?
    private var lastSignature: String?
    private var active = false

    init(
        center: NotificationCenter = .default,
        reacquisitionInterval: TimeInterval = 0.25,
        resolveHost: @escaping () -> AOSStatusItemAnchorObservationHost?,
        readSignature: @escaping () -> String?,
        onBoundsChanged: @escaping () -> Void,
        onTopologyChanged: @escaping () -> Void
    ) {
        self.center = center
        self.reacquisitionInterval = reacquisitionInterval
        self.resolveHost = resolveHost
        self.readSignature = readSignature
        self.onBoundsChanged = onBoundsChanged
        self.onTopologyChanged = onTopologyChanged
    }

    func start() {
        stop()
        active = true
        _ = rebindIfNeeded()
        lastSignature = readSignature()
        topologyToken = center.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.handleTopologyChange()
        }
        let timer = Timer(timeInterval: reacquisitionInterval, repeats: true) { [weak self] _ in
            self?.handlePotentialBoundsChange()
        }
        RunLoop.main.add(timer, forMode: .common)
        reacquisitionTimer = timer
    }

    func stop() {
        active = false
        if let topologyToken { center.removeObserver(topologyToken) }
        topologyToken = nil
        reacquisitionTimer?.invalidate()
        reacquisitionTimer = nil
        unbindHost()
        lastSignature = nil
    }

    @discardableResult
    private func rebindIfNeeded() -> Bool {
        guard active else { return false }
        guard let host = resolveHost() else {
            unbindHost()
            return false
        }
        if observedButton === host.button, observedWindow === host.window { return false }
        unbindHost()
        observedButton = host.button
        observedWindow = host.window
        previousPostsFrameChangedNotifications = host.button.postsFrameChangedNotifications
        host.button.postsFrameChangedNotifications = true
        hostTokens.append(center.addObserver(
            forName: NSView.frameDidChangeNotification,
            object: host.button,
            queue: .main
        ) { [weak self] _ in
            self?.handlePotentialBoundsChange()
        })
        for name in [NSWindow.didMoveNotification, NSWindow.didResizeNotification] {
            hostTokens.append(center.addObserver(forName: name, object: host.window, queue: .main) { [weak self] _ in
                self?.handlePotentialBoundsChange()
            })
        }
        return true
    }

    private func unbindHost() {
        hostTokens.forEach(center.removeObserver)
        hostTokens.removeAll()
        if let previousPostsFrameChangedNotifications {
            observedButton?.postsFrameChangedNotifications = previousPostsFrameChangedNotifications
        }
        observedButton = nil
        observedWindow = nil
        previousPostsFrameChangedNotifications = nil
    }

    private func handlePotentialBoundsChange() {
        guard active else { return }
        _ = rebindIfNeeded()
        guard let signature = readSignature(), signature != lastSignature else { return }
        lastSignature = signature
        onBoundsChanged()
    }

    private func handleTopologyChange() {
        guard active else { return }
        _ = rebindIfNeeded()
        lastSignature = readSignature()
        onTopologyChanged()
    }
}
