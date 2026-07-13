import AVFoundation
import Foundation

let aosMicrophoneSettingsURL = "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"

enum AOSMicrophoneAuthorizationState: String, CaseIterable {
    case notDetermined = "not_determined"
    case restricted
    case denied
    case authorized
    case unknown

    init(_ status: AVAuthorizationStatus) {
        switch status {
        case .notDetermined: self = .notDetermined
        case .restricted: self = .restricted
        case .denied: self = .denied
        case .authorized: self = .authorized
        @unknown default: self = .unknown
        }
    }

    var isAuthorized: Bool { self == .authorized }
    var canRequest: Bool { self == .notDetermined }

    var failure: (code: String, message: String)? {
        switch self {
        case .authorized:
            return nil
        case .notDetermined:
            return ("MICROPHONE_PERMISSION_NOT_DETERMINED", "microphone permission has not been requested")
        case .restricted:
            return ("MICROPHONE_PERMISSION_RESTRICTED", "microphone access is restricted by system policy")
        case .denied:
            return ("MICROPHONE_PERMISSION_DENIED", "microphone permission is denied")
        case .unknown:
            return ("MICROPHONE_PERMISSION_UNKNOWN", "microphone permission state is unknown")
        }
    }

    func statusDictionary() -> [String: Any] {
        [
            "owner": "daemon",
            "state": rawValue,
            "authorized": isAuthorized,
            "can_request": canRequest,
            "settings_url": aosMicrophoneSettingsURL,
        ]
    }
}

struct AOSMicrophoneAuthorizationRequestResult {
    let before: AOSMicrophoneAuthorizationState
    let after: AOSMicrophoneAuthorizationState
    let attempted: Bool
    let completed: Bool

    func dictionary() -> [String: Any] {
        [
            "owner": "daemon",
            "before_state": before.rawValue,
            "after_state": after.rawValue,
            "attempted": attempted,
            "completed": completed,
            "authorized": after.isAuthorized,
            "can_request": after.canRequest,
            "settings_url": aosMicrophoneSettingsURL,
        ]
    }
}

protocol AOSMicrophoneAuthorizationProviding: AnyObject {
    func status() -> AOSMicrophoneAuthorizationState
    func request(timeout: TimeInterval) -> AOSMicrophoneAuthorizationRequestResult
}

private final class AOSMicrophoneRequestCompletion {
    private let lock = NSLock()
    private var completed = false

    func markCompleted() {
        lock.lock()
        completed = true
        lock.unlock()
    }

    func value() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return completed
    }
}

final class AOSSystemMicrophoneAuthorization: AOSMicrophoneAuthorizationProviding {
    private let requestLock = NSLock()

    func status() -> AOSMicrophoneAuthorizationState {
        AOSMicrophoneAuthorizationState(AVCaptureDevice.authorizationStatus(for: .audio))
    }

    func request(timeout: TimeInterval = 30) -> AOSMicrophoneAuthorizationRequestResult {
        requestLock.lock()
        defer { requestLock.unlock() }
        let before = status()
        guard before == .notDetermined else {
            return AOSMicrophoneAuthorizationRequestResult(
                before: before,
                after: before,
                attempted: false,
                completed: true
            )
        }

        let semaphore = DispatchSemaphore(value: 0)
        let completion = AOSMicrophoneRequestCompletion()
        AVCaptureDevice.requestAccess(for: .audio) { _ in
            completion.markCompleted()
            semaphore.signal()
        }
        let wait = semaphore.wait(timeout: .now() + max(0, timeout))
        return AOSMicrophoneAuthorizationRequestResult(
            before: before,
            after: status(),
            attempted: true,
            completed: wait == .success && completion.value()
        )
    }
}
