import AppKit
import MetalKit

/// Lazily hosts one native Metal projection beneath a DesktopWorld segment's
/// transparent WebKit layer. Rendering and product semantics remain owned by
/// the caller; this type owns only view placement and deterministic teardown.
final class DesktopWorldNativeProjectionHost {
    let view: MTKView
    private weak var containerView: NSView?
    private var finalized = false

    init(containerView: NSView, below webView: NSView, device: MTLDevice) {
        precondition(Thread.isMainThread, "native projection creation must run on the main thread")
        let view = MTKView(frame: containerView.bounds, device: device)
        view.autoResizeDrawable = true
        view.autoresizingMask = [.width, .height]
        view.clearColor = MTLClearColorMake(0, 0, 0, 0)
        view.colorPixelFormat = .bgra8Unorm
        view.enableSetNeedsDisplay = true
        view.framebufferOnly = true
        view.isHidden = true
        view.isPaused = true
        view.wantsLayer = true
        view.layer?.isOpaque = false
        containerView.addSubview(view, positioned: .below, relativeTo: webView)
        self.view = view
        self.containerView = containerView
    }

    func resize() {
        precondition(Thread.isMainThread, "native projection resize must run on the main thread")
        guard !finalized, let containerView else { return }
        view.frame = containerView.bounds
    }

    func present() {
        precondition(Thread.isMainThread, "native projection presentation must run on the main thread")
        guard !finalized else { return }
        resize()
        view.isHidden = false
        view.draw()
    }

    func suspend() {
        precondition(Thread.isMainThread, "native projection suspension must run on the main thread")
        guard !finalized else { return }
        view.isHidden = true
    }

    func detachRenderer() {
        precondition(Thread.isMainThread, "native projection detachment must run on the main thread")
        guard !finalized else { return }
        suspend()
        view.isPaused = true
        view.enableSetNeedsDisplay = true
        view.delegate = nil
    }

    func finalize() {
        precondition(Thread.isMainThread, "native projection finalization must run on the main thread")
        guard !finalized else { return }
        finalized = true
        view.isHidden = true
        view.delegate = nil
        view.removeFromSuperview()
        containerView = nil
    }

    var retainedViewCount: Int {
        finalized || view.superview == nil ? 0 : 1
    }

    var isDormant: Bool {
        !finalized
            && view.superview != nil
            && view.isHidden
            && view.isPaused
            && view.delegate == nil
    }
}
