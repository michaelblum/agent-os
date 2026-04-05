// bridge.js — Shared WKWebView ↔ component bridge.
//
// Inline this into component HTML files. Provides:
//   - headsup.receive(b64): base64 decode + JSON parse + dispatch to onHeadsupMessage(msg)
//   - esc(s): HTML-safe string escaping
//
// Components define: function onHeadsupMessage(msg) { ... }

function esc(s) {
  if (!s) return '';
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.headsup) {
  window.headsup = {
    receive: function(b64) {
      try {
        var msg = JSON.parse(atob(b64));
        if (typeof onHeadsupMessage === 'function') {
          onHeadsupMessage(msg);
        }
      } catch(e) {}
    }
  };
}
