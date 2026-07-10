@../../../AGENTS.md
@../AGENTS.md

# Toolkit Controls

`controls/` contains reusable app-control behavior for WKWebView surfaces. It
enhances ordinary semantic HTML controls; it does not own product state,
windowing, chrome, persistence, or app-specific workflows.

Controls should:

- attach to semantic HTML and dispatch normal DOM events;
- use shared toolkit theme tokens and remain app-themeable;
- preserve keyboard, pointer, and accessibility behavior;
- stay small enough that panels and workbenches can combine them without
  inheriting product assumptions.
- keep reusable dictation/text-entry state here so apps can opt into shared
  input behavior instead of forking private text-control guts.
- keep voice-envelope parsing fail closed; the only legacy dictation boundary
  is the exact flat bridge documented in `docs/api/toolkit/controls.md`.

Do not add a control here merely because one app needs it. Promote behavior to
`controls/` only when the same interaction should be reusable across AOS
surfaces.
