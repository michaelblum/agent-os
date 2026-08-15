import Foundation

enum BrowserAdapterError: Error {
    case subprocess(String, code: String)
    case invalidTarget(String)
}

private func broker(_ operation: String, session: String, input: [String: Any] = [:]) throws -> [String: Any] {
    do { return try managedBrowserBrokerRequest(operation: operation, session: session, input: input) }
    catch let error as ManagedBrowserBrokerError {
        throw BrowserAdapterError.subprocess(error.message, code: error.code)
    }
}

func seeCaptureScreenshot(target: BrowserTarget, outPath: String) throws -> String {
    guard target.ref == nil else {
        throw BrowserAdapterError.invalidTarget("browser ref screenshots remain unsupported")
    }
    let response = try broker("screenshot", session: target.session)
    guard let encoded = response["base64"] as? String,
          let bytes = Data(base64Encoded: encoded), !bytes.isEmpty else {
        throw BrowserAdapterError.subprocess("managed screenshot bytes are invalid", code: "BROWSER_BROKER_OUTPUT_INVALID")
    }
    do { try bytes.write(to: URL(fileURLWithPath: outPath), options: .atomic) }
    catch { throw BrowserAdapterError.subprocess("screenshot output could not be written", code: "SCREENSHOT_WRITE_FAILED") }
    return outPath
}

func seeCaptureXray(target: BrowserTarget, withBounds _: Bool) throws -> [AXElementJSON] {
    guard target.ref == nil else {
        throw BrowserAdapterError.invalidTarget("browser ref capture remains unsupported")
    }
    let response = try broker("snapshot", session: target.session)
    guard let markdown = response["markdown"] as? String else {
        throw BrowserAdapterError.subprocess("managed snapshot is invalid", code: "BROWSER_BROKER_OUTPUT_INVALID")
    }
    return parseSnapshotMarkdown(markdown)
}
