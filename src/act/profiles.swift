// profiles.swift — Profile loading, discovery, built-in defaults, and CLI subcommands

import Foundation

// MARK: - Profile Directory

let profileDirectory: String = {
    aosProfilesDir()
}()

// MARK: - Profile Loading

/// Load a profile by name.
/// 1. Check user directory (~/.config/aos/<mode>/profiles/<name>.json)
/// 2. Fall back to built-in ("natural" → BehaviorProfile.natural)
/// 3. Return nil if not found
func loadProfile(name: String) -> BehaviorProfile? {
    let userPath = profileDirectory + "/\(name).json"
    if FileManager.default.fileExists(atPath: userPath),
       let data = FileManager.default.contents(atPath: userPath),
       let profile = try? JSONDecoder().decode(BehaviorProfile.self, from: data) {
        return profile
    }

    // Built-in fallback
    if name == "natural" {
        return .natural
    }

    return nil
}

// MARK: - Profile Discovery

/// List all available profiles (user + built-in), sorted by name.
/// Returns tuples of (name, description, source) where source is "user" or "built-in".
func listProfiles() -> [(name: String, description: String?, source: String)] {
    var results: [(name: String, description: String?, source: String)] = []
    var seen: Set<String> = []

    // Scan user directory
    let fm = FileManager.default
    if let entries = try? fm.contentsOfDirectory(atPath: profileDirectory) {
        for entry in entries where entry.hasSuffix(".json") {
            let name = String(entry.dropLast(5)) // strip .json
            let path = profileDirectory + "/\(entry)"
            if let data = fm.contents(atPath: path),
               let profile = try? JSONDecoder().decode(BehaviorProfile.self, from: data) {
                results.append((name: name, description: profile.description, source: "user"))
                seen.insert(name)
            }
        }
    }

    // Add built-in "natural" if not overridden by a user file
    if !seen.contains("natural") {
        results.append((name: "natural", description: BehaviorProfile.natural.description, source: "built-in"))
    }

    return results.sorted { $0.name < $1.name }
}

// MARK: - CLI Subcommands

/// `hand-off profiles` — list all profiles as a JSON array to stdout.
func profilesListCommand() {
    let profiles = listProfiles()

    // Build JSON array manually to use the shared encoder style
    var entries: [[String: String]] = []
    for p in profiles {
        var entry: [String: String] = ["name": p.name, "source": p.source]
        if let desc = p.description {
            entry["description"] = desc
        }
        entries.append(entry)
    }

    if let data = try? JSONSerialization.data(withJSONObject: entries, options: [.sortedKeys]),
       let s = String(data: data, encoding: .utf8) {
        print(s)
    }
}

/// `hand-off profiles show <name>` — print full profile JSON with pretty-printing.
func profilesShowCommand(name: String) {
    guard let profile = loadProfile(name: name) else {
        exitError("Profile not found: \(name)", code: "PROFILE_NOT_FOUND")
    }

    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    if let data = try? encoder.encode(profile),
       let s = String(data: data, encoding: .utf8) {
        print(s)
    }
}
