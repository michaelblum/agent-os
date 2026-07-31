import Foundation

func aosSchemeOriginalURLResponse(_ response: URLResponse, requestURL: URL) -> URLResponse {
    if let http = response as? HTTPURLResponse {
        var headers = http.allHeaderFields.reduce(into: [String: String]()) { result, entry in
            guard let key = entry.key as? String else { return }
            guard key.caseInsensitiveCompare("Cache-Control") != .orderedSame,
                  key.caseInsensitiveCompare("Pragma") != .orderedSame else { return }
            result[key] = String(describing: entry.value)
        }
        headers["Cache-Control"] = "no-store"
        headers["Pragma"] = "no-cache"
        return HTTPURLResponse(
            url: requestURL,
            statusCode: http.statusCode,
            httpVersion: nil,
            headerFields: headers
        ) ?? aosSchemeURLResponse(response, requestURL: requestURL)
    }
    return aosSchemeURLResponse(response, requestURL: requestURL)
}

private func aosSchemeURLResponse(_ response: URLResponse, requestURL: URL) -> URLResponse {
    URLResponse(
        url: requestURL,
        mimeType: response.mimeType,
        expectedContentLength: Int(clamping: response.expectedContentLength),
        textEncodingName: response.textEncodingName
    )
}
