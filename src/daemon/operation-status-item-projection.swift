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

struct AOSOperationStatusHostLeaseIdentity: Equatable {
    let binding: AOSOperationStatusHostBinding
    let epoch: UInt64
}

struct AOSOperationStatusHostAdmission: Equatable {
    let binding: AOSOperationStatusHostBinding
    let epoch: UInt64
}

final class AOSOperationStatusHostLease {
    private let lock = NSLock()
    private var binding: AOSOperationStatusHostBinding?
    private var epoch: UInt64

    init(_ binding: AOSOperationStatusHostBinding? = nil) {
        self.binding = binding
        self.epoch = binding == nil ? 0 : 1
    }

    @discardableResult
    func install(_ binding: AOSOperationStatusHostBinding) throws -> AOSOperationStatusHostLeaseIdentity {
        lock.lock()
        defer { lock.unlock() }
        guard epoch < UInt64.max else {
            self.binding = nil
            throw AOSOperationProjectionError.invalidStatusHostBinding
        }
        epoch += 1
        self.binding = binding
        return AOSOperationStatusHostLeaseIdentity(binding: binding, epoch: epoch)
    }

    func clear() {
        lock.lock()
        binding = nil
        if epoch < UInt64.max { epoch += 1 }
        lock.unlock()
    }

    @discardableResult
    func retire(_ expected: AOSOperationStatusHostLeaseIdentity) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard binding == expected.binding, epoch == expected.epoch else { return false }
        binding = nil
        if epoch < UInt64.max { epoch += 1 }
        return true
    }

    func identity() -> AOSOperationStatusHostLeaseIdentity? {
        lock.lock()
        defer { lock.unlock() }
        guard let binding else { return nil }
        return AOSOperationStatusHostLeaseIdentity(binding: binding, epoch: epoch)
    }

    func admit(
        _ expected: AOSOperationStatusHostLeaseIdentity
    ) throws -> AOSOperationStatusHostAdmission {
        lock.lock()
        defer { lock.unlock() }
        guard binding == expected.binding, epoch == expected.epoch else {
            throw AOSOperationProjectionError.invalidStatusHostBinding
        }
        return AOSOperationStatusHostAdmission(binding: expected.binding, epoch: expected.epoch)
    }
}

enum AOSOperationInternalStatusItemAction: String {
    case openCanvas = "open_canvas"
    case stopAll = "stop_all"
    case reopen
}

struct AOSOperationInternalStatusItemActionEvidence: Equatable {
    let action: AOSOperationInternalStatusItemAction
    let itemGeneration: UInt64
    let descriptorRevision: UInt64
    let actionSequence: UInt64
    let expectedBarrierGeneration: UInt64
}

struct AOSOperationStatusMenuPresentation: Equatable {
    let barrierTitle: String
    let stopAllEnabled: Bool
    let reopenEnabled: Bool
    let stopAllConfirmationTitle: String
    let reopenConfirmationTitle: String

    static func make(snapshot: AOSOperationStatusItemSnapshot) -> Self {
        let state = snapshot.barrierState.rawValue
            .replacingOccurrences(of: "_", with: " ")
            .capitalized
        return Self(
            barrierTitle: "Barrier: \(state) · generation \(snapshot.barrierGeneration)",
            stopAllEnabled: true,
            reopenEnabled: snapshot.barrierState == .closed,
            stopAllConfirmationTitle: "Confirm Stop All for Generation \(snapshot.barrierGeneration)",
            reopenConfirmationTitle: "Confirm Reopen Generation \(snapshot.barrierGeneration)"
        )
    }
}

private struct AOSOperationStatusMenuActionBinding {
    let action: AOSOperationInternalStatusItemAction
    let itemGeneration: UInt64
    let descriptorRevision: UInt64
    let expectedBarrierGeneration: UInt64
}

protocol AOSOperationInternalStatusItemHosting: AnyObject {
    func install(
        itemGeneration: UInt64,
        descriptorRevision: UInt64,
        onAction: @escaping (AOSOperationInternalStatusItemActionEvidence) -> Void
    )
    func update(snapshot: AOSOperationStatusItemSnapshot, descriptorRevision: UInt64)
    func updateFailure(code: String, descriptorRevision: UInt64)
    func updateControlFailure(code: String, descriptorRevision: UInt64)
    func teardown()
}

final class AOSAppKitOperationInternalStatusItemHost: NSObject, AOSOperationInternalStatusItemHosting {
    private var statusItem: NSStatusItem?
    private var itemGeneration: UInt64 = 0
    private var descriptorRevision: UInt64 = 0
    private var actionSequence: UInt64 = 0
    private var onAction: ((AOSOperationInternalStatusItemActionEvidence) -> Void)?
    private var snapshot: AOSOperationStatusItemSnapshot?
    private var controlFailureCode: String?

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
            guard let self, descriptorRevision >= self.descriptorRevision else { return }
            self.snapshot = snapshot
            self.descriptorRevision = descriptorRevision
            self.controlFailureCode = nil
            self.render()
        }
    }

    func updateFailure(code: String, descriptorRevision: UInt64) {
        onMain { [weak self] in
            guard let self, descriptorRevision >= self.descriptorRevision else { return }
            self.snapshot = nil
            self.controlFailureCode = nil
            self.descriptorRevision = descriptorRevision
            self.statusItem?.button?.title = "AOS"
            self.statusItem?.button?.toolTip = "AOS operation status unavailable (\(code))"
            self.statusItem?.button?.image = self.makeIcon(red: false)
        }
    }

    func updateControlFailure(code: String, descriptorRevision: UInt64) {
        onMain { [weak self] in
            guard let self, descriptorRevision >= self.descriptorRevision else { return }
            self.controlFailureCode = code
            self.descriptorRevision = descriptorRevision
            self.render()
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
            self.controlFailureCode = nil
        }
    }

    @objc private func handleClick(_ sender: Any?) {
        showMenu()
    }

    @objc private func handleBoundAction(_ sender: Any?) {
        guard let item = sender as? NSMenuItem,
              let binding = item.representedObject as? AOSOperationStatusMenuActionBinding else {
            return
        }
        emit(binding)
    }

    private func showMenu() {
        guard let statusItem, let button = statusItem.button else { return }
        let menu = NSMenu()
        if let snapshot {
            let presentation = AOSOperationStatusMenuPresentation.make(snapshot: snapshot)
            let barrier = NSMenuItem(
                title: presentation.barrierTitle,
                action: nil,
                keyEquivalent: ""
            )
            barrier.isEnabled = false
            menu.addItem(barrier)
            let counts = snapshot.counts
            let summary = NSMenuItem(
                title: "\(counts.active) active, \(counts.recording) recording, \(counts.residual) cleanup",
                action: nil,
                keyEquivalent: ""
            )
            summary.isEnabled = false
            menu.addItem(summary)
            if let controlFailureCode {
                let failure = NSMenuItem(
                    title: "Last control failed: \(controlFailureCode)",
                    action: nil,
                    keyEquivalent: ""
                )
                failure.isEnabled = false
                menu.addItem(failure)
            }
            menu.addItem(.separator())
            menu.addItem(makeBoundActionItem(
                title: "Open Operation Control",
                binding: binding(for: .openCanvas, snapshot: snapshot)
            ))
            menu.addItem(makeConfirmedActionItem(
                title: "Stop All Registered Operations…",
                explanation: "Closes new registered-operation admission until explicitly reopened.",
                confirmationTitle: presentation.stopAllConfirmationTitle,
                enabled: presentation.stopAllEnabled,
                binding: binding(for: .stopAll, snapshot: snapshot)
            ))
            menu.addItem(makeConfirmedActionItem(
                title: "Reopen Registered Operation Admission…",
                explanation: "Reopens only after the exact closed generation is residual-free and reconciled.",
                confirmationTitle: presentation.reopenConfirmationTitle,
                enabled: presentation.reopenEnabled,
                binding: binding(for: .reopen, snapshot: snapshot)
            ))
        } else {
            let unavailable = NSMenuItem(
                title: "Operation status unavailable",
                action: nil,
                keyEquivalent: ""
            )
            unavailable.isEnabled = false
            menu.addItem(unavailable)
        }
        statusItem.menu = menu
        button.performClick(nil)
        statusItem.menu = nil
    }

    private func makeBoundActionItem(
        title: String,
        binding: AOSOperationStatusMenuActionBinding
    ) -> NSMenuItem {
        let item = NSMenuItem(
            title: title,
            action: #selector(handleBoundAction(_:)),
            keyEquivalent: ""
        )
        item.target = self
        item.representedObject = binding
        return item
    }

    private func makeConfirmedActionItem(
        title: String,
        explanation: String,
        confirmationTitle: String,
        enabled: Bool,
        binding: AOSOperationStatusMenuActionBinding
    ) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = enabled
        let confirmation = NSMenu()
        let explanationItem = NSMenuItem(title: explanation, action: nil, keyEquivalent: "")
        explanationItem.isEnabled = false
        confirmation.addItem(explanationItem)
        confirmation.addItem(.separator())
        confirmation.addItem(makeBoundActionItem(
            title: confirmationTitle,
            binding: binding
        ))
        item.submenu = confirmation
        return item
    }

    private func binding(
        for action: AOSOperationInternalStatusItemAction,
        snapshot: AOSOperationStatusItemSnapshot
    ) -> AOSOperationStatusMenuActionBinding {
        AOSOperationStatusMenuActionBinding(
            action: action,
            itemGeneration: itemGeneration,
            descriptorRevision: descriptorRevision,
            expectedBarrierGeneration: snapshot.barrierGeneration
        )
    }

    private func emit(_ binding: AOSOperationStatusMenuActionBinding) {
        guard actionSequence < UInt64.max else { return }
        actionSequence += 1
        onAction?(AOSOperationInternalStatusItemActionEvidence(
            action: binding.action,
            itemGeneration: binding.itemGeneration,
            descriptorRevision: binding.descriptorRevision,
            actionSequence: actionSequence,
            expectedBarrierGeneration: binding.expectedBarrierGeneration
        ))
    }

    private func render() {
        guard let button = statusItem?.button else { return }
        let counts = snapshot?.counts
        button.title = counts.map { "AOS \($0.active)" } ?? "AOS"
        button.toolTip = counts.map {
            let barrier = snapshot?.barrierState.rawValue ?? "unknown"
            let generation = snapshot?.barrierGeneration ?? 0
            let failure = controlFailureCode.map { "; last control failed: \($0)" } ?? ""
            return "AOS operations: \($0.active) active, \($0.recording) recording, \($0.residual) cleanup; barrier \(barrier) generation \(generation)\(failure)"
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
    typealias CanvasOpener = (AOSOperationStatusHostLeaseIdentity) -> Void

    private let controlPlane: AOSOperationControlPlane
    private let readState: StateReader
    private let indicatorRegistry: AOSOperationStatusIndicatorRegistry
    private let statusHost: AOSOperationStatusHostBinding
    private let itemHost: AOSOperationInternalStatusItemHosting
    private let requestIDFactory: RequestIDFactory
    private let openCanvas: CanvasOpener
    private let statusHostLease: AOSOperationStatusHostLease
    private let statusHostLeaseIdentity: AOSOperationStatusHostLeaseIdentity
    private let controlQueue: DispatchQueue
    private let lock = NSLock()
    private let refreshLock = NSLock()
    private let itemGeneration: UInt64
    private var descriptorRevision: UInt64 = 1
    private var publishedBarrierGeneration: UInt64?
    private var lastActionSequence: UInt64 = 0
    private var controlActionInFlight = false
    private var tornDown = false

    init(
        controlPlane: AOSOperationControlPlane,
        readState: @escaping StateReader,
        indicatorRegistry: AOSOperationStatusIndicatorRegistry,
        statusHost: AOSOperationStatusHostBinding,
        itemGeneration: UInt64,
        itemHost: AOSOperationInternalStatusItemHosting = AOSAppKitOperationInternalStatusItemHost(),
        requestIDFactory: @escaping RequestIDFactory = { UUID().uuidString.lowercased() },
        statusHostLease: AOSOperationStatusHostLease,
        controlQueue: DispatchQueue = DispatchQueue(
            label: "io.agent-os.operation-status-control",
            qos: .userInitiated
        ),
        openCanvas: @escaping CanvasOpener
    ) throws {
        let state = readState()
        try statusHost.validate(against: state)
        guard itemGeneration > 0 else {
            throw AOSOperationProjectionError.invalidStatusHostBinding
        }
        try indicatorRegistry.validate(against: state.adapterRegistry)
        guard let leaseIdentity = statusHostLease.identity(),
              leaseIdentity.binding == statusHost else {
            throw AOSOperationProjectionError.invalidStatusHostBinding
        }
        self.controlPlane = controlPlane
        self.readState = readState
        self.indicatorRegistry = indicatorRegistry
        self.statusHost = statusHost
        self.itemGeneration = itemGeneration
        self.itemHost = itemHost
        self.requestIDFactory = requestIDFactory
        self.statusHostLease = statusHostLease
        self.statusHostLeaseIdentity = leaseIdentity
        self.controlQueue = controlQueue
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
        lock.lock()
        tornDown = true
        lock.unlock()
        statusHostLease.retire(statusHostLeaseIdentity)
        itemHost.teardown()
    }

    @discardableResult
    func refresh(
        controlFailureCode: String? = nil
    ) -> Result<AOSOperationStatusItemSnapshot, AOSOperationProjectionError> {
        refreshLock.lock()
        defer { refreshLock.unlock() }
        do {
            let state = readState()
            try statusHost.validate(against: state)
            let snapshot = try AOSOperationStatusItemSnapshot.make(
                state: state,
                indicatorRegistry: indicatorRegistry
            )
            let revision = advanceDescriptorRevision(
                publishedBarrierGeneration: snapshot.barrierGeneration
            )
            itemHost.update(snapshot: snapshot, descriptorRevision: revision)
            if let controlFailureCode {
                itemHost.updateControlFailure(
                    code: controlFailureCode,
                    descriptorRevision: revision
                )
            }
            return .success(snapshot)
        } catch let error as AOSOperationProjectionError {
            itemHost.updateFailure(
                code: error.code,
                descriptorRevision: advanceDescriptorRevision(publishedBarrierGeneration: nil)
            )
            return .failure(error)
        } catch {
            let projected = AOSOperationProjectionError.invalidStatusHostBinding
            itemHost.updateFailure(
                code: projected.code,
                descriptorRevision: advanceDescriptorRevision(publishedBarrierGeneration: nil)
            )
            return .failure(projected)
        }
    }

    private func routeStatusItemAction(_ evidence: AOSOperationInternalStatusItemActionEvidence) {
        guard admit(evidence) else { return }
        switch evidence.action {
        case .openCanvas:
            guard (try? statusHostLease.admit(statusHostLeaseIdentity)) != nil else { return }
            openCanvas(statusHostLeaseIdentity)
        case .stopAll, .reopen:
            controlQueue.async { [weak self] in
                self?.runControlAction(evidence)
            }
        }
    }

    private func runControlAction(_ evidence: AOSOperationInternalStatusItemActionEvidence) {
        var failureCode: String?
        do {
            guard !isTornDown() else {
                throw AOSOperationProjectionError.invalidStatusHostBinding
            }
            let admission = try statusHostLease.admit(statusHostLeaseIdentity)
            switch evidence.action {
            case .openCanvas:
                throw AOSOperationProjectionError.unsupportedAction
            case .stopAll:
                _ = try stopAll(
                    statusHost: admission.binding,
                    expectedBarrierGeneration: evidence.expectedBarrierGeneration
                )
            case .reopen:
                _ = try reopen(
                    statusHost: admission.binding,
                    expectedBarrierGeneration: evidence.expectedBarrierGeneration
                )
            }
        } catch {
            failureCode = controlFailureCode(error)
        }

        if !isTornDown() {
            _ = refresh(controlFailureCode: failureCode)
        }
        finishControlAction()
    }

    private func controlFailureCode(_ error: Error) -> String {
        if let error = error as? AOSOperationCoreError { return error.code }
        if let error = error as? AOSOperationProjectionError { return error.code }
        return AOSOperationProjectionError.controlFailed.code
    }

    private func admit(_ evidence: AOSOperationInternalStatusItemActionEvidence) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !tornDown,
              evidence.itemGeneration == itemGeneration,
              evidence.descriptorRevision == descriptorRevision,
              evidence.expectedBarrierGeneration == publishedBarrierGeneration,
              evidence.actionSequence > lastActionSequence else {
            return false
        }
        lastActionSequence = evidence.actionSequence
        if evidence.action != .openCanvas {
            guard !controlActionInFlight else { return false }
            controlActionInFlight = true
        }
        return true
    }

    private func stopAll(
        statusHost: AOSOperationStatusHostBinding,
        expectedBarrierGeneration: UInt64
    ) throws -> AOSStopAllReceipt {
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
                expectedBarrierGeneration: expectedBarrierGeneration
            ),
            expectedBarrierGeneration: expectedBarrierGeneration
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

    private func reopen(
        statusHost: AOSOperationStatusHostBinding,
        expectedBarrierGeneration: UInt64
    ) throws -> AOSReopenReceipt {
        let state = readState()
        try statusHost.validate(against: state)
        let requestID = requestIDFactory()
        guard !requestID.isEmpty, requestID.count <= 128 else {
            throw AOSOperationProjectionError.invalidRequest
        }
        let request = AOSHostControlRequest(
            requestID: requestID,
            action: .reopen,
            canonicalParameterDigest: try AOSOperationProjectionRequestDigest.hostAction(
                .reopen,
                expectedBarrierGeneration: expectedBarrierGeneration
            ),
            expectedBarrierGeneration: expectedBarrierGeneration
        )
        return try controlPlane.reopen(
            context: AOSHostControlContext(
                expectedDaemonGeneration: statusHost.daemonGeneration,
                connectionEpoch: statusHost.connectionEpoch,
                caller: statusHost.callerEvidence
            ),
            request: request
        )
    }

    private func finishControlAction() {
        lock.lock()
        controlActionInFlight = false
        lock.unlock()
    }

    private func isTornDown() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return tornDown
    }

    private func currentDescriptorRevision() -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        return descriptorRevision
    }

    private func advanceDescriptorRevision(publishedBarrierGeneration: UInt64?) -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        if descriptorRevision < UInt64.max {
            descriptorRevision += 1
        }
        self.publishedBarrierGeneration = publishedBarrierGeneration
        return descriptorRevision
    }
}
