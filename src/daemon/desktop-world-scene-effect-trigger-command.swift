import Foundation

final class AOSDesktopWorldSceneEffectTriggerCommandController {
    private static let transportKeys = [
        "action", "__envelope_active", "__envelope_ref",
    ]

    typealias Execute = (
        AOSDesktopWorldSceneEffectTriggerInput
    ) -> AOSDesktopWorldSceneEffectTriggerPreparation

    private let execute: Execute

    init(execute: @escaping Execute) {
        self.execute = execute
    }

    func handle(_ payload: [String: Any]) -> [String: Any] {
        var commandPayload = payload
        for key in Self.transportKeys {
            commandPayload.removeValue(forKey: key)
        }
        let input: AOSDesktopWorldSceneEffectTriggerInput
        switch AOSDesktopWorldSceneEffectTriggerContract.parse(commandPayload) {
        case .failure(let error):
            return AOSDesktopWorldSceneEffectTriggerContract.failure(error)
        case .success(let value):
            input = value
        }

        switch execute(input) {
        case .failure(let code, let message):
            return ["status": "error", "code": code, "error": message]
        case .success(let plan):
            var response = plan.response
            response["accepted"] = !input.dryRun
            response["binding_validated"] = true
            return response
        }
    }
}
