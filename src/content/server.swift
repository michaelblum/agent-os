// content/server.swift — Lightweight HTTP file server for local content
//
// Serves static files from named content roots over localhost.
// Used by WKWebView canvases to load multi-file HTML surfaces
// (ES modules, CSS imports, etc.) without bundling.

import Foundation
import Network

class ContentServer {
    private var listener: NWListener?
    private let roots: [String: String]  // URL prefix -> absolute directory path
    private let stateDir: String?        // writable directory for POST (state persistence)
    let port: NWEndpoint.Port
    var assignedPort: UInt16 = 0

    init(config: AosConfig.ContentConfig?, repoRoot: String?, stateDir: String? = nil) {
        self.stateDir = stateDir
        let cfg = config ?? AosConfig.ContentConfig(port: 0, roots: [:])
        self.port = cfg.port == 0 ? .any : NWEndpoint.Port(rawValue: UInt16(cfg.port))!

        // Resolve root paths: relative paths resolve against repo root
        var resolved: [String: String] = [:]
        for (prefix, path) in cfg.roots {
            if path.hasPrefix("/") {
                resolved[prefix] = path
            } else if let root = repoRoot {
                resolved[prefix] = (root as NSString).appendingPathComponent(path)
            } else {
                fputs("Warning: content root '\(prefix)' has relative path '\(path)' but no repo root found — skipping\n", stderr)
            }
        }
        self.roots = resolved
    }

    func start() {
        guard !roots.isEmpty else {
            fputs("Content server: no roots configured, skipping\n", stderr)
            return
        }

        let params = NWParameters.tcp
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: port)

        do {
            listener = try NWListener(using: params)
        } catch {
            fputs("Content server: failed to create listener: \(error)\n", stderr)
            return
        }

        listener?.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                if let port = self?.listener?.port?.rawValue {
                    self?.assignedPort = port
                    fputs("Content server listening on http://127.0.0.1:\(port)/\n", stderr)
                    for (prefix, dir) in self?.roots ?? [:] {
                        fputs("  /\(prefix)/ → \(dir)\n", stderr)
                    }
                }
            case .failed(let error):
                fputs("Content server failed: \(error)\n", stderr)
                self?.listener?.cancel()
            default:
                break
            }
        }

        listener?.newConnectionHandler = { [weak self] connection in
            self?.handleConnection(connection)
        }

        listener?.start(queue: DispatchQueue(label: "aos.content-server"))
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    // MARK: - Connection Handling

    private func handleConnection(_ connection: NWConnection) {
        connection.start(queue: DispatchQueue(label: "aos.content-conn"))
        receiveUntilComplete(connection: connection, accumulated: Data())
    }

    /// Accumulate bytes until we have the full HTTP request (headers + body).
    ///
    /// Clients like WKWebView `fetch()` commonly send the request line +
    /// headers in one TCP segment and the body in a second segment; a single
    /// `connection.receive` call sees only the first segment, so PUT/POST
    /// bodies arrive empty. We parse headers as soon as we see `\r\n\r\n`,
    /// extract Content-Length, and keep reading until we have `contentLength`
    /// bytes of body (or zero if no Content-Length header, which is valid for
    /// GET/HEAD/DELETE).
    private func receiveUntilComplete(connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self = self else {
                connection.cancel()
                return
            }
            if let error = error {
                fputs("Content server: receive error: \(error)\n", stderr)
                connection.cancel()
                return
            }
            var buf = accumulated
            if let data = data, !data.isEmpty {
                buf.append(data)
            }

            // Look for end-of-headers
            let sep = Data([0x0D, 0x0A, 0x0D, 0x0A])  // \r\n\r\n
            guard let sepRange = buf.range(of: sep) else {
                if isComplete {
                    // Connection closed before we got a full header.
                    connection.cancel()
                    return
                }
                // Headers not fully received yet — keep reading.
                self.receiveUntilComplete(connection: connection, accumulated: buf)
                return
            }

            let headerBytes = buf.subdata(in: 0..<sepRange.lowerBound)
            let bodyStart = sepRange.upperBound
            let bodySoFar = buf.count - bodyStart

            // Parse Content-Length out of the headers (case-insensitive).
            var contentLength = 0
            if let headerStr = String(data: headerBytes, encoding: .utf8) {
                for line in headerStr.components(separatedBy: "\r\n") {
                    let parts = line.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
                    guard parts.count == 2 else { continue }
                    if parts[0].lowercased() == "content-length" {
                        contentLength = Int(parts[1].trimmingCharacters(in: .whitespaces)) ?? 0
                        break
                    }
                }
            }

            if bodySoFar < contentLength {
                if isComplete {
                    // Peer closed early; give up with what we have.
                    self.finishRequest(connection: connection, request: buf)
                    return
                }
                self.receiveUntilComplete(connection: connection, accumulated: buf)
                return
            }

            // Full request received — process it.
            self.finishRequest(connection: connection, request: buf)
        }
    }

    private func finishRequest(connection: NWConnection, request buf: Data) {
        let request = String(data: buf, encoding: .utf8) ?? ""
        let response = self.handleHTTPRequest(request)
        connection.send(content: response, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    // MARK: - HTTP Request Processing

    private func handleHTTPRequest(_ raw: String) -> Data {
        let lines = raw.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else {
            return httpResponse(status: 400, statusText: "Bad Request", body: "Bad Request")
        }

        let parts = requestLine.split(separator: " ", maxSplits: 2)
        guard parts.count >= 2 else {
            return httpResponse(status: 400, statusText: "Bad Request", body: "Bad Request")
        }

        let method = String(parts[0])
        guard method == "GET" || method == "HEAD" || method == "POST" || method == "PUT" || method == "DELETE" else {
            return httpResponse(status: 405, statusText: "Method Not Allowed", body: "Method Not Allowed")
        }

        let rawPath = String(parts[1])
        let path = rawPath.components(separatedBy: "?").first ?? rawPath

        guard let decoded = path.removingPercentEncoding else {
            return httpResponse(status: 400, statusText: "Bad Request", body: "Bad path encoding")
        }

        if decoded.contains("..") {
            return httpResponse(status: 403, statusText: "Forbidden", body: "Forbidden")
        }

        let trimmed = decoded.hasPrefix("/") ? String(decoded.dropFirst()) : decoded
        guard !trimmed.isEmpty else {
            return httpResponse(status: 404, statusText: "Not Found", body: "Not Found")
        }

        let segments = trimmed.split(separator: "/", maxSplits: 1)
        let prefix = String(segments[0])

        // _state prefix: writable state directory for persistence
        if prefix == "_state" {
            guard let dir = stateDir else {
                return httpResponse(status: 404, statusText: "Not Found", body: "State directory not configured")
            }
            let relativePath = segments.count > 1 ? String(segments[1]) : ""
            guard !relativePath.isEmpty else {
                return httpResponse(status: 400, statusText: "Bad Request", body: "Missing file path")
            }
            let filePath = (dir as NSString).appendingPathComponent(relativePath)
            let resolvedPath = (filePath as NSString).standardizingPath
            let resolvedDir = (dir as NSString).standardizingPath
            guard resolvedPath.hasPrefix(resolvedDir) else {
                return httpResponse(status: 403, statusText: "Forbidden", body: "Forbidden")
            }

            if method == "POST" {
                // Extract body after blank line
                guard let bodyData = extractBody(raw) else {
                    return httpResponse(status: 400, statusText: "Bad Request", body: "No body")
                }
                // Ensure parent directory exists
                let parentDir = (resolvedPath as NSString).deletingLastPathComponent
                try? FileManager.default.createDirectory(atPath: parentDir, withIntermediateDirectories: true)
                do {
                    try bodyData.write(to: URL(fileURLWithPath: resolvedPath))
                    return httpResponse(status: 200, statusText: "OK", body: "OK")
                } catch {
                    return httpResponse(status: 500, statusText: "Internal Server Error", body: "Write failed: \(error.localizedDescription)")
                }
            }

            // GET/HEAD on state file
            guard FileManager.default.fileExists(atPath: resolvedPath),
                  let fileData = FileManager.default.contents(atPath: resolvedPath) else {
                return httpResponse(status: 404, statusText: "Not Found", body: "Not Found")
            }
            let mimeType = mimeTypeForExtension((resolvedPath as NSString).pathExtension)
            return httpResponse(status: 200, statusText: "OK", contentType: mimeType, body: method == "HEAD" ? nil : fileData)
        }

        // wiki prefix: read/write from the state wiki directory
        if prefix == "wiki" {
            guard let dir = stateDir else {
                return httpResponse(status: 404, statusText: "Not Found", body: "State directory not configured")
            }
            let wikiRoot = (dir as NSString).appendingPathComponent("wiki")
            let relativePath = segments.count > 1 ? String(segments[1]) : ""
            guard !relativePath.isEmpty, !relativePath.contains(".."), !relativePath.hasPrefix("/") else {
                return httpResponse(status: 400, statusText: "Bad Request", body: "Invalid wiki path")
            }
            let filePath = (wikiRoot as NSString).appendingPathComponent(relativePath)
            let resolvedPath = (filePath as NSString).standardizingPath
            let resolvedRoot = (wikiRoot as NSString).standardizingPath
            guard resolvedPath == resolvedRoot || resolvedPath.hasPrefix(resolvedRoot + "/") else {
                return httpResponse(status: 403, statusText: "Forbidden", body: "Forbidden")
            }

            // Directory listing: /wiki/<dir>/ → JSON listing of entries.
            // Only GET/HEAD supported; no write semantics on directories.
            if decoded.hasSuffix("/") {
                guard method == "GET" || method == "HEAD" else {
                    return httpResponse(status: 405, statusText: "Method Not Allowed", body: "Method not allowed on directory")
                }
                var isDir: ObjCBool = false
                guard FileManager.default.fileExists(atPath: resolvedPath, isDirectory: &isDir), isDir.boolValue else {
                    return httpResponse(status: 404, statusText: "Not Found", body: "Directory not found")
                }
                let children = (try? FileManager.default.contentsOfDirectory(atPath: resolvedPath)) ?? []
                struct Entry: Codable { let name: String; let kind: String }
                let entries: [Entry] = children.sorted().compactMap { name in
                    if name.hasPrefix(".") { return nil }
                    let childPath = (resolvedPath as NSString).appendingPathComponent(name)
                    var childIsDir: ObjCBool = false
                    FileManager.default.fileExists(atPath: childPath, isDirectory: &childIsDir)
                    return Entry(name: name, kind: childIsDir.boolValue ? "dir" : "file")
                }
                struct Listing: Codable { let path: String; let entries: [Entry] }
                let cleanPath = relativePath.hasSuffix("/") ? String(relativePath.dropLast()) : relativePath
                let payload = Listing(path: cleanPath, entries: entries)
                do {
                    let data = try JSONEncoder().encode(payload)
                    return httpResponse(status: 200, statusText: "OK", contentType: "application/json", body: method == "HEAD" ? nil : data)
                } catch {
                    return httpResponse(status: 500, statusText: "Internal Server Error", body: "Failed to encode listing")
                }
            }

            switch method {
            case "GET", "HEAD":
                guard FileManager.default.fileExists(atPath: resolvedPath),
                      let fileData = FileManager.default.contents(atPath: resolvedPath) else {
                    return httpResponse(status: 404, statusText: "Not Found", body: "Not Found: \(decoded)")
                }
                let mimeType = mimeTypeForExtension((resolvedPath as NSString).pathExtension)
                return httpResponse(status: 200, statusText: "OK", contentType: mimeType, body: method == "HEAD" ? nil : fileData)

            case "PUT":
                guard let bodyData = extractBodyAllowingEmpty(raw) else {
                    return httpResponse(status: 400, statusText: "Bad Request", body: "Malformed request (no header/body separator)")
                }
                let parentDir = (resolvedPath as NSString).deletingLastPathComponent
                try? FileManager.default.createDirectory(atPath: parentDir, withIntermediateDirectories: true)
                let isNew = !FileManager.default.fileExists(atPath: resolvedPath)
                do {
                    try bodyData.write(to: URL(fileURLWithPath: resolvedPath))
                    WikiIndexHooks.reindex(path: relativePath)
                    WikiChangeBus.shared.emit(path: relativePath, op: isNew ? .created : .updated)
                    return httpResponse(status: 200, statusText: "OK", body: "OK")
                } catch {
                    return httpResponse(status: 500, statusText: "Internal Server Error", body: "Write failed: \(error.localizedDescription)")
                }

            case "DELETE":
                guard FileManager.default.fileExists(atPath: resolvedPath) else {
                    return httpResponse(status: 404, statusText: "Not Found", body: "Not Found")
                }
                do {
                    try FileManager.default.removeItem(atPath: resolvedPath)
                    WikiIndexHooks.remove(path: relativePath)
                    WikiChangeBus.shared.emit(path: relativePath, op: .deleted)
                    return httpResponse(status: 200, statusText: "OK", body: "OK")
                } catch {
                    return httpResponse(status: 500, statusText: "Internal Server Error", body: "Delete failed: \(error.localizedDescription)")
                }

            default:
                return httpResponse(status: 405, statusText: "Method Not Allowed", body: "Method Not Allowed")
            }
        }

        // Only GET/HEAD allowed on content roots; POST is _state-only,
        // PUT/DELETE is wiki-only (both already handled/returned above).
        guard method == "GET" || method == "HEAD" else {
            return httpResponse(status: 405, statusText: "Method Not Allowed", body: "Method not allowed on this path")
        }

        guard let rootDir = roots[prefix] else {
            return httpResponse(status: 404, statusText: "Not Found", body: "Unknown content root: \(prefix)")
        }

        let relativePath = segments.count > 1 ? String(segments[1]) : "index.html"
        let filePath = (rootDir as NSString).appendingPathComponent(relativePath)

        let resolvedPath = (filePath as NSString).standardizingPath
        let resolvedRoot = (rootDir as NSString).standardizingPath
        guard resolvedPath.hasPrefix(resolvedRoot) else {
            return httpResponse(status: 403, statusText: "Forbidden", body: "Forbidden")
        }

        guard FileManager.default.fileExists(atPath: resolvedPath),
              let fileData = FileManager.default.contents(atPath: resolvedPath) else {
            return httpResponse(status: 404, statusText: "Not Found", body: "Not Found: \(decoded)")
        }

        let mimeType = mimeTypeForExtension((resolvedPath as NSString).pathExtension)
        let isHead = method == "HEAD"

        return httpResponse(status: 200, statusText: "OK", contentType: mimeType, body: isHead ? nil : fileData)
    }

    // MARK: - HTTP Response Building

    private func httpResponse(status: Int, statusText: String, body: String) -> Data {
        httpResponse(status: status, statusText: statusText, contentType: "text/plain; charset=utf-8", body: body.data(using: .utf8))
    }

    private func httpResponse(status: Int, statusText: String, contentType: String, body: Data?) -> Data {
        let bodyLen = body?.count ?? 0
        var header = "HTTP/1.1 \(status) \(statusText)\r\n"
        header += "Content-Type: \(contentType)\r\n"
        header += "Content-Length: \(bodyLen)\r\n"
        header += "Connection: close\r\n"
        header += "Access-Control-Allow-Origin: *\r\n"
        header += "\r\n"

        var response = header.data(using: .utf8)!
        if let body = body {
            response.append(body)
        }
        return response
    }

    // MARK: - Body Extraction

    private func extractBody(_ raw: String) -> Data? {
        // HTTP body starts after the first blank line (\r\n\r\n)
        guard let range = raw.range(of: "\r\n\r\n") else { return nil }
        let body = String(raw[range.upperBound...])
        guard !body.isEmpty else { return nil }
        return body.data(using: .utf8)
    }

    /// Like `extractBody` but preserves the distinction between
    /// "no header/body separator" (nil) and "empty body" (Data()).
    /// PUT semantics allow writing zero-byte files.
    private func extractBodyAllowingEmpty(_ raw: String) -> Data? {
        guard let range = raw.range(of: "\r\n\r\n") else { return nil }
        let body = String(raw[range.upperBound...])
        return body.data(using: .utf8) ?? Data()
    }

    // MARK: - MIME Types

    private func mimeTypeForExtension(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm":  return "text/html; charset=utf-8"
        case "js", "mjs":    return "application/javascript; charset=utf-8"
        case "css":          return "text/css; charset=utf-8"
        case "json":         return "application/json; charset=utf-8"
        case "svg":          return "image/svg+xml"
        case "png":          return "image/png"
        case "jpg", "jpeg":  return "image/jpeg"
        case "gif":          return "image/gif"
        case "woff2":        return "font/woff2"
        case "woff":         return "font/woff"
        case "glsl":         return "text/plain; charset=utf-8"
        case "wasm":         return "application/wasm"
        default:             return "application/octet-stream"
        }
    }

    // MARK: - Status

    func statusDict() -> [String: Any] {
        return [
            "address": "127.0.0.1",
            "port": Int(assignedPort),
            "roots": roots
        ]
    }
}
