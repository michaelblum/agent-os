# Panel Chrome Controls Audit

Source audited: `packages/toolkit/panel/chrome.js` at 1,491 lines.

Controls compared: `packages/toolkit/controls/` currently exports
`createButton`, `createButtonGroup`, `createToggle`, `createTextField`,
`createCheckboxGroup`, `createSelect`, `createTimerBar`, and
`wireNumberFieldControls`.

## Findings

| Inline widget / affordance | Rough line range | Current implementation | Controls mapping |
| --- | ---: | --- | --- |
| Maximize / restore window button | 98-113, 731-738 | Hand-created `<button>` with `aos-window-button aos-window-maximize`, custom `aria-pressed`, title, label sync, and click handler. | `createButton` is the closest existing control for the press action and disabled plumbing, but this needs either a window-button variant/API or a new panel-window control because it owns pressed state, icon text, and panel-window semantics. |
| Minimize window button | 116-142 | Hand-created `<button>` with in-flight disabled state, `data-in-flight`, async action handling, and click handler. | `createButton` maps to the base pressable button and disabled state. A panel-window button wrapper or new control would still be needed for the async in-flight contract and window-control styling/semantics. |
| Close window button | 145-157 | Hand-created `<button>` with `aos-window-button aos-window-close`, label/title text, and click handler. | `createButton` maps cleanly for the base action. A window-control variant or panel-window button wrapper would avoid hand-rolling the chrome-specific class and accessibility labels. |
| Header drag affordance / grip | 53-59, 163-180, 183-185, 1335-1437 | Header and grip are hand-created, then `wireDrag` attaches pointer capture, global input subscription, drag lifecycle emits, and control-region exclusion. Double-click on the header toggles maximize. | No existing `controls/` control maps to this. This is panel-window policy rather than an app control; keep in `panel/` or extract to a new panel-specific `createPanelDragHandle`/`wirePanelDragHandle`, not the generic controls package unless it becomes broadly reusable outside panel chrome. |
| Minimized stage chip body/restore/close regions | 792-797, 905-1020 | Hand-built DesktopWorld stage affordance with input regions for body drag, restore, and close. The visual layer is a `kind: 'chip'`; interactivity is through registered native input regions instead of DOM controls. | No existing DOM control maps to this. It likely needs a panel/stage affordance abstraction, not `controls/`, because it is not a WKWebView semantic HTML control. |
| Resize handles | 1439-1491 | `wireResize` creates one `<div>` per edge, marks it `aria-hidden`, stores `data-edge`, and wires pointer capture plus resize lifecycle emits. | No existing `controls/` control maps to this. This should remain panel-window policy or become a new panel-specific resize-handle helper; generic controls do not expose pointer-region/edge-resize behavior. |

## Non-Findings

- No inline `<input>`, `<select>`, checkbox, toggle, segmented button group, text field, number field, or timer widget is created in `chrome.js`.
- `setControls(html)` at line 208 is an injection slot for caller-provided custom controls, not a widget implemented by `chrome.js`.
- The fallback minimized chip WebView is spawned from `chrome.js`, but its DOM lives in `packages/toolkit/panel/minimized-chip.html`, so its controls are outside this audit's requested source file.

## Summary

The reusable `controls/` package can cover the base button behavior for close,
minimize, and maximize, but the current controls do not yet model window-button
variants, pressed maximize state, or async in-flight minimize behavior. The
remaining interactive affordances are panel-window or DesktopWorld stage policy,
not ordinary app controls, and would need panel-specific helpers rather than new
generic controls.
