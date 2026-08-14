import Darwin
import Foundation

private enum PrivateRecordHarnessFailure: Error {
    case failed
}

private struct BoundaryEnvelope: Codable {
    let value: String
}

private struct PrivateRecordHarnessReceipt: Codable {
    let destination_collision_preserved: Bool
    let destination_no_replace: Bool
    let exact_framing_mode_and_maximum: Bool
    let no_temporary_names: Bool
    let non_file_rejected: Bool
    let owned_residue_not_ready: Bool
    let path_swap_replacement_preserved: Bool
    let status: String
    let symlink_identity_preserved: Bool
    let symlink_rejected: Bool
}

private func require(_ condition: @autoclosure () -> Bool) throws {
    if !condition() { throw PrivateRecordHarnessFailure.failed }
}

private func encoded(_ value: BoundaryEnvelope) throws -> Data {
    try JSONEncoder.exactFocusSorted.encode(value)
}

private func envelope(exactBytes: Int) throws -> BoundaryEnvelope {
    let base = try encoded(BoundaryEnvelope(value: "")).count + 1
    try require(exactBytes >= base)
    return BoundaryEnvelope(value: String(repeating: "x", count: exactBytes - base))
}

private func createOwnerFile(_ url: URL, bytes: Data) throws {
    try require(FileManager.default.createFile(
        atPath: url.path,
        contents: bytes,
        attributes: [.posixPermissions: 0o600]
    ))
}

private func ownerRegularFile(_ url: URL) -> Bool {
    var metadata = stat()
    return Darwin.lstat(url.path, &metadata) == 0
        && metadata.st_mode & S_IFMT == S_IFREG
        && metadata.st_mode & mode_t(0o777) == mode_t(0o600)
}

private func metadata(_ url: URL) -> stat? {
    var value = stat()
    return Darwin.lstat(url.path, &value) == 0 ? value : nil
}

private func sameIdentity(_ first: stat, _ second: stat) -> Bool {
    first.st_dev == second.st_dev && first.st_ino == second.st_ino
        && first.st_mode & S_IFMT == second.st_mode & S_IFMT
}

private func emit<T: Encodable>(_ value: T) {
    guard let data = try? JSONEncoder.exactFocusSorted.encode(value) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
}

@main
private enum ExactFocusPrivateRecordsHarness {
    static func main() {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(
            "aos-exact-private-records-\(UUID().uuidString)",
            isDirectory: true
        )
        do {
            try FileManager.default.createDirectory(
                at: root,
                withIntermediateDirectories: false,
                attributes: [.posixPermissions: 0o700]
            )
            defer { try? FileManager.default.removeItem(at: root) }

            let maximum = 128
            let exact = try envelope(exactBytes: maximum)
            let exactFile = root.appendingPathComponent("exact.json")
            try require(writeExactFocusPrivateJSON(exact, to: exactFile, maximumBytes: maximum))
            let exactBytes = try Data(contentsOf: exactFile)
            try require(exactBytes.count == maximum)
            try require(exactBytes.last == 0x0A)
            try require(!exactBytes.dropLast().contains(0x0A))
            try require(ownerRegularFile(exactFile))
            let oversizedFile = root.appendingPathComponent("oversized.json")
            let oversized = try envelope(exactBytes: maximum + 1)
            try require(!writeExactFocusPrivateJSON(
                oversized,
                to: oversizedFile,
                maximumBytes: maximum
            ))
            try require(!FileManager.default.fileExists(atPath: oversizedFile.path))

            let preserved = Data("preserved\n".utf8)
            let existing = root.appendingPathComponent("existing.json")
            try createOwnerFile(existing, bytes: preserved)
            guard let existingBefore = metadata(existing) else { throw PrivateRecordHarnessFailure.failed }
            try require(!writeExactFocusPrivateJSON(exact, to: existing, maximumBytes: maximum))
            let existingBytes = try Data(contentsOf: existing)
            guard let existingAfter = metadata(existing) else { throw PrivateRecordHarnessFailure.failed }
            try require(existingBytes == preserved && sameIdentity(existingBefore, existingAfter))

            let symlinkTarget = root.appendingPathComponent("symlink-target.json")
            let symlinkDestination = root.appendingPathComponent("symlink-destination.json")
            try createOwnerFile(symlinkTarget, bytes: preserved)
            try require(Darwin.symlink(symlinkTarget.path, symlinkDestination.path) == 0)
            guard let symlinkBefore = metadata(symlinkDestination),
                  let symlinkTargetBefore = metadata(symlinkTarget) else {
                throw PrivateRecordHarnessFailure.failed
            }
            let symlinkTargetBytesBefore = try Data(contentsOf: symlinkTarget)
            let symlinkValue = try FileManager.default.destinationOfSymbolicLink(
                atPath: symlinkDestination.path
            )
            try require(!writeExactFocusPrivateJSON(
                exact,
                to: symlinkDestination,
                maximumBytes: maximum
            ))
            let symlinkTargetBytes = try Data(contentsOf: symlinkTarget)
            guard let symlinkAfter = metadata(symlinkDestination),
                  let symlinkTargetAfter = metadata(symlinkTarget) else {
                throw PrivateRecordHarnessFailure.failed
            }
            let symlinkAfterValue = try FileManager.default.destinationOfSymbolicLink(
                atPath: symlinkDestination.path
            )
            try require(symlinkBefore.st_mode & S_IFMT == S_IFLNK)
            try require(sameIdentity(symlinkBefore, symlinkAfter))
            try require(sameIdentity(symlinkTargetBefore, symlinkTargetAfter))
            try require(symlinkAfterValue == symlinkValue && symlinkTargetBytes == preserved)
            try require(symlinkTargetBytes == symlinkTargetBytesBefore)

            let directoryDestination = root.appendingPathComponent("directory.json", isDirectory: true)
            try FileManager.default.createDirectory(at: directoryDestination, withIntermediateDirectories: false)
            try require(!writeExactFocusPrivateJSON(
                exact,
                to: directoryDestination,
                maximumBytes: maximum
            ))
            var isDirectory: ObjCBool = false
            try require(FileManager.default.fileExists(
                atPath: directoryDestination.path,
                isDirectory: &isDirectory
            ) && isDirectory.boolValue)

            let swappedDestination = root.appendingPathComponent("swapped.json")
            let ownedResidue = root.appendingPathComponent("owned-residue.json")
            var replacementIdentity: stat?
            try require(!writeExactFocusPrivateJSON(
                exact,
                to: swappedDestination,
                maximumBytes: maximum,
                beforeReadiness: {
                    try require(Darwin.rename(swappedDestination.path, ownedResidue.path) == 0)
                    try createOwnerFile(swappedDestination, bytes: preserved)
                    replacementIdentity = metadata(swappedDestination)
                }
            ))
            guard let replacementBefore = replacementIdentity,
                  let replacementAfter = metadata(swappedDestination),
                  let residue = metadata(ownedResidue) else {
                throw PrivateRecordHarnessFailure.failed
            }
            let replacementBytes = try Data(contentsOf: swappedDestination)
            try require(sameIdentity(replacementBefore, replacementAfter))
            try require(ownerRegularFile(swappedDestination))
            try require(replacementBytes == preserved)
            try require(residue.st_mode & S_IFMT == S_IFREG)
            try require(residue.st_mode & mode_t(0o777) == mode_t(0))
            try require(residue.st_size == off_t(maximum))
            let rootEntries = try FileManager.default.contentsOfDirectory(atPath: root.path)
            let expectedEntries = [
                "directory.json", "exact.json", "existing.json", "owned-residue.json",
                "swapped.json", "symlink-destination.json", "symlink-target.json",
            ]
            try require(rootEntries.sorted() == expectedEntries)

            emit(PrivateRecordHarnessReceipt(
                destination_collision_preserved: true,
                destination_no_replace: true,
                exact_framing_mode_and_maximum: true,
                no_temporary_names: true,
                non_file_rejected: true,
                owned_residue_not_ready: true,
                path_swap_replacement_preserved: true,
                status: "passed",
                symlink_identity_preserved: true,
                symlink_rejected: true
            ))
        } catch {
            emit(["error_code": "PRIVATE_RECORD_HARNESS_FAILED", "status": "failed"])
            exit(1)
        }
    }
}
