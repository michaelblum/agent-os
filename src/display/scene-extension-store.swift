import CryptoKit
import Darwin
import Foundation

struct AOSSceneExtensionStoreFailure: Error {
    let code: String
}

struct AOSSceneExtensionReference: Equatable {
    static let sceneABI = "aos.scene.projection.v1"
    static let threeRevision = "183"

    let ownerID: String
    let id: String
    let digest: String
    let sceneABI: String
    let threeRevision: String

    init(dictionary: [String: Any]) throws {
        let expected = Set(["ownerId", "id", "digest", "sceneAbi", "threeRevision"])
        guard Set(dictionary.keys) == expected,
              let ownerID = dictionary["ownerId"] as? String,
              let id = dictionary["id"] as? String,
              let digest = dictionary["digest"] as? String,
              let sceneABI = dictionary["sceneAbi"] as? String,
              let threeRevision = dictionary["threeRevision"] as? String,
              AOSSceneExtensionStore.isPathSegment(ownerID),
              AOSSceneExtensionStore.isPathSegment(id),
              AOSSceneExtensionStore.isSHA256(digest),
              sceneABI == Self.sceneABI,
              threeRevision == Self.threeRevision else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_REFERENCE_INVALID")
        }
        self.ownerID = ownerID
        self.id = id
        self.digest = digest
        self.sceneABI = sceneABI
        self.threeRevision = threeRevision
    }

    var dictionary: [String: Any] {
        [
            "ownerId": ownerID,
            "id": id,
            "digest": digest,
            "sceneAbi": sceneABI,
            "threeRevision": threeRevision,
        ]
    }
}

struct AOSSceneExtensionArtifact {
    let reference: AOSSceneExtensionReference
    let manifest: [String: Any]
    let body: Data

    func wrapperModule() throws -> Data {
        let manifestData = try JSONSerialization.data(withJSONObject: manifest, options: [.sortedKeys])
        guard let manifestJSON = String(data: manifestData, encoding: .utf8) else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_MANIFEST_ENCODING")
        }
        guard let bodySource = String(data: body, encoding: .utf8) else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_BODY_ENCODING")
        }
        let source = """
        function createProjection(context) {
        \(bodySource)
        }
        const manifest = \(manifestJSON);
        Object.freeze(manifest.implementationIds);
        Object.freeze(manifest.budgets);
        Object.freeze(manifest);
        export default Object.freeze({ manifest, createProjection });

        """
        guard let data = source.data(using: .utf8) else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_BODY_ENCODING")
        }
        return data
    }
}

final class AOSSceneExtensionStore {
    static let contract = "aos.scene.extension.v1"
    static let authorizationContract = "aos.scene.extension.authorization.v1"
    static let schemaVersion = 1

    private static let manifestKeys = Set([
        "budgets", "contract", "digest", "id", "implementationIds",
        "ownerId", "sceneAbi", "schemaVersion", "threeRevision",
    ])
    private static let budgetKeys = [
        "maxDrawCalls", "maxObjects", "maxResources", "maxTextureBytes",
        "maxTriangles", "maxWorkingBytes",
    ]
    private static let budgetLimits = [
        "maxDrawCalls": 2_048,
        "maxObjects": 1_024,
        "maxResources": 1_024,
        "maxTextureBytes": 256 * 1_024 * 1_024,
        "maxTriangles": 2_000_000,
        "maxWorkingBytes": 256 * 1_024 * 1_024,
    ]
    private static let manifestLimit = 64 * 1_024
    private static let bodyLimit = 4 * 1_024 * 1_024
    private static let authorizationLimit = 16 * 1_024
    private static let authorizationKeys = Set([
        "contract", "digest", "id", "ownerId", "sceneAbi", "threeRevision",
    ])

    private let root: String

    init(stateDirectory: String = aosStateDir()) {
        root = (stateDirectory as NSString).appendingPathComponent("scene-extensions")
    }

    static func isPathSegment(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        guard !bytes.isEmpty, bytes.count <= 128,
              isLowerAlphanumeric(bytes[0]),
              isLowerAlphanumeric(bytes[bytes.count - 1]) else { return false }
        return bytes.allSatisfy {
            isLowerAlphanumeric($0) || $0 == 0x2e || $0 == 0x5f || $0 == 0x2d
        }
    }

    static func isCanonicalImplementationID(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        guard !bytes.isEmpty, bytes.count <= 128,
              isLowerAlphanumeric(bytes[0]),
              isLowerAlphanumeric(bytes[bytes.count - 1]) else { return false }
        guard bytes.allSatisfy({
            isLowerAlphanumeric($0) || $0 == 0x2e || $0 == 0x5f || $0 == 0x2d || $0 == 0x2f
        }) else { return false }
        return !value.contains("//") && !value.split(separator: "/", omittingEmptySubsequences: false).contains {
            $0.isEmpty || $0 == "." || $0 == ".."
        }
    }

    static func isSHA256(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy {
            ($0 >= 0x30 && $0 <= 0x39) || ($0 >= 0x61 && $0 <= 0x66)
        }
    }

    private static func isLowerAlphanumeric(_ byte: UInt8) -> Bool {
        (byte >= 0x30 && byte <= 0x39) || (byte >= 0x61 && byte <= 0x7a)
    }

    private static func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func digestMaterial(
        manifest: [String: Any],
        implementationIDs: [String],
        budgets: [String: Int],
        bodyDigest: String
    ) throws -> Data {
        guard let contract = manifest["contract"] as? String,
              let schemaVersion = manifest["schemaVersion"] as? Int,
              let ownerID = manifest["ownerId"] as? String,
              let id = manifest["id"] as? String,
              let sceneABI = manifest["sceneAbi"] as? String,
              let threeRevision = manifest["threeRevision"] as? String else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_MANIFEST_INVALID")
        }
        var lines = [
            "aos.scene.extension.digest.v1",
            "contract:\(contract)",
            "schemaVersion:\(schemaVersion)",
            "ownerId:\(ownerID)",
            "id:\(id)",
            "sceneAbi:\(sceneABI)",
            "threeRevision:\(threeRevision)",
            "implementationCount:\(implementationIDs.count)",
        ]
        lines.append(contentsOf: implementationIDs.map { "implementation:\($0)" })
        for key in budgetKeys {
            guard let value = budgets[key] else {
                throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_MANIFEST_INVALID")
            }
            lines.append("budget.\(key):\(value)")
        }
        lines.append("bodySha256:\(bodyDigest)")
        lines.append("")
        guard let material = lines.joined(separator: "\n").data(using: .utf8) else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_MANIFEST_ENCODING")
        }
        return material
    }

    private static func validateDirectory(_ path: String) throws {
        var info = stat()
        guard lstat(path, &info) == 0,
              (info.st_mode & S_IFMT) == S_IFDIR,
              (info.st_mode & 0o777) == 0o700,
              info.st_uid == geteuid() else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_STORE_INVALID")
        }
    }

    private static func readOwnerOnlyFile(_ path: String, maximumBytes: Int) throws -> Data {
        var before = stat()
        guard lstat(path, &before) == 0,
              (before.st_mode & S_IFMT) == S_IFREG,
              (before.st_mode & 0o777) == 0o600,
              before.st_uid == geteuid(),
              before.st_size > 0,
              before.st_size <= off_t(maximumBytes) else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_STORE_INVALID")
        }
        let descriptor = Darwin.open(path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
        guard descriptor >= 0 else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_STORE_INVALID")
        }
        defer { Darwin.close(descriptor) }
        var opened = stat()
        guard fstat(descriptor, &opened) == 0,
              (opened.st_mode & S_IFMT) == S_IFREG,
              opened.st_dev == before.st_dev,
              opened.st_ino == before.st_ino,
              opened.st_size == before.st_size else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_STORE_CHANGED")
        }
        var data = Data(count: Int(opened.st_size))
        let count = data.withUnsafeMutableBytes { buffer -> Int in
            guard let base = buffer.baseAddress else { return 0 }
            var offset = 0
            while offset < buffer.count {
                let result = Darwin.read(descriptor, base.advanced(by: offset), buffer.count - offset)
                if result < 0 {
                    if errno == EINTR { continue }
                    return -1
                }
                if result == 0 { break }
                offset += result
            }
            return offset
        }
        guard count == data.count else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_STORE_CHANGED")
        }
        return data
    }

    private static func validatedManifest(_ data: Data) throws -> (
        dictionary: [String: Any],
        reference: AOSSceneExtensionReference,
        implementationIDs: [String],
        budgets: [String: Int]
    ) {
        guard let object = try? JSONSerialization.jsonObject(with: data),
              let manifest = object as? [String: Any],
              Set(manifest.keys) == manifestKeys,
              manifest["contract"] as? String == contract,
              manifest["schemaVersion"] as? Int == schemaVersion,
              let ownerID = manifest["ownerId"] as? String,
              let id = manifest["id"] as? String,
              let digest = manifest["digest"] as? String,
              let sceneABI = manifest["sceneAbi"] as? String,
              let threeRevision = manifest["threeRevision"] as? String,
              let implementationIDs = manifest["implementationIds"] as? [String],
              let budgetObject = manifest["budgets"] as? [String: Any],
              isPathSegment(ownerID), isPathSegment(id), isSHA256(digest),
              sceneABI == AOSSceneExtensionReference.sceneABI,
              threeRevision == AOSSceneExtensionReference.threeRevision,
              !implementationIDs.isEmpty, implementationIDs.count <= 256,
              implementationIDs == implementationIDs.sorted(),
              Set(implementationIDs).count == implementationIDs.count,
              implementationIDs.allSatisfy({
                  isCanonicalImplementationID($0) && $0.hasPrefix("\(ownerID).")
              }),
              Set(budgetObject.keys) == Set(budgetKeys) else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_MANIFEST_INVALID")
        }
        var budgets: [String: Int] = [:]
        for key in budgetKeys {
            guard let value = budgetObject[key] as? Int,
                  value >= 0,
                  value <= (budgetLimits[key] ?? -1) else {
                throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_MANIFEST_INVALID")
            }
            budgets[key] = value
        }
        let reference = try AOSSceneExtensionReference(dictionary: [
            "ownerId": ownerID,
            "id": id,
            "digest": digest,
            "sceneAbi": sceneABI,
            "threeRevision": threeRevision,
        ])
        return (manifest, reference, implementationIDs, budgets)
    }

    private static func validateAuthorization(
        _ data: Data,
        reference: AOSSceneExtensionReference
    ) throws {
        guard let object = try? JSONSerialization.jsonObject(with: data),
              let authorization = object as? [String: Any],
              Set(authorization.keys) == authorizationKeys,
              authorization["contract"] as? String == authorizationContract,
              authorization["ownerId"] as? String == reference.ownerID,
              authorization["id"] as? String == reference.id,
              authorization["digest"] as? String == reference.digest,
              authorization["sceneAbi"] as? String == reference.sceneABI,
              authorization["threeRevision"] as? String == reference.threeRevision else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_NOT_AUTHORIZED")
        }
    }

    func load(_ reference: AOSSceneExtensionReference) throws -> AOSSceneExtensionArtifact {
        let ownerRoot = (root as NSString).appendingPathComponent(reference.ownerID)
        let extensionRoot = (ownerRoot as NSString).appendingPathComponent(reference.id)
        let artifactRoot = (extensionRoot as NSString).appendingPathComponent(reference.digest)
        for directory in [root, ownerRoot, extensionRoot, artifactRoot] {
            try Self.validateDirectory(directory)
        }
        let entries = try FileManager.default.contentsOfDirectory(atPath: artifactRoot).sorted()
        guard entries.contains("authorization.json") else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_NOT_AUTHORIZED")
        }
        guard entries == ["authorization.json", "extension.json", "projection.js"] else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_STORE_INVALID")
        }
        let authorizationData = try Self.readOwnerOnlyFile(
            (artifactRoot as NSString).appendingPathComponent("authorization.json"),
            maximumBytes: Self.authorizationLimit
        )
        try Self.validateAuthorization(authorizationData, reference: reference)
        let manifestData = try Self.readOwnerOnlyFile(
            (artifactRoot as NSString).appendingPathComponent("extension.json"),
            maximumBytes: Self.manifestLimit
        )
        let bodyData = try Self.readOwnerOnlyFile(
            (artifactRoot as NSString).appendingPathComponent("projection.js"),
            maximumBytes: Self.bodyLimit
        )
        let validated = try Self.validatedManifest(manifestData)
        guard validated.reference == reference else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_IDENTITY_MISMATCH")
        }
        guard String(data: bodyData, encoding: .utf8) != nil else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_BODY_ENCODING")
        }
        let bodyDigest = Self.sha256(bodyData)
        let material = try Self.digestMaterial(
            manifest: validated.dictionary,
            implementationIDs: validated.implementationIDs,
            budgets: validated.budgets,
            bodyDigest: bodyDigest
        )
        guard Self.sha256(material) == reference.digest else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_DIGEST_MISMATCH")
        }
        return AOSSceneExtensionArtifact(
            reference: reference,
            manifest: validated.dictionary,
            body: bodyData
        )
    }

    func admitSceneOperation(
        _ operation: [String: Any],
        expectedOwnerID: String
    ) throws -> [String: Any] {
        guard let op = operation["op"] as? String else {
            throw AOSSceneExtensionStoreFailure(code: "INVALID_SCENE_OPERATION")
        }
        guard let extensionValue = operation["extension"] else { return operation }
        guard op == "mount", let extensionDictionary = extensionValue as? [String: Any] else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_REFERENCE_INVALID")
        }
        let reference = try AOSSceneExtensionReference(dictionary: extensionDictionary)
        guard reference.ownerID == expectedOwnerID else {
            throw AOSSceneExtensionStoreFailure(code: "SCENE_EXTENSION_OWNER_MISMATCH")
        }
        _ = try load(reference)
        var accepted = operation
        accepted["extension"] = reference.dictionary
        return accepted
    }
}
