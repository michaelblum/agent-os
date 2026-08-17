import AppKit
import CryptoKit
import Foundation

enum AOSOperationStatusIndicatorClass: String, Codable, Equatable, Hashable {
    case neutral
    case recording
}

struct AOSOperationStatusIndicatorBinding: Codable, Equatable, Hashable {
    let adapterRegistrationID: String
    let adapterRegistrationRevision: UInt64
    let capabilityID: String
    let indicatorClass: AOSOperationStatusIndicatorClass

    init(
        adapterRegistrationID: String,
        adapterRegistrationRevision: UInt64,
        capabilityID: String,
        indicatorClass: AOSOperationStatusIndicatorClass
    ) {
        self.adapterRegistrationID = adapterRegistrationID
        self.adapterRegistrationRevision = adapterRegistrationRevision
        self.capabilityID = capabilityID
        self.indicatorClass = indicatorClass
    }

    init(
        registration: AOSOperationAdapterRegistration,
        capabilityID: String,
        indicatorClass: AOSOperationStatusIndicatorClass
    ) throws {
        guard registration.capabilityIDs.contains(capabilityID) else {
            throw AOSOperationProjectionError.indicatorRegistryConflict
        }
        self.init(
            adapterRegistrationID: registration.id,
            adapterRegistrationRevision: registration.revision,
            capabilityID: capabilityID,
            indicatorClass: indicatorClass
        )
    }
}

struct AOSOperationStatusIndicatorRegistry {
    private struct Key: Hashable {
        let adapterRegistrationID: String
        let adapterRegistrationRevision: UInt64
        let capabilityID: String
    }

    private let bindings: [Key: AOSOperationStatusIndicatorClass]

    init(bindings values: [AOSOperationStatusIndicatorBinding]) throws {
        var result: [Key: AOSOperationStatusIndicatorClass] = [:]
        for value in values {
            guard !value.adapterRegistrationID.isEmpty,
                  value.adapterRegistrationRevision > 0,
                  !value.capabilityID.isEmpty else {
                throw AOSOperationProjectionError.indicatorRegistryConflict
            }
            let key = Key(
                adapterRegistrationID: value.adapterRegistrationID,
                adapterRegistrationRevision: value.adapterRegistrationRevision,
                capabilityID: value.capabilityID
            )
            guard result.updateValue(value.indicatorClass, forKey: key) == nil else {
                throw AOSOperationProjectionError.indicatorRegistryConflict
            }
        }
        bindings = result
    }

    func validate(against registry: AOSAdapterRegistrySnapshot) throws {
        let expected = Set(registry.registrations.flatMap { registration in
            registration.capabilityIDs.map {
                Key(
                    adapterRegistrationID: registration.id,
                    adapterRegistrationRevision: registration.revision,
                    capabilityID: $0
                )
            }
        })
        guard expected == Set(bindings.keys) else {
            throw AOSOperationProjectionError.indicatorRegistryConflict
        }
    }

    func indicatorClass(
        for operation: AOSOperationRecord,
        registry: AOSAdapterRegistrySnapshot
    ) throws -> AOSOperationStatusIndicatorClass {
        guard let registration = registry.registration(
            id: operation.adapterRegistrationID,
            revision: operation.adapterRegistrationRevision
        ), registration.capabilityIDs.contains(operation.capabilityID) else {
            throw AOSOperationProjectionError.unregisteredOperation
        }
        let key = Key(
            adapterRegistrationID: operation.adapterRegistrationID,
            adapterRegistrationRevision: operation.adapterRegistrationRevision,
            capabilityID: operation.capabilityID
        )
        guard let value = bindings[key] else {
            throw AOSOperationProjectionError.indicatorRegistryConflict
        }
        return value
    }
}

enum AOSOperationProjectionError: Error, Equatable, CustomStringConvertible {
    case invalidStatusHostBinding
    case staleStatusItemAction
    case indicatorRegistryConflict
    case unregisteredOperation
    case invalidCanvasIdentity
    case staleCanvasGeneration
    case capturedPeerUnavailable
    case invalidRequest
    case authorityClaimRejected
    case unsupportedAction
    case canvasDeliveryFailed
    case controlFailed

    var code: String {
        switch self {
        case .invalidStatusHostBinding: return "OPERATION_STATUS_HOST_INVALID"
        case .staleStatusItemAction: return "OPERATION_STATUS_ACTION_STALE"
        case .indicatorRegistryConflict: return "OPERATION_INDICATOR_REGISTRY_CONFLICT"
        case .unregisteredOperation: return "OPERATION_NOT_REGISTERED"
        case .invalidCanvasIdentity: return "OPERATION_CANVAS_IDENTITY_INVALID"
        case .staleCanvasGeneration: return "OPERATION_CANVAS_GENERATION_STALE"
        case .capturedPeerUnavailable: return "OPERATION_CANVAS_PEER_UNAVAILABLE"
        case .invalidRequest: return "OPERATION_CANVAS_REQUEST_INVALID"
        case .authorityClaimRejected: return "OPERATION_CANVAS_AUTHORITY_CLAIM_REJECTED"
        case .unsupportedAction: return "OPERATION_CANVAS_ACTION_UNSUPPORTED"
        case .canvasDeliveryFailed: return "OPERATION_CANVAS_DELIVERY_FAILED"
        case .controlFailed: return "OPERATION_STATUS_CONTROL_FAILED"
        }
    }

    var description: String { code }
}

struct AOSOperationStatusCounts: Codable, Equatable {
    let registered: UInt64
    let active: UInt64
    let recording: UInt64
    let residual: UInt64
}

struct AOSOperationStatusItemSnapshot: Codable, Equatable {
    let daemonGeneration: UInt64
    let adapterRegistryRevision: UInt64
    let barrierGeneration: UInt64
    let barrierState: AOSHostBarrierLifecycleState
    let counts: AOSOperationStatusCounts
    let recordingIndicatorIsRed: Bool

    static let recordingRedStates: Set<AOSOperationLifecycleState> = [.active]

    static func make(
        state: AOSOperationDurableState,
        indicatorRegistry: AOSOperationStatusIndicatorRegistry
    ) throws -> Self {
        try indicatorRegistry.validate(against: state.adapterRegistry)
        let operations = try state.operations.filter { operation in
            guard let registration = state.adapterRegistry.registration(
                id: operation.adapterRegistrationID,
                revision: operation.adapterRegistrationRevision
            ) else { return false }
            return registration.capabilityIDs.contains(operation.capabilityID)
        }.map { operation in
            (
                operation,
                try indicatorRegistry.indicatorClass(
                    for: operation,
                    registry: state.adapterRegistry
                )
            )
        }
        let recording = operations.filter {
            $0.1 == .recording && recordingRedStates.contains($0.0.state)
        }
        let residual = operations.filter {
            $0.0.state == .cleanupRequired
                || $0.0.state == .recovering
                || $0.0.residualDigest != nil
        }
        return Self(
            daemonGeneration: state.daemonGeneration,
            adapterRegistryRevision: state.adapterRegistry.revision,
            barrierGeneration: state.barrier.generation,
            barrierState: state.barrier.state,
            counts: AOSOperationStatusCounts(
                registered: UInt64(operations.count),
                active: UInt64(operations.filter {
                    [.starting, .active, .stopping].contains($0.0.state)
                }.count),
                recording: UInt64(recording.count),
                residual: UInt64(residual.count)
            ),
            recordingIndicatorIsRed: !recording.isEmpty
        )
    }
}

struct AOSOperationStatusHostBinding: Codable, Equatable {
    let daemonGeneration: UInt64
    let effectiveUID: UInt32
    let statusHostID: String
    let statusHostGeneration: UInt64
    let connectionEpoch: UInt64

    func validate(against state: AOSOperationDurableState) throws {
        guard daemonGeneration > 0,
              daemonGeneration == state.daemonGeneration,
              !statusHostID.isEmpty,
              statusHostGeneration > 0,
              connectionEpoch > 0 else {
            throw AOSOperationProjectionError.invalidStatusHostBinding
        }
    }

    var callerEvidence: AOSCallerEvidence {
        .statusItemHost(AOSStatusItemHostEvidence(
            statusHostID: statusHostID,
            statusHostGeneration: statusHostGeneration,
            daemonGeneration: daemonGeneration,
            effectiveUID: effectiveUID
        ))
    }
}

enum AOSOperationInternalStatusItemAction: String {
    case openCanvas = "open_canvas"
    case stopAll = "stop_all"
}

struct AOSOperationInternalStatusItemActionEvidence: Equatable {
    let action: AOSOperationInternalStatusItemAction
    let itemGeneration: UInt64
    let descriptorRevision: UInt64
    let actionSequence: UInt64
}

protocol AOSOperationInternalStatusItemHosting: AnyObject {
    func install(
        itemGeneration: UInt64,
        descriptorRevision: UInt64,
        onAction: @escaping (AOSOperationInternalStatusItemActionEvidence) -> Void
    )
    func update(snapshot: AOSOperationStatusItemSnapshot, descriptorRevision: UInt64)
    func updateFailure(code: String, descriptorRevision: UInt64)
    func teardown()
}

final class AOSAppKitOperationInternalStatusItemHost: NSObject, AOSOperationInternalStatusItemHosting {
    private var statusItem: NSStatusItem?
    private var itemGeneration: UInt64 = 0
    private var descriptorRevision: UInt64 = 0
    private var actionSequence: UInt64 = 0
    private var onAction: ((AOSOperationInternalStatusItemActionEvidence) -> Void)?
    private var snapshot: AOSOperationStatusItemSnapshot?

    func install(
        itemGeneration: UInt64,
        descriptorRevision: UInt64,
        onAction: @escaping (AOSOperationInternalStatusItemActionEvidence) -> Void
    ) {
        onMain { [weak self] in
            guard let self else { return }
            self.itemGeneration = itemGeneration
            self.descriptorRevision = descriptorRevision
            self.onAction = onAction
            guard self.statusItem == nil else { return }
            let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
            self.statusItem = item
            item.button?.target = self
            item.button?.action = #selector(self.handleClick(_:))
            item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
            self.render()
        }
    }

    func update(snapshot: AOSOperationStatusItemSnapshot, descriptorRevision: UInt64) {
        onMain { [weak self] in
            self?.snapshot = snapshot
            self?.descriptorRevision = descriptorRevision
            self?.render()
        }
    }

    func updateFailure(code: String, descriptorRevision: UInt64) {
        onMain { [weak self] in
            guard let self else { return }
            self.snapshot = nil
            self.descriptorRevision = descriptorRevision
            self.statusItem?.button?.title = "AOS"
            self.statusItem?.button?.toolTip = "AOS operation status unavailable (\(code))"
            self.statusItem?.button?.image = self.makeIcon(red: false)
        }
    }

    func teardown() {
        onMain { [weak self] in
            guard let self else { return }
            if let statusItem = self.statusItem {
                NSStatusBar.system.removeStatusItem(statusItem)
            }
            self.statusItem = nil
            self.onAction = nil
            self.snapshot = nil
        }
    }

    @objc private func handleClick(_ sender: Any?) {
        if NSApp.currentEvent?.type == .rightMouseUp {
            showMenu()
        } else {
            emit(.openCanvas)
        }
    }

    @objc private func handleStopAll(_ sender: Any?) {
        emit(.stopAll)
    }

    private func showMenu() {
        guard let statusItem, let button = statusItem.button else { return }
        let menu = NSMenu()
        if let snapshot {
            let counts = snapshot.counts
            let summary = NSMenuItem(
                title: "\(counts.active) active, \(counts.recording) recording, \(counts.residual) cleanup",
                action: nil,
                keyEquivalent: ""
            )
            summary.isEnabled = false
            menu.addItem(summary)
            menu.addItem(.separator())
        }
        let open = NSMenuItem(
            title: "Open Operation Control",
            action: #selector(handleOpenCanvas(_:)),
            keyEquivalent: ""
        )
        open.target = self
        menu.addItem(open)
        let stopAll = NSMenuItem(
            title: "Stop All Registered Operations",
            action: #selector(handleStopAll(_:)),
            keyEquivalent: ""
        )
        stopAll.target = self
        stopAll.isEnabled = true
        menu.addItem(stopAll)
        statusItem.menu = menu
        button.performClick(nil)
        statusItem.menu = nil
    }

    @objc private func handleOpenCanvas(_ sender: Any?) {
        emit(.openCanvas)
    }

    private func emit(_ action: AOSOperationInternalStatusItemAction) {
        guard actionSequence < UInt64.max else { return }
        actionSequence += 1
        onAction?(AOSOperationInternalStatusItemActionEvidence(
            action: action,
            itemGeneration: itemGeneration,
            descriptorRevision: descriptorRevision,
            actionSequence: actionSequence
        ))
    }

    private func render() {
        guard let button = statusItem?.button else { return }
        let counts = snapshot?.counts
        button.title = counts.map { "AOS \($0.active)" } ?? "AOS"
        button.toolTip = counts.map {
            "AOS operations: \($0.active) active, \($0.recording) recording, \($0.residual) cleanup"
        } ?? "AOS operation control"
        button.image = makeIcon(red: snapshot?.recordingIndicatorIsRed == true)
        button.imagePosition = .imageLeading
        button.imageHugsTitle = true
    }

    private func makeIcon(red: Bool) -> NSImage {
        let size = NSSize(width: 12, height: 12)
        let image = NSImage(size: size)
        image.lockFocus()
        NSColor.clear.setFill()
        NSRect(origin: .zero, size: size).fill()
        let circle = NSBezierPath(ovalIn: NSRect(x: 2, y: 2, width: 8, height: 8))
        (red ? NSColor.systemRed : NSColor.labelColor).setFill()
        circle.fill()
        image.unlockFocus()
        image.isTemplate = !red
        return image
    }

    private func onMain(_ body: @escaping () -> Void) {
        if Thread.isMainThread {
            body()
        } else {
            DispatchQueue.main.async(execute: body)
        }
    }
}

enum AOSOperationProjectionRequestDigest {
    private struct HostParameters: Codable {
        let action: String
        let expectedBarrierGeneration: UInt64

        enum CodingKeys: String, CodingKey {
            case action
            case expectedBarrierGeneration = "expected_barrier_generation"
        }
    }

    static func hostAction(
        _ action: AOSHostControlAction,
        expectedBarrierGeneration: UInt64
    ) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        var data = Data("aos:operation-projection-host-request:v1\n".utf8)
        data.append(try encoder.encode(HostParameters(
            action: action.rawValue,
            expectedBarrierGeneration: expectedBarrierGeneration
        )))
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

final class AOSOperationStatusItemProjection {
    typealias StateReader = () -> AOSOperationDurableState
    typealias RequestIDFactory = () -> String
    typealias CanvasOpener = (AOSOperationStatusHostBinding) -> Void

    private let controlPlane: AOSOperationControlPlane
    private let readState: StateReader
    private let indicatorRegistry: AOSOperationStatusIndicatorRegistry
    private let statusHost: AOSOperationStatusHostBinding
    private let itemHost: AOSOperationInternalStatusItemHosting
    private let requestIDFactory: RequestIDFactory
    private let openCanvas: CanvasOpener
    private let lock = NSLock()
    private let itemGeneration: UInt64
    private var descriptorRevision: UInt64 = 1
    private var lastActionSequence: UInt64 = 0

    init(
        controlPlane: AOSOperationControlPlane,
        readState: @escaping StateReader,
        indicatorRegistry: AOSOperationStatusIndicatorRegistry,
        statusHost: AOSOperationStatusHostBinding,
        itemGeneration: UInt64,
        itemHost: AOSOperationInternalStatusItemHosting = AOSAppKitOperationInternalStatusItemHost(),
        requestIDFactory: @escaping RequestIDFactory = { UUID().uuidString.lowercased() },
        openCanvas: @escaping CanvasOpener
    ) throws {
        let state = readState()
        try statusHost.validate(against: state)
        guard itemGeneration > 0 else {
            throw AOSOperationProjectionError.invalidStatusHostBinding
        }
        try indicatorRegistry.validate(against: state.adapterRegistry)
        self.controlPlane = controlPlane
        self.readState = readState
        self.indicatorRegistry = indicatorRegistry
        self.statusHost = statusHost
        self.itemGeneration = itemGeneration
        self.itemHost = itemHost
        self.requestIDFactory = requestIDFactory
        self.openCanvas = openCanvas
    }

    func start() {
        let revision = currentDescriptorRevision()
        itemHost.install(
            itemGeneration: itemGeneration,
            descriptorRevision: revision,
            onAction: { [weak self] evidence in
                self?.routeStatusItemAction(evidence)
            }
        )
        refresh()
    }

    func teardown() {
        itemHost.teardown()
    }

    @discardableResult
    func refresh() -> Result<AOSOperationStatusItemSnapshot, AOSOperationProjectionError> {
        do {
            let state = readState()
            try statusHost.validate(against: state)
            let snapshot = try AOSOperationStatusItemSnapshot.make(
                state: state,
                indicatorRegistry: indicatorRegistry
            )
            itemHost.update(snapshot: snapshot, descriptorRevision: advanceDescriptorRevision())
            return .success(snapshot)
        } catch let error as AOSOperationProjectionError {
            itemHost.updateFailure(code: error.code, descriptorRevision: advanceDescriptorRevision())
            return .failure(error)
        } catch {
            let projected = AOSOperationProjectionError.invalidStatusHostBinding
            itemHost.updateFailure(code: projected.code, descriptorRevision: advanceDescriptorRevision())
            return .failure(projected)
        }
    }

    private func routeStatusItemAction(_ evidence: AOSOperationInternalStatusItemActionEvidence) {
        guard admit(evidence) else { return }
        switch evidence.action {
        case .openCanvas:
            openCanvas(statusHost)
        case .stopAll:
            do {
                _ = try stopAll()
                refresh()
            } catch {
                itemHost.updateFailure(
                    code: controlFailureCode(error),
                    descriptorRevision: advanceDescriptorRevision()
                )
            }
        }
    }

    private func controlFailureCode(_ error: Error) -> String {
        if let error = error as? AOSOperationCoreError { return error.code }
        if let error = error as? AOSOperationProjectionError { return error.code }
        return AOSOperationProjectionError.controlFailed.code
    }

    private func admit(_ evidence: AOSOperationInternalStatusItemActionEvidence) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard evidence.itemGeneration == itemGeneration,
              evidence.descriptorRevision == descriptorRevision,
              evidence.actionSequence > lastActionSequence else {
            return false
        }
        lastActionSequence = evidence.actionSequence
        return true
    }

    private func stopAll() throws -> AOSStopAllReceipt {
        let state = readState()
        try statusHost.validate(against: state)
        let requestID = requestIDFactory()
        guard !requestID.isEmpty, requestID.count <= 128 else {
            throw AOSOperationProjectionError.invalidRequest
        }
        let request = AOSHostControlRequest(
            requestID: requestID,
            action: .stopAll,
            canonicalParameterDigest: try AOSOperationProjectionRequestDigest.hostAction(
                .stopAll,
                expectedBarrierGeneration: state.barrier.generation
            ),
            expectedBarrierGeneration: state.barrier.generation
        )
        return try controlPlane.stopAll(
            context: AOSHostControlContext(
                expectedDaemonGeneration: statusHost.daemonGeneration,
                connectionEpoch: statusHost.connectionEpoch,
                caller: statusHost.callerEvidence
            ),
            request: request
        )
    }

    private func currentDescriptorRevision() -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        return descriptorRevision
    }

    private func advanceDescriptorRevision() -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        if descriptorRevision < UInt64.max {
            descriptorRevision += 1
        }
        return descriptorRevision
    }
}
