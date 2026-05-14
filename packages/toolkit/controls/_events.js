export function createEventHub() {
  const listeners = new Map();
  return {
    on(type, callback) {
      if (typeof callback !== 'function') return () => {};
      const set = listeners.get(type) || new Set();
      set.add(callback);
      listeners.set(type, set);
      return () => set.delete(callback);
    },
    emit(type, payload) {
      for (const callback of listeners.get(type) || []) callback(payload);
    },
    clear() {
      listeners.clear();
    },
  };
}

export function dispatchDomEvent(el, type, detail = undefined) {
  const view = el?.ownerDocument?.defaultView || globalThis;
  const EventCtor = detail === undefined ? view.Event : view.CustomEvent;
  let event = null;
  if (typeof EventCtor === 'function') {
    try {
      event = detail === undefined
        ? new EventCtor(type, { bubbles: true })
        : new EventCtor(type, { bubbles: true, detail });
    } catch {
      event = null;
    }
  }
  el?.dispatchEvent?.(event || { type, bubbles: true, detail });
}

export function ownerDocument(options = {}) {
  const doc = options.document || globalThis.document;
  if (!doc?.createElement) {
    throw new Error('AOS toolkit controls require a DOM document');
  }
  return doc;
}
