import Foundation
import WebKit

final class AOSSceneExtensionSchemeHandler: NSObject, WKURLSchemeHandler {
    private let store: AOSSceneExtensionStore
    private let loadQueue = DispatchQueue(label: "io.agent-os.scene-extension-loader", qos: .userInitiated)
    private let taskState = AOSSceneExtensionSchemeTaskState()

    init(store: AOSSceneExtensionStore) {
        self.store = store
    }

    private func parsedRequest(_ url: URL) throws -> AOSSceneExtensionReference {
        guard url.scheme == "aos-scene-extension", url.host == nil || url.host == "" else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_URL_INVALID")
        }
        let parts = url.path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard parts.count == 5, parts[0] == "v1" else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_URL_INVALID")
        }
        guard parts[4] == "module.js" else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_URL_INVALID")
        }
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let queryItems = components.queryItems,
              queryItems.count == 2 else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_URL_INVALID")
        }
        var query: [String: String] = [:]
        for item in queryItems {
            guard let value = item.value, query[item.name] == nil else {
                throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_URL_INVALID")
            }
            query[item.name] = value
        }
        guard Set(query.keys) == Set(["sceneAbi", "threeRevision"]) else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_URL_INVALID")
        }
        guard let sceneABI = query["sceneAbi"],
              let threeRevision = query["threeRevision"] else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_URL_INVALID")
        }
        let reference = try AOSSceneExtensionReference(dictionary: [
            "ownerId": parts[1],
            "id": parts[2],
            "digest": parts[3],
            "sceneAbi": sceneABI,
            "threeRevision": threeRevision,
        ])
        return reference
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let taskID = ObjectIdentifier(urlSchemeTask as AnyObject)
        guard taskState.start(taskID) else { return }
        guard let url = urlSchemeTask.request.url else {
            taskState.finish(taskID) {
                urlSchemeTask.didFailWithError(URLError(.badURL))
            }
            return
        }
        loadQueue.async { [weak self] in
            guard let self else { return }
            do {
                let reference = try self.parsedRequest(url)
                let artifact = try self.store.load(reference)
                let data = try artifact.wrapperModule()
                self.taskState.finish(taskID) {
                    let response = URLResponse(
                        url: url,
                        mimeType: "text/javascript",
                        expectedContentLength: data.count,
                        textEncodingName: "utf-8"
                    )
                    urlSchemeTask.didReceive(response)
                    urlSchemeTask.didReceive(data)
                    urlSchemeTask.didFinish()
                }
            } catch {
                self.taskState.finish(taskID) {
                    urlSchemeTask.didFailWithError(URLError(.noPermissionsToReadFile))
                }
            }
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        taskState.stop(ObjectIdentifier(urlSchemeTask as AnyObject))
    }
}
