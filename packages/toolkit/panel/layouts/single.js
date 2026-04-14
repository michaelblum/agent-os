// single.js — one content, full panel body.
//
// Single(factory) returns a layout instance. mountPanel calls layout.mount(host)
// or otherwise dispatches based on layout.kind.

export function Single(factory) {
  return {
    kind: 'single',
    factory,
    instantiate() {
      // factory may be a function (call it) or already a Content object (use as-is).
      return typeof factory === 'function' ? factory() : factory
    },
  }
}
