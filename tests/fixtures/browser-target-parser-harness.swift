import Foundation

@main
struct BrowserTargetParserHarness {
    static func main() {
        let args = Array(CommandLine.arguments.dropFirst())
        guard args.count == 1 else {
            emitError(code: "UNKNOWN_ARG", message: "expected exactly one browser target")
        }

        do {
            let target = try parseBrowserTarget(args[0])
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            let data = try encoder.encode(target)
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data([0x0a]))
        } catch BrowserTargetError.missingSession {
            emitError(code: "MISSING_SESSION", message: "PLAYWRIGHT_CLI_SESSION not set")
        } catch BrowserTargetError.invalid(let message) {
            emitError(code: "INVALID_TARGET", message: message)
        } catch {
            emitError(code: "INTERNAL", message: String(describing: error))
        }
    }

    private static func emitError(code: String, message: String) -> Never {
        let payload = ["code": code, "error": message]
        let data = try! JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        FileHandle.standardError.write(data)
        FileHandle.standardError.write(Data([0x0a]))
        Foundation.exit(1)
    }
}
