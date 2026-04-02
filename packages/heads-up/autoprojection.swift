// heads-up — Auto-projection modes
// Generates HTML content and JS updates for built-in projection modes:
// - cursor_trail: fading circles along cursor path
// - highlight_focused: border around focused subtree
// - label_elements: numbered badges on channel elements

import Foundation

// MARK: - HTML Generation

/// Generate initial HTML for an auto-projection mode.
func generateAutoProjectHTML(mode: String, channelData: ChannelData?) -> String {
    switch mode {
    case "cursor_trail":
        return cursorTrailHTML()
    case "highlight_focused":
        return highlightFocusedHTML(channelData: channelData)
    case "label_elements":
        return labelElementsHTML(channelData: channelData)
    default:
        return "<html><body></body></html>"
    }
}

/// Generate JS to eval for updating an auto-projection canvas.
/// Returns empty string if no update is needed.
func generateAutoProjectUpdate(mode: String, channelData: ChannelData) -> String {
    switch mode {
    case "highlight_focused":
        return highlightFocusedUpdateJS(channelData: channelData)
    case "label_elements":
        return labelElementsUpdateJS(channelData: channelData)
    default:
        return ""
    }
}

// MARK: - cursor_trail

private func cursorTrailHTML() -> String {
    return """
    <!DOCTYPE html>
    <html><head><style>
    * { margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; background: transparent; overflow: hidden; }
    canvas { width: 100%; height: 100%; }
    </style></head><body>
    <canvas id="c"></canvas>
    <script>
    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    const points = [];
    const TRAIL_MS = 500;

    function resize() {
        canvas.width = window.innerWidth * (window.devicePixelRatio || 1);
        canvas.height = window.innerHeight * (window.devicePixelRatio || 1);
        ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    }
    resize();
    window.addEventListener('resize', resize);

    function addPoint(x, y, t) {
        points.push({x: x, y: y, t: t});
    }

    function draw() {
        const now = Date.now();
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Remove old points
        while (points.length > 0 && now - points[0].t > TRAIL_MS) {
            points.shift();
        }

        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const age = (now - p.t) / TRAIL_MS;
            const alpha = Math.max(0, 0.4 * (1 - age));
            const radius = Math.max(2, 8 * (1 - age));
            ctx.beginPath();
            ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(59, 130, 246, ${alpha})`;
            ctx.fill();
        }

        requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
    </script></body></html>
    """
}

// MARK: - highlight_focused

private func highlightFocusedHTML(channelData: ChannelData?) -> String {
    let borderCSS: String
    if let cd = channelData, let elements = focusedSubtreeElements(cd) {
        let bbox = computeBoundingBox(elements, windowBounds: cd.window_bounds)
        borderCSS = """
        left: \(bbox.x)px; top: \(bbox.y)px;
        width: \(bbox.w)px; height: \(bbox.h)px;
        display: block;
        """
    } else {
        borderCSS = "display: none;"
    }

    return """
    <!DOCTYPE html>
    <html><head><style>
    * { margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; background: transparent; overflow: hidden; }
    #highlight {
        position: absolute;
        border: 2px solid rgba(59, 130, 246, 0.6);
        border-radius: 4px;
        pointer-events: none;
        box-sizing: border-box;
        \(borderCSS)
    }
    </style></head><body>
    <div id="highlight"></div>
    <script>
    function updateHighlight(x, y, w, h, visible) {
        const el = document.getElementById('highlight');
        if (!visible) { el.style.display = 'none'; return; }
        el.style.display = 'block';
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        el.style.width = w + 'px';
        el.style.height = h + 'px';
    }
    </script></body></html>
    """
}

private func highlightFocusedUpdateJS(channelData: ChannelData) -> String {
    guard let elements = focusedSubtreeElements(channelData) else {
        return "updateHighlight(0,0,0,0,false)"
    }
    let bbox = computeBoundingBox(elements, windowBounds: channelData.window_bounds)
    return "updateHighlight(\(bbox.x),\(bbox.y),\(bbox.w),\(bbox.h),true)"
}

/// Get elements belonging to the focused subtree.
/// If focus.subtree is set, filter elements that are children of the subtree root.
/// For simplicity, we use all elements as they represent the focused subtree content.
private func focusedSubtreeElements(_ data: ChannelData) -> [ChannelElement]? {
    guard data.focus.subtree != nil else { return nil }
    guard !data.elements.isEmpty else { return nil }
    return data.elements
}

/// Compute bounding box of elements in window-relative coordinates.
private func computeBoundingBox(_ elements: [ChannelElement], windowBounds: ChannelBounds) -> (x: Double, y: Double, w: Double, h: Double) {
    guard !elements.isEmpty else { return (0, 0, 0, 0) }

    var minX = Double.infinity
    var minY = Double.infinity
    var maxX = -Double.infinity
    var maxY = -Double.infinity

    for el in elements {
        let b = el.bounds_window
        minX = min(minX, b.x)
        minY = min(minY, b.y)
        maxX = max(maxX, b.x + b.w)
        maxY = max(maxY, b.y + b.h)
    }

    return (x: minX, y: minY, w: maxX - minX, h: maxY - minY)
}

// MARK: - label_elements

private func labelElementsHTML(channelData: ChannelData?) -> String {
    let badgesHTML: String
    if let cd = channelData {
        badgesHTML = generateBadgesHTML(cd.elements, windowBounds: cd.window_bounds)
    } else {
        badgesHTML = ""
    }

    return """
    <!DOCTYPE html>
    <html><head><style>
    * { margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; background: transparent; overflow: hidden; }
    .badge {
        position: absolute;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 10px;
        font-weight: 600;
        color: white;
        padding: 1px 4px;
        border-radius: 8px;
        pointer-events: none;
        white-space: nowrap;
        line-height: 14px;
        min-width: 14px;
        text-align: center;
        z-index: 1000;
    }
    </style></head><body>
    <div id="badges">\(badgesHTML)</div>
    <script>
    function updateBadges(html) {
        document.getElementById('badges').innerHTML = html;
    }
    </script></body></html>
    """
}

private func labelElementsUpdateJS(channelData: ChannelData) -> String {
    let html = generateBadgesHTML(channelData.elements, windowBounds: channelData.window_bounds)
    let escaped = html
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "'", with: "\\'")
        .replacingOccurrences(of: "\n", with: "\\n")
    return "updateBadges('\(escaped)')"
}

private func generateBadgesHTML(_ elements: [ChannelElement], windowBounds: ChannelBounds) -> String {
    var html = ""
    for (i, el) in elements.enumerated() {
        let b = el.bounds_window
        let color = badgeColor(for: el.role)
        let label = i + 1
        html += "<div class=\"badge\" style=\"left:\(b.x)px;top:\(b.y)px;background:\(color);\">\(label)</div>"
    }
    return html
}

/// Role-based color coding for element badges.
private func badgeColor(for role: String) -> String {
    switch role {
    case "AXButton":
        return "rgba(59,130,246,0.85)"   // blue
    case "AXTextField", "AXTextArea", "AXSearchField":
        return "rgba(16,185,129,0.85)"   // green
    case "AXLink":
        return "rgba(139,92,246,0.85)"   // purple
    case "AXMenuItem", "AXMenu", "AXMenuBar":
        return "rgba(245,158,11,0.85)"   // amber
    case "AXCheckBox", "AXRadioButton":
        return "rgba(236,72,153,0.85)"   // pink
    case "AXPopUpButton", "AXComboBox":
        return "rgba(6,182,212,0.85)"    // cyan
    case "AXStaticText":
        return "rgba(107,114,128,0.75)"  // gray
    case "AXImage":
        return "rgba(249,115,22,0.85)"   // orange
    case "AXTab", "AXTabGroup":
        return "rgba(168,85,247,0.85)"   // violet
    default:
        return "rgba(75,85,99,0.8)"      // default gray
    }
}
