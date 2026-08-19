import CoreGraphics
import CryptoKit
import Foundation

struct AOSScreenRecordingFollowUpdateRequest: Equatable {
    let requestID: String
    let canonicalParameterDigest: String
    let selector: AOSOperationIdentity
    let expectedGeometryGeneration: UInt64
    let topology: AOSDisplayTopologySnapshot
    let target: AOSScreenRecordingTarget
    let binding: AOSScreenRecordingFollowBinding

    static func validatingPublicValue(_ value: [String: Any]) throws -> Self {
        let expected: Set<String> = [
            "request_id", "canonical_parameter_digest", "selector",
            "expected_geometry_generation", "topology", "target", "binding",
        ]
        guard Set(value.keys) == expected,
              let requestID = aosOperationWireIdentifier(value["request_id"]),
              let digest = value["canonical_parameter_digest"] as? String,
              digest.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil,
              let selector = aosExactOperationWireIdentity(
                value["selector"], idKey: "operation_id", generationKey: "operation_generation"
              ),
              let expectedValue = value["expected_geometry_generation"],
              let expectedGeneration = aosExactJSONInteger(
                expectedValue, minimum: 1, maximum: Int(aosMaximumExactJSONInteger)
              ),
              let topologyValue = value["topology"],
              let targetValue = value["target"] as? [String: Any] else {
            throw AOSOperationCoreError.invalidRecord("screen_recording_follow_update")
        }
        let topology = try validateAOSDisplayTopologyWireValue(topologyValue)
        let target = try AOSScreenRecordingRequest.parseTarget(targetValue, topology: topology)
        guard target.kind == .region else {
            throw AOSOperationCoreError.invalidRecord("screen_recording_follow_update_target")
        }
        return Self(
            requestID: requestID,
            canonicalParameterDigest: digest,
            selector: selector,
            expectedGeometryGeneration: UInt64(expectedGeneration),
            topology: topology,
            target: target,
            binding: try .validatingPublicValue(value["binding"])
        )
    }
}

enum AOSScreenRecordingFollowDeadlineState: String, Codable {
    case notApplicable = "not_applicable"
    case inactive
    case armed
    case expired
    case stopped
}

struct AOSScreenRecordingPendingGeometryUpdate: Codable, Equatable {
    let requestID: String
    let canonicalParameterDigest: String
    let expectedGeometryGeneration: UInt64
    let candidate: AOSScreenRecordingGeometry
}

struct AOSScreenRecordingGeometryState: Codable, Equatable {
    var accepted: AOSScreenRecordingGeometry
    var pendingUpdate: AOSScreenRecordingPendingGeometryUpdate?
    var deadlineState: AOSScreenRecordingFollowDeadlineState
    var nextUpdateNotBeforeNanoseconds: UInt64?
    var nextDeadlineNanoseconds: UInt64?

    static func initial(_ geometry: AOSScreenRecordingGeometry) -> Self {
        Self(
            accepted: geometry,
            pendingUpdate: nil,
            deadlineState: geometry.mode == .fixed ? .notApplicable : .inactive,
            nextUpdateNotBeforeNanoseconds: nil,
            nextDeadlineNanoseconds: nil
        )
    }
}

enum AOSScreenRecordingFollowValidationDisposition: Error, Equatable {
    case reject(AOSOperationCoreError)
    case targetDrift
}

extension AOSScreenRecordingGeometryValidator {
    static func resolveFollowUpdate(
        _ update: AOSScreenRecordingFollowUpdateRequest,
        current: AOSScreenRecordingGeometry,
        maximumPixelCount: UInt64,
        observedTopology: AOSDisplayTopologySnapshot,
        windowFacts: [CaptureWindowFact]
    ) throws -> AOSScreenRecordingGeometry {
        guard current.mode == .callerFollowed,
              let currentBinding = current.followBinding,
              update.expectedGeometryGeneration == current.geometryGeneration else {
            throw AOSScreenRecordingFollowValidationDisposition.reject(.generationConflict)
        }
        guard try canonicalTopologyData(update.topology) == canonicalTopologyData(current.admittedTopology),
              try canonicalTopologyData(observedTopology) == canonicalTopologyData(current.admittedTopology),
              update.target.displayOrdinal == current.target.displayOrdinal,
              update.target.displayMemberIdentity == current.target.displayMemberIdentity,
              update.binding.target == currentBinding.target,
              update.binding.session == currentBinding.session,
              update.binding.navigation == currentBinding.navigation,
              update.binding.frame == currentBinding.frame,
              update.binding.sourceWindowID == currentBinding.sourceWindowID,
              update.binding.sourceOwnerPID == currentBinding.sourceOwnerPID else {
            throw AOSScreenRecordingFollowValidationDisposition.targetDrift
        }
        guard update.binding.observation.id == currentBinding.observation.id,
              update.binding.state.id == currentBinding.state.id,
              update.binding.observation.generation > currentBinding.observation.generation,
              update.binding.state.generation > currentBinding.state.generation else {
            throw AOSScreenRecordingFollowValidationDisposition.reject(.generationConflict)
        }
        guard windowFacts.filter({ $0.windowID == currentBinding.sourceWindowID }).count == 1,
              let sourceWindow = windowFacts.first(where: {
                  $0.windowID == currentBinding.sourceWindowID
              }),
              sourceWindow.owningApplication?.processID == currentBinding.sourceOwnerPID else {
            throw AOSScreenRecordingFollowValidationDisposition.targetDrift
        }
        guard let region = update.target.globalBounds else {
            throw AOSScreenRecordingFollowValidationDisposition.reject(
                .invalidRecord("screen_recording_follow_region")
            )
        }
        let sourceBounds = AOSDisplayTopologyBounds(
            x: sourceWindow.frame.origin.x,
            y: sourceWindow.frame.origin.y,
            width: sourceWindow.frame.width,
            height: sourceWindow.frame.height
        )
        guard AOSScreenRecordingRequest.contains(sourceBounds, region) else {
            throw AOSScreenRecordingFollowValidationDisposition.reject(
                .invalidRecord("screen_recording_follow_source")
            )
        }
        guard let display = observedTopology.displays.first(where: {
            $0.ordinal == current.target.displayOrdinal
                && $0.memberIdentity == current.target.displayMemberIdentity
        }), AOSScreenRecordingRequest.contains(display.nativeBounds, region),
              display.scaleFactor > 0 else {
            throw AOSScreenRecordingFollowValidationDisposition.reject(
                .invalidRecord("screen_recording_follow_display")
            )
        }
        let rawWidth = Int((region.width * display.scaleFactor).rounded(.down))
        let rawHeight = Int((region.height * display.scaleFactor).rounded(.down))
        let width = rawWidth - rawWidth % 2
        let height = rawHeight - rawHeight % 2
        let product = width.multipliedReportingOverflow(by: height)
        guard width >= 2, height >= 2, !product.overflow,
              UInt64(product.partialValue) <= maximumPixelCount else {
            throw AOSScreenRecordingFollowValidationDisposition.reject(.recordingBoundsExceeded)
        }
        let generation = current.geometryGeneration + 1
        struct DigestBinding: Codable {
            let mode: AOSScreenRecordingGeometryMode
            let geometryGeneration: UInt64
            let topology: AOSDisplayTopologySnapshot
            let target: AOSScreenRecordingTarget
            let sourceRect: AOSDisplayTopologyBounds
            let width: Int
            let height: Int
            let followBinding: AOSScreenRecordingFollowBinding
        }
        let digestInput = DigestBinding(
            mode: .callerFollowed,
            geometryGeneration: generation,
            topology: current.admittedTopology,
            target: update.target,
            sourceRect: region,
            width: current.pixelWidth,
            height: current.pixelHeight,
            followBinding: update.binding
        )
        var material = Data("aos:screen-recording-binding:v1\n".utf8)
        material.append(try AOSOperationDigest.canonicalData(digestInput))
        let digest = SHA256.hash(data: material).map {
            String(format: "%02x", $0)
        }.joined()
        return AOSScreenRecordingGeometry(
            mode: .callerFollowed,
            geometryGeneration: generation,
            admittedTopology: current.admittedTopology,
            target: update.target,
            sourceRect: region,
            pixelWidth: current.pixelWidth,
            pixelHeight: current.pixelHeight,
            pixelCount: current.pixelCount,
            bindingDigest: digest,
            followBinding: update.binding,
            updateIntervalMilliseconds: current.updateIntervalMilliseconds,
            updateDeadlineMilliseconds: current.updateDeadlineMilliseconds
        )
    }
}

func aosScreenRecordingGeometryPublicValue(
    _ state: AOSScreenRecordingGeometryState
) -> [String: Any] {
    let geometry = state.accepted
    let interval: Any = geometry.updateIntervalMilliseconds.map { $0 as Any } ?? NSNull()
    let deadline: Any = geometry.updateDeadlineMilliseconds.map { $0 as Any } ?? NSNull()
    let observation: Any = geometry.followBinding.map {
        $0.observation.generation as Any
    } ?? NSNull()
    let observedState: Any = geometry.followBinding.map {
        $0.state.generation as Any
    } ?? NSNull()
    let notBefore: Any = state.nextUpdateNotBeforeNanoseconds.map { $0 as Any } ?? NSNull()
    let nextDeadline: Any = state.nextDeadlineNanoseconds.map { $0 as Any } ?? NSNull()
    return [
        "mode": geometry.mode.rawValue,
        "geometry_generation": geometry.geometryGeneration,
        "binding_digest": geometry.bindingDigest,
        "source_rect": [
            "x": geometry.sourceRect.x,
            "y": geometry.sourceRect.y,
            "width": geometry.sourceRect.width,
            "height": geometry.sourceRect.height,
        ],
        "pixel_width": geometry.pixelWidth,
        "pixel_height": geometry.pixelHeight,
        "update_interval_ms": interval,
        "update_deadline_ms": deadline,
        "last_accepted_observation_generation": observation,
        "last_accepted_state_generation": observedState,
        "pending_update": state.pendingUpdate != nil,
        "next_deadline": [
            "state": state.deadlineState.rawValue,
            "not_before_monotonic_ns": notBefore,
            "deadline_monotonic_ns": nextDeadline,
        ],
    ]
}

func aosScreenRecordingFollowUpdatePublicValue(
    operation: AOSOperationIdentity,
    geometry: AOSScreenRecordingGeometryState
) -> [String: Any] {
    [
        "schema_version": "aos.screen-recording.follow-update-result.v1",
        "operation": [
            "operation_id": operation.id,
            "operation_generation": operation.generation,
        ],
        "geometry": aosScreenRecordingGeometryPublicValue(geometry),
    ]
}

protocol AOSScreenRecordingFollowTimerControlling: AnyObject {
    func schedule(deadlineNanoseconds: UInt64, _ handler: @escaping () -> Void)
    func cancel()
}

final class AOSScreenRecordingFollowDispatchTimer: AOSScreenRecordingFollowTimerControlling {
    private let clock: () -> UInt64
    private let lock = NSLock()
    private let source: DispatchSourceTimer
    private var handler: (() -> Void)?

    init(
        clock: @escaping () -> UInt64,
        queue: DispatchQueue = DispatchQueue(
            label: "aos.screen-recording.follow-deadline",
            qos: .utility
        )
    ) {
        self.clock = clock
        source = DispatchSource.makeTimerSource(queue: queue)
        source.setEventHandler { [weak self] in
            self?.fire()
        }
        source.resume()
    }

    deinit {
        source.setEventHandler {}
        source.cancel()
    }

    func schedule(deadlineNanoseconds: UInt64, _ handler: @escaping () -> Void) {
        lock.lock()
        self.handler = handler
        let now = clock()
        let delay = deadlineNanoseconds > now ? deadlineNanoseconds - now : 0
        source.schedule(
            deadline: .now() + .nanoseconds(Int(min(delay, UInt64(Int.max)))),
            repeating: .never
        )
        lock.unlock()
    }

    func cancel() {
        lock.lock()
        handler = nil
        source.schedule(deadline: .distantFuture, repeating: .never)
        lock.unlock()
    }

    private func fire() {
        lock.lock()
        let callback = handler
        handler = nil
        lock.unlock()
        callback?()
    }
}

final class AOSScreenRecordingFollowGeometryCoordinator {
    typealias NativeUpdate = (
        AOSScreenRecordingGeometry,
        @escaping (Result<Void, Error>) -> Void
    ) -> Void
    typealias Stop = (AOSStopIntent, AOSOperationCoreError) -> Void

    private let operation: AOSOperationIdentity
    private let registry: AOSOperationRegistry
    private let observeTopology: () -> AOSDisplayTopologySnapshot
    private let observeWindows: () -> [CaptureWindowFact]
    private let nativeUpdate: NativeUpdate
    private let clock: () -> UInt64
    private let timer: AOSScreenRecordingFollowTimerControlling
    private let stopOperation: Stop

    init(
        operation: AOSOperationIdentity,
        registry: AOSOperationRegistry,
        observeTopology: @escaping () -> AOSDisplayTopologySnapshot,
        observeWindows: @escaping () -> [CaptureWindowFact],
        nativeUpdate: @escaping NativeUpdate,
        clock: @escaping () -> UInt64 = { DispatchTime.now().uptimeNanoseconds },
        timer: AOSScreenRecordingFollowTimerControlling? = nil,
        stopOperation: @escaping Stop
    ) {
        self.operation = operation
        self.registry = registry
        self.observeTopology = observeTopology
        self.observeWindows = observeWindows
        self.nativeUpdate = nativeUpdate
        self.clock = clock
        self.timer = timer ?? AOSScreenRecordingFollowDispatchTimer(clock: clock)
        self.stopOperation = stopOperation
    }

    @discardableResult
    func activate() throws -> AOSScreenRecordingGeometryState {
        let state = try registry.activateScreenRecordingFollowGeometry(
            operation,
            nowNanoseconds: clock()
        )
        schedule(state)
        return state
    }

    func submit(
        _ request: AOSScreenRecordingFollowUpdateRequest,
        completion: @escaping (Result<AOSScreenRecordingGeometryState, AOSOperationCoreError>) -> Void
    ) {
        guard request.selector == operation else {
            completion(.failure(.operationNotFound))
            return
        }
        let record: AOSOperationRecord
        do {
            record = try registry.inspect(operation)
            guard record.state == .active,
                  let state = record.screenRecordingGeometry,
                  let bounds = record.requestedBounds else {
                throw AOSOperationCoreError.invalidTransition
            }
            let candidate = try AOSScreenRecordingGeometryValidator.resolveFollowUpdate(
                request,
                current: state.accepted,
                maximumPixelCount: bounds.pixelCount,
                observedTopology: observeTopology(),
                windowFacts: observeWindows()
            )
            _ = try registry.reserveScreenRecordingFollowUpdate(
                operation,
                request: request,
                candidate: candidate,
                nowNanoseconds: clock()
            )
            nativeUpdate(candidate) { [weak self] result in
                guard let self else {
                    completion(.failure(.recordingCleanupRequired))
                    return
                }
                switch result {
                case .success:
                    do {
                        let committed = try self.registry.commitScreenRecordingFollowUpdate(
                            self.operation,
                            requestID: request.requestID,
                            canonicalParameterDigest: request.canonicalParameterDigest,
                            nowNanoseconds: self.clock()
                        )
                        self.schedule(committed)
                        completion(.success(committed))
                    } catch let error as AOSOperationCoreError {
                        self.stopOperation(.adapterFailed, .recordingFollowUpdateFailed)
                        completion(.failure(error))
                    } catch {
                        self.stopOperation(.adapterFailed, .recordingFollowUpdateFailed)
                        completion(.failure(.recordingFollowUpdateFailed))
                    }
                case .failure:
                    self.stopOperation(.adapterFailed, .recordingFollowUpdateFailed)
                    completion(.failure(.recordingFollowUpdateFailed))
                }
            }
        } catch let disposition as AOSScreenRecordingFollowValidationDisposition {
            switch disposition {
            case .reject(let error): completion(.failure(error))
            case .targetDrift:
                stopOperation(.adapterFailed, .recordingTargetDrift)
                completion(.failure(.recordingTargetDrift))
            }
        } catch let error as AOSOperationCoreError {
            completion(.failure(error))
        } catch {
            completion(.failure(.invalidRecord("screen_recording_follow_update")))
        }
    }

    func currentGeometry() throws -> AOSScreenRecordingGeometry {
        guard let state = try registry.inspect(operation).screenRecordingGeometry else {
            throw AOSOperationCoreError.invalidTransition
        }
        return state.accepted
    }

    func stop() {
        timer.cancel()
        _ = try? registry.stopScreenRecordingFollowGeometry(operation)
    }

    private func schedule(_ state: AOSScreenRecordingGeometryState) {
        guard state.deadlineState == .armed,
              let deadline = state.nextDeadlineNanoseconds else {
            timer.cancel()
            return
        }
        timer.schedule(deadlineNanoseconds: deadline) { [weak self] in
            guard let self else { return }
            do {
                if try self.registry.expireScreenRecordingFollowGeometry(
                    self.operation,
                    expectedDeadlineNanoseconds: deadline,
                    nowNanoseconds: self.clock()
                ) {
                    self.stopOperation(.deadline, .recordingFollowTimeout)
                }
            } catch {
                self.stopOperation(.adapterFailed, .recordingCleanupRequired)
            }
        }
    }
}
