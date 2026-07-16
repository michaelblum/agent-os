import Foundation

struct LegacyContentRootRetirement {
    let roots: [String: String]
    let retired: Bool
}

func retireLegacySigilContentRoot(
    _ roots: [String: String],
    repoRoot: String
) -> LegacyContentRootRetirement {
    let rootName = "sigil"
    guard let configuredPath = roots[rootName] else {
        return LegacyContentRootRetirement(roots: roots, retired: false)
    }

    let repoURL = URL(fileURLWithPath: repoRoot, isDirectory: true).standardizedFileURL
    let configuredURL: URL
    if configuredPath.hasPrefix("/") {
        configuredURL = URL(fileURLWithPath: configuredPath, isDirectory: true).standardizedFileURL
    } else {
        configuredURL = repoURL.appendingPathComponent(configuredPath, isDirectory: true).standardizedFileURL
    }
    let legacyFixtureURL = repoURL
        .appendingPathComponent("apps/sigil", isDirectory: true)
        .standardizedFileURL

    guard configuredURL.path == legacyFixtureURL.path else {
        return LegacyContentRootRetirement(roots: roots, retired: false)
    }

    var migrated = roots
    migrated.removeValue(forKey: rootName)
    return LegacyContentRootRetirement(roots: migrated, retired: true)
}
