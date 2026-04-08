# AOS Content Server (Serve Mode)

**Date:** 2026-04-08
**Status:** Draft
**Scope:** Built-in HTTP file server in the AOS daemon for serving HTML surfaces to WKWebView canvases

## Problem

WKWebView canvases load HTML content in two ways today:

1. **`loadHTMLString`** — inline HTML with `baseURL: nil`. ES module `import` statements fail because `file://` CORS blocks cross-file loads. Every surface must be manually bundled into a single HTML file. The live renderer (2,900 lines) was bundled this way. The studio (~7,500 lines across 20+ files) can't practically maintain a manual bundle.

2. **`loadURL`** — works with any HTTP URL, ES modules resolve correctly. But nothing serves the files. Consumers resort to ad-hoc workarounds (Python dev servers on `:3333`).

The daemon has a Unix socket for IPC but no HTTP capability. Every new surface (studio, settings, chat overlay, future apps) hits the same wall independently.

## Design

### What It Is

A lightweight HTTP file server embedded in the AOS daemon. When `aos serve` starts, it also starts an HTTP listener on localhost. Canvases use `loadURL("http://localhost:PORT/...")` to load multi-file HTML surfaces with working ES modules, relative imports, CSS links, and CDN scripts.

### What It Is Not

- Not a web framework — no routing, no middleware, no templating
- Not a public server — binds to `127.0.0.1` only
- Not a build system — serves files as-is from disk, no transpilation or bundling

### Architecture

The daemon gains a new module alongside perception, display, action, and voice:

```
UnifiedDaemon
  ├── perception    (PerceptionEngine)
  ├── display       (CanvasManager)
  ├── voice         (SpeechEngine)
  └── content       (ContentServer)    ← new
```

`ContentServer` is a peer module — it runs within `aos serve`, starts/stops with the daemon, and is configured via the same `config.json` mechanism.

### Content Roots

The server serves files from **content roots** — named directory mappings. Each root maps a URL prefix to a local directory:

```json
{
  "content": {
    "port": 0,
    "roots": {
      "sigil": "apps/sigil"
    }
  }
}
```

A request to `http://localhost:PORT/sigil/studio/index.html` resolves to `{aos_root}/apps/sigil/studio/index.html`.

**Root paths** are resolved relative to the AOS binary's root directory (repo root in repo mode, app bundle Resources in installed mode). Absolute paths are also accepted.

**Port `0`** means the OS assigns an available port. The daemon logs the assigned port at startup and exposes it via `aos content status` and the `ping` response. This avoids port conflicts. Consumers discover the port via the daemon, not hardcoded values.

### How Consumers Use It

A consumer (Sigil, future apps) creates a canvas pointing at the content server:

```bash
# Create a canvas loading the studio
aos show create --id studio \
  --url "http://localhost:$PORT/sigil/studio/index.html" \
  --at 100,100,800,600 \
  --interactive

# The live renderer — no more bundled HTML
aos show create --id avatar \
  --url "http://localhost:$PORT/sigil/renderer/index.html" \
  --at 0,0,1920,1080
```

The `toggle_url` config for the status item works the same way — point it at a content server URL instead of a bundled file.

No consumer needs to know how files are served. They get a URL, they use it. The daemon handles the rest.

### URL Convenience: `aos://` Prefix

To avoid hardcoding `localhost:PORT` in config files and canvas create calls, the daemon recognizes an `aos://` prefix and rewrites it to the content server's actual address:

- `aos://sigil/studio/index.html` → `http://127.0.0.1:PORT/sigil/studio/index.html`

This rewriting happens in `Canvas.loadURL()` and in config value resolution (e.g., `toggle_url`). The `aos://` prefix only works within the daemon process — it's not a real URL scheme.

### Implementation

**`ContentServer` class** (new file: `src/content/server.swift`):

- Uses `NWListener` (Network framework) to bind a TCP listener on `127.0.0.1`
- Handles HTTP/1.1 GET requests only (HEAD for completeness)
- Resolves URL path → content root → filesystem path
- Serves with correct `Content-Type` based on file extension (`.html`, `.js`, `.css`, `.json`, `.glsl`, `.png`, `.svg`, `.woff2`)
- Returns 404 for missing files, 403 for directory traversal attempts (`../`)
- No caching headers (local development; WKWebView manages its own cache)

**MIME types** (minimal set for web content):

| Extension | Content-Type |
|-----------|-------------|
| `.html` | `text/html; charset=utf-8` |
| `.js`, `.mjs` | `application/javascript; charset=utf-8` |
| `.css` | `text/css; charset=utf-8` |
| `.json` | `application/json; charset=utf-8` |
| `.svg` | `image/svg+xml` |
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.woff2` | `font/woff2` |
| `.glsl` | `text/plain; charset=utf-8` |
| `*` (fallback) | `application/octet-stream` |

**Security:**

- Binds to `127.0.0.1` only — not reachable from the network
- Path traversal blocked: resolved paths must be within the content root directory after symlink resolution
- No directory listings
- No CGI, no script execution, no request body processing

**Integration with `UnifiedDaemon.start()`:**

```
1. Start Unix socket (existing)
2. Start ContentServer on 127.0.0.1:0        ← new
3. Log assigned port to stderr
4. Start perception, display, voice (existing)
5. Accept connections (existing)
```

**New daemon action** — `content_status`:

Returns the content server's address and registered roots. Available via the Unix socket like other daemon actions:

```json
{"action": "content_status"}
→ {"status": "ok", "address": "127.0.0.1", "port": 8492, "roots": {"sigil": "apps/sigil"}}
```

**New CLI command** — `aos content status`:

```bash
aos content status --json
→ {"address": "127.0.0.1", "port": 8492, "roots": {"sigil": "apps/sigil"}}
```

### Config

New top-level config section:

```json
{
  "content": {
    "port": 0,
    "roots": {
      "sigil": "apps/sigil"
    }
  }
}
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `content.port` | int | `0` | Port for content server (`0` = OS-assigned) |
| `content.roots` | dict | `{}` | Named content roots: prefix → directory path |

Hot-reloadable via `ConfigWatcher` — adding a root makes it immediately available without daemon restart.

### What Changes for Existing Surfaces

**Live renderer** (`apps/sigil/renderer/index.html`):
- Currently a 2,900-line manually bundled single file
- Can be un-bundled back to ES modules (state.js, geometry.js, colors.js, etc.)
- `toggle_url` in config changes from a file path to `aos://sigil/renderer/index.html`
- The bundled version continues to work as-is during transition

**Studio** (`apps/sigil/studio/index.html`):
- No bundling needed — ES modules work over HTTP
- Canvas creation uses `aos://sigil/studio/index.html`

**Future surfaces** (settings, chat overlay, agent toolkit):
- Same pattern: drop HTML/CSS/JS in a directory, register a content root, create a canvas with the URL

### What This Replaces

- Manual single-file bundling of HTML surfaces
- Ad-hoc Python/Node dev servers for local testing
- `loadHTMLString` with `baseURL: nil` as the primary content loading path
- Per-surface workarounds for ES module CORS

### Dependencies

- **Network framework** (`import Network`) — already available on macOS 10.14+, ships with the OS. No external dependencies.

### Deferred

- **Live reload / file watching**: The content server could watch served directories and notify canvases when files change. Useful for development but not needed for v1.
- **Runtime root registration**: A daemon action to register content roots dynamically (without config file). Useful when a consumer wants to serve its own content directory at startup. Can be added later.
- **HTTPS**: Not needed for localhost.
