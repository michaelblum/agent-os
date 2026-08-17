import Foundation

enum AOSSpawnEvidenceScope: String, Codable, Sendable {
    case immediateSocketPeer = "immediate_socket_peer"
    case verifiedAncestor = "verified_ancestor"
}

struct AOSGenerationBoundSpawnRecord: Codable, Hashable, Sendable {
    let spawnRecordID: String
    let evidenceScope: AOSSpawnEvidenceScope
    let child: AOSProcessGenerationIdentity
    let parent: AOSProcessGenerationIdentity
    let parentEdgeReceipt: AOSParentEdgeReceipt
    let operationID: String
    let operationGeneration: UInt64
    let adapterID: String
    let adapterRegistrationRevision: UInt64
    let executableIdentityDigest: AOSSHA256Digest
    let executableDigest: AOSSHA256Digest
    let reviewedDependencySetDigest: AOSSHA256Digest
    let childAuditToken: AOSAuditTokenIdentity?

    func verifySkip(
        edge: AOSStableProcessEdge,
        immediatePeer: AOSSocketPeerIdentity
    ) throws {
        guard !spawnRecordID.isEmpty,
              !operationID.isEmpty,
              operationGeneration > 0,
              !adapterID.isEmpty,
              adapterRegistrationRevision > 0,
              child == edge.child.generation,
              parent == edge.parent.generation,
              parentEdgeReceipt == edge.receipt,
              executableIdentityDigest == edge.child.image.executableIdentityDigest,
              executableDigest == edge.child.image.executableDigest else {
            throw AOSOwnerRootError.invalidSkipProof
        }
        switch evidenceScope {
        case .immediateSocketPeer:
            guard child.pid == immediatePeer.pid,
                  child.effectiveUID == immediatePeer.effectiveUID,
                  childAuditToken == immediatePeer.auditToken else {
                throw AOSOwnerRootError.invalidSkipProof
            }
        case .verifiedAncestor:
            guard child.pid != immediatePeer.pid,
                  childAuditToken == nil else {
                throw AOSOwnerRootError.invalidSkipProof
            }
        }
    }
}

struct AOSResolvedExecutableObservation: Codable, Hashable, Sendable {
    let resolvedPathDigest: AOSSHA256Digest
    let executableIdentityDigest: AOSSHA256Digest
    let device: UInt64
    let inode: UInt64
    let codeIdentityDigest: AOSSHA256Digest
    let fileDigest: AOSSHA256Digest
    let platformCodeDirectoryHash: AOSPlatformCodeDirectoryHash?
    let signingIdentifier: String?
    let signingTeamIdentifier: String?

    init(
        resolvedPathDigest: AOSSHA256Digest,
        executableIdentityDigest: AOSSHA256Digest,
        device: UInt64,
        inode: UInt64,
        codeIdentityDigest: AOSSHA256Digest,
        fileDigest: AOSSHA256Digest,
        platformCodeDirectoryHash: AOSPlatformCodeDirectoryHash? = nil,
        signingIdentifier: String? = nil,
        signingTeamIdentifier: String? = nil
    ) {
        self.resolvedPathDigest = resolvedPathDigest
        self.executableIdentityDigest = executableIdentityDigest
        self.device = device
        self.inode = inode
        self.codeIdentityDigest = codeIdentityDigest
        self.fileDigest = fileDigest
        self.platformCodeDirectoryHash = platformCodeDirectoryHash
        self.signingIdentifier = signingIdentifier
        self.signingTeamIdentifier = signingTeamIdentifier
    }
}

/// macOS exposes the dynamically validated SHA-256 CodeDirectory identity as
/// the 20-byte platform CDHash. This is deliberately not named or modeled as a
/// full SHA-256 digest.
struct AOSPlatformCodeDirectoryHash: Codable, Hashable, Sendable {
    static let algorithm = "sha256_truncated_cdhash_20_bytes"

    let value: String

    init(_ value: String) throws {
        guard value.utf8.count == 40,
              value.utf8.allSatisfy({ byte in
                  (byte >= 48 && byte <= 57) || (byte >= 97 && byte <= 102)
              }) else {
            throw AOSExternalDispatchSpawnBindingError.invalidPlatformCodeDirectoryHash
        }
        self.value = value
    }

    init(from decoder: Decoder) throws {
        try self.init(decoder.singleValueContainer().decode(String.self))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(value)
    }
}

struct AOSExternalRunningExecutableEvidence: Codable, Hashable, Sendable {
    let resolvedPathDigest: AOSSHA256Digest
    let device: UInt64
    let inode: UInt64
    let platformCodeDirectoryHash: AOSPlatformCodeDirectoryHash
    let signingIdentifier: String
    let signingTeamIdentifier: String
}

struct AOSExternalDispatchAdmittedChild: Codable, Hashable, Sendable {
    let child: AOSProcessGenerationIdentity
    let parentEdgeReceipt: AOSParentEdgeReceipt
    let runningExecutable: AOSExternalRunningExecutableEvidence
    let admittedAtMonotonicNanoseconds: UInt64
}

struct AOSExternalDispatchSpawnIntent: Codable, Hashable, Sendable {
    let spawnRecordID: String
    let oneTimeBindingTokenDigest: AOSSHA256Digest
    let parent: AOSProcessGenerationIdentity
    let operationID: String
    let operationGeneration: UInt64
    let adapterID: String
    let adapterRegistrationRevision: UInt64
    let routeSourceID: String?
    let routeSourceRevision: AOSSHA256Digest?
    let executable: AOSResolvedExecutableObservation
    let expectedScriptIdentityDigest: AOSSHA256Digest
    let expectedScriptDigest: AOSSHA256Digest
    let canonicalArgvShapeDigest: AOSSHA256Digest
    let reviewedDependencySetDigest: AOSSHA256Digest
    let daemonGeneration: UInt64
    let createdAtMonotonicNanoseconds: UInt64
    let expiresAtMonotonicNanoseconds: UInt64
    var admittedChild: AOSExternalDispatchAdmittedChild?
}

enum AOSExternalDispatchIntentClosureReason: String, Codable, Sendable {
    case abandoned = "prepared_operation_abandoned"
    case expired = "prepared_operation_expired"
    case bootRecovery = "prepared_operation_boot_recovered"
    case finalizeRejected = "prepared_operation_finalize_rejected"
}

struct AOSClosedExternalDispatchSpawnIntent: Codable, Hashable, Sendable {
    let spawnRecordID: String
    let oneTimeBindingTokenDigest: AOSSHA256Digest
    let parent: AOSProcessGenerationIdentity
    let operationID: String
    let operationGeneration: UInt64
    let daemonGeneration: UInt64
    let closedAtMonotonicNanoseconds: UInt64
    let reason: AOSExternalDispatchIntentClosureReason
}

struct AOSExternalDispatchFinalizationObservation: Sendable {
    let spawnRecordID: String
    let peer: AOSSocketPeerIdentity
    let parentEdge: AOSStableProcessEdge
    let runningExecutable: AOSExternalRunningExecutableEvidence
    let operationID: String
    let operationGeneration: UInt64
    let adapterID: String
    let adapterRegistrationRevision: UInt64
    let canonicalArgvShapeDigest: AOSSHA256Digest
    let finalizedAtMonotonicNanoseconds: UInt64
}

enum AOSExternalDispatchSpawnOutcome: String, Codable, Sendable {
    case finalized = "generation_bound_spawn_record_finalized"
}

struct AOSExternalDispatchSpawnReceipt: Codable, Hashable, Sendable {
    let spawnRecordID: String
    let operationID: String
    let operationGeneration: UInt64
    let adapterID: String
    let adapterRegistrationRevision: UInt64
    let resolvedExecutablePathDigest: AOSSHA256Digest
    let executableIdentityDigest: AOSSHA256Digest
    let executableFileDigest: AOSSHA256Digest
    let platformCodeDirectoryHash: AOSPlatformCodeDirectoryHash
    let platformCodeDirectoryHashAlgorithm: String
    let expectedScriptIdentityDigest: AOSSHA256Digest
    let scriptIdentityDigest: AOSSHA256Digest
    let scriptDigest: AOSSHA256Digest
    let canonicalArgvShapeDigest: AOSSHA256Digest
    let reviewedDependencySetDigest: AOSSHA256Digest
    let outcome: AOSExternalDispatchSpawnOutcome
}

struct AOSFinalizedExternalDispatchSpawnRecord: Codable, Hashable, Sendable {
    let skipRecord: AOSGenerationBoundSpawnRecord
    let oneTimeBindingTokenDigest: AOSSHA256Digest
    let resolvedExecutablePathDigest: AOSSHA256Digest
    let executableDevice: UInt64
    let executableInode: UInt64
    let executableCodeIdentityDigest: AOSSHA256Digest
    let executableFileDigest: AOSSHA256Digest
    let platformCodeDirectoryHash: AOSPlatformCodeDirectoryHash
    let signingIdentifier: String
    let signingTeamIdentifier: String
    let expectedScriptIdentityDigest: AOSSHA256Digest
    let scriptIdentityDigest: AOSSHA256Digest
    let scriptDigest: AOSSHA256Digest
    let canonicalArgvShapeDigest: AOSSHA256Digest
    let reviewedDependencySetDigest: AOSSHA256Digest
    let receipt: AOSExternalDispatchSpawnReceipt
}

enum AOSExternalDispatchSpawnBinder {
    static func makeIntent(
        spawnRecordID: String,
        oneTimeBindingToken: Data,
        parent: AOSProcessGenerationIdentity,
        operationID: String,
        operationGeneration: UInt64,
        adapterID: String,
        adapterRegistrationRevision: UInt64,
        routeSourceID: String? = nil,
        routeSourceRevision: AOSSHA256Digest? = nil,
        executable: AOSResolvedExecutableObservation,
        authoredScriptIdentity: String,
        expectedScriptDigest: AOSSHA256Digest,
        canonicalArgvShapeDigest: AOSSHA256Digest,
        reviewedDependencySetDigest: AOSSHA256Digest,
        daemonGeneration: UInt64 = 1,
        createdAtMonotonicNanoseconds: UInt64 = 1,
        expiresAtMonotonicNanoseconds: UInt64 = 2
    ) throws -> AOSExternalDispatchSpawnIntent {
        guard !spawnRecordID.isEmpty,
              !oneTimeBindingToken.isEmpty,
              !operationID.isEmpty,
              operationGeneration > 0,
              !adapterID.isEmpty,
              adapterRegistrationRevision > 0,
              daemonGeneration > 0,
              createdAtMonotonicNanoseconds > 0,
              expiresAtMonotonicNanoseconds > createdAtMonotonicNanoseconds else {
            throw AOSExternalDispatchSpawnBindingError.invalidIntent
        }
        let scriptIdentityDigest = try digestScriptIdentity(
            authoredScriptIdentity
        )
        return AOSExternalDispatchSpawnIntent(
            spawnRecordID: spawnRecordID,
            oneTimeBindingTokenDigest: .hashing(
                domain: .externalBindingToken,
                data: oneTimeBindingToken
            ),
            parent: parent,
            operationID: operationID,
            operationGeneration: operationGeneration,
            adapterID: adapterID,
            adapterRegistrationRevision: adapterRegistrationRevision,
            routeSourceID: routeSourceID,
            routeSourceRevision: routeSourceRevision,
            executable: executable,
            expectedScriptIdentityDigest: scriptIdentityDigest,
            expectedScriptDigest: expectedScriptDigest,
            canonicalArgvShapeDigest: canonicalArgvShapeDigest,
            reviewedDependencySetDigest: reviewedDependencySetDigest,
            daemonGeneration: daemonGeneration,
            createdAtMonotonicNanoseconds: createdAtMonotonicNanoseconds,
            expiresAtMonotonicNanoseconds: expiresAtMonotonicNanoseconds,
            admittedChild: nil
        )
    }

    static func admit(
        intent: AOSExternalDispatchSpawnIntent,
        oneTimeBindingToken: Data,
        authenticatedParent: AOSProcessGenerationIdentity,
        childEdge: AOSStableProcessEdge,
        runningExecutable: AOSExternalRunningExecutableEvidence,
        admittedAtMonotonicNanoseconds: UInt64
    ) throws -> AOSExternalDispatchSpawnIntent {
        guard intent.oneTimeBindingTokenDigest == .hashing(
            domain: .externalBindingToken,
            data: oneTimeBindingToken
        ) else {
            throw AOSExternalDispatchSpawnBindingError.bindingTokenMismatch
        }
        guard intent.parent == authenticatedParent,
              childEdge.parent.generation == authenticatedParent,
              childEdge.child.generation.parentPID == authenticatedParent.pid,
              childEdge.receipt == .make(
                  child: childEdge.child.generation,
                  parent: childEdge.parent.generation
              ) else {
            throw AOSExternalDispatchSpawnBindingError.parentEdgeMismatch
        }
        guard runningExecutable.resolvedPathDigest == intent.executable.resolvedPathDigest,
              runningExecutable.device == intent.executable.device,
              runningExecutable.inode == intent.executable.inode,
              let expectedPlatformCodeDirectoryHash
                = intent.executable.platformCodeDirectoryHash,
              intent.executable.signingIdentifier == "node",
              intent.executable.signingTeamIdentifier == "HX7739G8FX",
              runningExecutable.platformCodeDirectoryHash
                == expectedPlatformCodeDirectoryHash,
              runningExecutable.signingIdentifier == intent.executable.signingIdentifier,
              runningExecutable.signingTeamIdentifier
                == intent.executable.signingTeamIdentifier else {
            throw AOSExternalDispatchSpawnBindingError.executableMismatch
        }
        guard admittedAtMonotonicNanoseconds >= intent.createdAtMonotonicNanoseconds,
              admittedAtMonotonicNanoseconds < intent.expiresAtMonotonicNanoseconds else {
            throw AOSExternalDispatchSpawnBindingError.intentExpired
        }
        let admission = AOSExternalDispatchAdmittedChild(
            child: childEdge.child.generation,
            parentEdgeReceipt: childEdge.receipt,
            runningExecutable: runningExecutable,
            admittedAtMonotonicNanoseconds: admittedAtMonotonicNanoseconds
        )
        if let existing = intent.admittedChild {
            guard existing == admission else {
                throw AOSExternalDispatchSpawnBindingError.childAdmissionMismatch
            }
            return intent
        }
        var admitted = intent
        admitted.admittedChild = admission
        return admitted
    }

    static func digestScriptIdentity(
        _ authoredScriptIdentity: String
    ) throws -> AOSSHA256Digest {
        guard !authoredScriptIdentity.isEmpty,
              authoredScriptIdentity == authoredScriptIdentity.precomposedStringWithCanonicalMapping,
              !authoredScriptIdentity.hasPrefix("/"),
              !authoredScriptIdentity.hasSuffix("/"),
              !authoredScriptIdentity.contains("\\"),
              !authoredScriptIdentity.unicodeScalars.contains(where: {
                  $0.value == 0 || CharacterSet.controlCharacters.contains($0)
              }) else {
            throw AOSExternalDispatchSpawnBindingError.invalidScriptIdentity
        }
        let components = authoredScriptIdentity.split(
            separator: "/",
            omittingEmptySubsequences: false
        )
        guard components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else {
            throw AOSExternalDispatchSpawnBindingError.invalidScriptIdentity
        }
        return .hashing(
            domain: .externalScriptIdentity,
            data: Data(authoredScriptIdentity.utf8)
        )
    }

    static func finalize(
        intent: AOSExternalDispatchSpawnIntent,
        observation: AOSExternalDispatchFinalizationObservation
    ) throws -> AOSFinalizedExternalDispatchSpawnRecord {
        guard intent.spawnRecordID == observation.spawnRecordID else {
            throw AOSExternalDispatchSpawnBindingError.spawnRecordMismatch
        }
        guard let admission = intent.admittedChild else {
            throw AOSExternalDispatchSpawnBindingError.childNotAdmitted
        }
        guard observation.peer.pid == observation.parentEdge.child.generation.pid,
              observation.peer.effectiveUID
                == observation.parentEdge.child.generation.effectiveUID,
              admission.child == observation.parentEdge.child.generation,
              intent.parent == observation.parentEdge.parent.generation,
              admission.parentEdgeReceipt == observation.parentEdge.receipt,
              observation.parentEdge.receipt == .make(
                  child: observation.parentEdge.child.generation,
                  parent: observation.parentEdge.parent.generation
              ) else {
            throw AOSExternalDispatchSpawnBindingError.parentEdgeMismatch
        }
        guard intent.operationID == observation.operationID,
              intent.operationGeneration == observation.operationGeneration else {
            throw AOSExternalDispatchSpawnBindingError.operationMismatch
        }
        guard intent.adapterID == observation.adapterID,
              intent.adapterRegistrationRevision
                == observation.adapterRegistrationRevision else {
            throw AOSExternalDispatchSpawnBindingError.adapterMismatch
        }
        guard admission.runningExecutable == observation.runningExecutable else {
            throw AOSExternalDispatchSpawnBindingError.executableMismatch
        }
        guard let platformCodeDirectoryHash = intent.executable.platformCodeDirectoryHash,
              let signingIdentifier = intent.executable.signingIdentifier,
              let signingTeamIdentifier = intent.executable.signingTeamIdentifier else {
            throw AOSExternalDispatchSpawnBindingError.executableMismatch
        }
        guard intent.canonicalArgvShapeDigest
                == observation.canonicalArgvShapeDigest else {
            throw AOSExternalDispatchSpawnBindingError.argvShapeMismatch
        }
        guard observation.finalizedAtMonotonicNanoseconds
                >= admission.admittedAtMonotonicNanoseconds,
              observation.finalizedAtMonotonicNanoseconds
                < intent.expiresAtMonotonicNanoseconds else {
            throw AOSExternalDispatchSpawnBindingError.intentExpired
        }

        let skipRecord = AOSGenerationBoundSpawnRecord(
            spawnRecordID: intent.spawnRecordID,
            evidenceScope: .immediateSocketPeer,
            child: observation.parentEdge.child.generation,
            parent: observation.parentEdge.parent.generation,
            parentEdgeReceipt: observation.parentEdge.receipt,
            operationID: intent.operationID,
            operationGeneration: intent.operationGeneration,
            adapterID: intent.adapterID,
            adapterRegistrationRevision: intent.adapterRegistrationRevision,
            executableIdentityDigest: intent.executable.executableIdentityDigest,
            executableDigest: intent.executable.fileDigest,
            reviewedDependencySetDigest: intent.reviewedDependencySetDigest,
            childAuditToken: observation.peer.auditToken
        )
        let receipt = AOSExternalDispatchSpawnReceipt(
            spawnRecordID: intent.spawnRecordID,
            operationID: intent.operationID,
            operationGeneration: intent.operationGeneration,
            adapterID: intent.adapterID,
            adapterRegistrationRevision: intent.adapterRegistrationRevision,
            resolvedExecutablePathDigest: intent.executable.resolvedPathDigest,
            executableIdentityDigest: intent.executable.executableIdentityDigest,
            executableFileDigest: intent.executable.fileDigest,
            platformCodeDirectoryHash: platformCodeDirectoryHash,
            platformCodeDirectoryHashAlgorithm: AOSPlatformCodeDirectoryHash.algorithm,
            expectedScriptIdentityDigest: intent.expectedScriptIdentityDigest,
            scriptIdentityDigest: intent.expectedScriptIdentityDigest,
            scriptDigest: intent.expectedScriptDigest,
            canonicalArgvShapeDigest: observation.canonicalArgvShapeDigest,
            reviewedDependencySetDigest: intent.reviewedDependencySetDigest,
            outcome: .finalized
        )
        return AOSFinalizedExternalDispatchSpawnRecord(
            skipRecord: skipRecord,
            oneTimeBindingTokenDigest: intent.oneTimeBindingTokenDigest,
            resolvedExecutablePathDigest: intent.executable.resolvedPathDigest,
            executableDevice: intent.executable.device,
            executableInode: intent.executable.inode,
            executableCodeIdentityDigest: intent.executable.codeIdentityDigest,
            executableFileDigest: intent.executable.fileDigest,
            platformCodeDirectoryHash: platformCodeDirectoryHash,
            signingIdentifier: signingIdentifier,
            signingTeamIdentifier: signingTeamIdentifier,
            expectedScriptIdentityDigest: intent.expectedScriptIdentityDigest,
            scriptIdentityDigest: intent.expectedScriptIdentityDigest,
            scriptDigest: intent.expectedScriptDigest,
            canonicalArgvShapeDigest: observation.canonicalArgvShapeDigest,
            reviewedDependencySetDigest: intent.reviewedDependencySetDigest,
            receipt: receipt
        )
    }
}

enum AOSExternalDispatchSpawnBindingError: Error, Equatable {
    case invalidIntent
    case invalidScriptIdentity
    case invalidPlatformCodeDirectoryHash
    case spawnRecordMismatch
    case bindingTokenMismatch
    case parentEdgeMismatch
    case operationMismatch
    case adapterMismatch
    case executableMismatch
    case scriptMismatch
    case argvShapeMismatch
    case reviewedDependencySetMismatch
    case childNotAdmitted
    case childAdmissionMismatch
    case intentExpired
}
