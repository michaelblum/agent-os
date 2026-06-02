// semantic-targets.swift — Fixed AOS-owned canvas semantic target projection.

import Foundation

private func jsonStringLiteral(_ value: String) -> String {
    guard
        let data = try? JSONSerialization.data(withJSONObject: [value], options: []),
        let arrayLiteral = String(data: data, encoding: .utf8),
        arrayLiteral.count >= 2
    else {
        return "\"\""
    }
    return String(arrayLiteral.dropFirst().dropLast())
}

private func semanticTargetProbeJS(canvasID: String, scaleFactor: Double) -> String {
    let encodedCanvasID = jsonStringLiteral(canvasID)
    let scale = String(scaleFactor)
    return """
    (() => {
      const canvasId = \(encodedCanvasID);
      const scale = Number(\(scale)) || 1;
      const selector = [
        '[data-aos-ref]',
        '[data-aos-action]',
        '[data-aos-surface]',
        '[data-semantic-target-id]',
        '[data-aos-parent-canvas]'
      ].join(',');

      const clean = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const attr = (el, name) => clean(el.getAttribute(name));
      const data = (el, name) => clean(el.dataset ? el.dataset[name] : '');
      const boolAttr = (el, name) => {
        const value = attr(el, name);
        if (!value || value === 'undefined' || value === 'mixed') return null;
        return value === 'true';
      };
      const nativeRole = (el) => {
        const tag = clean(el.tagName).toLowerCase();
        const type = attr(el, 'type').toLowerCase();
        if (tag === 'button') return 'button';
        if (tag === 'a' && attr(el, 'href')) return 'link';
        if (tag === 'input') {
          if (type === 'checkbox') return 'checkbox';
          if (type === 'radio') return 'radio';
          if (type === 'range') return 'slider';
          if (type === 'search') return 'searchbox';
          return 'textbox';
        }
        if (tag === 'textarea') return 'textbox';
        if (tag === 'select') return 'combobox';
        return 'generic';
      };
      const targetName = (el, id, ref) => clean(
        attr(el, 'aria-label')
        || attr(el, 'title')
        || clean(el.innerText)
        || clean(el.textContent)
        || id
        || ref
      );
      const stateFor = (el) => {
        const state = {};
        const value = attr(el, 'aria-valuetext') || attr(el, 'aria-valuenow') || (el.value !== undefined ? clean(el.value) : '');
        if (value) state.value = value;
        const current = attr(el, 'aria-current');
        if (current && current !== 'false') state.current = current;
        for (const key of ['pressed', 'selected', 'checked', 'expanded']) {
          const value = boolAttr(el, `aria-${key}`);
          if (value !== null) state[key] = value;
        }
        return Object.keys(state).length ? state : null;
      };

      return JSON.stringify(Array.from(document.querySelectorAll(selector)).map((el) => {
        const rect = el.getBoundingClientRect();
        if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) return null;
        const id = data(el, 'semanticTargetId') || attr(el, 'data-semantic-target-id') || attr(el, 'id');
        const ref = data(el, 'aosRef') || attr(el, 'data-aos-ref');
        if (!ref) return null;
        const doTarget = canvasId && ref ? `canvas:${canvasId}/${ref}` : null;
        const disabled = el.matches?.(':disabled') || attr(el, 'aria-disabled') === 'true';
        const bounds = {
          x: Math.round(rect.left * scale),
          y: Math.round(rect.top * scale),
          width: Math.max(1, Math.round(rect.width * scale)),
          height: Math.max(1, Math.round(rect.height * scale)),
        };
        const action = data(el, 'aosAction') || attr(el, 'data-aos-action') || '';
        const parentCanvasId = data(el, 'aosParentCanvas') || attr(el, 'data-aos-parent-canvas') || null;
        return {
          ref,
          surface: data(el, 'aosSurface') || attr(el, 'data-aos-surface') || null,
          role: attr(el, 'role') || nativeRole(el),
          name: targetName(el, id, ref) || null,
          kind: 'semantic_target',
          enabled: !disabled,
          state: stateFor(el),
          actions: action ? [action] : [],
          extension: {
            dom_id: id || null,
            source: { path: null, line_start: null, line_end: null },
          },
          provenance: {
            canvas_id: canvasId,
            do_target: doTarget,
            parent_canvas_id: parentCanvasId,
            source_payload_id: id || ref,
            bounds,
            frame: bounds,
            center: {
              x: Math.round(bounds.x + bounds.width / 2),
              y: Math.round(bounds.y + bounds.height / 2),
            },
          },
        };
      }).filter(Boolean));
    })()
    """
}

func collectCanvasSemanticTargets(canvasID: String, scaleFactor: Double) -> [AOSSemanticTargetJSON]? {
    let js = semanticTargetProbeJS(canvasID: canvasID, scaleFactor: scaleFactor)
    let maxAttempts = 5
    let retryDelaySeconds = 0.05

    for attempt in 0..<maxAttempts {
        guard
            let response = sendEnvelopeRequest(
                service: "show",
                action: "eval",
                data: ["id": canvasID, "js": js],
                autoStartBinary: aosExecutablePath()
            ),
            let decoded = decodeCanvasResponse(response),
            decoded.error == nil,
            let result = decoded.result,
            !result.hasPrefix("error:")
        else {
            return nil
        }

        guard
            let data = result.data(using: .utf8),
            let targets = try? JSONDecoder().decode([AOSSemanticTargetJSON].self, from: data)
        else {
            return nil
        }

        if !targets.isEmpty || attempt == maxAttempts - 1 {
            return targets
        }

        Thread.sleep(forTimeInterval: retryDelaySeconds)
    }

    return []
}
