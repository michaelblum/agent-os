import Foundation
import Metal

@main
struct DesktopPixelMetalPipelineTests {
    static func main() throws {
        guard CommandLine.arguments.count == 2 else {
            preconditionFailure("expected native baseline Metal source path")
        }
        let sourcePath = CommandLine.arguments[1]
        let swiftSource = try String(contentsOfFile: sourcePath, encoding: .utf8)
        let opening = "private let aosDesktopPixelNativeBaselineShader = #\"\"\""
        guard let openingRange = swiftSource.range(of: opening) else {
            preconditionFailure("native baseline shader opening marker is missing")
        }
        let remainder = swiftSource[openingRange.upperBound...]
        guard let closingRange = remainder.range(of: "\"\"\"#") else {
            preconditionFailure("native baseline shader closing marker is missing")
        }
        let metalSource = String(remainder[..<closingRange.lowerBound])
        guard let device = MTLCreateSystemDefaultDevice() else {
            preconditionFailure("Metal device is unavailable")
        }
        let library = try device.makeLibrary(source: metalSource, options: nil)
        precondition(library.makeFunction(name: "desktopPixelBaselineVertex") != nil)
        precondition(library.makeFunction(name: "desktopPixelBaselineFragment") != nil)
        print("PASS desktop pixel Metal shader compilation")
    }
}
