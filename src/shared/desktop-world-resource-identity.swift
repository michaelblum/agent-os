import Foundation

struct AOSDesktopWorldResourceIdentity: Hashable {
    static let stageID = "desktop-world/main"

    let ownerID: String
    let resourceID: String

    init(ownerID: String, resourceID: String) throws {
        guard Self.canonicalIdentifier(ownerID, allowSlash: false) != nil else {
            throw AOSDesktopWorldResourceIdentityError.invalidOwner
        }
        guard Self.canonicalIdentifier(resourceID, allowSlash: true) != nil else {
            throw AOSDesktopWorldResourceIdentityError.invalidResource
        }
        self.ownerID = ownerID
        self.resourceID = resourceID
    }

    var key: String {
        "\(ownerID)::\(resourceID)"
    }

    static func canonicalIdentifier(_ value: Any?, allowSlash: Bool) -> String? {
        guard let value = value as? String, !value.isEmpty, value.count <= 128 else {
            return nil
        }
        let scalars = Array(value.unicodeScalars)
        func alphaNumeric(_ scalar: UnicodeScalar) -> Bool {
            (scalar.value >= 97 && scalar.value <= 122)
                || (scalar.value >= 48 && scalar.value <= 57)
        }
        guard let first = scalars.first, alphaNumeric(first) else { return nil }
        guard scalars.allSatisfy({ scalar in
            alphaNumeric(scalar)
                || scalar == "."
                || scalar == "_"
                || scalar == "-"
                || (allowSlash && scalar == "/")
        }) else { return nil }
        if allowSlash && value.split(separator: "/", omittingEmptySubsequences: false).contains(where: {
            $0.isEmpty || $0 == "." || $0 == ".."
        }) {
            return nil
        }
        return value
    }
}

enum AOSDesktopWorldResourceIdentityError: Error {
    case invalidOwner
    case invalidResource
}
