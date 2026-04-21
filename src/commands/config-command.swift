// config.swift — aos config [get|set]: discoverable config surface

import Foundation

private enum ConfigLookupResult {
    case found(Any?)
    case unknown
}

private func lookupConfigValue(key: String, config: AosConfig) -> ConfigLookupResult {
    switch key {
    case "voice.enabled":
        return .found(config.voice.enabled)
    case "voice.announce_actions":
        return .found(config.voice.announce_actions)
    case "voice.voice":
        return .found(config.voice.voice)
    case "voice.rate":
        return .found(config.voice.rate)
    case "voice.policies.final_response.style":
        return .found(config.voice.policies?.final_response?.style)
    case "voice.policies.final_response.last_n_chars":
        return .found(config.voice.policies?.final_response?.last_n_chars)
    case "voice.controls.cancel.key_code":
        return .found(config.voice.controls?.cancel?.key_code)
    case "perception.default_depth":
        return .found(config.perception.default_depth)
    case "perception.settle_threshold_ms":
        return .found(config.perception.settle_threshold_ms)
    case "feedback.visual":
        return .found(config.feedback.visual)
    case "feedback.sound":
        return .found(config.feedback.sound)
    case "content.port":
        return .found(config.content?.port)
    case _ where key.hasPrefix("content.roots."):
        let rootName = String(key.dropFirst("content.roots.".count))
        guard !rootName.isEmpty else { return .unknown }
        return .found(config.content?.roots[rootName])
    case "status_item.enabled":
        return .found(config.status_item?.enabled)
    case "status_item.toggle_id":
        return .found(config.status_item?.toggle_id)
    case "status_item.toggle_url":
        return .found(config.status_item?.toggle_url)
    case "status_item.toggle_track":
        return .found(config.status_item?.toggle_track)
    case "status_item.icon":
        return .found(config.status_item?.icon)
    case "hotkeys.cancel_speech":
        return .found(config.hotkeys?.cancel_speech)
    case "see.canvas_inspector_bundle":
        let bundle = effectiveCanvasInspectorBundleConfig(config)
        let include = bundle.include
        let includeDict: [String: Any] = [
            "capture_image": include?.capture_image ?? false,
            "capture_metadata": include?.capture_metadata ?? false,
            "inspector_state": include?.inspector_state ?? false,
            "display_geometry": include?.display_geometry ?? false,
            "canvas_list": include?.canvas_list ?? false,
            "xray": include?.xray ?? false,
        ]
        let hotkey: Any = bundle.hotkey ?? NSNull()
        return .found([
            "hotkey": hotkey,
            "include": includeDict,
        ])
    case "see.canvas_inspector_bundle.hotkey":
        return .found(effectiveCanvasInspectorBundleConfig(config).hotkey)
    case "see.canvas_inspector_bundle.include.capture_image":
        return .found(effectiveCanvasInspectorBundleConfig(config).include?.capture_image)
    case "see.canvas_inspector_bundle.include.capture_metadata":
        return .found(effectiveCanvasInspectorBundleConfig(config).include?.capture_metadata)
    case "see.canvas_inspector_bundle.include.inspector_state":
        return .found(effectiveCanvasInspectorBundleConfig(config).include?.inspector_state)
    case "see.canvas_inspector_bundle.include.display_geometry":
        return .found(effectiveCanvasInspectorBundleConfig(config).include?.display_geometry)
    case "see.canvas_inspector_bundle.include.canvas_list":
        return .found(effectiveCanvasInspectorBundleConfig(config).include?.canvas_list)
    case "see.canvas_inspector_bundle.include.xray":
        return .found(effectiveCanvasInspectorBundleConfig(config).include?.xray)
    default:
        return .unknown
    }
}

private func printConfigLookupValue(_ value: Any?, jsonMode: Bool) {
    if jsonMode {
        switch value {
        case nil:
            print("null")
        case let string as String:
            print(jsStringLiteral(string))
        case let bool as Bool:
            print(bool ? "true" : "false")
        case let number as NSNumber:
            print(number.stringValue)
        default:
            guard JSONSerialization.isValidJSONObject(value as Any),
                  let data = try? JSONSerialization.data(withJSONObject: value as Any, options: [.prettyPrinted, .sortedKeys]),
                  let text = String(data: data, encoding: .utf8) else {
                exitError("Failed to encode config value", code: "SERIALIZATION_ERROR")
            }
            print(text)
        }
        return
    }

    switch value {
    case nil:
        print("null")
    case let string as String:
        print(string)
    case let bool as Bool:
        print(bool ? "true" : "false")
    case let number as NSNumber:
        print(number.stringValue)
    default:
        guard JSONSerialization.isValidJSONObject(value as Any),
              let data = try? JSONSerialization.data(withJSONObject: value as Any, options: [.prettyPrinted, .sortedKeys]),
              let text = String(data: data, encoding: .utf8) else {
            exitError("Failed to encode config value", code: "SERIALIZATION_ERROR")
        }
        print(text)
    }
}

private func configGetCommand(args: [String]) {
    let jsonMode = args.contains("--json")
    let filteredArgs = args.filter { $0 != "--json" && $0 != "--help" && $0 != "-h" }

    guard let key = filteredArgs.first else {
        exitError("Usage: aos config get <key>", code: "MISSING_ARG")
    }
    guard filteredArgs.count == 1 else {
        exitError("Usage: aos config get <key>", code: "USAGE")
    }

    let config = loadConfig()
    switch lookupConfigValue(key: key, config: config) {
    case .found(let value):
        printConfigLookupValue(value, jsonMode: jsonMode)
    case .unknown:
        exitError("Unknown config key: \(key)", code: "UNKNOWN_KEY")
    }
}

func configCommand(args: [String]) {
    if args.contains("--help") || args.contains("-h") {
        if let subcommand = args.first(where: { !$0.hasPrefix("-") }) {
            printCommandHelp(["config", subcommand], json: args.contains("--json"))
        } else {
            printCommandHelp(["config"], json: args.contains("--json"))
        }
        exit(0)
    }

    guard let subcommand = args.first else {
        print(jsonString(loadConfig()))
        return
    }

    let subArgs = Array(args.dropFirst())
    switch subcommand {
    case "get":
        configGetCommand(args: subArgs)
    case "set":
        setCommand(args: subArgs)
    default:
        exitError("Unknown config subcommand: \(subcommand)", code: "UNKNOWN_COMMAND")
    }
}
