// status-item.swift — Menu bar icon that toggles a canvas on/off.
// Ported from packages/heads-up/daemon.swift (StatusItemManager).

import AppKit
import Foundation

class StatusItemManager: NSObject {
    let canvasManager: CanvasManager
    var statusItem: NSStatusItem?

    let toggleId: String
    let toggleUrl: String
    let toggleAt: [Double]

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

    private var isDismissing = false

    @objc func handleClick(_ sender: Any?) {
        guard !isDismissing else { return }

        if canvasManager.hasCanvas(toggleId) {
            // Egress: play dismissed animation + fly back to icon, then remove
            isDismissing = true
            updateIcon()

            var evalReq = CanvasRequest(action: "eval")
            evalReq.id = toggleId
            let msg = "{\"type\":\"behavior\",\"slot\":\"dismissed\"}"
            let b64 = Data(msg.utf8).base64EncodedString()
            evalReq.js = "headsup.receive('\(b64)')"
            _ = canvasManager.handle(evalReq)

            let iconCG = statusItemCGPosition()
            let endSize: CGFloat = 20

            let listResp = canvasManager.handle(CanvasRequest(action: "list"))
            var fromX: CGFloat = 200, fromY: CGFloat = 200, fromW: CGFloat = 300, fromH: CGFloat = 300
            if let canvases = listResp.canvases {
                for c in canvases where c.id == toggleId {
                    fromX = c.at[0]; fromY = c.at[1]; fromW = c.at[2]; fromH = c.at[3]
                }
            }
            let toX = iconCG.x - endSize / 2, toY = iconCG.y

            let duration = 0.4
            let fps = 60.0
            let totalFrames = Int(duration * fps)

            DispatchQueue.global(qos: .userInteractive).async { [weak self] in
                let t0 = Date()
                for i in 0...totalFrames {
                    let t = Double(i) / Double(totalFrames)
                    let c1 = 1.70158, c3 = c1 + 1
                    let e = c3 * t * t * t - c1 * t * t

                    let x = fromX + (toX - fromX) * CGFloat(e)
                    let y = fromY + (toY - fromY) * CGFloat(e)
                    let w = fromW + (endSize - fromW) * CGFloat(e)
                    let h = fromH + (endSize - fromH) * CGFloat(e)

                    DispatchQueue.main.async {
                        var updateReq = CanvasRequest(action: "update")
                        updateReq.id = self?.toggleId
                        updateReq.at = [x, y, w, h]
                        _ = self?.canvasManager.handle(updateReq)
                    }

                    let want = Double(i + 1) / fps
                    let got = Date().timeIntervalSince(t0)
                    if want > got { Thread.sleep(forTimeInterval: want - got) }
                }

                DispatchQueue.main.async { [weak self] in
                    guard let self = self else { return }
                    var removeReq = CanvasRequest(action: "remove")
                    removeReq.id = self.toggleId
                    _ = self.canvasManager.handle(removeReq)
                    self.isDismissing = false
                    self.updateIcon()
                }
            }
        } else {
            // Ingress: create canvas at icon position, animate to target
            guard !toggleUrl.isEmpty, toggleAt.count == 4 else { return }

            let iconCG = statusItemCGPosition()
            let startSize: CGFloat = 40
            let fromX = iconCG.x - startSize / 2
            let fromY = iconCG.y

            let targetX = CGFloat(toggleAt[0])
            let targetY = CGFloat(toggleAt[1])
            let targetW = CGFloat(toggleAt[2])
            let targetH = CGFloat(toggleAt[3])

            var req = CanvasRequest(action: "create")
            req.id = toggleId
            req.url = toggleUrl
            req.at = [fromX, fromY, startSize, startSize]
            _ = canvasManager.handle(req)
            canvasManager.setCanvasAlpha(toggleId, 0)
            updateIcon()

            let duration = 0.5
            let fps = 60.0
            let totalFrames = Int(duration * fps)

            DispatchQueue.global(qos: .userInteractive).async { [weak self] in
                Thread.sleep(forTimeInterval: 0.35)

                DispatchQueue.main.async {
                    self?.canvasManager.setCanvasAlpha(self?.toggleId ?? "", 1)
                }

                let t0 = Date()
                for i in 0...totalFrames {
                    let t = Double(i) / Double(totalFrames)
                    let e = 1 - pow(1 - t, 3)  // easeOutCubic

                    let x = fromX + (targetX - fromX) * CGFloat(e)
                    let y = fromY + (targetY - fromY) * CGFloat(e)
                    let w = startSize + (targetW - startSize) * CGFloat(e)
                    let h = startSize + (targetH - startSize) * CGFloat(e)

                    DispatchQueue.main.async {
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
        }
    }

    func statusItemCGPosition() -> CGPoint {
        guard let button = statusItem?.button,
              let window = button.window else {
            return CGPoint(x: 100, y: 0)
        }
        let frameInScreen = window.frame
        let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
        let cgX = frameInScreen.midX
        let cgY = primaryHeight - frameInScreen.midY
        return CGPoint(x: cgX, y: cgY)
    }

    func updateIcon() {
        let showing = canvasManager.hasCanvas(toggleId)
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

            if filled {
                NSColor.black.setFill()
                path.fill()
            }
            path.stroke()

            let dotR: CGFloat = filled ? 2.0 : 1.5
            let dotRect = NSRect(x: cx - dotR, y: cy - dotR, width: dotR * 2, height: dotR * 2)
            let dot = NSBezierPath(ovalIn: dotRect)
            if filled { NSColor.white.setFill() }
            else { NSColor.black.setFill() }
            dot.fill()

            return true
        }
        img.isTemplate = true
        return img
    }
}
