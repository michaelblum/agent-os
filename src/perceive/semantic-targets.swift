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
      const numberAttr = (el, name) => {
        const value = Number(attr(el, name));
        return Number.isFinite(value) ? value : null;
      };
      const jsonAttr = (el, name, fallback = null) => {
        const value = attr(el, name);
        if (!value) return fallback;
        try { return JSON.parse(value); } catch { return fallback; }
      };
      const words = (value) => clean(value).split(/[\\s,]+/).map((item) => clean(item)).filter(Boolean);
      const unique = (items) => Array.from(new Set(items));
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
      const sliderStateFor = (el) => {
        if ((attr(el, 'role') || nativeRole(el)) !== 'slider') return {};
        const root = el.matches?.('[data-aos-slider-root]') ? el : el.closest?.('[data-aos-slider-root]');
        const thumbs = Array.from(root?.querySelectorAll?.('[data-aos-slider-thumb]') || []);
        const values = jsonAttr(el, 'data-aos-values', null)
          || jsonAttr(root, 'data-aos-values', null)
          || thumbs.map((thumb) => numberAttr(thumb, 'aria-valuenow')).filter((value) => value !== null);
        const firstThumb = thumbs[0] || el;
        return {
          values: Array.isArray(values) ? values.map(Number).filter(Number.isFinite) : null,
          min: numberAttr(el, 'aria-valuemin') ?? numberAttr(root, 'aria-valuemin') ?? numberAttr(firstThumb, 'aria-valuemin'),
          max: numberAttr(el, 'aria-valuemax') ?? numberAttr(root, 'aria-valuemax') ?? numberAttr(firstThumb, 'aria-valuemax'),
          step: numberAttr(el, 'data-aos-step') ?? numberAttr(root, 'data-aos-step'),
          orientation: attr(el, 'aria-orientation') || attr(el, 'data-orientation') || attr(root, 'data-orientation') || null,
          thumb_count: Number.isFinite(Number(attr(el, 'data-aos-thumb-count'))) ? Number(attr(el, 'data-aos-thumb-count')) : thumbs.length || null,
        };
      };
      const stateFor = (el, disabled) => {
        const state = {};
        const current = attr(el, 'aria-current');
        if (current && current !== 'false') state.current = current;
        for (const key of ['pressed', 'selected', 'checked', 'expanded']) {
          const value = boolAttr(el, `aria-${key}`);
          if (value !== null) state[key] = value;
        }
        const value = attr(el, 'aria-valuetext') || attr(el, 'aria-valuenow') || (el.value !== undefined ? clean(el.value) : '');
        if (value) state.value = value;
        const slider = sliderStateFor(el);
        if (slider.values?.length) state.values = slider.values;
        for (const key of ['min', 'max', 'step', 'orientation', 'thumb_count']) {
          if (slider[key] !== null && slider[key] !== undefined) state[key] = slider[key];
        }
        if (disabled) state.disabled = true;
        return Object.keys(state).length ? state : null;
      };
      const actionsFor = (el) => {
        const role = attr(el, 'role') || nativeRole(el);
        const explicit = [
          ...words(attr(el, 'data-aos-actions')),
          ...words(attr(el, 'data-aos-primitive-actions')),
        ];
        if (explicit.length) return unique(explicit);
        if (role === 'slider') return ['drag', 'set-value'];
        if (role === 'button' || role === 'link' || role === 'checkbox' || role === 'radio') return ['click'];
        if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return ['focus', 'set-value'];
        return [];
      };
      const geometryFor = (el, bounds) => {
        const role = attr(el, 'role') || nativeRole(el);
        const root = el.matches?.('[data-aos-slider-root]') ? el : el.closest?.('[data-aos-slider-root]');
        if (role !== 'slider' || !root) return null;
        const partRect = (part) => {
          const rect = part?.getBoundingClientRect?.();
          if (!rect || rect.width <= 0 || rect.height <= 0) return null;
          return {
            x: Math.round(rect.left * scale),
            y: Math.round(rect.top * scale),
            width: Math.max(1, Math.round(rect.width * scale)),
            height: Math.max(1, Math.round(rect.height * scale)),
          };
        };
        return {
          control_bounds: partRect(root.querySelector?.('[data-aos-slider-control]')) || bounds,
          track_bounds: partRect(root.querySelector?.('[data-aos-slider-track]')),
          thumb_bounds: Array.from(root.querySelectorAll?.('[data-aos-slider-thumb]') || []).map(partRect).filter(Boolean),
        };
      };

      return JSON.stringify(Array.from(document.querySelectorAll(selector)).map((el) => {
        const rect = el.getBoundingClientRect();
        if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) return null;
        const id = data(el, 'semanticTargetId') || attr(el, 'data-semantic-target-id') || attr(el, 'id');
        const ref = data(el, 'aosRef') || attr(el, 'data-aos-ref');
        const doTarget = canvasId && ref ? `canvas:${canvasId}/${ref}` : null;
        const disabled = el.matches?.(':disabled') || attr(el, 'aria-disabled') === 'true';
        const bounds = {
          x: Math.round(rect.left * scale),
          y: Math.round(rect.top * scale),
          width: Math.max(1, Math.round(rect.width * scale)),
          height: Math.max(1, Math.round(rect.height * scale)),
        };
        return {
          canvas_id: canvasId,
          id: id || null,
          ref: ref || null,
          do_target: doTarget,
          role: attr(el, 'role') || nativeRole(el),
          name: targetName(el, id, ref) || null,
          action: data(el, 'aosAction') || attr(el, 'data-aos-action') || null,
          actions: actionsFor(el),
          surface: data(el, 'aosSurface') || attr(el, 'data-aos-surface') || null,
          parent_canvas: data(el, 'aosParentCanvas') || attr(el, 'data-aos-parent-canvas') || null,
          enabled: !disabled,
          bounds,
          center: {
            x: Math.round(bounds.x + bounds.width / 2),
            y: Math.round(bounds.y + bounds.height / 2),
          },
          geometry: geometryFor(el, bounds),
          metadata: jsonAttr(el, 'data-aos-metadata', null),
          state: stateFor(el, disabled),
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
