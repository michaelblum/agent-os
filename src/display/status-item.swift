// status-item.swift — Menu bar icon that toggles Sigil (avatar-sub) on/off.
//
// Ingress: create avatar canvas at icon position → animate to target → spawn avatar-sub
// Egress: kill avatar-sub → animate canvas back to icon → remove canvas
//
// Sigil's ensureAvatarCanvas() detects the existing canvas and attaches to it,
// so the handoff is seamless.

import AppKit
import Foundation

class StatusItemManager: NSObject {
    let canvasManager: CanvasManager
    var statusItem: NSStatusItem?

    let toggleId: String
    let toggleUrl: String
    let toggleAt: [Double]
    var urlResolver: ((String) -> String)?
    private var sigilProcess: Process?
    private var isDismissing = false

    init(canvasManager: CanvasManager, config: AosConfig.StatusItemConfig) {
        self.canvasManager = canvasManager
        self.toggleId = config.toggle_id ?? "avatar"
        self.toggleUrl = config.toggle_url ?? ""
        self.toggleAt = config.toggle_at ?? [200, 200, 300, 300]
        super.init()
    }

    func setup() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        updateIcon()
        statusItem?.button?.target = self
        statusItem?.button?.action = #selector(handleClick(_:))
    }

    @objc func handleClick(_ sender: Any?) {
        guard !isDismissing else { return }

        if isSigilRunning() || canvasManager.hasCanvas(toggleId) {
            dismissAvatar()
        } else {
            summonAvatar()
        }
    }

    // MARK: - Ingress: animate canvas in, then start Sigil

    private func summonAvatar() {
        guard !toggleUrl.isEmpty, toggleAt.count == 4 else {
            startSigilProcess()
            return
        }

        let iconCG = statusItemCGPosition()
        let startSize: CGFloat = 40
        let fromX = iconCG.x - startSize / 2
        let fromY = iconCG.y
        let targetX = CGFloat(toggleAt[0])
        let targetY = CGFloat(toggleAt[1])
        let targetW = CGFloat(toggleAt[2])
        let targetH = CGFloat(toggleAt[3])

        // Create canvas at icon position — invisible until WKWebView loads
        var req = CanvasRequest(action: "create")
        req.id = toggleId
        req.url = urlResolver?(toggleUrl) ?? toggleUrl
        req.at = [fromX, fromY, startSize, startSize]
        _ = canvasManager.handle(req)
        canvasManager.setCanvasAlpha(toggleId, 0)
        updateIcon()

        DispatchQueue.global(qos: .userInteractive).async { [weak self] in
            // Wait for WKWebView + Three.js to initialize
            Thread.sleep(forTimeInterval: 0.35)

            // Reveal
            DispatchQueue.main.async {
                self?.canvasManager.setCanvasAlpha(self?.toggleId ?? "", 1)
            }

            // Animate from icon to target
            self?.animateCanvas(
                fromX: fromX, fromY: fromY, fromW: startSize, fromH: startSize,
                toX: targetX, toY: targetY, toW: targetW, toH: targetH,
                duration: 0.5, easing: { t in 1 - pow(1 - t, 3) }  // easeOutCubic
            )

            // Now start Sigil — it will detect the existing canvas
            DispatchQueue.main.async { [weak self] in
                self?.startSigilProcess()
            }
        }
    }

    // MARK: - Egress: stop Sigil, animate canvas out, remove

    private func dismissAvatar() {
        isDismissing = true
        updateIcon()

        // Kill Sigil first
        stopSigilProcess()

        // Tell the skin to play the dismissed transition
        var evalReq = CanvasRequest(action: "eval")
        evalReq.id = toggleId
        let msg = "{\"type\":\"behavior\",\"slot\":\"dismissed\"}"
        let b64 = Data(msg.utf8).base64EncodedString()
        evalReq.js = "headsup.receive('\(b64)')"
        _ = canvasManager.handle(evalReq)

        let iconCG = statusItemCGPosition()
        let endSize: CGFloat = 20
        let toX = iconCG.x - endSize / 2
        let toY = iconCG.y

        // Read current canvas position
        let listResp = canvasManager.handle(CanvasRequest(action: "list"))
        var fromX: CGFloat = 200, fromY: CGFloat = 200, fromW: CGFloat = 300, fromH: CGFloat = 300
        if let canvases = listResp.canvases {
            for c in canvases where c.id == toggleId {
                fromX = c.at[0]; fromY = c.at[1]; fromW = c.at[2]; fromH = c.at[3]
            }
        }

        DispatchQueue.global(qos: .userInteractive).async { [weak self] in
            // easeInBack: accelerate into the icon
            self?.animateCanvas(
                fromX: fromX, fromY: fromY, fromW: fromW, fromH: fromH,
                toX: toX, toY: toY, toW: endSize, toH: endSize,
                duration: 0.4, easing: { t in
                    let c1 = 1.70158, c3 = c1 + 1
                    return c3 * t * t * t - c1 * t * t
                }
            )

            // Remove canvas and clean up
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                for id in [self.toggleId, "avatar-hit-target", "cursor-decor"] {
                    var rm = CanvasRequest(action: "remove")
                    rm.id = id
                    _ = self.canvasManager.handle(rm)
                }
                self.isDismissing = false
                self.updateIcon()
            }
        }
    }

    // MARK: - Animation

    private func animateCanvas(
        fromX: CGFloat, fromY: CGFloat, fromW: CGFloat, fromH: CGFloat,
        toX: CGFloat, toY: CGFloat, toW: CGFloat, toH: CGFloat,
        duration: Double, easing: @escaping (Double) -> Double
    ) {
        let fps = 60.0
        let totalFrames = Int(duration * fps)
        let t0 = Date()

        for i in 0...totalFrames {
            let t = Double(i) / Double(totalFrames)
            let e = CGFloat(easing(t))

            let x = fromX + (toX - fromX) * e
            let y = fromY + (toY - fromY) * e
            let w = fromW + (toW - fromW) * e
            let h = fromH + (toH - fromH) * e

            DispatchQueue.main.async { [weak self] in
                var updateReq = CanvasRequest(action: "update")
                updateReq.id = self?.toggleId
                updateReq.at = [x, y, w, h]
                _ = self?.canvasManager.handle(updateReq)
            }

            let want = Double(i + 1) / fps
            let got = Date().timeIntervalSince(t0)
            if want > got { Thread.sleep(forTimeInterval: want - got) }
        }
    }

    // MARK: - Process Management

    private func startSigilProcess() {
        guard let binaryPath = resolveSigilBinary() else {
            fputs("status-item: avatar-sub binary not found\n", stderr)
            return
        }

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: binaryPath)
        proc.standardOutput = FileHandle.nullDevice
        let logPath = aosSigilLogPath()
        try? FileManager.default.createDirectory(
            atPath: (logPath as NSString).deletingLastPathComponent,
            withIntermediateDirectories: true
        )
        FileManager.default.createFile(atPath: logPath, contents: nil)
        if let logHandle = FileHandle(forWritingAtPath: logPath) {
            logHandle.seekToEndOfFile()
            proc.standardError = logHandle
        } else {
            proc.standardError = FileHandle.nullDevice
        }

        proc.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async { self?.updateIcon() }
        }

        do {
            try proc.run()
            sigilProcess = proc
            fputs("status-item: started avatar-sub (pid \(proc.processIdentifier))\n", stderr)
        } catch {
            fputs("status-item: failed to start avatar-sub: \(error)\n", stderr)
        }
        updateIcon()
    }

    private func stopSigilProcess() {
        if let proc = sigilProcess, proc.isRunning {
            proc.terminate()
            sigilProcess = nil
        }
        // Also kill any externally-started avatar-sub
        let pkill = Process()
        pkill.executableURL = URL(fileURLWithPath: "/usr/bin/pkill")
        pkill.arguments = ["-f", "avatar-sub"]
        pkill.standardOutput = FileHandle.nullDevice
        pkill.standardError = FileHandle.nullDevice
        try? pkill.run()
        pkill.waitUntilExit()
    }

    private func isSigilRunning() -> Bool {
        if let proc = sigilProcess, proc.isRunning { return true }
        let pgrep = Process()
        pgrep.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
        pgrep.arguments = ["-f", "avatar-sub"]
        pgrep.standardOutput = FileHandle.nullDevice
        pgrep.standardError = FileHandle.nullDevice
        try? pgrep.run()
        pgrep.waitUntilExit()
        return pgrep.terminationStatus == 0
    }

    private func resolveSigilBinary() -> String? {
        let selfDir = URL(fileURLWithPath: aosExecutablePath()).deletingLastPathComponent().path

        // 1. Adjacent to aos binary
        let adjacent = (selfDir as NSString).appendingPathComponent("avatar-sub")
        if FileManager.default.isExecutableFile(atPath: adjacent) { return adjacent }

        // 2. Repo build output
        if let repoRoot = aosCurrentRepoRoot() {
            let repoBuild = (repoRoot as NSString).appendingPathComponent("apps/sigil/build/avatar-sub")
            if FileManager.default.isExecutableFile(atPath: repoBuild) { return repoBuild }
        }

        // 3. Installed app bundle
        let installed = aosInstalledBinaryPath("avatar-sub")
        if FileManager.default.isExecutableFile(atPath: installed) { return installed }

        return nil
    }

    // MARK: - Icon

    func statusItemCGPosition() -> CGPoint {
        guard let button = statusItem?.button,
              let window = button.window else {
            return CGPoint(x: 100, y: 0)
        }
        let frameInScreen = window.frame
        let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
        return CGPoint(x: frameInScreen.midX, y: primaryHeight - frameInScreen.midY)
    }

    func updateIcon() {
        let showing = isSigilRunning() || canvasManager.hasCanvas(toggleId)
        statusItem?.button?.image = drawDefaultIcon(filled: showing)
    }

    private func drawDefaultIcon(filled: Bool) -> NSImage {
        let size = NSSize(width: 18, height: 18)
        let img = NSImage(size: size, flipped: false) { rect in
            let cx = rect.midX, cy = rect.midY
            let r: CGFloat = 7.0
            let path = NSBezierPath()

            for i in 0..<6 {
                let angle = CGFloat(Double(i) * .pi / 3.0 - .pi / 6.0)
                let px = cx + r * cos(angle)
                let py = cy + r * sin(angle)
                if i == 0 { path.move(to: NSPoint(x: px, y: py)) }
                else { path.line(to: NSPoint(x: px, y: py)) }
            }
            path.close()

            NSColor.black.setStroke()
            path.lineWidth = 1.2
            if filled { NSColor.black.setFill(); path.fill() }
            path.stroke()

            let dotR: CGFloat = filled ? 2.0 : 1.5
            let dotRect = NSRect(x: cx - dotR, y: cy - dotR, width: dotR * 2, height: dotR * 2)
            let dot = NSBezierPath(ovalIn: dotRect)
            if filled { NSColor.white.setFill() } else { NSColor.black.setFill() }
            dot.fill()

            return true
        }
        img.isTemplate = true
        return img
    }
}
