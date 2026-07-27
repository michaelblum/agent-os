import Foundation

func aosSceneExtensionIdentifierIsCanonical(_ value: String) -> Bool {
    let bytes = Array(value.utf8)
    guard !bytes.isEmpty, bytes.count <= 128,
          isLowerAlphanumeric(bytes[0]),
          isLowerAlphanumeric(bytes[bytes.count - 1]),
          bytes.allSatisfy({
              isLowerAlphanumeric($0)
                  || $0 == 0x2e || $0 == 0x5f || $0 == 0x2d || $0 == 0x2f
          }),
          !value.contains("//") else { return false }
    return !value.split(separator: "/", omittingEmptySubsequences: false).contains {
        $0.isEmpty || $0 == "." || $0 == ".."
    }
}

private func isLowerAlphanumeric(_ byte: UInt8) -> Bool {
    (byte >= 0x30 && byte <= 0x39) || (byte >= 0x61 && byte <= 0x7a)
}
