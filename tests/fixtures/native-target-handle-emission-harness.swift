import Foundation

struct Bounds: Codable {
    let x: Int
    let y: Int
    let width: Int
    let height: Int
}

struct AOSDisplayTopologySnapshot: Codable {}

enum JSONValue: String, Codable {
    case null
}

struct NativeTargetHandleEmissionResult: Encodable {
    let missing_role: TargetHandleJSON?
    let normalized_handle: TargetHandleJSON?
}

@main
struct NativeTargetHandleEmissionHarness {
    static func main() throws {
        let result = NativeTargetHandleEmissionResult(
            missing_role: TargetHandleJSON.nativeAX(
                pid: 42, windowID: nil, role: "", title: "Save", label: nil, identifier: nil
            ),
            normalized_handle: TargetHandleJSON.nativeAX(
                pid: 42, windowID: 7, role: "AXButton", title: "", label: "", identifier: ""
            )
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        FileHandle.standardOutput.write(try encoder.encode(result))
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
}
