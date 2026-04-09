---
type: concept
name: Content Server
description: Local HTTP server for serving HTML assets to WKWebView canvases
tags: [infrastructure, http, content]
---

# Content Server

The daemon runs a local HTTP file server that serves HTML, CSS, and JavaScript files to WKWebView canvases. This eliminates the need to bundle multi-file web apps into single HTML files.

## URL Scheme

Canvases use `aos://` URLs which the daemon rewrites to `http://127.0.0.1:PORT/...` at canvas creation time.

Example: `aos://sigil/studio/index.html` resolves to the studio interface.

## Configuration

Content roots map URL prefixes to filesystem directories:

```bash
aos set content.roots.sigil apps/sigil
```

## Why

WKWebView in file:// mode blocks ES module imports and cross-origin CSS. The HTTP server bypasses these restrictions while keeping everything local.

## Related
- [Canvas System](../entities/canvas-system.md)
- [Daemon](../entities/daemon.md)
