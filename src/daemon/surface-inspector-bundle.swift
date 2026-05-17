import AppKit
import Foundation

private let surfaceInspectorBundleCanvasID = "surface-inspector"
private let canvasInspectorBundleCanvasIDs = [surfaceInspectorBundleCanvasID]
private let canvasInspectorBundleDebounceSeconds: TimeInterval = 0.75

private struct CanvasInspectorBundleResolvedInclude {
    let captureImage: Bool
    let captureMetadata: Bool
    let inspectorState: Bool
    let annotationSnapshot: Bool
    let displayGeometry: Bool
    let canvasList: Bool
    let xray: Bool

    var requiresCapture: Bool {
        captureImage || captureMetadata || xray
    }

    var asDictionary: [String: Bool] {
        [
            "capture_image": captureImage,
            "capture_metadata": captureMetadata,
            "inspector_state": inspectorState,
            "annotation_snapshot": annotationSnapshot,
            "display_geometry": displayGeometry,
            "canvas_list": canvasList,
            "xray": xray,
        ]
    }
}

private struct CanvasInspectorBundleRuntimeConfig {
    let hotkey: String?
    let outputMode: String
    let include: CanvasInspectorBundleResolvedInclude

    var shortcutLabel: String {
        hotkey ?? "disabled"
    }

    var copiesClipboardPayload: Bool {
        outputMode == "clipboard_payload"
    }
}

private struct CanvasInspectorBundleCaptureFailure: Error {
    let phase: String
    let code: String
    let message: String
    let exitCode: Int32

    var asDictionary: [String: Any] {
        [
            "phase": phase,
            "code": code,
            "message": message,
            "exit_code": Int(exitCode),
        ]
    }
}

extension UnifiedDaemon {
    func maybeHandleCanvasInspectorAnnotationHotkey(event: String, data: [String: Any]) -> Bool {
        guard event == "key_down", canvasInspectorAnnotationHotkeyMatches(data) else {
            return false
        }
        openCanvasInspectorForAnnotationMode()
        return true
    }

    private func openCanvasInspectorForAnnotationMode() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let canvasID = self.currentCanvasInspectorBundleCanvasID() ?? surfaceInspectorBundleCanvasID
            if self.canvasManager.hasCanvas(canvasID) {
                if self.canvasManager.canvas(forID: canvasID)?.suspended == true {
                    var resume = CanvasRequest(action: "resume")
                    resume.id = canvasID
                    _ = self.canvasManager.handle(resume)
                }
            } else {
                var request = CanvasRequest(action: "create")
                request.id = canvasID
                request.url = self.resolveContentURL("aos://toolkit/components/surface-inspector/index.html")
                request.at = self.defaultCanvasInspectorFrame()
                request.interactive = true
                request.focus = true
                request.suspended = false
                _ = self.canvasManager.handle(request)
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                self.canvasManager.postMessageAsync(canvasID: canvasID, payload: [
                    "type": "canvas_inspector.annotation_toggle",
                    "reason": "shortcut",
                ])
            }
        }
    }

    private func defaultCanvasInspectorFrame() -> [CGFloat] {
        guard let screen = NSScreen.main ?? NSScreen.screens.first else {
            return [1120, 40, 360, 520]
        }
        let visible = screen.visibleFrame
        let screenHeight = screen.frame.height
        let width = min(CGFloat(360.0), max(CGFloat(320.0), visible.width * 0.26))
        let height = min(CGFloat(520.0), max(CGFloat(420.0), visible.height * 0.55))
        let x = visible.origin.x + visible.width - width - 20.0
        let y = screenHeight - visible.origin.y - visible.height + 20.0
        return [x, y, width, height]
    }

    func maybeHandleCanvasInspectorSeeBundleHotkey(event: String, data: [String: Any]) -> Bool {
        guard event == "key_down",
              let canvasID = currentCanvasInspectorBundleCanvasID(),
              canvasInspectorBundleHotkeyMatches(data) else {
            return false
        }
        triggerCanvasInspectorSeeBundle(
            sourceCanvasID: canvasID,
            trigger: "hotkey"
        )
        return true
    }

    func triggerCanvasInspectorSeeBundle(sourceCanvasID: String, trigger: String) {
        guard canvasInspectorBundleCanvasIDs.contains(sourceCanvasID),
              canvasExists(sourceCanvasID) else {
            return
        }
        let runtimeConfig = resolvedCanvasInspectorBundleConfig()

        let startResult = beginCanvasInspectorBundleCapture()
        switch startResult {
        case .missing:
            return
        case .busy:
            postCanvasInspectorSeeBundleStatus(
                canvasID: sourceCanvasID,
                status: "pending",
                message: "see bundle already in flight",
                trigger: trigger,
                runtimeConfig: runtimeConfig
            )
            return
        case .started:
            postCanvasInspectorSeeBundleStatus(
                canvasID: sourceCanvasID,
                status: "pending",
                message: "capturing see bundle...",
                trigger: trigger,
                runtimeConfig: runtimeConfig
            )
        }

        DispatchQueue.global(qos: .utility).async { [weak self] in
            self?.performCanvasInspectorSeeBundleExport(
                canvasID: sourceCanvasID,
                trigger: trigger,
                runtimeConfig: runtimeConfig
            )
        }
    }

    func sendCanvasInspectorSeeBundleConfig(canvasID: String) {
        guard canvasInspectorBundleCanvasIDs.contains(canvasID), canvasExists(canvasID) else { return }
        let runtimeConfig = resolvedCanvasInspectorBundleConfig()
        let message = runtimeConfig.hotkey == nil
            ? "bundle hotkey disabled"
            : "bundle \(runtimeConfig.shortcutLabel)"
        postCanvasInspectorSeeBundleStatus(
            canvasID: canvasID,
            status: "idle",
            message: message,
            trigger: "config",
            runtimeConfig: runtimeConfig
        )
    }

    private enum CanvasInspectorBundleStartResult {
        case missing
        case busy
        case started
    }

    private func beginCanvasInspectorBundleCapture() -> CanvasInspectorBundleStartResult {
        canvasInspectorBundleLock.lock()
        defer { canvasInspectorBundleLock.unlock() }

        guard currentCanvasInspectorBundleCanvasID() != nil else {
            return .missing
        }

        let now = Date()
        if canvasInspectorBundleInFlight ||
            now.timeIntervalSince(canvasInspectorBundleLastTriggerAt) < canvasInspectorBundleDebounceSeconds {
            return .busy
        }

        canvasInspectorBundleInFlight = true
        canvasInspectorBundleLastTriggerAt = now
        return .started
    }

    private func finishCanvasInspectorBundleCapture() {
        canvasInspectorBundleLock.lock()
        canvasInspectorBundleInFlight = false
        canvasInspectorBundleLock.unlock()
    }

    private func performCanvasInspectorSeeBundleExport(
        canvasID: String,
        trigger: String,
        runtimeConfig: CanvasInspectorBundleRuntimeConfig
    ) {
        defer { finishCanvasInspectorBundleCapture() }

        let createdAt = iso8601Now()
        if runtimeConfig.copiesClipboardPayload {
            performCanvasInspectorSeeBundleClipboardPayloadExport(
                canvasID: canvasID,
                trigger: trigger,
                runtimeConfig: runtimeConfig,
                createdAt: createdAt
            )
            return
        }

        let bundleDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("aos-surface-inspector-see-bundle-\(UUID().uuidString)")
        let captureImageURL = bundleDir.appendingPathComponent("capture.png")
        let captureJSONURL = bundleDir.appendingPathComponent("capture.json")
        let xrayJSONURL = bundleDir.appendingPathComponent("xray.json")
        let stateJSONURL = bundleDir.appendingPathComponent("inspector-state.json")
        let annotationSnapshotJSONURL = bundleDir.appendingPathComponent("annotation-snapshot.json")
        let displayGeometryURL = bundleDir.appendingPathComponent("display-geometry.json")
        let canvasListURL = bundleDir.appendingPathComponent("canvas-list.json")
        let bundleJSONURL = bundleDir.appendingPathComponent("bundle.json")

        do {
            try FileManager.default.createDirectory(at: bundleDir, withIntermediateDirectories: true, attributes: nil)

            let canvasList = snapshotCanvasList()
            guard let canvasInfo = canvasList.first(where: { $0.id == canvasID }) else {
                throw NSError(
                    domain: "AOSCanvasInspectorBundle",
                    code: 4,
                    userInfo: [NSLocalizedDescriptionKey: "Canvas '\(canvasID)' not found"]
                )
            }

            var files: [String: String] = [:]

            if runtimeConfig.include.inspectorState {
                let inspectorState = snapshotCanvasInspectorState(canvasID: canvasID)
                try writeJSONValue(inspectorState, to: stateJSONURL)
                files["inspector_state_json"] = stateJSONURL.lastPathComponent
            }

            if runtimeConfig.include.annotationSnapshot {
                let assets: [String: Any] = [
                    "capture_json": runtimeConfig.include.captureMetadata ? captureJSONURL.lastPathComponent : NSNull(),
                    "capture_image": runtimeConfig.include.captureImage ? captureImageURL.lastPathComponent : NSNull(),
                    "display_geometry_json": runtimeConfig.include.displayGeometry ? displayGeometryURL.lastPathComponent : NSNull(),
                    "canvas_list_json": runtimeConfig.include.canvasList ? canvasListURL.lastPathComponent : NSNull(),
                    "inspector_state_json": runtimeConfig.include.inspectorState ? stateJSONURL.lastPathComponent : NSNull(),
                ]
                let annotationSnapshot = snapshotCanvasInspectorAnnotationSnapshot(
                    canvasID: canvasID,
                    trigger: trigger,
                    capturedAt: createdAt,
                    canvasAt: canvasInfo.at,
                    assets: assets
                )
                try writeJSONValue(annotationSnapshot, to: annotationSnapshotJSONURL)
                files["annotation_snapshot_json"] = annotationSnapshotJSONURL.lastPathComponent
            }

            if runtimeConfig.include.displayGeometry {
                let displayGeometry = snapshotDisplayGeometryForBundle()
                try writeJSONValue(displayGeometry, to: displayGeometryURL)
                files["display_geometry_json"] = displayGeometryURL.lastPathComponent
            }

            if runtimeConfig.include.canvasList {
                try writeEncodableJSON(canvasList, to: canvasListURL)
                files["canvas_list_json"] = canvasListURL.lastPathComponent
            }

            if runtimeConfig.include.requiresCapture {
                let captureResult = try runCanvasInspectorSeeCapture(
                    canvasInfo: canvasInfo,
                    outputPath: captureImageURL.path,
                    includeXray: runtimeConfig.include.xray
                )
                if runtimeConfig.include.captureMetadata {
                    try writeJSONValue(captureResult, to: captureJSONURL)
                    files["capture_json"] = captureJSONURL.lastPathComponent
                }
                if runtimeConfig.include.captureImage,
                   FileManager.default.fileExists(atPath: captureImageURL.path) {
                    files["capture_image"] = captureImageURL.lastPathComponent
                } else if FileManager.default.fileExists(atPath: captureImageURL.path) {
                    try? FileManager.default.removeItem(at: captureImageURL)
                }
                if runtimeConfig.include.xray {
                    let xrayPayload: [String: Any] = [
                        "captured_at": createdAt,
                        "canvas_id": canvasID,
                        "canvas_at": canvasInfo.at,
                        "elements": captureResult["elements"] as? [Any] ?? [],
                    ]
                    try writeJSONValue(xrayPayload, to: xrayJSONURL)
                    files["xray_json"] = xrayJSONURL.lastPathComponent
                }
            }

            let manifest: [String: Any] = [
                "kind": "canvas_inspector_see_bundle",
                "status": "success",
                "created_at": createdAt,
                "trigger": trigger,
                "shortcut": runtimeConfig.shortcutLabel,
                "canvas_id": canvasID,
                "canvas_at": canvasInfo.at,
                "bundle_path": bundleDir.path,
                "bundle_json_path": bundleJSONURL.path,
                "config": [
                    "output": ["mode": runtimeConfig.outputMode],
                    "include": runtimeConfig.include.asDictionary,
                ],
                "files": files,
            ]
            var finalManifest = manifest
            if let hotkey = runtimeConfig.hotkey {
                if var config = finalManifest["config"] as? [String: Any] {
                    config["hotkey"] = hotkey
                    finalManifest["config"] = config
                }
            } else if var config = finalManifest["config"] as? [String: Any] {
                config["hotkey"] = NSNull()
                finalManifest["config"] = config
            }
            try writeJSONValue(finalManifest, to: bundleJSONURL)
            copyStringToClipboard(bundleDir.path)
            postCanvasInspectorSeeBundleStatus(
                canvasID: canvasID,
                status: "success",
                message: "see bundle copied to clipboard",
                bundlePath: bundleDir.path,
                bundleJSONPath: bundleJSONURL.path,
                trigger: trigger,
                runtimeConfig: runtimeConfig
            )
        } catch {
            let bundleError: [String: Any]
            let message: String
            if let captureFailure = error as? CanvasInspectorBundleCaptureFailure {
                bundleError = captureFailure.asDictionary
                message = "see bundle failed during \(captureFailure.phase): \(captureFailure.message)"
            } else {
                bundleError = [
                    "phase": "bundle_export",
                    "code": "BUNDLE_EXPORT_FAILED",
                    "message": String(describing: error),
                ]
                message = "see bundle failed: \(error)"
            }
            var bundlePath: String? = nil
            var bundleJSONPath: String? = nil
            if FileManager.default.fileExists(atPath: bundleDir.path) {
                bundlePath = bundleDir.path
                bundleJSONPath = bundleJSONURL.path
                let errorManifest: [String: Any] = [
                    "kind": "canvas_inspector_see_bundle",
                    "status": "error",
                    "created_at": createdAt,
                    "trigger": trigger,
                    "shortcut": runtimeConfig.shortcutLabel,
                    "canvas_id": canvasID,
                    "bundle_path": bundleDir.path,
                    "bundle_json_path": bundleJSONURL.path,
                    "config": [
                        "output": ["mode": runtimeConfig.outputMode],
                        "include": runtimeConfig.include.asDictionary,
                    ],
                    "error": bundleError,
                ]
                var finalErrorManifest = errorManifest
                if var config = finalErrorManifest["config"] as? [String: Any] {
                    if let hotkey = runtimeConfig.hotkey {
                        config["hotkey"] = hotkey
                    } else {
                        config["hotkey"] = NSNull()
                    }
                    finalErrorManifest["config"] = config
                }
                try? writeJSONValue(finalErrorManifest, to: bundleJSONURL)
                copyStringToClipboard(bundleDir.path)
            }
            postCanvasInspectorSeeBundleStatus(
                canvasID: canvasID,
                status: "error",
                message: message,
                bundlePath: bundlePath,
                bundleJSONPath: bundleJSONPath,
                error: bundleError,
                trigger: trigger,
                runtimeConfig: runtimeConfig
            )
        }
    }

    private func performCanvasInspectorSeeBundleClipboardPayloadExport(
        canvasID: String,
        trigger: String,
        runtimeConfig: CanvasInspectorBundleRuntimeConfig,
        createdAt: String
    ) {
        let canvasList = snapshotCanvasList()
        guard let canvasInfo = canvasList.first(where: { $0.id == canvasID }) else {
            let error: [String: Any] = [
                "phase": "clipboard_payload_export",
                "code": "CANVAS_NOT_FOUND",
                "message": "Canvas '\(canvasID)' not found",
            ]
            postCanvasInspectorSeeBundleStatus(
                canvasID: canvasID,
                status: "error",
                message: "see bundle clipboard payload failed: Canvas '\(canvasID)' not found",
                error: error,
                trigger: trigger,
                runtimeConfig: runtimeConfig
            )
            return
        }

        var payload: [String: Any] = [
            "kind": "canvas_inspector_see_bundle_clipboard_payload",
            "status": "success",
            "created_at": createdAt,
            "trigger": trigger,
            "shortcut": runtimeConfig.shortcutLabel,
            "source_canvas_id": canvasID,
            "canvas_at": canvasInfo.at,
            "config": [
                "hotkey": runtimeConfig.hotkey as Any? ?? NSNull(),
                "output": ["mode": runtimeConfig.outputMode],
                "include": runtimeConfig.include.asDictionary,
            ],
            "artifacts": [
                "capture_image": skippedClipboardArtifact("capture_image", enabled: runtimeConfig.include.captureImage),
                "capture_metadata": skippedClipboardArtifact("capture_metadata", enabled: runtimeConfig.include.captureMetadata),
                "xray": skippedClipboardArtifact("xray", enabled: runtimeConfig.include.xray),
            ],
        ]

        if runtimeConfig.include.inspectorState {
            payload["inspector_state"] = snapshotCanvasInspectorState(canvasID: canvasID)
        }
        if runtimeConfig.include.displayGeometry {
            payload["display_geometry"] = snapshotDisplayGeometryForBundle()
        }
        if runtimeConfig.include.canvasList {
            payload["canvas_list"] = canvasList.map { canvasInfoDictionary($0) }
        }
        if runtimeConfig.include.annotationSnapshot {
            let assets: [String: Any] = [
                "capture_json": NSNull(),
                "capture_image": NSNull(),
                "display_geometry_json": NSNull(),
                "canvas_list_json": NSNull(),
                "inspector_state_json": NSNull(),
                "clipboard_payload": true,
            ]
            payload["surface_inspector_annotation_snapshot"] = snapshotCanvasInspectorAnnotationSnapshot(
                canvasID: canvasID,
                trigger: trigger,
                capturedAt: createdAt,
                canvasAt: canvasInfo.at,
                assets: assets
            )
        }

        do {
            let payloadText = try jsonPayloadString(payload)
            guard !containsEmbeddedImageData(payloadText) else {
                throw NSError(
                    domain: "AOSCanvasInspectorBundle",
                    code: 5,
                    userInfo: [NSLocalizedDescriptionKey: "Clipboard payload contains embedded image data"]
                )
            }
            copyStringToClipboard(payloadText)
            postCanvasInspectorSeeBundleStatus(
                canvasID: canvasID,
                status: "success",
                message: "see bundle JSON copied to clipboard",
                trigger: trigger,
                runtimeConfig: runtimeConfig
            )
        } catch {
            let bundleError: [String: Any] = [
                "phase": "clipboard_payload_export",
                "code": "CLIPBOARD_PAYLOAD_EXPORT_FAILED",
                "message": String(describing: error),
            ]
            postCanvasInspectorSeeBundleStatus(
                canvasID: canvasID,
                status: "error",
                message: "see bundle clipboard payload failed: \(error)",
                error: bundleError,
                trigger: trigger,
                runtimeConfig: runtimeConfig
            )
        }
    }

    private func skippedClipboardArtifact(_ name: String, enabled: Bool) -> [String: Any] {
        [
            "status": enabled ? "skipped" : "disabled",
            "reason": enabled
                ? "\(name) requires disk-backed capture files and is not embedded in clipboard payload mode"
                : "disabled by include config",
        ]
    }

    private func canvasInfoDictionary(_ canvas: CanvasInfo) -> [String: Any] {
        [
            "id": canvas.id,
            "at": canvas.at,
            "anchor_window": canvas.anchorWindow ?? NSNull(),
            "anchor_channel": canvas.anchorChannel ?? NSNull(),
            "offset": canvas.offset ?? NSNull(),
            "interactive": canvas.interactive,
            "window_level": canvas.windowLevel ?? NSNull(),
            "ttl": canvas.ttl ?? NSNull(),
            "scope": canvas.scope ?? NSNull(),
            "auto_project": canvas.autoProject ?? NSNull(),
            "track": canvas.track ?? NSNull(),
            "parent": canvas.parent ?? NSNull(),
            "cascade": canvas.cascade ?? NSNull(),
            "suspended": canvas.suspended ?? NSNull(),
            "lifecycle_state": canvas.lifecycleState ?? NSNull(),
            "window_numbers": canvas.windowNumbers ?? NSNull(),
        ]
    }

    private func snapshotCanvasInspectorState(canvasID: String) -> [String: Any] {
        let js = """
        JSON.stringify((() => ({
          captured_at: new Date().toISOString(),
          text: document.body?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
          state: window.__canvasInspectorState ?? null
        }))())
        """

        var response = CanvasResponse.fail("eval unavailable", code: "EVAL_UNAVAILABLE")
        DispatchQueue.main.sync {
            response = canvasManager.handle(CanvasRequest(action: "eval", id: canvasID, js: js))
        }

        guard let raw = response.result,
              let data = raw.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data, options: []),
              let dict = parsed as? [String: Any] else {
            return [
                "captured_at": iso8601Now(),
                "error": response.error ?? response.result ?? "Failed to read inspector state",
            ]
        }
        return dict
    }

    private func snapshotCanvasInspectorAnnotationSnapshot(
        canvasID: String,
        trigger: String,
        capturedAt: String,
        canvasAt: [CGFloat],
        assets: [String: Any]
    ) -> [String: Any] {
        let assetsJSON: String
        if JSONSerialization.isValidJSONObject(assets),
           let data = try? JSONSerialization.data(withJSONObject: assets, options: [.sortedKeys]),
           let encoded = String(data: data, encoding: .utf8) {
            assetsJSON = encoded
        } else {
            assetsJSON = "{}"
        }
        let js = """
        JSON.stringify((() => {
          const options = {
            captured_at: \(jsStringLiteral(capturedAt)),
            trigger: \(jsStringLiteral(trigger)),
            source_canvas_id: \(jsStringLiteral(canvasID)),
            surface_inspector_frame: \(jsonString(canvasAt)),
            assets: \(assetsJSON)
          };
          if (window.__canvasInspectorDebug?.buildAnnotationSnapshotArtifact) {
            return window.__canvasInspectorDebug.buildAnnotationSnapshotArtifact(options);
          }
          const state = window.__canvasInspectorState?.annotation ?? null;
          return {
            schema: "surface_inspector_annotation_snapshot",
            version: "0.1.0",
            capture: options,
            active_context: {
              current_scope_id: state?.current_scope_id ?? "root",
              root_id: "root",
              root_kind: "surface_root",
              root_label: "main",
              adapter_id: "",
              subject_id: "",
              subject_path: [],
              display_space_rect: null,
              local_space_rect: null,
              source_metadata: {}
            },
            selection: {
              active_edge_id: state?.active_edge_id ?? "",
              active_frame_id: state?.active_frame_id ?? "",
              current_scope_id: state?.current_scope_id ?? "root",
              frame_path_pin_ids: []
            },
            annotation_mode: state?.annotation_mode ?? { active: false },
            empty_state: !state || ((state.pins ?? []).length === 0 && (state.comments ?? []).length === 0),
            pins: state?.pins ?? [],
            comments: state?.comments ?? [],
            hover_candidate: state?.last_hover_candidate ?? null,
            projection_capabilities: state?.projection_capabilities ?? [],
            adapter_capability_summary: state?.adapter_capability_summary ?? [],
            blockers: {
              last_projection_blocker: state?.last_projection_blocker ?? null,
              unsupported_stale_absent: state?.unsupported_stale_absent_blockers ?? []
            },
            reveal: {
              last_request: state?.last_reveal_request ?? null,
              last_result: state?.last_reveal_result ?? null
            },
            annotation_scope_stack: state?.annotation_scope_stack ?? [],
            source_state: {
              schema: state?.schema ?? "surface_inspector_annotation_state",
              version: state?.version ?? "0.1.0",
              snapshot_version: state?.snapshot_version ?? 0
            }
          };
        })())
        """

        var response = CanvasResponse.fail("eval unavailable", code: "EVAL_UNAVAILABLE")
        DispatchQueue.main.sync {
            response = canvasManager.handle(CanvasRequest(action: "eval", id: canvasID, js: js))
        }

        guard let raw = response.result,
              let data = raw.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data, options: []),
              let dict = parsed as? [String: Any] else {
            return [
                "schema": "surface_inspector_annotation_snapshot",
                "version": "0.1.0",
                "capture": [
                    "captured_at": capturedAt,
                    "trigger": trigger,
                    "source_canvas_id": canvasID,
                    "surface_inspector_frame": canvasAt,
                    "assets": assets,
                ],
                "active_context": [
                    "current_scope_id": "root",
                    "root_id": "root",
                    "root_kind": "surface_root",
                    "root_label": "main",
                    "adapter_id": "",
                    "subject_id": "",
                    "subject_path": [],
                    "display_space_rect": NSNull(),
                    "local_space_rect": NSNull(),
                    "source_metadata": [:],
                ],
                "selection": [
                    "active_edge_id": "",
                    "active_frame_id": "",
                    "current_scope_id": "root",
                    "frame_path_pin_ids": [],
                ],
                "annotation_mode": ["active": false],
                "empty_state": true,
                "pins": [],
                "comments": [],
                "hover_candidate": NSNull(),
                "projection_capabilities": [],
                "adapter_capability_summary": [],
                "blockers": [
                    "last_projection_blocker": NSNull(),
                    "unsupported_stale_absent": [],
                ],
                "reveal": [
                    "last_request": NSNull(),
                    "last_result": NSNull(),
                ],
                "annotation_scope_stack": [],
                "source_state": [
                    "schema": "surface_inspector_annotation_state",
                    "version": "0.1.0",
                    "snapshot_version": 0,
                    "error": response.error ?? response.result ?? "Failed to read annotation snapshot",
                ],
            ]
        }
        return dict
    }

    private func snapshotCanvasList() -> [CanvasInfo] {
        var response = CanvasResponse.ok()
        DispatchQueue.main.sync {
            response = canvasManager.handle(CanvasRequest(action: "list"))
        }
        return response.canvases ?? []
    }

    private func snapshotDisplayGeometryForBundle() -> [String: Any] {
        if Thread.isMainThread {
            return snapshotDisplayGeometry()
        }
        var payload: [String: Any] = [:]
        DispatchQueue.main.sync {
            payload = snapshotDisplayGeometry()
        }
        return payload
    }

    private func runCanvasInspectorSeeCapture(
        canvasInfo: CanvasInfo,
        outputPath: String,
        includeXray: Bool
    ) throws -> [String: Any] {
        let region = canvasInfo.at
            .map { String(format: "%.3f", Double($0)) }
            .joined(separator: ",")
        var arguments = [
            "see", "capture",
            "--region", region,
            "--perception",
            "--out", outputPath,
        ]
        if includeXray {
            arguments.insert("--xray", at: arguments.count - 2)
        }
        let process = runProcess(
            aosExpectedBinaryPath(program: "aos", mode: aosCurrentRuntimeMode()),
            arguments: arguments,
            environment: canvasInspectorSeeCaptureEnvironment()
        )

        guard process.exitCode == 0 else {
            let parsed = parseCanvasInspectorSeeCaptureError(process.stderr)
            throw CanvasInspectorBundleCaptureFailure(
                phase: parsed.phase,
                code: parsed.code,
                message: parsed.message.isEmpty ? "see capture exited with code \(process.exitCode)" : parsed.message,
                exitCode: process.exitCode
            )
        }

        guard let data = process.stdout.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data, options: []),
              let dict = parsed as? [String: Any] else {
            throw NSError(
                domain: "AOSCanvasInspectorBundle",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Failed to decode see capture response"]
            )
        }
        return dict
    }

    private func canvasInspectorSeeCaptureEnvironment() -> [String: String] {
        var environment: [String: String] = [
            "AOS_RUNTIME_MODE": aosCurrentRuntimeMode().rawValue,
            // This child is launched by an already-ready daemon-owned capture
            // request. Skip only the CLI onboarding marker gate so actual
            // ScreenCaptureKit permission remains checked by captureCommand().
            "AOS_BYPASS_PERMISSIONS_SETUP": "1",
        ]
        if aosHasExplicitStateRootOverride() {
            environment["AOS_STATE_ROOT"] = aosStateRoot()
        }
        return environment
    }

    private func parseCanvasInspectorSeeCaptureError(_ stderr: String) -> (phase: String, code: String, message: String) {
        let trimmed = stderr.trimmingCharacters(in: .whitespacesAndNewlines)
        let fallback = trimmed.isEmpty ? "see capture failed" : trimmed
        guard let data = trimmed.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data, options: []),
              let dict = parsed as? [String: Any] else {
            return ("capture_process", "SEE_CAPTURE_FAILED", fallback)
        }

        let code = dict["code"] as? String ?? "SEE_CAPTURE_FAILED"
        let message = dict["error"] as? String ?? fallback
        let phase: String
        switch code {
        case "PERMISSIONS_SETUP_REQUIRED":
            phase = "child_cli_permissions_setup_preflight"
        case "PERMISSION_DENIED":
            phase = "screen_capture_permission"
        case "CAPTURE_BUSY":
            phase = "screen_capture_lock"
        default:
            phase = "capture_process"
        }
        return (phase, code, message)
    }

    private func postCanvasInspectorSeeBundleStatus(
        canvasID: String,
        status: String,
        message: String,
        bundlePath: String? = nil,
        bundleJSONPath: String? = nil,
        error: [String: Any]? = nil,
        trigger: String,
        runtimeConfig: CanvasInspectorBundleRuntimeConfig
    ) {
        var inner: [String: Any] = [
            "status": status,
            "message": message,
            "trigger": trigger,
            "at": iso8601Now(),
            "shortcut": runtimeConfig.shortcutLabel,
            "output_mode": runtimeConfig.outputMode,
            "include": runtimeConfig.include.asDictionary,
        ]
        if let hotkey = runtimeConfig.hotkey {
            inner["hotkey"] = hotkey
        } else {
            inner["hotkey"] = NSNull()
        }
        if let bundlePath {
            inner["bundle_path"] = bundlePath
        }
        if let bundleJSONPath {
            inner["bundle_json_path"] = bundleJSONPath
        }
        if let error {
            inner["error"] = error
        }
        let payload: [String: Any] = [
            "type": "canvas_inspector.see_bundle_status",
            "payload": inner,
        ]
        DispatchQueue.main.async { [weak self] in
            self?.canvasManager.postMessageAsync(canvasID: canvasID, payload: payload)
        }
    }

    private func copyStringToClipboard(_ value: String) {
        let apply = {
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setString(value, forType: .string)
        }
        if Thread.isMainThread {
            apply()
        } else {
            DispatchQueue.main.sync(execute: apply)
        }
    }

    private func writeJSONValue(_ value: Any, to url: URL) throws {
        guard JSONSerialization.isValidJSONObject(value) else {
            throw NSError(
                domain: "AOSCanvasInspectorBundle",
                code: 3,
                userInfo: [NSLocalizedDescriptionKey: "Invalid JSON payload for \(url.lastPathComponent)"]
            )
        }
        let data = try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: url)
    }

    private func jsonPayloadString(_ value: Any) throws -> String {
        guard JSONSerialization.isValidJSONObject(value) else {
            throw NSError(
                domain: "AOSCanvasInspectorBundle",
                code: 3,
                userInfo: [NSLocalizedDescriptionKey: "Invalid JSON clipboard payload"]
            )
        }
        let data = try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
        guard let text = String(data: data, encoding: .utf8) else {
            throw NSError(
                domain: "AOSCanvasInspectorBundle",
                code: 6,
                userInfo: [NSLocalizedDescriptionKey: "Failed to encode JSON clipboard payload"]
            )
        }
        return text
    }

    private func containsEmbeddedImageData(_ text: String) -> Bool {
        text.range(of: "data:image/", options: [.caseInsensitive]) != nil
    }

    private func writeEncodableJSON<T: Encodable>(_ value: T, to url: URL) throws {
        let data = Data(jsonString(value).utf8)
        try data.write(to: url)
    }

    private func canvasInspectorBundleHotkeyMatches(_ data: [String: Any]) -> Bool {
        let runtimeConfig = resolvedCanvasInspectorBundleConfig()
        guard let combo = runtimeConfig.hotkey else { return false }
        return hotkeyDataMatches(data, combo: combo)
    }

    private func canvasInspectorAnnotationHotkeyMatches(_ data: [String: Any]) -> Bool {
        hotkeyDataMatches(data, combo: "ctrl+opt+a")
    }

    private func hotkeyDataMatches(_ data: [String: Any], combo: String) -> Bool {
        let keyCode: Int64
        if let raw = data["keyCode"] as? NSNumber {
            keyCode = raw.int64Value
        } else if let raw = data["key_code"] as? NSNumber {
            keyCode = raw.int64Value
        } else if let raw = data["keyCode"] as? Int {
            keyCode = Int64(raw)
        } else if let raw = data["key_code"] as? Int {
            keyCode = Int64(raw)
        } else {
            return false
        }

        guard let expected = normalizeHotkeyCombo(combo) else { return false }
        let parts = expected.split(separator: "+").map(String.init)
        guard let keyName = parts.last,
              let expectedKeyCode = keyCodeMap[keyName] else { return false }
        guard keyCode == Int64(expectedKeyCode) else { return false }

        let flags = data["flags"] as? [String: Any] ?? [:]
        let expectedModifiers = Set(parts.dropLast())
        for modifier in canonicalHotkeyModifierOrder {
            let actual = (flags[modifier] as? Bool) ?? false
            if actual != expectedModifiers.contains(modifier) {
                return false
            }
        }
        return true
    }

    private func resolvedCanvasInspectorBundleConfig() -> CanvasInspectorBundleRuntimeConfig {
        let config = effectiveCanvasInspectorBundleConfig(currentConfig)
        let include = config.include
        return CanvasInspectorBundleRuntimeConfig(
            hotkey: config.hotkey,
            outputMode: config.output?.mode ?? "bundle_path",
            include: CanvasInspectorBundleResolvedInclude(
                captureImage: include?.capture_image ?? true,
                captureMetadata: include?.capture_metadata ?? true,
                inspectorState: include?.inspector_state ?? true,
                annotationSnapshot: include?.annotation_snapshot ?? true,
                displayGeometry: include?.display_geometry ?? true,
                canvasList: include?.canvas_list ?? true,
                xray: include?.xray ?? false
            )
        )
    }

    private func canvasExists(_ canvasID: String) -> Bool {
        if Thread.isMainThread {
            return canvasManager.canvas(forID: canvasID) != nil
        }
        var exists = false
        DispatchQueue.main.sync {
            exists = canvasManager.canvas(forID: canvasID) != nil
        }
        return exists
    }

    private func currentCanvasInspectorBundleCanvasID() -> String? {
        for canvasID in canvasInspectorBundleCanvasIDs where canvasExists(canvasID) {
            return canvasID
        }
        return nil
    }
}
