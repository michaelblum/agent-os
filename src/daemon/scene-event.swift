import Foundation

private let aosSceneCancellationReasons = Set([
    "escape",
    "owner_disconnected",
    "pointer_cancelled",
    "resource_changed",
    "resource_removed",
    "resource_suspended",
    "stage_disposed",
    "topology_changed",
])

private func aosSceneExactKeys(_ value: [String: Any], _ keys: Set<String>) -> Bool {
    return Set(value.keys) == keys
}

private func aosSceneFiniteNumber(_ value: Any?) -> Double? {
    guard !(value is Bool), let number = value as? NSNumber else { return nil }
    let result = number.doubleValue
    return result.isFinite ? result : nil
}

private func aosSceneInteger(_ value: Any?, minimum: Int = Int.min, maximum: Int = Int.max) -> Int? {
    guard let number = aosSceneFiniteNumber(value), number.rounded() == number,
          number >= Double(minimum), number <= Double(maximum) else { return nil }
    return Int(number)
}

private func aosSceneString(_ value: Any?, maximum: Int) -> String? {
    guard let value = value as? String, !value.isEmpty, value.count <= maximum else { return nil }
    return value
}

private func aosSceneIdentifier(_ value: Any?, allowSlash: Bool) -> String? {
    guard let value = aosSceneString(value, maximum: 128) else { return nil }
    let scalars = Array(value.unicodeScalars)
    func alphaNumeric(_ scalar: UnicodeScalar) -> Bool {
        return (scalar.value >= 97 && scalar.value <= 122)
            || (scalar.value >= 48 && scalar.value <= 57)
    }
    guard let first = scalars.first, alphaNumeric(first) else { return nil }
    guard scalars.allSatisfy({ scalar in
        alphaNumeric(scalar)
            || scalar == "."
            || scalar == "_"
            || scalar == "-"
            || (allowSlash && scalar == "/")
    }) else { return nil }
    if allowSlash && value.split(separator: "/", omittingEmptySubsequences: false).contains(where: {
        $0.isEmpty || $0 == "." || $0 == ".."
    }) { return nil }
    return value
}

private func aosSceneNullablePoint(_ value: Any?) -> Bool {
    if value is NSNull { return true }
    guard let point = value as? [String: Any],
          aosSceneExactKeys(point, ["x", "y"]),
          aosSceneFiniteNumber(point["x"]) != nil,
          aosSceneFiniteNumber(point["y"]) != nil else { return false }
    return true
}

private func aosSceneGesture(_ value: Any?) -> Bool {
    guard let gesture = value as? [String: Any],
          aosSceneExactKeys(gesture, ["id", "kind", "phase", "pointerSessionId", "cancellationReason"]),
          aosSceneString(gesture["id"], maximum: 256) != nil,
          let kind = gesture["kind"] as? String,
          ["tap", "drag", "long_press", "radial"].contains(kind),
          let phase = gesture["phase"] as? String,
          ["start", "update", "end", "cancel"].contains(phase) else { return false }
    if !(gesture["pointerSessionId"] is NSNull)
        && aosSceneString(gesture["pointerSessionId"], maximum: 256) == nil { return false }
    if phase == "cancel" {
        guard let reason = gesture["cancellationReason"] as? String,
              aosSceneCancellationReasons.contains(reason) else { return false }
    } else if !(gesture["cancellationReason"] is NSNull) { return false }
    return true
}

private func aosSceneCoordinates(_ value: Any?) -> Bool {
    let keys = Set(["origin", "previous", "current", "desktopWorld", "native", "delta", "totalDelta"])
    guard let coordinates = value as? [String: Any], aosSceneExactKeys(coordinates, keys) else { return false }
    return keys.allSatisfy { aosSceneNullablePoint(coordinates[$0]) }
}

private func aosSceneTopology(_ value: Any?) -> Bool {
    if value is NSNull { return true }
    guard let topology = value as? [String: Any],
          aosSceneExactKeys(topology, ["displays"]),
          let displays = topology["displays"] as? [Any], displays.count <= 16 else { return false }
    for value in displays {
        guard let display = value as? [String: Any],
              aosSceneExactKeys(display, ["displayId", "index", "bounds"]) else { return false }
        let displayID = display["displayId"]
        if !(displayID is NSNull)
            && aosSceneInteger(displayID) == nil
            && aosSceneString(displayID, maximum: 128) == nil { return false }
        if !(display["index"] is NSNull)
            && aosSceneInteger(display["index"], minimum: 0, maximum: 1024) == nil { return false }
        if !(display["bounds"] is NSNull) {
            guard let bounds = display["bounds"] as? [Any], bounds.count == 4,
                  bounds.allSatisfy({ aosSceneFiniteNumber($0) != nil }) else { return false }
        }
    }
    return true
}

private func aosSceneAppliedFields(_ response: [String: Any], allowed: Set<String>) -> Bool {
    guard Set(response.keys).isSubset(of: allowed) else { return false }
    if let applied = response["applied"], !(applied is Bool) { return false }
    if let revision = response["revision"], aosSceneInteger(revision, minimum: 0) == nil { return false }
    return true
}

private func aosSceneResponse(_ value: Any?) -> Bool {
    guard let response = value as? [String: Any], let kind = response["kind"] as? String else { return false }
    switch kind {
    case "translate":
        let required = Set(["kind", "objectId", "position"])
        guard required.isSubset(of: Set(response.keys)),
              aosSceneAppliedFields(response, allowed: required.union(["applied", "revision"])),
              aosSceneIdentifier(response["objectId"], allowSlash: true) != nil,
              let position = response["position"] as? [Any], position.count == 3,
              position.allSatisfy({ aosSceneFiniteNumber($0) != nil }) else { return false }
    case "aim_commit":
        let required = Set(["kind", "objectId", "origin", "pointer", "position", "angle", "distance", "route"])
        guard required.isSubset(of: Set(response.keys)),
              aosSceneAppliedFields(response, allowed: required.union(["applied", "revision"])),
              aosSceneIdentifier(response["objectId"], allowSlash: true) != nil,
              aosSceneNullablePoint(response["origin"]), aosSceneNullablePoint(response["pointer"]),
              let position = response["position"] as? [Any], position.count == 3,
              position.allSatisfy({ aosSceneFiniteNumber($0) != nil }),
              aosSceneFiniteNumber(response["angle"]) != nil,
              let distance = aosSceneFiniteNumber(response["distance"]), distance >= 0,
              let route = response["route"] as? String, ["line", "wormhole"].contains(route) else { return false }
    case "drop":
        let required = Set(["kind", "objectId", "point"])
        guard required.isSubset(of: Set(response.keys)),
              aosSceneAppliedFields(response, allowed: required.union(["applied", "revision"])),
              aosSceneIdentifier(response["objectId"], allowSlash: true) != nil,
              aosSceneNullablePoint(response["point"]) else { return false }
    case "signal_graph":
        let required = Set(["kind", "signals"])
        guard required.isSubset(of: Set(response.keys)),
              aosSceneAppliedFields(response, allowed: required.union(["appliedSignals", "revision"])),
              let signals = response["signals"] as? [Any], signals.count <= 32 else { return false }
        if let count = response["appliedSignals"], aosSceneInteger(count, minimum: 0, maximum: 32) == nil { return false }
        for value in signals {
            guard let signal = value as? [String: Any],
                  aosSceneExactKeys(signal, ["signalId", "value"]),
                  aosSceneIdentifier(signal["signalId"], allowSlash: true) != nil,
                  aosSceneFiniteNumber(signal["value"]) != nil else { return false }
        }
    default:
        return false
    }
    return true
}

func aosCanonicalSceneEvent(_ event: [String: Any]) -> [String: Any]? {
    let keys = Set([
        "contract", "schemaVersion", "type", "sequence", "stageId", "ownerId", "resourceId",
        "affordanceId", "interactionId", "gesture", "coordinates", "topology", "response", "at",
    ])
    guard aosSceneExactKeys(event, keys),
          event["contract"] as? String == "aos.scene.event.v1",
          aosSceneInteger(event["schemaVersion"], minimum: 1, maximum: 1) == 1,
          event["type"] as? String == "gesture",
          aosSceneInteger(event["sequence"], minimum: 1) != nil,
          event["stageId"] as? String == "desktop-world/main",
          aosSceneIdentifier(event["ownerId"], allowSlash: false) != nil,
          aosSceneIdentifier(event["resourceId"], allowSlash: true) != nil,
          aosSceneIdentifier(event["affordanceId"], allowSlash: true) != nil,
          aosSceneIdentifier(event["interactionId"], allowSlash: true) != nil,
          aosSceneGesture(event["gesture"]),
          aosSceneCoordinates(event["coordinates"]),
          aosSceneTopology(event["topology"]),
          aosSceneResponse(event["response"]),
          let at = aosSceneFiniteNumber(event["at"]), at >= 0 else { return nil }
    return event
}
