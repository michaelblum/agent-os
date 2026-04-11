// bridge.js — WKWebView ↔ component bridge (ES module)
//
// Provides:
//   - esc(s): HTML-safe string escaping
//   - initBridge(handler): wire headsup.receive → handler(msg)
//   - postToHost(payload): send message to daemon via messageHandler

export function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function initBridge(handler) {
  if (window.webkit?.messageHandlers?.headsup) {
    window.headsup = {
      receive(b64) {
        try {
          const msg = JSON.parse(atob(b64));
          if (typeof handler === 'function') handler(msg);
        } catch (e) {
          console.error('bridge: decode error', e);
        }
      }
    };
  }
}

export function postToHost(payload) {
  window.webkit?.messageHandlers?.headsup?.postMessage(payload);
}
