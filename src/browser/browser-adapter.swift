// browser-adapter.swift — Top-level entry point for browser-target calls.

import Foundation

enum BrowserAdapterError: Error {
    case versionCheckFailed(String, code: String)
    case subprocess(String, code: String)
    case invalidTarget(String)    // forward-declared for Tasks 8-12 verb dispatchers
    case notLocalBrowser(String)  // used by anchor-resolver
}

struct BrowserDomHitTestPoint {
    let x: Double
    let y: Double
}

struct BrowserDomContentRect {
    let x: Double
    let y: Double
    let w: Double
    let h: Double
}

/// Screenshot the whole active tab (no ref) or a single element.
/// Returns the PNG file path on success.
func seeCaptureScreenshot(target: BrowserTarget, outPath: String) throws -> String {
    try ensureVersion()
    var args: [String] = []
    if let ref = target.ref { args.append(ref) }
    args.append("--filename=\(outPath)")
    let r = try runPlaywright(PlaywrightInvocation(
        session: target.session, verb: "screenshot", args: args, withTempFilename: false
    ))
    try requireSuccess(r, action: "screenshot")
    return outPath
}

/// Run snapshot, parse markdown, return AXElementJSON[].
/// If `withBounds` is true, follows up with one eval per ref.
func seeCaptureXray(target: BrowserTarget, withBounds: Bool) throws -> [AXElementJSON] {
    try ensureVersion()
    let r = try runPlaywright(PlaywrightInvocation(
        session: target.session, verb: "snapshot", args: [], withTempFilename: true
    ))
    try requireSuccess(r, action: "snapshot")
    guard let path = r.filename else {
        throw BrowserAdapterError.subprocess("snapshot produced no filename", code: "PLAYWRIGHT_CLI_FAILED")
    }
    defer { try? FileManager.default.removeItem(atPath: path) }
    let contents = try readSnapshotMarkdown(atPath: path)
    var elements = parseSnapshotMarkdown(contents)
    if withBounds {
        elements = try elements.map { el in
            guard let ref = el.ref else { return el }
            guard let b = try boundsViaEval(session: target.session, ref: ref) else { return el }
            return AXElementJSON(
                role: el.role, title: el.title, label: el.label, value: el.value,
                enabled: el.enabled, context_path: el.context_path,
                bounds: b, ref: el.ref
            )
        }
    }
    return elements
}

/// Hit-test the active page DOM at a viewport point and return an
/// `aos-browser-dom-element-picker` element_target payload. This is intentionally
/// bounded: one explicit eval for one user-approved browser session and point.
func seeCaptureBrowserDomElementTarget(
    target: BrowserTarget,
    point: BrowserDomHitTestPoint,
    contentRect: BrowserDomContentRect?
) throws -> String {
    try ensureVersion()
    guard target.ref == nil else {
        throw BrowserAdapterError.invalidTarget("browser DOM hit testing expects a page target, not an element ref")
    }
    let js = browserDomElementTargetEvalScript(point: point, contentRect: contentRect)
    let r = try runPlaywright(PlaywrightInvocation(
        session: target.session, verb: "eval", args: [js], withTempFilename: false
    ))
    try requireSuccess(r, action: "browser DOM element target")
    let body = try parsePlaywrightResultBody(r.stdout)
    let normalized = try normalizeBrowserDomElementTargetResponse(body)
    return String(data: normalized, encoding: .utf8) ?? "{}"
}

private func browserDomElementTargetEvalScript(
    point: BrowserDomHitTestPoint,
    contentRect: BrowserDomContentRect?
) -> String {
    let contentRectLiteral: String
    if let rect = contentRect {
        contentRectLiteral = "{x:\(rect.x),y:\(rect.y),w:\(rect.w),h:\(rect.h)}"
    } else {
        contentRectLiteral = "null"
    }
    return """
(() => {
  const point = { x: \(point.x), y: \(point.y) };
  const __aosBrowserDomElementTargetFixture = "__aos-browser-dom-element-target-fixture";
  const browserContentRect = \(contentRectLiteral);
  const adapterId = "aos-browser-dom-element-picker";
  const text = (value) => String(value == null ? "" : value).trim();
  const stable = (prefix, parts) => {
    const material = parts.map(text).filter(Boolean).join("|") || prefix;
    let hash = 2166136261;
    for (let i = 0; i < material.length; i += 1) {
      hash ^= material.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `${prefix}-${(hash >>> 0).toString(36)}`;
  };
  const esc = (value) => globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/["\\\\]/g, "\\\\$&");
  const stableAttr = (value) => {
    const normalized = text(value);
    if (!normalized || normalized.length > 96 || /^\\d+$/.test(normalized)) return "";
    if (/(^|[-_:])(?:[a-f0-9]{8,}|[0-9]{6,}|uuid|generated|random)([-_:]|$)/i.test(normalized)) return "";
    return normalized;
  };
  const tag = (element) => text(element?.tagName).toLowerCase();
  const rect = (element) => {
    const r = element?.getBoundingClientRect?.();
    if (!r) return null;
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  };
  const role = (element) => {
    const explicit = text(element?.getAttribute?.("role"));
    if (explicit) return explicit;
    const t = tag(element);
    if (t === "a" && element?.getAttribute?.("href")) return "link";
    if (t === "button") return "button";
    if (t === "textarea") return "textbox";
    if (t === "select") return "combobox";
    if (t === "input") return "textbox";
    if (/^h[1-6]$/.test(t)) return "heading";
    if (t === "img") return "img";
    return "";
  };
  const label = (element) => {
    for (const attr of ["aria-label", "alt", "title", "placeholder", "name", "value"]) {
      const value = stableAttr(element?.getAttribute?.(attr));
      if (value) return value;
    }
    return text(element?.innerText || element?.textContent).replace(/\\s+/g, " ").slice(0, 120);
  };
  const nth = (element) => {
    const t = tag(element) || "*";
    let index = 1;
    let previous = element?.previousElementSibling;
    while (previous) {
      if (tag(previous) === t) index += 1;
      previous = previous.previousElementSibling;
    }
    return `${t}:nth-of-type(${index})`;
  };
  const selectors = (element) => {
    const out = [];
    const add = (selector) => { if (selector && !out.includes(selector)) out.push(selector); };
    const id = stableAttr(element?.getAttribute?.("id"));
    if (id) add(`#${esc(id)}`);
    for (const attr of ["data-testid", "data-test", "data-cy", "data-qa"]) {
      const value = stableAttr(element?.getAttribute?.(attr));
      if (value) add(`[${attr}="${String(value).replace(/"/g, "\\\\\"")}"]`);
    }
    const name = stableAttr(element?.getAttribute?.("name"));
    if (name) add(`${tag(element)}[name="${String(name).replace(/"/g, "\\\\\"")}"]`);
    const path = [];
    let current = element;
    while (current && current.nodeType === 1 && tag(current) !== "html" && path.length < 4) {
      const currentId = stableAttr(current.getAttribute?.("id"));
      if (currentId) { path.unshift(`#${esc(currentId)}`); break; }
      path.unshift(nth(current));
      if (tag(current) === "body") break;
      current = current.parentElement || current.getRootNode?.().host || null;
    }
    add(path.join(" > "));
    return out;
  };
  const xpath = (element) => {
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1) {
      const t = tag(current);
      if (!t || t === "html") break;
      let index = 1;
      let previous = current.previousElementSibling;
      while (previous) {
        if (tag(previous) === t) index += 1;
        previous = previous.previousElementSibling;
      }
      parts.unshift(`${t}[${index}]`);
      if (t === "body") break;
      current = current.parentElement || current.getRootNode?.().host || null;
    }
    return parts.length ? `/${parts.join("/")}` : null;
  };
  const reject = (element) => {
    if (!element || element.nodeType !== 1) return "not_an_element";
    if (["SCRIPT", "STYLE", "HEAD", "META", "LINK", "HTML", "TEMPLATE", "NOSCRIPT"].includes(text(element.tagName).toUpperCase())) return "unsupported_tag";
    if (element.closest?.("[data-aos-overlay],[data-aos-tooling],[data-aos-dom-picker-overlay],[data-surface-inspector-overlay],.aos-dom-element-picker,.aos-surface-inspector-overlay")) return "overlay_or_tooling_dom";
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number(style.opacity) === 0) return "hidden_target";
    const r = rect(element);
    if (!r || r.width <= 0 || r.height <= 0) return "zero_area_target";
    return "";
  };
  const stack = document.elementsFromPoint ? Array.from(document.elementsFromPoint(point.x, point.y)) : [document.elementFromPoint(point.x, point.y)].filter(Boolean);
  const skipped = [];
  let element = null;
  for (const candidate of stack) {
    const reason = reject(candidate);
    if (!reason) { element = candidate; break; }
    skipped.push({ tag_name: tag(candidate), reason });
  }
  if (!element) {
    return {
      status: "blocked",
      schema: "browser_dom_element_target",
      version: "0.1.0",
      adapter_id: adapterId,
      blocker_reason: skipped[0]?.reason || "no_dom_target_at_point",
      point,
      skipped
    };
  }
  const bounds = rect(element);
  const selectorCandidates = selectors(element);
  const preferred = selectorCandidates[0] || null;
  const pageBounds = bounds ? { x: bounds.x + scrollX, y: bounds.y + scrollY, width: bounds.width, height: bounds.height } : null;
  const id = stable("element-target", [location.href, preferred, xpath(element), JSON.stringify(point)]);
  const displayRect = browserContentRect && bounds ? { x: browserContentRect.x + bounds.x, y: browserContentRect.y + bounds.y, w: bounds.width, h: bounds.height } : null;
  return {
    status: "success",
    schema: "browser_dom_element_target",
    version: "0.1.0",
    adapter_id: adapterId,
    target: {
      id,
      kind: "element_target",
      surface_id: `browser-page:${location.origin || "local"}`,
      surface_type: "browser_page",
      source_url: location.href,
      coordinate_space: "viewport",
      point,
      anchor_point: point,
      bounds,
      viewport_bounds: bounds,
      page_bounds: pageBounds,
      selector_candidates: selectorCandidates,
      preferred_selector: preferred,
      xpath: xpath(element),
      tag_name: tag(element),
      role: role(element),
      label: label(element),
      accessible_name: label(element),
      text_excerpt: text(element.innerText || element.textContent).replace(/\\s+/g, " ").slice(0, 160),
      ancestor_chain: [],
      ancestor_descriptors: [],
      frame_chain: [{ kind: "top", url: location.href }],
      shadow_chain: [],
      metadata: {
        picker: { source: "aos_browser_eval", state_version: "0.1.0" },
        visibility: { state: "visible", can_reveal: Boolean(preferred), reveal_action: preferred ? "scrollIntoView" : null, blocker_reason: "" },
        browser_attachment: "explicit_local_page"
      }
    },
    projection: displayRect ? {
      adapter_id: adapterId,
      root_id: `browser-page:${location.origin || "local"}`,
      subject_id: id,
      can_project_display_overlay: true,
      display_space_rect: displayRect,
      visible_display_rect: displayRect,
      coordinate_space: "desktop_world",
      blocker_reason: ""
    } : {
      adapter_id: adapterId,
      root_id: `browser-page:${location.origin || "local"}`,
      subject_id: id,
      can_project_display_overlay: false,
      display_space_rect: null,
      visible_display_rect: null,
      coordinate_space: "viewport",
      blocker_reason: "browser_content_inset_unresolved"
    },
    browser_content_rect: browserContentRect,
    skipped
  };
})()
"""
}

private func normalizeBrowserDomElementTargetResponse(_ body: Data) throws -> Data {
    do {
        let value = try JSONSerialization.jsonObject(with: body, options: [])
        if let stringValue = value as? String, let data = stringValue.data(using: .utf8) {
            _ = try JSONSerialization.jsonObject(with: data, options: [])
            return data
        }
        _ = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        return try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .prettyPrinted])
    } catch {
        throw BrowserAdapterError.subprocess(
            "browser DOM element target produced invalid JSON: \(error)",
            code: "BROWSER_DOM_TARGET_INVALID_JSON"
        )
    }
}

func readSnapshotMarkdown(atPath path: String) throws -> String {
    do {
        return try String(contentsOfFile: path, encoding: .utf8)
    } catch {
        throw BrowserAdapterError.subprocess(
            "cannot read snapshot markdown \(path): \(error)",
            code: "SNAPSHOT_READ_FAILED"
        )
    }
}

/// Dispatch `do` verbs on browser targets. Returns the raw PlaywrightResult;
/// per-verb callers in Tasks 8-12 decide whether a non-zero exit is an error
/// and shape the user-facing message (`see*` helpers above wrap non-zero into
/// BrowserAdapterError.subprocess because they must resolve to a value).
func doVerb(_ verb: String, target: BrowserTarget, extraArgs: [String] = []) throws -> PlaywrightResult {
    try ensureVersion()
    var args: [String] = []
    if let ref = target.ref { args.append(ref) }
    args.append(contentsOf: extraArgs)
    return try runPlaywright(PlaywrightInvocation(
        session: target.session, verb: verb, args: args, withTempFilename: false
    ))
}

/// Fetch getBoundingClientRect() for a specific ref. Returns nil on zero-size
/// rect or any probe failure. The JS returns an object directly (not
/// JSON.stringify'd) so playwright-cli's `### Result` envelope contains bare
/// JSON we decode with parsePlaywrightResultBody.
func boundsViaEval(session: String, ref: String) throws -> BoundsJSON? {
    let js = "(e) => { const r = e.getBoundingClientRect(); return {x:r.left,y:r.top,w:r.width,h:r.height}; }"
    let r = try runPlaywright(PlaywrightInvocation(
        session: session, verb: "eval", args: [js, ref], withTempFilename: false
    ))
    if r.exit_code != 0 { return nil }
    // Treat a "### Error" marker as probe failure (eval against a detached ref,
    // CSP violations, etc.) — return nil rather than throwing, so the caller's
    // best-effort per-ref loop can skip missing bounds.
    if detectPlaywrightErrorMarker(r.stdout) != nil { return nil }
    guard let data = try? parsePlaywrightResultBody(r.stdout) else { return nil }
    struct Rect: Decodable { let x: Double; let y: Double; let w: Double; let h: Double }
    guard let rect = try? JSONDecoder().decode(Rect.self, from: data) else { return nil }
    if rect.w == 0 && rect.h == 0 { return nil }
    return BoundsJSON(x: Int(rect.x), y: Int(rect.y), width: Int(rect.w), height: Int(rect.h))
}

/// Throw BrowserAdapterError.subprocess when a PlaywrightResult indicates
/// failure via either non-zero exit code or a `### Error` marker in stdout
/// (which real playwright-cli sometimes emits at exit 0). Use at every
/// orchestrator entry point that needs success-or-fail semantics.
func requireSuccess(_ r: PlaywrightResult, action: String) throws {
    if r.exit_code != 0 {
        let msg = r.stderr.isEmpty ? r.stdout : r.stderr
        throw BrowserAdapterError.subprocess(
            "\(action) failed (exit \(r.exit_code)): \(msg)",
            code: "PLAYWRIGHT_CLI_FAILED"
        )
    }
    if let err = detectPlaywrightErrorMarker(r.stdout) {
        throw BrowserAdapterError.subprocess(
            "\(action) failed: \(err)",
            code: "PLAYWRIGHT_CLI_FAILED"
        )
    }
}

// One probe per CLI invocation. Each ./aos call is a fresh process, so the
// memoization never carries stale state across invocations.
private var versionChecked = false
func ensureVersion() throws {
    if versionChecked { return }
    do {
        _ = try probePlaywrightVersion()
        versionChecked = true
    } catch PlaywrightVersionError.notFound {
        throw BrowserAdapterError.versionCheckFailed(
            "@playwright/cli not found. Install: npm install -g @playwright/cli@\(kMinPlaywrightCLIVersion)",
            code: "PLAYWRIGHT_CLI_NOT_FOUND")
    } catch PlaywrightVersionError.tooOld(let found, let min) {
        throw BrowserAdapterError.versionCheckFailed(
            "@playwright/cli \(found) below minimum \(min). Upgrade: npm install -g @playwright/cli@latest",
            code: "PLAYWRIGHT_CLI_TOO_OLD")
    } catch {
        throw BrowserAdapterError.versionCheckFailed("version probe error: \(error)", code: "PLAYWRIGHT_CLI_PROBE_FAILED")
    }
}
