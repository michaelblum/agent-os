import CryptoKit
import Darwin
import Foundation
import Security

struct AOSSHA256Digest: Codable, Hashable, Sendable {
    let value: String

    init(_ value: String) throws {
        guard value.utf8.count == 64,
              value.utf8.allSatisfy({ byte in
                  (byte >= 48 && byte <= 57) || (byte >= 97 && byte <= 102)
              }) else {
            throw AOSOwnerRootError.invalidDigest
        }
        self.value = value
    }

    static func hashing(
        domain: AOSDigestDomain,
        data: Data
    ) -> AOSSHA256Digest {
        var domainSeparated = Data(domain.rawValue.utf8)
        domainSeparated.append(0)
        domainSeparated.append(data)
        let value = SHA256.hash(data: domainSeparated)
            .map { String(format: "%02x", $0) }
            .joined()
        return try! AOSSHA256Digest(value)
    }

    init(from decoder: Decoder) throws {
        try self.init(decoder.singleValueContainer().decode(String.self))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(value)
    }
}

enum AOSDigestDomain: String, Codable, Sendable {
    case parentEdge = "aos.operation.parent-edge.v1"
    case ownerBinding = "aos.operation.owner-binding.v1"
    case externalScriptIdentity = "aos.operation.external-script-identity.v1"
    case externalBindingToken = "aos.operation.external-binding-token.v1"
    case executableCodeIdentity = "aos.operation.executable-code-identity.v1"
    case executableIdentity = "aos.operation.executable-identity.v1"
    case selectedOwner = "aos.operation.selected-owner.v1"
}

struct AOSAuditTokenIdentity: Codable, Hashable, Sendable {
    let words: [UInt32]

    init(words: [UInt32]) throws {
        guard words.count == 8 else {
            throw AOSOwnerRootError.invalidAuditToken
        }
        self.words = words
    }

    var effectiveUID: uid_t { words[1] }
    var pid: pid_t { Int32(bitPattern: words[5]) }
    var pidVersion: UInt32 { words[7] }
}

struct AOSSocketPeerIdentity: Codable, Hashable, Sendable {
    let auditToken: AOSAuditTokenIdentity
    let effectiveUID: uid_t
    let pid: pid_t
    let pidVersion: UInt32

    init(auditToken: AOSAuditTokenIdentity) {
        self.auditToken = auditToken
        effectiveUID = auditToken.effectiveUID
        pid = auditToken.pid
        pidVersion = auditToken.pidVersion
    }
}

struct AOSProcessGenerationIdentity: Codable, Hashable, Sendable {
    let pid: pid_t
    let effectiveUID: uid_t
    let parentPID: pid_t
    let startTimeSeconds: UInt64
    let startTimeMicroseconds: UInt64
}

struct AOSProcessImageEvidence: Codable, Hashable, Sendable {
    let executableIdentityDigest: AOSSHA256Digest
    let executableDigest: AOSSHA256Digest
}

struct AOSProcessObservation: Codable, Hashable, Sendable {
    let generation: AOSProcessGenerationIdentity
    let image: AOSProcessImageEvidence
}

struct AOSParentEdgeReceipt: Codable, Hashable, Sendable {
    let child: AOSProcessGenerationIdentity
    let parent: AOSProcessGenerationIdentity
    let digest: AOSSHA256Digest

    static func make(
        child: AOSProcessGenerationIdentity,
        parent: AOSProcessGenerationIdentity
    ) -> AOSParentEdgeReceipt {
        let canonical = [
            String(child.pid), String(child.effectiveUID),
            String(child.parentPID), String(child.startTimeSeconds),
            String(child.startTimeMicroseconds), String(parent.pid),
            String(parent.effectiveUID), String(parent.parentPID),
            String(parent.startTimeSeconds), String(parent.startTimeMicroseconds),
        ].joined(separator: "\u{1f}")
        return AOSParentEdgeReceipt(
            child: child,
            parent: parent,
            digest: .hashing(
                domain: .parentEdge,
                data: Data(canonical.utf8)
            )
        )
    }
}

struct AOSStableProcessEdge: Codable, Hashable, Sendable {
    let child: AOSProcessObservation
    let parent: AOSProcessObservation
    let receipt: AOSParentEdgeReceipt
}

protocol AOSProcessImageEvidenceProviding {
    func imageEvidence(for pid: pid_t) throws -> AOSProcessImageEvidence
}

struct AOSDarwinProcessImageProvider: AOSProcessImageEvidenceProviding {
    private static let sha256CodeDirectoryAlgorithm: UInt32 = 2
    func imageEvidence(for pid: pid_t) throws -> AOSProcessImageEvidence {
        let executable = try resolvedExecutable(for: pid)
        return AOSProcessImageEvidence(
            executableIdentityDigest: executable.executableIdentityDigest,
            executableDigest: executable.fileDigest
        )
    }

    func resolvedExecutable(for pid: pid_t) throws -> AOSResolvedExecutableObservation {
        guard pid > 0 else { throw AOSOwnerRootError.processUnavailable(pid) }
        var pathBuffer = [CChar](repeating: 0, count: 4 * 1_024)
        let pathLength = proc_pidpath(pid, &pathBuffer, UInt32(pathBuffer.count))
        guard pathLength > 0 else { throw AOSOwnerRootError.processUnavailable(pid) }
        let path = URL(fileURLWithPath: String(cString: pathBuffer))
            .resolvingSymlinksInPath().path
        guard !path.isEmpty else { throw AOSOwnerRootError.processUnavailable(pid) }
        let descriptor = open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
        guard descriptor >= 0 else { throw AOSOwnerRootError.processUnavailable(pid) }
        defer { close(descriptor) }
        var status = stat()
        guard fstat(descriptor, &status) == 0, (status.st_mode & S_IFMT) == S_IFREG else {
            throw AOSOwnerRootError.processUnavailable(pid)
        }
        var hasher = SHA256()
        var bytes = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            let count = read(descriptor, &bytes, bytes.count)
            guard count >= 0 else { throw AOSOwnerRootError.processUnavailable(pid) }
            if count == 0 { break }
            hasher.update(data: Data(bytes[0..<count]))
        }
        let rawFileDigest = hasher.finalize().map { String(format: "%02x", $0) }.joined()
        let fileDigest = try AOSSHA256Digest(rawFileDigest)
        let codeIdentityDigest = AOSSHA256Digest.hashing(
            domain: .executableCodeIdentity,
            data: Data(rawFileDigest.utf8)
        )
        let identity = [
            String(UInt64(status.st_dev)),
            String(UInt64(status.st_ino)),
            codeIdentityDigest.value,
            fileDigest.value,
        ].joined(separator: "\u{1f}")
        let staticSignature = try? Self.staticCodeSignatureEvidence(
            at: URL(fileURLWithPath: path)
        )
        return AOSResolvedExecutableObservation(
            resolvedPathDigest: Self.rawDigest(Data(path.utf8)),
            executableIdentityDigest: .hashing(
                domain: .executableIdentity,
                data: Data(identity.utf8)
            ),
            device: UInt64(status.st_dev),
            inode: UInt64(status.st_ino),
            codeIdentityDigest: codeIdentityDigest,
            fileDigest: fileDigest,
            platformCodeDirectoryHash: staticSignature?.platformCodeDirectoryHash,
            signingIdentifier: staticSignature?.signingIdentifier,
            signingTeamIdentifier: staticSignature?.signingTeamIdentifier
        )
    }

    func stableProcessEdge(childPID: pid_t) throws -> AOSStableProcessEdge {
        let observer = AOSDarwinOwnerRootObserver(imageProvider: self)
        let child1 = try observer.processObservation(pid: childPID)
        let parent1 = try observer.processObservation(pid: child1.generation.parentPID)
        let child2 = try observer.processObservation(pid: childPID)
        let parent2 = try observer.processObservation(pid: parent1.generation.pid)
        guard child1 == child2,
              parent1 == parent2,
              child2.generation.parentPID == parent2.generation.pid else {
            throw AOSOwnerRootError.staleAncestry(childPID)
        }
        return AOSStableProcessEdge(
            child: child2,
            parent: parent2,
            receipt: .make(child: child2.generation, parent: parent2.generation)
        )
    }

    func runningExecutableEvidence(
        for pid: pid_t
    ) throws -> AOSExternalRunningExecutableEvidence {
        guard pid > 0 else { throw AOSOwnerRootError.processUnavailable(pid) }
        let path = try processExecutablePath(pid: pid)
        let firstSignature = try Self.dynamicCodeSignatureEvidence(pid: pid)
        let vnode = try mappedMainExecutableVnode(pid: pid, executablePath: path)
        let secondSignature = try Self.dynamicCodeSignatureEvidence(pid: pid)
        guard firstSignature == secondSignature else {
            throw AOSOwnerRootError.runningExecutableChanged
        }
        return AOSExternalRunningExecutableEvidence(
            resolvedPathDigest: Self.rawDigest(Data(path.utf8)),
            device: vnode.device,
            inode: vnode.inode,
            platformCodeDirectoryHash: secondSignature.platformCodeDirectoryHash,
            signingIdentifier: secondSignature.signingIdentifier,
            signingTeamIdentifier: secondSignature.signingTeamIdentifier
        )
    }

    func externalChildBootstrapEvidence(
        for pid: pid_t,
        routeSourceID: String
    ) throws -> AOSExternalChildBootstrapEvidence {
        let arguments = try processArguments(pid: pid)
        guard arguments.count >= 4,
              arguments[1] == "--input-type=module",
              arguments[2] == "-",
              arguments[3] == routeSourceID else {
            throw AOSOwnerRootError.processArgumentsUnavailable(pid)
        }
        let shape: [String: Any] = [
            "argv_prefix": ["node", "--input-type=module", "-", routeSourceID],
            "forwarded_suffix": "path_suffix_after_route",
        ]
        let shapeData = try JSONSerialization.data(
            withJSONObject: shape,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )
        return AOSExternalChildBootstrapEvidence(
            runningExecutable: try runningExecutableEvidence(for: pid),
            canonicalArgvShapeDigest: Self.rawDigest(shapeData)
        )
    }

    func externalChildBindingEvidence(
        for pid: pid_t,
        repositoryRoot: String,
        routeSourceID: String
    ) throws -> AOSExternalChildBindingEvidence {
        let arguments = try processArguments(pid: pid)
        guard arguments.count >= 2 else { throw AOSOwnerRootError.processArgumentsUnavailable(pid) }
        let script = try Self.verifiedExternalScript(
            argument: arguments[1],
            repositoryRoot: repositoryRoot
        )
        let scriptIdentityDigest = try AOSExternalDispatchSpawnBinder.digestScriptIdentity(
            script.relativeIdentity
        )
        let scriptDigest = try Self.digestCanonicalRegularFile(script.url)
        guard arguments.count >= 3, arguments[2] == routeSourceID else {
            throw AOSOwnerRootError.processArgumentsUnavailable(pid)
        }
        let shape: [String: Any] = [
            "argv_prefix": ["node", script.relativeIdentity, routeSourceID],
            "forwarded_suffix": "path_suffix_after_route",
        ]
        let shapeData = try JSONSerialization.data(
            withJSONObject: shape,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )
        return AOSExternalChildBindingEvidence(
            executable: try resolvedExecutable(for: pid),
            scriptIdentityDigest: scriptIdentityDigest,
            scriptDigest: scriptDigest,
            canonicalArgvShapeDigest: Self.rawDigest(shapeData),
            reviewedDependencySetDigest: try Self.reviewedExternalDependencySetDigest(
                repositoryRoot: repositoryRoot
            )
        )
    }

    static func reviewedExternalDependencySetDigest(
        repositoryRoot: String
    ) throws -> AOSSHA256Digest {
        let root = URL(fileURLWithPath: repositoryRoot, isDirectory: true)
            .resolvingSymlinksInPath().standardizedFileURL
        let identities = [
            "scripts/lib/aos-daemon-client.mjs",
            "scripts/lib/aos-voice-follow.mjs",
        ]
        let members: [[String: String]] = try identities.map { identity in
            let candidate = root.appendingPathComponent(identity, isDirectory: false).path
            let verified = try verifiedExternalScript(
                argument: candidate,
                repositoryRoot: root.path
            )
            guard verified.relativeIdentity == identity else {
                throw AOSOwnerRootError.externalDependencySetInvalid
            }
            return [
                "digest": try digestCanonicalRegularFile(verified.url).value,
                "identity": identity,
            ]
        }
        let canonical = try JSONSerialization.data(
            withJSONObject: members,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )
        return rawDigest(canonical)
    }

    static func verifiedExternalScript(
        argument: String,
        repositoryRoot: String
    ) throws -> AOSVerifiedExternalScript {
        guard (argument as NSString).isAbsolutePath else {
            throw AOSOwnerRootError.externalScriptPathNotAbsolute
        }
        let root = URL(fileURLWithPath: repositoryRoot, isDirectory: true)
            .resolvingSymlinksInPath().standardizedFileURL
        let authored = URL(fileURLWithPath: argument, isDirectory: false)
            .standardizedFileURL
        let resolved = authored.resolvingSymlinksInPath().standardizedFileURL
        guard authored.path == argument, resolved.path == argument else {
            throw AOSOwnerRootError.externalScriptPathNotCanonical
        }
        guard resolved.path.hasPrefix(root.path + "/") else {
            throw AOSOwnerRootError.externalScriptOutsideRepository
        }
        return AOSVerifiedExternalScript(
            url: resolved,
            relativeIdentity: String(resolved.path.dropFirst(root.path.count + 1))
        )
    }

    private static func digestCanonicalRegularFile(
        _ url: URL
    ) throws -> AOSSHA256Digest {
        let descriptor = open(url.path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
        guard descriptor >= 0 else {
            throw AOSOwnerRootError.externalDependencySetInvalid
        }
        defer { close(descriptor) }
        var status = stat()
        guard fstat(descriptor, &status) == 0,
              (status.st_mode & S_IFMT) == S_IFREG else {
            throw AOSOwnerRootError.externalDependencySetInvalid
        }
        var hasher = SHA256()
        var bytes = [UInt8](repeating: 0, count: 64 * 1_024)
        while true {
            let count = read(descriptor, &bytes, bytes.count)
            guard count >= 0 else {
                throw AOSOwnerRootError.externalDependencySetInvalid
            }
            if count == 0 { break }
            hasher.update(data: Data(bytes[0..<count]))
        }
        return try AOSSHA256Digest(
            hasher.finalize().map { String(format: "%02x", $0) }.joined()
        )
    }

    private func processExecutablePath(pid: pid_t) throws -> String {
        var pathBuffer = [CChar](repeating: 0, count: 4 * 1_024)
        let pathLength = proc_pidpath(pid, &pathBuffer, UInt32(pathBuffer.count))
        guard pathLength > 0 else { throw AOSOwnerRootError.processUnavailable(pid) }
        let path = String(cString: pathBuffer)
        guard !path.isEmpty, (path as NSString).isAbsolutePath else {
            throw AOSOwnerRootError.processUnavailable(pid)
        }
        return path
    }

    private func mappedMainExecutableVnode(
        pid: pid_t,
        executablePath: String
    ) throws -> (device: UInt64, inode: UInt64) {
        var address: UInt64 = 0
        let expected = MemoryLayout<proc_regionwithpathinfo>.size
        for _ in 0..<16_384 {
            var region = proc_regionwithpathinfo()
            let received = withUnsafeMutablePointer(to: &region) { pointer in
                proc_pidinfo(
                    pid,
                    PROC_PIDREGIONPATHINFO,
                    address,
                    pointer,
                    Int32(expected)
                )
            }
            guard received == expected else { break }
            let info = region.prp_prinfo
            let next = info.pri_address.addingReportingOverflow(info.pri_size)
            guard !next.overflow, next.partialValue > address else {
                throw AOSOwnerRootError.runningExecutableUnverifiable
            }
            address = next.partialValue
            let path = withUnsafePointer(to: &region.prp_vip.vip_path) { pointer in
                pointer.withMemoryRebound(to: CChar.self, capacity: Int(MAXPATHLEN)) {
                    String(cString: $0)
                }
            }
            let stat = region.prp_vip.vip_vi.vi_stat
            if path == executablePath,
               info.pri_offset == 0,
               (info.pri_protection & UInt32(VM_PROT_EXECUTE)) != 0,
               (stat.vst_mode & UInt16(S_IFMT)) == UInt16(S_IFREG),
               stat.vst_ino > 0 {
                return (UInt64(stat.vst_dev), stat.vst_ino)
            }
        }
        throw AOSOwnerRootError.runningExecutableUnverifiable
    }

    private static func staticCodeSignatureEvidence(
        at url: URL
    ) throws -> AOSExternalCodeSignatureEvidence {
        var code: SecStaticCode?
        guard SecStaticCodeCreateWithPath(
            url as CFURL,
            SecCSFlags(),
            &code
        ) == errSecSuccess, let code,
        SecStaticCodeCheckValidity(code, SecCSFlags(), nil) == errSecSuccess else {
            throw AOSOwnerRootError.runningExecutableUnverifiable
        }
        return try codeSignatureEvidence(code)
    }

    private static func dynamicCodeSignatureEvidence(
        pid: pid_t
    ) throws -> AOSExternalCodeSignatureEvidence {
        var guest: SecCode?
        let attributes = [
            kSecGuestAttributePid as String: NSNumber(value: pid),
        ] as CFDictionary
        var requirement: SecRequirement?
        let requirementSource = "anchor apple generic and identifier \"node\" "
            + "and certificate leaf[subject.OU] = \"HX7739G8FX\""
        guard SecRequirementCreateWithString(
            requirementSource as CFString,
            SecCSFlags(),
            &requirement
        ) == errSecSuccess, let requirement,
        SecCodeCopyGuestWithAttributes(
            nil,
            attributes,
            SecCSFlags(),
            &guest
        ) == errSecSuccess, let guest,
        SecCodeCheckValidity(guest, SecCSFlags(), requirement) == errSecSuccess else {
            throw AOSOwnerRootError.runningExecutableUnverifiable
        }
        // The Swift overlay types this C API to SecStaticCode even though the
        // Security header explicitly accepts live SecCode values. The CF object
        // identity is preserved by this type-only bridge.
        return try codeSignatureEvidence(
            unsafeBitCast(guest, to: SecStaticCode.self)
        )
    }

    private static func codeSignatureEvidence(
        _ code: SecStaticCode
    ) throws -> AOSExternalCodeSignatureEvidence {
        var rawInformation: CFDictionary?
        let flags = SecCSFlags(rawValue: kSecCSSigningInformation)
        guard SecCodeCopySigningInformation(code, flags, &rawInformation) == errSecSuccess,
              let information = rawInformation as? [CFString: Any],
              let algorithms = information[kSecCodeInfoDigestAlgorithms] as? [NSNumber],
              let hashes = information[kSecCodeInfoCdHashes] as? [Data],
              let signingIdentifier = information[kSecCodeInfoIdentifier] as? String,
              let signingTeamIdentifier
                = information[kSecCodeInfoTeamIdentifier] as? String,
              let signingFlags = information[kSecCodeInfoFlags] as? NSNumber,
              algorithms.count == hashes.count,
              let index = algorithms.firstIndex(where: {
                  $0.uint32Value == sha256CodeDirectoryAlgorithm
              }), hashes[index].count == 20,
              (signingFlags.uint32Value & 0x0001_0000) != 0 else {
            throw AOSOwnerRootError.runningExecutableUnverifiable
        }
        return AOSExternalCodeSignatureEvidence(
            platformCodeDirectoryHash: try AOSPlatformCodeDirectoryHash(
                hashes[index].map { String(format: "%02x", $0) }.joined()
            ),
            signingIdentifier: signingIdentifier,
            signingTeamIdentifier: signingTeamIdentifier
        )
    }

    private func processArguments(pid: pid_t) throws -> [String] {
        var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
        var byteCount = 0
        guard sysctl(&mib, u_int(mib.count), nil, &byteCount, nil, 0) == 0,
              byteCount > MemoryLayout<Int32>.size,
              byteCount <= 4 * 1_024 * 1_024 else {
            throw AOSOwnerRootError.processArgumentsUnavailable(pid)
        }
        var bytes = [UInt8](repeating: 0, count: byteCount)
        guard sysctl(&mib, u_int(mib.count), &bytes, &byteCount, nil, 0) == 0,
              byteCount > MemoryLayout<Int32>.size else {
            throw AOSOwnerRootError.processArgumentsUnavailable(pid)
        }
        let argumentCount = bytes.withUnsafeBytes {
            Int($0.loadUnaligned(as: Int32.self))
        }
        guard argumentCount > 0, argumentCount <= 16_384 else {
            throw AOSOwnerRootError.processArgumentsUnavailable(pid)
        }
        var cursor = MemoryLayout<Int32>.size
        func skipCString() {
            while cursor < byteCount, bytes[cursor] != 0 { cursor += 1 }
            while cursor < byteCount, bytes[cursor] == 0 { cursor += 1 }
        }
        skipCString()
        var arguments: [String] = []
        while arguments.count < argumentCount, cursor < byteCount {
            let start = cursor
            while cursor < byteCount, bytes[cursor] != 0 { cursor += 1 }
            guard cursor > start,
                  let value = String(bytes: bytes[start..<cursor], encoding: .utf8) else {
                throw AOSOwnerRootError.processArgumentsUnavailable(pid)
            }
            arguments.append(value)
            while cursor < byteCount, bytes[cursor] == 0 { cursor += 1 }
        }
        guard arguments.count == argumentCount else {
            throw AOSOwnerRootError.processArgumentsUnavailable(pid)
        }
        return arguments
    }

    private static func rawDigest(_ data: Data) -> AOSSHA256Digest {
        let value = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        return try! AOSSHA256Digest(value)
    }
}

struct AOSExternalChildBindingEvidence: Sendable {
    let executable: AOSResolvedExecutableObservation
    let scriptIdentityDigest: AOSSHA256Digest
    let scriptDigest: AOSSHA256Digest
    let canonicalArgvShapeDigest: AOSSHA256Digest
    let reviewedDependencySetDigest: AOSSHA256Digest
}

struct AOSExternalChildBootstrapEvidence: Sendable {
    let runningExecutable: AOSExternalRunningExecutableEvidence
    let canonicalArgvShapeDigest: AOSSHA256Digest
}

private struct AOSExternalCodeSignatureEvidence: Equatable {
    let platformCodeDirectoryHash: AOSPlatformCodeDirectoryHash
    let signingIdentifier: String
    let signingTeamIdentifier: String
}

struct AOSVerifiedExternalScript: Sendable {
    let url: URL
    let relativeIdentity: String
}

protocol AOSOwnerRootObserving {
    func immediatePeer(socketFD: Int32) throws -> AOSSocketPeerIdentity
    func processObservation(pid: pid_t) throws -> AOSProcessObservation
}

struct AOSDarwinOwnerRootObserver<ImageProvider: AOSProcessImageEvidenceProviding>:
    AOSOwnerRootObserving
{
    let imageProvider: ImageProvider

    func immediatePeer(socketFD: Int32) throws -> AOSSocketPeerIdentity {
        guard socketFD >= 0 else { throw AOSOwnerRootError.invalidSocket }
        var token = audit_token_t()
        var length = socklen_t(MemoryLayout<audit_token_t>.size)
        let status = getsockopt(
            socketFD,
            SOL_LOCAL,
            LOCAL_PEERTOKEN,
            &token,
            &length
        )
        guard status == 0,
              Int(length) == MemoryLayout<audit_token_t>.size else {
            throw AOSOwnerRootError.peerTokenUnavailable(errno)
        }
        let words = withUnsafeBytes(of: token) { raw in
            Array(raw.bindMemory(to: UInt32.self))
        }
        return AOSSocketPeerIdentity(
            auditToken: try AOSAuditTokenIdentity(words: words)
        )
    }

    func processObservation(pid: pid_t) throws -> AOSProcessObservation {
        guard pid > 0 else { throw AOSOwnerRootError.processUnavailable(pid) }
        var info = proc_bsdinfo()
        let expected = MemoryLayout<proc_bsdinfo>.size
        let received = withUnsafeMutablePointer(to: &info) { pointer in
            proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, pointer, Int32(expected))
        }
        guard received == expected,
              info.pbi_pid == UInt32(bitPattern: pid),
              info.pbi_ppid > 0 else {
            throw AOSOwnerRootError.processUnavailable(pid)
        }
        return AOSProcessObservation(
            generation: AOSProcessGenerationIdentity(
                pid: pid,
                effectiveUID: info.pbi_uid,
                parentPID: pid_t(bitPattern: info.pbi_ppid),
                startTimeSeconds: info.pbi_start_tvsec,
                startTimeMicroseconds: info.pbi_start_tvusec
            ),
            image: try imageProvider.imageEvidence(for: pid)
        )
    }
}

struct AOSExactImageSkipProof: Codable, Hashable, Sendable {
    let child: AOSProcessGenerationIdentity
    let parent: AOSProcessGenerationIdentity
    let parentEdgeReceipt: AOSParentEdgeReceipt
    let adapterRegistrationID: String
    let adapterRegistrationRevision: UInt64
    let image: AOSProcessImageEvidence
    let immediatePeerAuditToken: AOSAuditTokenIdentity?
}

enum AOSOwnerRootNodeClassification: Sendable {
    case nonAOS
    case exactAOSImage(AOSExactImageSkipProof)
    case exactCurrentAOSImage(adapterRegistrationID: String, adapterRegistrationRevision: UInt64)
    case generationBoundSpawnRecord(AOSGenerationBoundSpawnRecord)
    case unverifiedAOSAdapter
}

protocol AOSOwnerRootClassifying {
    func classification(
        for observation: AOSProcessObservation
    ) throws -> AOSOwnerRootNodeClassification
}

enum AOSUnverifiedAdapterDisposition: Sendable {
    case conservativeImmediatePeerBoundary
    case reject
}

enum AOSOwnerRootResolutionOutcome: String, Codable, Sendable {
    case directNonAOSPeer = "direct_non_aos_peer"
    case verifiedNonAOSAncestor = "verified_non_aos_ancestor"
    case conservativeImmediatePeerBoundary = "conservative_immediate_peer_boundary"
}

enum AOSOwnerRootSkipKind: String, Codable, Sendable {
    case exactAOSImage = "exact_aos_image"
    case generationBoundDaemonSpawnRecord = "generation_bound_daemon_spawn_record"
}

struct AOSOwnerRootSkippedNode: Codable, Hashable, Sendable {
    let kind: AOSOwnerRootSkipKind
    let child: AOSProcessGenerationIdentity
    let parent: AOSProcessGenerationIdentity
    let parentEdgeDigest: AOSSHA256Digest
    let exactImageProof: AOSExactImageSkipProof?
    let spawnRecord: AOSGenerationBoundSpawnRecord?
}

struct AOSOwnerRootBinding: Codable, Hashable, Sendable {
    let immediatePeer: AOSSocketPeerIdentity
    let ownerRoot: AOSProcessObservation
    let outcome: AOSOwnerRootResolutionOutcome
    let ancestorEdges: [AOSStableProcessEdge]
    let skippedNodes: [AOSOwnerRootSkippedNode]
    let bindingDigest: AOSSHA256Digest
}

enum AOSOwnerRootAction: String, Codable, Sendable {
    case signal
    case forceEscalation = "force_escalation"
    case cleanup
    case claimRelease = "claim_release"
    case barrierClose = "barrier_close"
    case barrierReopen = "barrier_reopen"
    case statusAction = "status_action"
    case canvasAction = "canvas_action"
}

struct AOSOwnerRootResolver<
    Observer: AOSOwnerRootObserving,
    Classifier: AOSOwnerRootClassifying
> {
    let observer: Observer
    let classifier: Classifier
    let unverifiedAdapterDisposition: AOSUnverifiedAdapterDisposition
    let maximumWalkDepth: Int

    init(
        observer: Observer,
        classifier: Classifier,
        unverifiedAdapterDisposition: AOSUnverifiedAdapterDisposition = .reject,
        maximumWalkDepth: Int = 64
    ) {
        self.observer = observer
        self.classifier = classifier
        self.unverifiedAdapterDisposition = unverifiedAdapterDisposition
        self.maximumWalkDepth = max(1, min(maximumWalkDepth, 256))
    }

    func resolve(socketFD: Int32) throws -> AOSOwnerRootBinding {
        let peer = try observer.immediatePeer(socketFD: socketFD)
        var currentPID = peer.pid
        var expectedCurrent: AOSProcessObservation?
        var visited = Set<pid_t>()
        var ancestorEdges: [AOSStableProcessEdge] = []
        var skipped: [AOSOwnerRootSkippedNode] = []

        for _ in 0..<maximumWalkDepth {
            guard visited.insert(currentPID).inserted else {
                throw AOSOwnerRootError.ancestryCycle(currentPID)
            }
            let edge = try stableEdge(childPID: currentPID)
            ancestorEdges.append(edge)
            if let expectedCurrent, expectedCurrent != edge.child {
                throw AOSOwnerRootError.staleAncestry(currentPID)
            }
            if currentPID == peer.pid {
                guard edge.child.generation.effectiveUID == peer.effectiveUID else {
                    throw AOSOwnerRootError.staleImmediatePeer
                }
            }

            switch try classifier.classification(for: edge.child) {
            case .nonAOS:
                return binding(
                    peer: peer,
                    root: edge.child,
                    outcome: currentPID == peer.pid
                        ? .directNonAOSPeer
                        : .verifiedNonAOSAncestor,
                    ancestorEdges: ancestorEdges,
                    skipped: skipped
                )
            case .exactAOSImage(let proof):
                try verify(proof: proof, edge: edge, peer: peer)
                skipped.append(AOSOwnerRootSkippedNode(
                    kind: .exactAOSImage,
                    child: edge.child.generation,
                    parent: edge.parent.generation,
                    parentEdgeDigest: edge.receipt.digest,
                    exactImageProof: proof,
                    spawnRecord: nil
                ))
            case let .exactCurrentAOSImage(adapterRegistrationID, adapterRegistrationRevision):
                let proof = AOSExactImageSkipProof(
                    child: edge.child.generation,
                    parent: edge.parent.generation,
                    parentEdgeReceipt: edge.receipt,
                    adapterRegistrationID: adapterRegistrationID,
                    adapterRegistrationRevision: adapterRegistrationRevision,
                    image: edge.child.image,
                    immediatePeerAuditToken: currentPID == peer.pid ? peer.auditToken : nil
                )
                try verify(proof: proof, edge: edge, peer: peer)
                skipped.append(AOSOwnerRootSkippedNode(
                    kind: .exactAOSImage,
                    child: edge.child.generation,
                    parent: edge.parent.generation,
                    parentEdgeDigest: edge.receipt.digest,
                    exactImageProof: proof,
                    spawnRecord: nil
                ))
            case .generationBoundSpawnRecord(let record):
                try record.verifySkip(edge: edge, immediatePeer: peer)
                skipped.append(AOSOwnerRootSkippedNode(
                    kind: .generationBoundDaemonSpawnRecord,
                    child: edge.child.generation,
                    parent: edge.parent.generation,
                    parentEdgeDigest: edge.receipt.digest,
                    exactImageProof: nil,
                    spawnRecord: record
                ))
            case .unverifiedAOSAdapter:
                guard unverifiedAdapterDisposition == .conservativeImmediatePeerBoundary else {
                    throw AOSOwnerRootError.unverifiedAdapter(currentPID)
                }
                let immediate = try stableEdge(childPID: peer.pid).child
                guard immediate.generation.effectiveUID == peer.effectiveUID else {
                    throw AOSOwnerRootError.staleImmediatePeer
                }
                return binding(
                    peer: peer,
                    root: immediate,
                    outcome: .conservativeImmediatePeerBoundary,
                    ancestorEdges: [try stableEdge(childPID: peer.pid)],
                    skipped: []
                )
            }

            expectedCurrent = edge.parent
            currentPID = edge.parent.generation.pid
        }
        throw AOSOwnerRootError.walkLimitExceeded
    }

    func revalidate(
        _ expected: AOSOwnerRootBinding,
        socketFD: Int32,
        for action: AOSOwnerRootAction
    ) throws -> AOSOwnerRootBinding {
        _ = action
        let current = try resolve(socketFD: socketFD)
        guard current == expected else {
            throw AOSOwnerRootError.actionIdentityStale
        }
        return current
    }

    private func stableEdge(childPID: pid_t) throws -> AOSStableProcessEdge {
        let child1 = try observer.processObservation(pid: childPID)
        let parent1 = try observer.processObservation(
            pid: child1.generation.parentPID
        )
        let child2 = try observer.processObservation(pid: childPID)
        let parent2 = try observer.processObservation(pid: parent1.generation.pid)
        guard child1 == child2,
              parent1 == parent2,
              child1.generation.parentPID == parent1.generation.pid else {
            throw AOSOwnerRootError.staleAncestry(childPID)
        }
        return AOSStableProcessEdge(
            child: child2,
            parent: parent2,
            receipt: .make(
                child: child2.generation,
                parent: parent2.generation
            )
        )
    }

    private func verify(
        proof: AOSExactImageSkipProof,
        edge: AOSStableProcessEdge,
        peer: AOSSocketPeerIdentity
    ) throws {
        guard !proof.adapterRegistrationID.isEmpty,
              proof.adapterRegistrationRevision > 0,
              proof.child == edge.child.generation,
              proof.parent == edge.parent.generation,
              proof.parentEdgeReceipt == edge.receipt,
              proof.image == edge.child.image else {
            throw AOSOwnerRootError.invalidSkipProof
        }
        if edge.child.generation.pid == peer.pid {
            guard proof.immediatePeerAuditToken == peer.auditToken else {
                throw AOSOwnerRootError.invalidSkipProof
            }
        } else if proof.immediatePeerAuditToken != nil {
            throw AOSOwnerRootError.invalidSkipProof
        }
    }

    private func binding(
        peer: AOSSocketPeerIdentity,
        root: AOSProcessObservation,
        outcome: AOSOwnerRootResolutionOutcome,
        ancestorEdges: [AOSStableProcessEdge],
        skipped: [AOSOwnerRootSkippedNode]
    ) -> AOSOwnerRootBinding {
        let payload = BindingDigestPayload(
            immediatePeer: peer,
            ownerRoot: root,
            outcome: outcome,
            ancestorEdges: ancestorEdges,
            skippedNodes: skipped
        )
        let data = try! JSONEncoder.aosCanonical.encode(payload)
        return AOSOwnerRootBinding(
            immediatePeer: peer,
            ownerRoot: root,
            outcome: outcome,
            ancestorEdges: ancestorEdges,
            skippedNodes: skipped,
            bindingDigest: .hashing(domain: .ownerBinding, data: data)
        )
    }
}

final class AOSRuntimeOwnerRootClassifier: AOSOwnerRootClassifying {
    typealias SpawnRecordLookup = (AOSProcessObservation) -> AOSGenerationBoundSpawnRecord?

    private let currentAOSImage: AOSProcessImageEvidence
    private let adapterRegistrationID: String
    private let adapterRegistrationRevision: UInt64
    private let spawnRecordLookup: SpawnRecordLookup

    init(
        currentAOSImage: AOSProcessImageEvidence,
        adapterRegistrationID: String,
        adapterRegistrationRevision: UInt64,
        spawnRecordLookup: @escaping SpawnRecordLookup
    ) {
        self.currentAOSImage = currentAOSImage
        self.adapterRegistrationID = adapterRegistrationID
        self.adapterRegistrationRevision = adapterRegistrationRevision
        self.spawnRecordLookup = spawnRecordLookup
    }

    func classification(
        for observation: AOSProcessObservation
    ) throws -> AOSOwnerRootNodeClassification {
        if observation.image == currentAOSImage {
            return .exactCurrentAOSImage(
                adapterRegistrationID: adapterRegistrationID,
                adapterRegistrationRevision: adapterRegistrationRevision
            )
        }
        if let spawnRecord = spawnRecordLookup(observation) {
            return .generationBoundSpawnRecord(spawnRecord)
        }
        return .nonAOS
    }
}

extension AOSMechanicalOwnerRoot {
    init(verified binding: AOSOwnerRootBinding) {
        let generation = binding.ownerRoot.generation
        let generationScalar = generation.startTimeSeconds
            .multipliedReportingOverflow(by: 1_000_000)
        let pidGeneration = generationScalar.overflow
            ? UInt64.max
            : generationScalar.partialValue.addingReportingOverflow(
                generation.startTimeMicroseconds
            ).partialValue
        let selected = [
            String(generation.pid),
            String(generation.effectiveUID),
            String(generation.parentPID),
            String(generation.startTimeSeconds),
            String(generation.startTimeMicroseconds),
            binding.ownerRoot.image.executableIdentityDigest.value,
            binding.ownerRoot.image.executableDigest.value,
        ].joined(separator: "\u{1f}")
        self.init(
            ownerID: AOSSHA256Digest.hashing(
                domain: .selectedOwner,
                data: Data(selected.utf8)
            ).value,
            effectiveUID: generation.effectiveUID,
            pid: generation.pid,
            pidGeneration: pidGeneration,
            executableIdentityDigest: binding.ownerRoot.image.executableIdentityDigest.value,
            verifiedBinding: binding
        )
    }
}

private struct BindingDigestPayload: Codable {
    let immediatePeer: AOSSocketPeerIdentity
    let ownerRoot: AOSProcessObservation
    let outcome: AOSOwnerRootResolutionOutcome
    let ancestorEdges: [AOSStableProcessEdge]
    let skippedNodes: [AOSOwnerRootSkippedNode]
}

extension JSONEncoder {
    fileprivate static var aosCanonical: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return encoder
    }
}

enum AOSOwnerRootError: Error, Equatable {
    case invalidDigest
    case invalidAuditToken
    case invalidSocket
    case peerTokenUnavailable(Int32)
    case processUnavailable(pid_t)
    case processArgumentsUnavailable(pid_t)
    case externalScriptPathNotAbsolute
    case externalScriptPathNotCanonical
    case externalScriptOutsideRepository
    case externalDependencySetInvalid
    case runningExecutableUnverifiable
    case runningExecutableChanged
    case staleImmediatePeer
    case staleAncestry(pid_t)
    case ancestryCycle(pid_t)
    case walkLimitExceeded
    case invalidSkipProof
    case unverifiedAdapter(pid_t)
    case actionIdentityStale
}
