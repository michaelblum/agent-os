// profiles.swift — Profile loading and built-in defaults

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
