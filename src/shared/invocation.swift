// invocation.swift — process invocation display helpers

import Foundation

func aosInvocationDisplayName() -> String {
    let raw = CommandLine.arguments.first ?? "aos"
    if raw == "aos" {
        return "aos"
    }
    if raw == "./aos" {
        return "./aos"
    }

    let standardized = NSString(string: raw).standardizingPath
    if standardized == "aos" && !raw.contains("/") {
        return "aos"
    }

    let cwdAOS = (FileManager.default.currentDirectoryPath as NSString).appendingPathComponent("aos")
    if standardized == NSString(string: cwdAOS).standardizingPath {
        return "./aos"
    }

    if let repoRoot = aosCurrentRepoRoot() {
        let repoAOS = (repoRoot as NSString).appendingPathComponent("aos")
        if standardized == NSString(string: repoAOS).standardizingPath {
            return "./aos"
        }
    }

    if standardized.hasSuffix("/aos") {
        return standardized
    }

    return raw
}
