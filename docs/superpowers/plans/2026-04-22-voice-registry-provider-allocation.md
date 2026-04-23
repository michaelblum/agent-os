# Voice Registry, Providers, and Allocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hard-coded `SessionVoiceBank` with a provider-agnostic `VoiceRegistry` backed by pluggable `VoiceProvider`s (system + ElevenLabs stub), driven by a sectioned `voice/policy.json` and a rotation-plus-cooldown allocator.

**Architecture:** Strangler migration on `main`. Foundation primitives (ID + record + provider protocol) ship first as additive code. Providers + registry next. Policy file + migration + watcher next. Allocator + coordination rewrite next. Command surface + IPC schema bumps next. Telemetry + audit-confirmation pass. Final checkpoint deletes the `SessionVoiceBank` shim, lifts `qualityTier` into the system provider, and removes the legacy `voice-assignments.json` path. Each checkpoint produces working software on `main`.

**Tech Stack:** Swift (macOS app target), `NSSpeechSynthesizer` (system provider), `DispatchSourceFileSystemObject` (policy watcher), shared NDJSON IPC envelopes, `bash`-driven shell tests under `tests/`.

**Spec:** `docs/superpowers/specs/2026-04-22-voice-registry-provider-allocation-design.md` (commits 6485012 + 1edf801).

**Open-question resolutions baked in:**

1. `tests/voice-session-leases.sh` → renamed to `tests/voice-session-allocation.sh` (Task 33). CI manifest updated in same commit.
2. `ConfigWatcher` extension → second watcher instance instantiated for `voice/policy.json` (Task 17). No generalization of existing watcher.
3. Promote partial-list sort tiebreak → unlisted voices fall through to provider-rank → quality-tier → name (documented in Task 36).
4. Coordination internal API name → keep `voiceCatalog()` (no rename).
5. `MockVoiceProvider` location → `src/voice/providers/mock.swift`, plain compiled-in, activated **additively** at startup by `AOS_VOICE_TEST_PROVIDERS=mock` env (alongside system + elevenlabs, Task 7). Mock has lowest `providerRank` (5) so unbound test sessions allocate mock voices first; explicit binds to other providers still work without restart.

---

## Checkpoint R-S: Foundation, providers, registry

Builds the primitives and ships `aos voice list` over the new registry without yet replacing coordination state. Old `SessionVoiceBank` stays live; the registry is built alongside and exposed only behind a feature gate at this point.

### Task 1: VoiceID URI helpers

**Files:**
- Create: `src/voice/registry.swift`
- Create: `tests/voice-id-canonicalization.sh`

- [ ] **Step 1: Write the failing test**

```bash
cat > tests/voice-id-canonicalization.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# Each ./aos voice _internal-* call is wrapped in `|| true` so that a
# non-zero exit (including "unknown subcommand" during the red phase)
# does NOT abort the script before the assertion below it can fire.
# Without this, `set -euo pipefail` short-circuits the assignment and
# the script exits 1 with no diagnostic — defeating the whole point
# of having a FAIL message per assertion.

# Round-trip make/parse via voice-id-roundtrip helper baked into ./aos for tests.
out=$(./aos voice _internal-id-roundtrip --provider system --suffix com.apple.voice.premium.en-US.Ava 2>&1 || true)
expected="voice://system/com.apple.voice.premium.en-US.Ava|system|com.apple.voice.premium.en-US.Ava"
if [[ "$out" != "$expected" ]]; then
  echo "FAIL: round-trip mismatch: got=$out want=$expected" >&2
  exit 1
fi

# Different providers, same suffix → distinct URIs.
a=$( { ./aos voice _internal-id-roundtrip --provider system --suffix shared-id 2>&1 || true; } | cut -d'|' -f1)
b=$( { ./aos voice _internal-id-roundtrip --provider elevenlabs --suffix shared-id 2>&1 || true; } | cut -d'|' -f1)
[[ "$a" != "$b" ]] || { echo "FAIL: collision across providers (a=$a b=$b)" >&2; exit 1; }

# Bare id → canonicalize upgrades to system URI.
got=$(./aos voice _internal-canonicalize --id com.apple.voice.premium.en-US.Ava 2>&1 || true)
want="voice://system/com.apple.voice.premium.en-US.Ava"
[[ "$got" == "$want" ]] || { echo "FAIL: canonicalize bare id: got=$got want=$want" >&2; exit 1; }

# Already-canonical → unchanged.
got=$(./aos voice _internal-canonicalize --id voice://elevenlabs/abc 2>&1 || true)
[[ "$got" == "voice://elevenlabs/abc" ]] || { echo "FAIL: canonicalize URI passthrough: got=$got" >&2; exit 1; }

# Suffix containing slash survives round-trip.
out=$(./aos voice _internal-id-roundtrip --provider system --suffix "with/slash" 2>&1 || true)
expected="voice://system/with/slash|system|with/slash"
[[ "$out" == "$expected" ]] || { echo "FAIL: suffix-with-slash: got=$out want=$expected" >&2; exit 1; }

# Invalid forms → exit code 2 with VOICE_ID_INVALID.
for bad in "voice://" "voice://foo" "voice:foo/bar" ""; do
  if ./aos voice _internal-id-roundtrip --raw "$bad" 2>/dev/null; then
    echo "FAIL: expected rejection for '$bad'" >&2
    exit 1
  fi
done

echo "ok"
EOF
chmod +x tests/voice-id-canonicalization.sh
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/voice-id-canonicalization.sh`
Expected exit code: 1.
Expected stderr: a `FAIL: round-trip mismatch:` line whose `got=`
half contains whatever the current `./aos voice` command emits for
an unknown subcommand (typically `Unknown voice command:
_internal-id-roundtrip` or the voice usage banner). The exact
`got=` text is not asserted — what matters is that the script
reaches the FIRST assertion and prints its FAIL line. If the
script exits 1 with empty stderr, the `|| true` guards in Step 1
are missing or `set -euo pipefail` aborted earlier than expected;
re-check Step 1 before proceeding.

- [ ] **Step 3: Implement `VoiceID` enum**

```swift
// src/voice/registry.swift
import Foundation

enum VoiceID {
    static let prefix = "voice://"

    static func make(provider: String, providerVoiceID: String) -> String {
        precondition(!provider.contains("/"), "provider must not contain '/'")
        precondition(!provider.isEmpty, "provider must not be empty")
        precondition(!providerVoiceID.isEmpty, "providerVoiceID must not be empty")
        return "\(prefix)\(provider)/\(providerVoiceID)"
    }

    static func parse(_ id: String) -> (provider: String, providerVoiceID: String)? {
        guard id.hasPrefix(prefix) else { return nil }
        let body = id.dropFirst(prefix.count)
        guard let slashIdx = body.firstIndex(of: "/") else { return nil }
        let provider = String(body[..<slashIdx])
        let suffix = String(body[body.index(after: slashIdx)...])
        guard !provider.isEmpty, !suffix.isEmpty else { return nil }
        return (provider, suffix)
    }

    static func canonicalize(_ rawID: String) -> String {
        if rawID.hasPrefix(VoiceID.prefix) { return rawID }
        return VoiceID.make(provider: "system", providerVoiceID: rawID)
    }
}
```

- [ ] **Step 4: Wire `_internal-id-roundtrip` and `_internal-canonicalize` into `voice` command**

Edit `src/commands/voice.swift` to add the test-only subcommand handlers. These are NOT advertised in help text. Place at top of `switch subcommand`:

```swift
case "_internal-id-roundtrip":
    voiceInternalIDRoundtrip(args: Array(args.dropFirst())); return
case "_internal-canonicalize":
    voiceInternalCanonicalize(args: Array(args.dropFirst())); return
```

Then add private helpers in same file:

```swift
private func voiceInternalIDRoundtrip(args: [String]) {
    var provider: String?
    var suffix: String?
    var raw: String?
    var i = 0
    while i < args.count {
        switch args[i] {
        case "--provider": i += 1; provider = i < args.count ? args[i] : nil
        case "--suffix":   i += 1; suffix   = i < args.count ? args[i] : nil
        case "--raw":      i += 1; raw      = i < args.count ? args[i] : nil
        default: break
        }
        i += 1
    }
    if let raw {
        if let parsed = VoiceID.parse(raw) {
            print("\(raw)|\(parsed.provider)|\(parsed.providerVoiceID)"); exit(0)
        }
        FileHandle.standardError.write("VOICE_ID_INVALID\n".data(using: .utf8)!); exit(2)
    }
    guard let provider, let suffix else { exitError("missing --provider/--suffix", code: "MISSING_ARG") }
    let uri = VoiceID.make(provider: provider, providerVoiceID: suffix)
    guard let parsed = VoiceID.parse(uri) else { exitError("VOICE_ID_INVALID", code: "VOICE_ID_INVALID") }
    print("\(uri)|\(parsed.provider)|\(parsed.providerVoiceID)")
    exit(0)
}

private func voiceInternalCanonicalize(args: [String]) {
    var id: String?
    var i = 0
    while i < args.count {
        if args[i] == "--id" { i += 1; id = i < args.count ? args[i] : nil }
        i += 1
    }
    guard let id else { exitError("missing --id", code: "MISSING_ARG") }
    print(VoiceID.canonicalize(id))
    exit(0)
}
```

- [ ] **Step 5: Add `registry.swift` to build manifest**

Verify `build.sh` already globs `src/voice/*.swift`. If glob — no edit needed. If explicit list — append `src/voice/registry.swift`.

- [ ] **Step 6: Build and run test to verify it passes**

```bash
bash build.sh
bash tests/voice-id-canonicalization.sh
```
Expected: `ok` on stdout, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/voice/registry.swift src/commands/voice.swift tests/voice-id-canonicalization.sh
git commit -m "feat(voice): add VoiceID URI helpers + canonicalize + round-trip tests"
```

---

### Task 2: VoiceRecord and ProviderAvailability shapes

**Files:**
- Modify: `src/voice/registry.swift`

- [ ] **Step 1: Add `VoiceRecord` and `ProviderAvailability` structs**

Append to `src/voice/registry.swift`:

```swift
struct VoiceCapabilities: Codable, Equatable {
    var local: Bool
    var streaming: Bool
    var ssml: Bool
    var speak_supported: Bool

    static let unknown = VoiceCapabilities(local: false, streaming: false, ssml: false, speak_supported: false)
}

struct VoiceAvailability: Codable, Equatable {
    var installed: Bool
    var enabled: Bool
    var reachable: Bool

    var allocatable: Bool { installed && enabled && reachable }
}

struct VoiceRecord: Codable, Equatable {
    var id: String
    var provider: String
    var provider_voice_id: String
    var name: String
    var display_name: String?
    var locale: String?
    var language: String?
    var region: String?
    var gender: String
    var kind: String
    var quality_tier: String
    var tags: [String]
    var capabilities: VoiceCapabilities
    var availability: VoiceAvailability
    var metadata: [String: AnyCodableJSON]

    var isAllocatable: Bool { availability.allocatable && capabilities.speak_supported }
}

struct ProviderAvailability: Codable, Equatable {
    var reachable: Bool
    var reason: String?
}

/// JSON-safe value passthrough for VoiceRecord.metadata. Restricts to scalars + arrays + objects.
enum AnyCodableJSON: Codable, Equatable {
    case string(String), int(Int), double(Double), bool(Bool), null
    case array([AnyCodableJSON]), object([String: AnyCodableJSON])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let v = try? c.decode(Bool.self)    { self = .bool(v); return }
        if let v = try? c.decode(Int.self)     { self = .int(v); return }
        if let v = try? c.decode(Double.self)  { self = .double(v); return }
        if let v = try? c.decode(String.self)  { self = .string(v); return }
        if let v = try? c.decode([AnyCodableJSON].self) { self = .array(v); return }
        if let v = try? c.decode([String: AnyCodableJSON].self) { self = .object(v); return }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "unsupported JSON type")
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null:           try c.encodeNil()
        case .bool(let v):    try c.encode(v)
        case .int(let v):     try c.encode(v)
        case .double(let v):  try c.encode(v)
        case .string(let v):  try c.encode(v)
        case .array(let v):   try c.encode(v)
        case .object(let v):  try c.encode(v)
        }
    }

    var asAny: Any {
        switch self {
        case .null:           return NSNull()
        case .bool(let v):    return v
        case .int(let v):     return v
        case .double(let v):  return v
        case .string(let v):  return v
        case .array(let v):   return v.map { $0.asAny }
        case .object(let v):  return v.mapValues { $0.asAny }
        }
    }
}

extension VoiceRecord {
    /// Stable JSON dictionary for envelope payloads.
    func dictionary() -> [String: Any] {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(self),
              let any  = try? JSONSerialization.jsonObject(with: data),
              let dict = any as? [String: Any] else { return [:] }
        return dict
    }
}
```

- [ ] **Step 2: Build to verify compilation**

Run: `bash build.sh`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/voice/registry.swift
git commit -m "feat(voice): add VoiceRecord, VoiceCapabilities, VoiceAvailability, ProviderAvailability"
```

---

### Task 3: VoiceProvider protocol

**Files:**
- Create: `src/voice/provider.swift`

- [ ] **Step 1: Implement protocol**

```swift
// src/voice/provider.swift
import Foundation

protocol VoiceProvider {
    var name: String { get }
    var providerRank: Int { get }
    var availability: ProviderAvailability { get }
    func enumerate() -> [VoiceRecord]
}
```

- [ ] **Step 2: Build to verify compilation**

Run: `bash build.sh`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/voice/provider.swift
git commit -m "feat(voice): add VoiceProvider protocol"
```

---

### Task 4: SystemVoiceProvider

**Files:**
- Create: `src/voice/providers/system.swift`

- [ ] **Step 1: Implement provider wrapping `NSSpeechSynthesizer.availableVoices`**

```swift
// src/voice/providers/system.swift
import AppKit
import Foundation

struct SystemVoiceProvider: VoiceProvider {
    let name = "system"
    let providerRank = 10
    var availability: ProviderAvailability { ProviderAvailability(reachable: true, reason: nil) }

    func enumerate() -> [VoiceRecord] {
        let load: () -> [VoiceRecord] = {
            _ = NSApplication.shared
            return NSSpeechSynthesizer.availableVoices.compactMap { voiceName -> VoiceRecord? in
                let attrs = NSSpeechSynthesizer.attributes(forVoice: voiceName)
                guard let displayName = attrs[.name] as? String else { return nil }
                let suffix = voiceName.rawValue
                let locale = attrs[.localeIdentifier] as? String
                let genderRaw = attrs[.gender] as? String ?? ""
                let gender: String
                switch genderRaw {
                case "VoiceGenderFemale": gender = "female"
                case "VoiceGenderMale":   gender = "male"
                default:                  gender = "unknown"
                }
                let (lang, region) = Self.splitLocale(locale)
                let tier = Self.qualityTier(forVoiceID: suffix)
                return VoiceRecord(
                    id: VoiceID.make(provider: "system", providerVoiceID: suffix),
                    provider: "system",
                    provider_voice_id: suffix,
                    name: displayName,
                    display_name: nil,
                    locale: locale,
                    language: lang,
                    region: region,
                    gender: gender,
                    kind: "human",
                    quality_tier: tier,
                    tags: [],
                    capabilities: VoiceCapabilities(local: true, streaming: false, ssml: false, speak_supported: true),
                    availability: VoiceAvailability(installed: true, enabled: true, reachable: true),
                    metadata: [:]
                )
            }
        }
        if Thread.isMainThread { return load() }
        var out: [VoiceRecord] = []
        DispatchQueue.main.sync { out = load() }
        return out
    }

    static func splitLocale(_ locale: String?) -> (language: String?, region: String?) {
        guard let locale, !locale.isEmpty else { return (nil, nil) }
        let parts = locale.replacingOccurrences(of: "_", with: "-").split(separator: "-")
        let lang = parts.first.map(String.init)
        let region = parts.count >= 2 ? String(parts[1]) : nil
        return (lang, region)
    }

    static func qualityTier(forVoiceID voiceID: String) -> String {
        let lower = voiceID.lowercased()
        if lower.contains(".premium.") || lower.contains("_premium")   { return "premium" }
        if lower.contains(".enhanced.") || lower.contains("_enhanced") { return "enhanced" }
        return "standard"
    }
}
```

- [ ] **Step 2: Build**

Run: `bash build.sh`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/voice/providers/system.swift
git commit -m "feat(voice): add SystemVoiceProvider wrapping NSSpeechSynthesizer"
```

---

### Task 5: ElevenLabsStubProvider

**Files:**
- Create: `src/voice/providers/elevenlabs-stub.swift`

- [ ] **Step 1: Implement stub provider with fixed catalog**

```swift
// src/voice/providers/elevenlabs-stub.swift
import Foundation

struct ElevenLabsStubProvider: VoiceProvider {
    let name = "elevenlabs"
    let providerRank = 20
    var availability: ProviderAvailability {
        if ProcessInfo.processInfo.environment["AOS_VOICE_TEST_ELEVENLABS_UNREACHABLE"] == "1" {
            return ProviderAvailability(reachable: false, reason: "test override")
        }
        return ProviderAvailability(reachable: true, reason: nil)
    }

    func enumerate() -> [VoiceRecord] {
        let reachable = availability.reachable
        let voices: [(String, String, String, String, String)] = [
            // (provider_voice_id, display_name, gender, kind, cost_class)
            ("21m00Tcm4TlvDq8ikWAM", "Rachel",  "female",  "human",     "standard"),
            ("AZnzlk1XvdvUeBnXmlld", "Domi",    "female",  "human",     "standard"),
            ("ErXwobaYiN019PkySvjV", "Antoni",  "male",    "human",     "standard"),
            ("MF3mGyEYCl7XYWbV9V6O", "Elli",    "female",  "human",     "standard"),
            ("VR6AewLTigWG4xSOukaG", "Arnold",  "neutral", "character", "premium")
        ]
        return voices.map { (suffix, name, gender, kind, costClass) in
            VoiceRecord(
                id: VoiceID.make(provider: "elevenlabs", providerVoiceID: suffix),
                provider: "elevenlabs",
                provider_voice_id: suffix,
                name: name,
                display_name: nil,
                locale: "en-US",
                language: "en",
                region: "US",
                gender: gender,
                kind: kind,
                quality_tier: "standard",
                tags: [],
                capabilities: VoiceCapabilities(local: false, streaming: true, ssml: false, speak_supported: false),
                availability: VoiceAvailability(installed: true, enabled: true, reachable: reachable),
                metadata: ["cost_class": .string(costClass)]
            )
        }
    }
}
```

- [ ] **Step 2: Build**

Run: `bash build.sh`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/voice/providers/elevenlabs-stub.swift
git commit -m "feat(voice): add ElevenLabsStubProvider catalog (no synthesis)"
```

---

### Task 6: MockVoiceProvider (test toggle)

**Files:**
- Create: `src/voice/providers/mock.swift`

- [ ] **Step 1: Implement mock provider with deterministic fixture**

```swift
// src/voice/providers/mock.swift
import Foundation

/// Test-only provider activated additively by AOS_VOICE_TEST_PROVIDERS=mock at
/// process start. Mock voices have lowest providerRank so unbound test sessions
/// allocate them first; the canonical [system, elevenlabs] providers stay live
/// alongside, allowing tests to also exercise NOT_SPEAKABLE paths against the
/// elevenlabs stub without restarting the daemon.
struct MockVoiceProvider: VoiceProvider {
    let name: String
    let providerRank: Int
    let _availability: ProviderAvailability
    private let voices: [VoiceRecord]

    init(name: String = "mock", providerRank: Int = 5, reachable: Bool = true, voices: [VoiceRecord] = MockVoiceProvider.defaultFixture()) {
        self.name = name
        self.providerRank = providerRank
        self._availability = ProviderAvailability(reachable: reachable, reason: reachable ? nil : "test mock unreachable")
        self.voices = voices
    }

    var availability: ProviderAvailability { _availability }
    func enumerate() -> [VoiceRecord] { voices }

    static func defaultFixture() -> [VoiceRecord] {
        let names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"]
        return names.enumerated().map { (idx, n) in
            VoiceRecord(
                id: VoiceID.make(provider: "mock", providerVoiceID: "mock-\(n.lowercased())"),
                provider: "mock",
                provider_voice_id: "mock-\(n.lowercased())",
                name: n,
                display_name: nil,
                locale: "en-US",
                language: "en",
                region: "US",
                gender: idx % 2 == 0 ? "female" : "male",
                kind: "human",
                quality_tier: idx == 0 ? "premium" : "standard",
                tags: [],
                capabilities: VoiceCapabilities(local: true, streaming: false, ssml: false, speak_supported: true),
                availability: VoiceAvailability(installed: true, enabled: true, reachable: true),
                metadata: [:]
            )
        }
    }
}
```

- [ ] **Step 2: Build**

Run: `bash build.sh`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/voice/providers/mock.swift
git commit -m "feat(voice): add MockVoiceProvider for test runs"
```

---

### Task 7: VoiceRegistry (snapshot, lookup, refresh, providers)

**Files:**
- Modify: `src/voice/registry.swift`

- [ ] **Step 1: Append `ProviderInfo` and `VoiceRegistry`**

Append to `src/voice/registry.swift`:

```swift
struct ProviderInfo: Codable {
    let name: String
    let rank: Int
    let availability: ProviderAvailability
    let voice_count: Int
    let enabled: Bool

    func dictionary() -> [String: Any] {
        return [
            "name": name,
            "rank": rank,
            "availability": [
                "reachable": availability.reachable,
                "reason": availability.reason as Any
            ].compactMapValues { ($0 is NSNull) ? nil : $0 },
            "voice_count": voice_count,
            "enabled": enabled
        ]
    }
}

final class VoiceRegistry {
    private let providers: [VoiceProvider]
    private let policyLoader: () -> VoicePolicy?

    init(providers: [VoiceProvider]? = nil, policyLoader: @escaping () -> VoicePolicy?) {
        self.providers = providers ?? VoiceRegistry.defaultProviders()
        self.policyLoader = policyLoader
    }

    static func defaultProviders() -> [VoiceProvider] {
        var providers: [VoiceProvider] = [SystemVoiceProvider(), ElevenLabsStubProvider()]
        let env = ProcessInfo.processInfo.environment["AOS_VOICE_TEST_PROVIDERS"]
        if env == "mock" {
            providers.append(MockVoiceProvider(name: "mock", providerRank: 5))
        }
        return providers
    }

    func providersInfo() -> [ProviderInfo] {
        let policy = policyLoader()
        return providers.map { p in
            let voices = p.enumerate()
            let enabled = policy?.providers[p.name]?.enabled ?? true
            return ProviderInfo(
                name: p.name,
                rank: p.providerRank,
                availability: p.availability,
                voice_count: voices.count,
                enabled: enabled
            )
        }.sorted { $0.rank < $1.rank }
    }

    func snapshot() -> [VoiceRecord] {
        let policy = policyLoader()
        let disabledURIs = Set(policy?.voices.disabled ?? [])
        let promoteOrder: [String: Int] = {
            var out: [String: Int] = [:]
            for (idx, uri) in (policy?.voices.promote ?? []).enumerated() { out[uri] = idx }
            return out
        }()

        var combined: [(record: VoiceRecord, providerRank: Int)] = []
        for p in providers {
            let providerEnabled = policy?.providers[p.name]?.enabled ?? true
            for var rec in p.enumerate() {
                if !providerEnabled || disabledURIs.contains(rec.id) {
                    rec.availability.enabled = false
                }
                combined.append((rec, p.providerRank))
            }
        }

        return combined.sorted { lhs, rhs in
            let lp = promoteOrder[lhs.record.id]
            let rp = promoteOrder[rhs.record.id]
            switch (lp, rp) {
            case let (l?, r?): if l != r { return l < r }
            case (_?, nil):    return true
            case (nil, _?):    return false
            default: break
            }
            if lhs.providerRank != rhs.providerRank { return lhs.providerRank < rhs.providerRank }
            let lq = qualityWeight(lhs.record.quality_tier)
            let rq = qualityWeight(rhs.record.quality_tier)
            if lq != rq { return lq > rq }
            return lhs.record.name < rhs.record.name
        }.map { $0.record }
    }

    func lookup(_ uri: String) -> VoiceRecord? {
        let canonical = VoiceID.canonicalize(uri)
        return snapshot().first { $0.id == canonical }
    }

    func contains(_ uri: String) -> Bool { lookup(uri) != nil }

    func refresh() -> [VoiceRecord] { snapshot() }

    func allocatableSnapshot() -> [VoiceRecord] {
        snapshot().filter { $0.isAllocatable }
    }

    private func qualityWeight(_ tier: String) -> Int {
        switch tier {
        case "premium":  return 3
        case "enhanced": return 2
        case "standard": return 1
        default:         return 0
        }
    }
}
```

- [ ] **Step 2: Build**

Run: `bash build.sh`
Expected: build fails — `VoicePolicy` not yet defined. That's expected; Task 9 introduces it. Stub it for now to keep registry compiling:

Append a temporary stub at the bottom of `registry.swift`:

```swift
// TEMP stub — replaced in Task 9 by full type in src/voice/policy.swift.
// Keep registry compilable until policy.swift lands.
struct VoicePolicy {
    struct ProviderEntry { var enabled: Bool }
    struct VoicesSection { var disabled: [String]; var promote: [String] }
    var providers: [String: ProviderEntry] = [:]
    var voices: VoicesSection = VoicesSection(disabled: [], promote: [])
    var session_preferences: [String: String] = [:]
}
```

Re-run build:
```bash
bash build.sh
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/voice/registry.swift
git commit -m "feat(voice): add VoiceRegistry (snapshot/lookup/refresh/providers/allocatable)"
```

---

### Task 8: Registry snapshot integration test (mock providers)

**Files:**
- Create: `tests/voice-registry-snapshot.sh`

- [ ] **Step 1: Add a daemon-less internal CLI surface that prints registry snapshot**

This avoids round-tripping the daemon for unit-style coverage. Add to `src/commands/voice.swift` switch:

```swift
case "_internal-registry-snapshot":
    let policyLoader: () -> VoicePolicy? = { nil }
    let reg = VoiceRegistry(policyLoader: policyLoader)
    let snap = reg.snapshot().map { $0.dictionary() }
    let data = try! JSONSerialization.data(withJSONObject: snap, options: [.sortedKeys, .prettyPrinted])
    print(String(data: data, encoding: .utf8)!)
    exit(0)
```

- [ ] **Step 2: Write the failing test**

```bash
cat > tests/voice-registry-snapshot.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
out=$(AOS_VOICE_TEST_PROVIDERS=mock ./aos voice _internal-registry-snapshot)
echo "$out" | python3 -c "
import json, sys
voices = json.loads(sys.stdin.read())
assert len(voices) > 0, 'snapshot empty'
mock_voices = [v for v in voices if v['provider'] == 'mock']
assert len(mock_voices) >= 3, f'expected >=3 mock voices, got {len(mock_voices)}'
# Mock provider rank=5 (Task 6) is below system (10) and elevenlabs (20):
# every mock voice must precede every non-mock voice in the snapshot order.
providers = [v['provider'] for v in voices]
last_mock = max(i for i,p in enumerate(providers) if p == 'mock')
first_non_mock_idx = next((i for i,p in enumerate(providers) if p != 'mock'), len(providers))
assert last_mock < first_non_mock_idx, \
    f'mock voices must precede non-mock by rank: last_mock={last_mock}, first_non_mock={first_non_mock_idx}'
# Within mock, premium tier sorts before standard.
assert mock_voices[0]['quality_tier'] == 'premium', \
    f'premium not first within mock provider, got {mock_voices[0]}'
print('ok')
"
EOF
chmod +x tests/voice-registry-snapshot.sh
```

- [ ] **Step 3: Run test**

```bash
bash build.sh
bash tests/voice-registry-snapshot.sh
```
Expected: `ok` printed, exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/commands/voice.swift tests/voice-registry-snapshot.sh
git commit -m "test(voice): registry snapshot ranking + mock provider toggle"
```

---

## Checkpoint T-U: Policy file, migration, allocator

### Task 9: VoicePolicy load/save

**Files:**
- Create: `src/voice/policy.swift`
- Modify: `src/voice/registry.swift` (delete temp stub from Task 7)
- Modify: `shared/swift/ipc/runtime-paths.swift`

- [ ] **Step 1: Add `aosVoicePolicyPath()` helper**

Edit `shared/swift/ipc/runtime-paths.swift` near line 149:

```swift
func aosVoicePolicyPath(for mode: AOSRuntimeMode? = nil) -> String {
    return "\(aosStateDir(for: mode))/voice/policy.json"
}

@available(*, deprecated, message: "Used only by one-shot migration. Remove with shim.")
func aosVoiceAssignmentsPath(for mode: AOSRuntimeMode? = nil) -> String {
    "\(aosCoordinationDir(for: mode))/voice-assignments.json"
}
```

- [ ] **Step 2: Implement `policy.swift`**

```swift
// src/voice/policy.swift
import Foundation

struct VoicePolicy: Codable, Equatable {
    struct ProviderEntry: Codable, Equatable { var enabled: Bool }
    struct VoicesSection: Codable, Equatable {
        var disabled: [String]
        var promote:  [String]
        init(disabled: [String] = [], promote: [String] = []) {
            self.disabled = disabled; self.promote = promote
        }
    }
    var schema_version: Int = 1
    var providers: [String: ProviderEntry] = [:]
    var voices: VoicesSection = VoicesSection()
    var session_preferences: [String: String] = [:]

    static let empty = VoicePolicy()
}

final class VoicePolicyStore {
    private let path: String
    private let lock = NSLock()
    private var cached: VoicePolicy?

    init(path: String = aosVoicePolicyPath()) {
        self.path = path
    }

    var filePath: String { path }

    func load() -> VoicePolicy {
        lock.lock(); defer { lock.unlock() }
        if let cached { return cached }
        guard let data = FileManager.default.contents(atPath: path) else {
            let empty = VoicePolicy.empty
            cached = empty; return empty
        }
        let stripped = stripJSONComments(data)
        let policy = (try? JSONDecoder().decode(VoicePolicy.self, from: stripped)) ?? VoicePolicy.empty
        cached = policy
        return policy
    }

    func reload() -> VoicePolicy {
        lock.lock(); cached = nil; lock.unlock()
        return load()
    }

    func save(_ policy: VoicePolicy) {
        lock.lock(); defer { lock.unlock() }
        let dir = (path as NSString).deletingLastPathComponent
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        // .withoutEscapingSlashes is load-bearing: voice URIs (voice://system/...)
        // appear in session_preferences values + voices.disabled / voices.promote
        // arrays. Foundation's default JSONEncoder escapes '/' to '\/'. The escape
        // is RFC-8259 valid and JSONDecoder round-trips it cleanly, but the file
        // is operator-edited and grep'd by tests (Task 10 + Task 28); leaving the
        // backslashes in produces ugly noise + breaks literal grep assumptions.
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(policy) else { return }
        let tmp = path + ".tmp"
        do {
            try data.write(to: URL(fileURLWithPath: tmp), options: .atomic)
            if FileManager.default.fileExists(atPath: path) {
                try? FileManager.default.removeItem(atPath: path)
            }
            try FileManager.default.moveItem(atPath: tmp, toPath: path)
        } catch {
            fputs("voice/policy.json save failed: \(error)\n", stderr)
        }
        cached = policy
    }

    func setPreferred(sessionID: String, voiceURI: String) {
        var p = load()
        p.session_preferences[sessionID] = voiceURI
        save(p)
    }

    func clearPreferred(sessionID: String) {
        var p = load()
        p.session_preferences.removeValue(forKey: sessionID)
        save(p)
    }

    func preferred(sessionID: String) -> String? {
        load().session_preferences[sessionID]
    }

    private func stripJSONComments(_ data: Data) -> Data {
        guard let text = String(data: data, encoding: .utf8) else { return data }
        var out = ""
        out.reserveCapacity(text.count)
        var inString = false
        var i = text.startIndex
        while i < text.endIndex {
            let ch = text[i]
            if inString {
                out.append(ch)
                if ch == "\\", text.index(after: i) < text.endIndex { out.append(text[text.index(after: i)]); i = text.index(i, offsetBy: 2); continue }
                if ch == "\"" { inString = false }
                i = text.index(after: i); continue
            }
            if ch == "\"" { inString = true; out.append(ch); i = text.index(after: i); continue }
            if ch == "/", text.index(after: i) < text.endIndex, text[text.index(after: i)] == "/" {
                while i < text.endIndex && text[i] != "\n" { i = text.index(after: i) }
                continue
            }
            out.append(ch)
            i = text.index(after: i)
        }
        return out.data(using: .utf8) ?? data
    }
}
```

- [ ] **Step 3: Delete temp stub from `registry.swift`**

Remove the `// TEMP stub` block added in Task 7 (lines starting with `// TEMP stub` through closing `}` of stub `VoicePolicy`).

- [ ] **Step 4: Update `VoiceRegistry` to thread provider lookup through `VoicePolicy.ProviderEntry`**

`VoiceRegistry` already references `policy.providers[p.name]?.enabled` — that now resolves against the real type. No code change needed beyond removing the stub.

- [ ] **Step 5: Build**

```bash
bash build.sh
```
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/voice/policy.swift src/voice/registry.swift shared/swift/ipc/runtime-paths.swift
git commit -m "feat(voice): add VoicePolicy + VoicePolicyStore + aosVoicePolicyPath"
```

---

### Task 10: One-shot migration legacy → policy

**Files:**
- Modify: `src/voice/policy.swift`
- Modify: `src/commands/voice.swift`
- Create: `tests/voice-migration.sh`

- [ ] **Step 0: Patch `VoicePolicyStore.save()` encoder options**

Inherited from Task 9: the `save()` method must use
`.withoutEscapingSlashes` on its `JSONEncoder.outputFormatting`,
otherwise voice URIs land in policy.json as
`voice:\/\/system\/...` and the literal grep assertions in
Step 4 (and in Task 28) fail. Edit `src/voice/policy.swift`
inside `save()`:

```swift
// REPLACE:
encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
// WITH:
encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
```

The Task 9 code block higher in this plan was patched to
include `.withoutEscapingSlashes` for posterity; this Step 0
exists for engineers executing Task 10 against a checkout
where Task 9 was already committed without it.

- [ ] **Step 1: Append migration to `policy.swift`**

```swift
extension VoicePolicyStore {
    /// One-shot: voice-assignments.json (bare ids) → voice/policy.json session_preferences (URI form).
    /// Idempotent: skips when target already populated OR when source already renamed to .migrated.
    @discardableResult
    func migrateLegacyAssignmentsIfNeeded() -> Bool {
        let legacyPath = aosVoiceAssignmentsPath()
        let fm = FileManager.default
        guard fm.fileExists(atPath: legacyPath) else { return false }

        var policy = load()
        if !policy.session_preferences.isEmpty {
            // Source of truth already on the new file; rename legacy to .migrated.
            try? fm.moveItem(atPath: legacyPath, toPath: legacyPath + ".migrated")
            return false
        }

        guard let data = fm.contents(atPath: legacyPath),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return false
        }
        let assignments = (json["assignments"] as? [String: String]) ?? (json as? [String: String]) ?? [:]

        var migrated: [String: String] = [:]
        for (sid, voiceID) in assignments {
            migrated[sid] = VoiceID.canonicalize(voiceID)
        }
        guard !migrated.isEmpty else {
            try? fm.moveItem(atPath: legacyPath, toPath: legacyPath + ".migrated")
            return false
        }
        policy.session_preferences = migrated
        save(policy)
        try? fm.moveItem(atPath: legacyPath, toPath: legacyPath + ".migrated")
        return true
    }
}
```

- [ ] **Step 2: Add daemon-less internal helper to drive migration in tests**

Append to `src/commands/voice.swift` switch:

```swift
case "_internal-migrate-policy":
    let store = VoicePolicyStore()
    let migrated = store.migrateLegacyAssignmentsIfNeeded()
    let result = ["migrated": migrated, "policy_path": store.filePath] as [String: Any]
    print(String(data: try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), encoding: .utf8)!)
    exit(0)
```

- [ ] **Step 3: Write the failing test**

```bash
cat > tests/voice-migration.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# In-process CLI helper — no daemon, so AOS_STATE_ROOT alone is sufficient.
TMP=$(mktemp -d)
trap "rm -rf $TMP" EXIT
export AOS_STATE_ROOT="$TMP"
mkdir -p "$TMP/repo/coordination" "$TMP/repo/voice"

# Seed a legacy voice-assignments.json with bare-id voices.
cat > "$TMP/repo/coordination/voice-assignments.json" <<JSON
{"assignments":{"sid-1":"com.apple.voice.premium.en-US.Ava","sid-2":"com.apple.voice.premium.en-US.Zoe"}}
JSON

# First migration run.
out=$(./aos voice _internal-migrate-policy)
echo "$out" | grep -q '"migrated":true' || { echo "FAIL: expected migrated=true got=$out" >&2; exit 1; }

# voice/policy.json should exist with URI-form session_preferences.
[[ -f "$TMP/repo/voice/policy.json" ]] || { echo "FAIL: policy.json missing" >&2; exit 1; }
grep -q 'voice://system/com.apple.voice.premium.en-US.Ava' "$TMP/repo/voice/policy.json"
grep -q 'voice://system/com.apple.voice.premium.en-US.Zoe' "$TMP/repo/voice/policy.json"

# Legacy file renamed.
[[ -f "$TMP/repo/coordination/voice-assignments.json.migrated" ]]
[[ ! -f "$TMP/repo/coordination/voice-assignments.json" ]]

# Re-running is a no-op.
out=$(./aos voice _internal-migrate-policy)
echo "$out" | grep -q '"migrated":false'

echo "ok"
EOF
chmod +x tests/voice-migration.sh
```

- [ ] **Step 4: Run test**

```bash
bash build.sh
bash tests/voice-migration.sh
```
Expected: `ok`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/voice/policy.swift src/commands/voice.swift tests/voice-migration.sh
git commit -m "feat(voice): one-shot migration voice-assignments.json → voice/policy.json"
```

---

### Task 11: Policy file watcher

**Files:**
- Create: `src/voice/policy-watcher.swift`

**Two correctness invariants drive this design:**

1. **Shared store, not a new one.** The watcher must reload the *same*
   `VoicePolicyStore` instance the bus's `VoiceRegistry` reads through. A
   fresh `VoicePolicyStore(path:)` invalidates a different cache; the bus's
   store keeps returning the stale policy from `policyLoader()` so reseed
   sees stale `allocatableSnapshot()`. Inject the store via init.

2. **Survive `VoicePolicyStore.save()`'s atomic rename.** `save()` writes
   `policy.json.tmp` then removes + renames it onto `policy.json`. An
   `O_EVTONLY` fd opened on the *file* still references the old inode
   after the rename, so it fires exactly once and then goes silent. The
   robust fix is to watch the **parent directory** instead — its fd
   stays valid across in-directory rename/delete/create cycles, and
   `.write` on a directory fd fires whenever directory contents change.
   Single fd for the watcher's lifetime, no reopen logic, no fd-lifecycle
   races.

- [ ] **Step 1: Implement watcher with parent-directory fd**

```swift
// src/voice/policy-watcher.swift
import Foundation

final class VoicePolicyWatcher {
    private var source: DispatchSourceFileSystemObject?
    private var fd: Int32 = -1
    private let path: String
    private let dirPath: String
    private let store: VoicePolicyStore
    private let queue = DispatchQueue(label: "aos.voice.policy-watcher")
    var onChange: ((VoicePolicy) -> Void)?

    /// Pass the bus-owned store so `reload()` invalidates the cache that
    /// `VoiceRegistry`'s `policyLoader` reads through.
    init(store: VoicePolicyStore) {
        self.store = store
        self.path = store.filePath
        self.dirPath = (store.filePath as NSString).deletingLastPathComponent
    }

    /// Convenience for tests / standalone callers without a bus.
    convenience init(path: String = aosVoicePolicyPath()) {
        self.init(store: VoicePolicyStore(path: path))
    }

    func start() {
        try? FileManager.default.createDirectory(atPath: dirPath, withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: path) {
            store.save(.empty)
        }
        // Watch the parent directory, not the file. The directory fd survives
        // VoicePolicyStore.save()'s write-tmp + remove + rename cycle; a
        // file-fd would be left attached to the old inode after rename.
        fd = open(dirPath, O_EVTONLY)
        guard fd >= 0 else {
            fputs("Warning: cannot watch voice policy directory at \(dirPath)\n", stderr); return
        }
        let src = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd,
            eventMask: [.write],
            queue: queue
        )
        src.setEventHandler { [weak self] in
            guard let self else { return }
            // Directory `.write` fires for any in-dir entry change; reload
            // unconditionally — the .tmp create + rename of policy.json
            // collapses to one observable change after the brief debounce.
            usleep(50_000)
            let policy = self.store.reload()
            self.onChange?(policy)
        }
        src.setCancelHandler { [weak self] in
            guard let self else { return }
            if self.fd >= 0 { close(self.fd); self.fd = -1 }
        }
        src.resume()
        self.source = src
    }

    func stop() {
        source?.cancel(); source = nil
    }
}
```

Why parent-dir over reopen-on-rename: a reopen path has to either
preserve the cancel handler's `self.fd` reference across the swap (race)
or capture the old fd in a per-source handler before re-issuing
`open()`. Both work but add fd-lifecycle surface that an executing
subagent can get subtly wrong (leak the old fd by setting `self.fd = -1`
before the cancel handler runs). The voice/ directory only ever holds
`policy.json` and its short-lived `.tmp` companion, so the dir-write
signal-to-noise is fine.

- [ ] **Step 2: Build**

```bash
bash build.sh
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/voice/policy-watcher.swift
git commit -m "feat(voice): add VoicePolicyWatcher (shared store, parent-dir fd)"
```

---

### Task 12: VoiceAllocator (rotation + cooldown deque)

**Files:**
- Create: `src/voice/allocator.swift`
- Create: `tests/voice-allocator.sh`

- [ ] **Step 1: Implement allocator**

```swift
// src/voice/allocator.swift
import Foundation

final class VoiceAllocator {
    private var deque: [String] = []
    private let lock = NSLock()

    func seed(uris: [String]) {
        lock.lock(); defer { lock.unlock() }
        deque = uris
    }

    func reseed(uris: [String]) {
        lock.lock(); defer { lock.unlock() }
        let newSet = Set(uris)
        let survivors = deque.filter { newSet.contains($0) }
        let added = uris.filter { !survivors.contains($0) }
        deque = survivors + added
    }

    func next() -> String? {
        lock.lock(); defer { lock.unlock() }
        guard let first = deque.first else { return nil }
        deque.removeFirst()
        deque.append(first)
        return first
    }

    func markUsed(_ uri: String) {
        lock.lock(); defer { lock.unlock() }
        if let idx = deque.firstIndex(of: uri) {
            deque.remove(at: idx)
        }
        deque.append(uri)
    }

    /// Snapshot for tests; not used in production paths.
    func currentDeque() -> [String] {
        lock.lock(); defer { lock.unlock() }
        return deque
    }
}
```

- [ ] **Step 2: Add daemon-less internal allocator harness for tests**

Append to `src/commands/voice.swift` switch:

```swift
case "_internal-allocator-test":
    voiceInternalAllocatorTest(args: Array(args.dropFirst())); return
```

Then add helper:

```swift
private func voiceInternalAllocatorTest(args: [String]) {
    // args is a sequence: seed:A,B,C  next  next  used:B  reseed:B,C,D  next ...
    let alloc = VoiceAllocator()
    var output: [Any] = []
    for cmd in args {
        if cmd.hasPrefix("seed:") {
            alloc.seed(uris: String(cmd.dropFirst(5)).split(separator: ",").map(String.init))
            output.append(["op": "seed", "deque": alloc.currentDeque()])
        } else if cmd.hasPrefix("reseed:") {
            alloc.reseed(uris: String(cmd.dropFirst(7)).split(separator: ",").map(String.init))
            output.append(["op": "reseed", "deque": alloc.currentDeque()])
        } else if cmd.hasPrefix("used:") {
            alloc.markUsed(String(cmd.dropFirst(5)))
            output.append(["op": "used", "deque": alloc.currentDeque()])
        } else if cmd == "next" {
            let n = alloc.next() ?? ""
            output.append(["op": "next", "value": n, "deque": alloc.currentDeque()])
        }
    }
    let data = try! JSONSerialization.data(withJSONObject: output, options: [.sortedKeys, .prettyPrinted])
    print(String(data: data, encoding: .utf8)!)
    exit(0)
}
```

- [ ] **Step 3: Write the failing test**

```bash
cat > tests/voice-allocator.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

out=$(./aos voice _internal-allocator-test seed:A,B,C next next next next)
echo "$out" | python3 -c "
import json, sys
ops = json.loads(sys.stdin.read())
nexts = [o['value'] for o in ops if o['op']=='next']
assert nexts == ['A','B','C','A'], f'bad rotation: {nexts}'
print('rotation ok')
"

out=$(./aos voice _internal-allocator-test seed:A,B,C used:B next)
echo "$out" | python3 -c "
import json, sys
ops = json.loads(sys.stdin.read())
deque_after_used = ops[1]['deque']
assert deque_after_used == ['A','C','B'], f'bad cooldown: {deque_after_used}'
nxt = ops[2]['value']
assert nxt == 'A', f'expected A next, got {nxt}'
print('cooldown ok')
"

out=$(./aos voice _internal-allocator-test seed:A,B,C reseed:B,C,D)
echo "$out" | python3 -c "
import json, sys
ops = json.loads(sys.stdin.read())
final = ops[1]['deque']
assert final == ['B','C','D'], f'reseed survivors+new wrong: {final}'
print('reseed ok')
"

out=$(./aos voice _internal-allocator-test next)
echo "$out" | python3 -c "
import json, sys
ops = json.loads(sys.stdin.read())
assert ops[0]['value'] == '', 'empty next should be empty string'
print('empty ok')
"

echo "all ok"
EOF
chmod +x tests/voice-allocator.sh
```

- [ ] **Step 4: Build and run**

```bash
bash build.sh
bash tests/voice-allocator.sh
```
Expected: `all ok` printed.

- [ ] **Step 5: Commit**

```bash
git add src/voice/allocator.swift src/commands/voice.swift tests/voice-allocator.sh
git commit -m "feat(voice): add VoiceAllocator (rotation deque + cooldown) + unit tests"
```

---

## Checkpoint V-W: Coordination rewrite, command surface, IPC schema

### Task 13: SessionVoiceBank shim adapter

**Files:**
- Modify: `src/voice/session-voice.swift`

- [ ] **Step 1: Add `init(record:)` to `SessionVoiceDescriptor`**

Edit `SessionVoiceDescriptor` in `src/voice/session-voice.swift` to add a new init alongside the existing `init(voiceInfo:)`:

```swift
init(record: VoiceRecord, leaseSessionID: String? = nil, leaseSessionName: String? = nil) {
    self.init(
        provider: record.provider,
        id: record.id,
        name: record.display_name ?? record.name,
        locale: record.locale ?? record.language ?? "unknown",
        gender: record.gender,
        quality_tier: record.quality_tier,
        available: record.availability.allocatable,
        lease_session_id: leaseSessionID,
        lease_session_name: leaseSessionName
    )
}
```

- [ ] **Step 2: Replace `SessionVoiceBank.curatedVoices()` body with adapter over registry**

Edit `SessionVoiceBank` in same file. Mark the enum deprecated and rewrite implementation to call the registry:

```swift
@available(*, deprecated, message: "Use VoiceRegistry directly. SessionVoiceBank is a transitional shim.")
enum SessionVoiceBank {
    static func curatedVoices() -> [SessionVoiceDescriptor] {
        let store = VoicePolicyStore()
        let registry = VoiceRegistry(policyLoader: { store.load() })
        let allocatable = registry.allocatableSnapshot()
        let descriptors = allocatable.map { SessionVoiceDescriptor(record: $0) }
        return applyTestBankOverride(descriptors)
    }

    static func hasVoice(id: String) -> Bool {
        let canonical = VoiceID.canonicalize(id)
        return curatedVoices().contains { $0.id == canonical }
    }

    static func voice(id: String) -> SessionVoiceDescriptor? {
        let canonical = VoiceID.canonicalize(id)
        return curatedVoices().first { $0.id == canonical }
    }

    private static func applyTestBankOverride(_ voices: [SessionVoiceDescriptor]) -> [SessionVoiceDescriptor] {
        guard let raw = ProcessInfo.processInfo.environment["AOS_TEST_VOICE_BANK_IDS"]?
            .split(separator: ",")
            .map({ $0.trimmingCharacters(in: .whitespacesAndNewlines) })
            .filter({ !$0.isEmpty }),
              !raw.isEmpty else { return voices }
        let allowed = Set(raw.map(VoiceID.canonicalize))
        let filtered = voices.filter { allowed.contains($0.id) }
        return filtered.isEmpty ? voices : filtered
    }
}
```

Delete the old `preferredVoices` matcher list and the old `voiceQualityWeight` helper from `SessionVoiceBank` — both no longer used.

- [ ] **Step 3: Build**

```bash
bash build.sh
```
Expected: build succeeds with deprecation warnings on every call site that touches `SessionVoiceBank`. That's intentional — those call sites get rewritten in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add src/voice/session-voice.swift
git commit -m "refactor(voice): SessionVoiceBank now a shim over VoiceRegistry (deprecated)"
```

---

### Task 14: Coordination — wire registry/policy/allocator into `CoordinationBus`

**Files:**
- Modify: `src/daemon/coordination.swift`

- [ ] **Step 1: Read coordination.swift to find init signature**

```bash
grep -n "init(\|class CoordinationBus" /Users/Michael/Code/agent-os/src/daemon/coordination.swift | head -20
```

- [ ] **Step 2: Add new instance properties + init params**

In `CoordinationBus` near existing `voiceAssignmentsPath` and `voiceAssignments` properties, add:

```swift
// Internal (not private) so the daemon can hand the same store instance to
// VoicePolicyWatcher; reload() then invalidates the cache that VoiceRegistry
// reads through. See Task 11 / Task 17 for the cross-instance constraint.
let voicePolicyStore: VoicePolicyStore
private let voiceRegistry: VoiceRegistry
private let voiceAllocator: VoiceAllocator
```

Update `init(...)` to accept and assign:

```swift
voicePolicyStore: VoicePolicyStore = VoicePolicyStore(),
voiceRegistry: VoiceRegistry? = nil,
voiceAllocator: VoiceAllocator = VoiceAllocator(),
// ...
self.voicePolicyStore = voicePolicyStore
self.voiceRegistry = voiceRegistry ?? VoiceRegistry(policyLoader: { voicePolicyStore.load() })
self.voiceAllocator = voiceAllocator
voicePolicyStore.migrateLegacyAssignmentsIfNeeded()
restoreVoiceAssignments()
seedAllocatorAfterRestore()
```

- [ ] **Step 3: Add `seedAllocatorAfterRestore()`**

Add inside `CoordinationBus`:

```swift
private func seedAllocatorAfterRestore() {
    let allocatableURIs = voiceRegistry.allocatableSnapshot().map { $0.id }
    voiceAllocator.seed(uris: allocatableURIs)
    // Spec Section 5: restore order is (registered_at ASC, session_id ASC).
    // Tiebreak on sessionID keeps reseed deterministic when two sessions
    // share a timestamp (common in fixture data + fast bulk registration).
    let restored = sessions
        .compactMap { (sid, info) -> (sessionID: String, voiceURI: String, registeredAt: Date)? in
            guard let voice = info.voice else { return nil }
            return (sessionID: sid, voiceURI: voice.id, registeredAt: info.registeredAt)
        }
        .sorted {
            if $0.registeredAt != $1.registeredAt { return $0.registeredAt < $1.registeredAt }
            return $0.sessionID < $1.sessionID
        }
    for entry in restored {
        voiceAllocator.markUsed(VoiceID.canonicalize(entry.voiceURI))
    }
}
```

`SessionInfo.registeredAt: Date` is non-optional in `src/daemon/coordination.swift:45`; safe to use as the sort key directly. `sessionID` is the dictionary key (also non-optional).

- [ ] **Step 4: Build**

```bash
bash build.sh
```
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/coordination.swift
git commit -m "feat(voice): wire registry/policy/allocator into CoordinationBus init"
```

---

### Task 15: Coordination — replace `assignVoiceLocked` with new register flow

**Files:**
- Modify: `src/daemon/coordination.swift`

- [ ] **Step 1: Replace `assignVoiceLocked(...)` body**

Locate the method (around line 534 per audit). Replace with:

```swift
private func assignVoiceLocked(existingVoice: SessionVoiceDescriptor?, excludingSessionID sid: String) -> SessionVoiceDescriptor? {
    if let existingVoice {
        // Session is being re-registered with a known voice; reaffirm cooldown.
        voiceAllocator.markUsed(existingVoice.id)
        return existingVoice
    }

    // Apply stored preference only if record is fully allocatable.
    if let preferredURI = voicePolicyStore.preferred(sessionID: sid) {
        let canonical = VoiceID.canonicalize(preferredURI)
        if let record = voiceRegistry.lookup(canonical), record.isAllocatable {
            voiceAllocator.markUsed(canonical)
            return SessionVoiceDescriptor(record: record)
        } else {
            emitVoiceEvent([
                "kind": "preference_skipped",
                "session_id": sid,
                "voice_id": canonical,
                "reason": preferenceSkipReason(canonical)
            ])
        }
    }

    guard let chosenURI = voiceAllocator.next(),
          let record = voiceRegistry.lookup(chosenURI) else {
        return nil
    }
    return SessionVoiceDescriptor(record: record)
}

private func preferenceSkipReason(_ uri: String) -> String {
    guard let record = voiceRegistry.lookup(uri) else { return "voice_not_found" }
    if !record.capabilities.speak_supported { return "voice_not_speakable" }
    if !record.availability.allocatable { return "voice_not_allocatable" }
    return "unknown"
}

private func emitVoiceEvent(_ event: [String: Any]) {
    let path = aosVoiceEventsPath()
    let dir = (path as NSString).deletingLastPathComponent
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    var payload = event
    payload["timestamp"] = ISO8601DateFormatter().string(from: Date())
    if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
       let line = String(data: data, encoding: .utf8) {
        if let handle = FileHandle(forWritingAtPath: path) ?? {
            FileManager.default.createFile(atPath: path, contents: nil)
            return FileHandle(forWritingAtPath: path)
        }() {
            handle.seekToEndOfFile()
            handle.write((line + "\n").data(using: .utf8)!)
            try? handle.close()
        }
    }
}
```

- [ ] **Step 2: Verify `aosVoiceEventsPath()` exists**

```bash
grep -n "aosVoiceEventsPath" /Users/Michael/Code/agent-os/shared/swift/ipc/runtime-paths.swift
```
If missing, add to `runtime-paths.swift`:

```swift
func aosVoiceEventsPath(for mode: AOSRuntimeMode? = nil) -> String {
    "\(aosStateDir(for: mode))/voice-events.jsonl"
}
```

- [ ] **Step 3: Delete `repairVoiceLeasesLocked`, `repairVoiceAssignmentsLocked`, `nextVoiceAssignmentIndex` field, and stop calling them from register / restore paths**

Search for callers and remove the calls. Keep `voiceAssignments` map (string→string) AS-IS for one more task — the next task replaces it with `policy.session_preferences`.

- [ ] **Step 4: Build**

```bash
bash build.sh
```
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/coordination.swift shared/swift/ipc/runtime-paths.swift
git commit -m "feat(voice): rewrite assignVoiceLocked to use registry+policy+allocator"
```

---

### Task 16: Coordination — replace `voiceAssignments` map with policy-backed reads

**Files:**
- Modify: `src/daemon/coordination.swift`

- [ ] **Step 1: Remove `voiceAssignments` field and helpers**

Delete:
- `private var voiceAssignments: [String: String] = [:]`
- `private var nextVoiceAssignmentIndex: Int = 0`
- `private let voiceAssignmentsPath: String`
- `init` arg `voiceAssignmentsPath:`
- `restoreVoiceAssignments()` body — replace with shim that just calls `voicePolicyStore.migrateLegacyAssignmentsIfNeeded()` (already done in Task 14, so this can become a no-op stub or be deleted).
- `persistVoiceAssignmentsLocked()` and all its call sites.

For every place that wrote to `voiceAssignments[sid] = uri`, replace with `voicePolicyStore.setPreferred(sessionID: sid, voiceURI: uri)` ONLY when the write originated from `bindVoice`. Voice assignments produced by the allocator are NOT persisted as preferences — only the live descriptor on the session matters.

- [ ] **Step 2: Update `voiceCatalog()` to return registry snapshot**

Replace body:

```swift
func voiceCatalog() -> [[String: Any]] {
    let snap = voiceRegistry.snapshot()
    let assignmentsByURI: [String: [String]] = sessions.reduce(into: [:]) { acc, kv in
        if let uri = kv.value.voice?.id {
            acc[uri, default: []].append(kv.key)
        }
    }
    return snap.map { rec in
        var dict = rec.dictionary()
        dict["current_session_ids"] = (assignmentsByURI[rec.id] ?? []).sorted()
        return dict
    }
}
```

- [ ] **Step 3: Replace `voiceLeases()` with `voiceAssignments()`** (keep `voiceLeases()` as one-line alias)

```swift
func voiceAssignments() -> [[String: Any]] {
    return sessions
        .sorted { $0.value.registeredAt < $1.value.registeredAt }
        .map { (sid, info) -> [String: Any] in
            var entry: [String: Any] = [
                "session_id": sid,
                "role": info.role,
                "harness": info.harness,
                "voice": info.voice.map { v -> Any in
                    voiceRegistry.lookup(v.id)?.dictionary() ?? NSNull()
                } ?? NSNull()
            ]
            if let name = info.name { entry["name"] = name }
            return entry
        }
}

func voiceLeases() -> [[String: Any]] {
    fputs("Deprecation: aos voice leases is now aos voice assignments\n", stderr)
    return voiceAssignments()
}
```

- [ ] **Step 4: Replace `bindVoice(...)` with three-error-code validator**

```swift
func bindVoice(sessionID: String, voiceID: String) -> [String: Any] {
    let canonical = VoiceID.canonicalize(voiceID)
    guard let record = voiceRegistry.lookup(canonical) else {
        return ["error": ["code": "VOICE_NOT_FOUND", "message": "voice not found in registry: \(canonical)"]]
    }
    if !record.capabilities.speak_supported {
        return ["error": ["code": "VOICE_NOT_SPEAKABLE", "message": "voice cannot synthesize in this version: \(canonical)"]]
    }
    if !record.availability.allocatable {
        return ["error": ["code": "VOICE_NOT_ALLOCATABLE", "message": "voice not allocatable (enabled/installed/reachable check failed): \(canonical)"]]
    }
    voicePolicyStore.setPreferred(sessionID: sessionID, voiceURI: canonical)
    voiceAllocator.markUsed(canonical)
    let descriptor = SessionVoiceDescriptor(record: record)
    if var info = sessions[sessionID] {
        info.voice = descriptor
        sessions[sessionID] = info
        persistSessionsLocked()
    }
    return [
        "status": "ok",
        "session_id": sessionID,
        "voice": record.dictionary()
    ]
}
```

If `SessionInfo` does not have `voice` as a `var`, change it. If `persistSessionsLocked` is named differently, grep for the actual session-snapshot writer.

- [ ] **Step 5: Build**

```bash
bash build.sh
```
Expected: build succeeds. Some deprecation warnings on `SessionVoiceBank` may persist — those resolve in Task 33.

- [ ] **Step 6: Commit**

```bash
git add src/daemon/coordination.swift
git commit -m "feat(voice): coordination uses VoicePolicy/VoiceRegistry; bind returns three error codes"
```

---

### Task 17: Daemon — instantiate `VoicePolicyWatcher` and reseed allocator on change

**Files:**
- Modify: `src/daemon/unified.swift`

- [ ] **Step 1: Find where `configWatcher` is started**

```bash
grep -n "configWatcher" /Users/Michael/Code/agent-os/src/daemon/unified.swift | head -10
```

- [ ] **Step 2: Add `voicePolicyWatcher` property and start it**

Add adjacent to `configWatcher`:

```swift
// Constructed lazily because it needs the bus's VoicePolicyStore (see below).
private var voicePolicyWatcher: VoicePolicyWatcher?
```

Where `configWatcher.start()` is called, also wire the watcher against the
**same** `VoicePolicyStore` instance the bus already owns. This is the
critical correctness invariant: a fresh store would invalidate a different
cache, and `handlePolicyReload` reads through `voiceRegistry.policyLoader`
which is bound to the bus's store.

```swift
let watcher = VoicePolicyWatcher(store: coordinationBus.voicePolicyStore)
watcher.onChange = { [weak self] policy in
    guard let self else { return }
    self.coordinationBus.handlePolicyReload(policy)
}
watcher.start()
voicePolicyWatcher = watcher
```

- [ ] **Step 3: Add `handlePolicyReload(_:)` to `CoordinationBus`**

In `src/daemon/coordination.swift`:

```swift
func handlePolicyReload(_ policy: VoicePolicy) {
    // The watcher already called `voicePolicyStore.reload()` on the same
    // instance VoiceRegistry's policyLoader uses, so allocatableSnapshot()
    // here resolves against the freshly-loaded policy. The `policy`
    // argument is provided for future hooks (e.g. emitting a diff event)
    // but is not required to drive reseed.
    _ = policy
    let allocatable = voiceRegistry.allocatableSnapshot().map { $0.id }
    voiceAllocator.reseed(uris: allocatable)
    // Do NOT auto-reassign live sessions; they keep their current descriptor
    // until they re-register or a new explicit bind happens.
}
```

- [ ] **Step 4: Build**

```bash
bash build.sh
```
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/unified.swift src/daemon/coordination.swift
git commit -m "feat(voice): daemon watches voice/policy.json + reseeds allocator on change"
```

---

### Task 18: Speech path — convert URI to engine id before `setVoice`

**Files:**
- Modify: `src/daemon/unified.swift`

- [ ] **Step 1: Find every `setVoice(...)` and `SpeechEngine(voice:)` call**

```bash
grep -n "setVoice\|SpeechEngine(voice:" /Users/Michael/Code/agent-os/src/daemon/unified.swift
```

- [ ] **Step 2: Wrap each call site**

For every call like `speechEngine.setVoice(voiceID)` or `SpeechEngine(voice: voiceID)`, replace with:

```swift
let rawVoiceID = VoiceID.parse(voiceID)?.providerVoiceID ?? voiceID
speechEngine.setVoice(rawVoiceID)
```

`SpeechEngine.resolvedDefaultVoiceID` already returns a raw engine id — bypass parsing for that source.

- [ ] **Step 3: Build**

```bash
bash build.sh
```
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/daemon/unified.swift
git commit -m "fix(voice): parse VoiceID URI to engine id before SpeechEngine.setVoice"
```

---

### Task 19: Command — `aos voice list` with `--provider` and `--speakable-only`

**Files:**
- Modify: `src/commands/voice.swift`

- [ ] **Step 1: Replace `case "list":` handler**

```swift
case "list":
    response = voiceListEnvelope(args: Array(args.dropFirst()))
```

Add helper:

```swift
private func voiceListEnvelope(args: [String]) -> [String: Any]? {
    var data: [String: Any] = [:]
    var i = 0
    while i < args.count {
        switch args[i] {
        case "--provider":
            i += 1
            guard i < args.count else { exitError("--provider requires a value", code: "MISSING_ARG") }
            data["provider"] = args[i]
        case "--speakable-only":
            data["speakable_only"] = true
        case "--json":
            break  // handled by output layer
        default:
            exitError("Unknown argument: \(args[i])", code: "UNKNOWN_ARG")
        }
        i += 1
    }
    return sendEnvelopeRequest(service: "voice", action: "list", data: data, autoStartBinary: CommandLine.arguments[0])
}
```

- [ ] **Step 2: Update daemon-side `voice.list` handler**

```bash
grep -n "case \"list\":\|case \"voice.list\":" /Users/Michael/Code/agent-os/src/daemon/unified.swift | head -5
```

Inside the `voice` action dispatch on the daemon side, add filter logic:

```swift
case "list":
    var voices = coordinationBus.voiceCatalog()
    if let provider = (request.data["provider"] as? String), !provider.isEmpty {
        voices = voices.filter { ($0["provider"] as? String) == provider }
    }
    if (request.data["speakable_only"] as? Bool) == true {
        voices = voices.filter { rec in
            let cap = rec["capabilities"] as? [String: Any]
            let avail = rec["availability"] as? [String: Any]
            return (cap?["speak_supported"] as? Bool) == true
                && (avail?["enabled"] as? Bool) == true
                && (avail?["installed"] as? Bool) == true
                && (avail?["reachable"] as? Bool) == true
        }
    }
    return ["voices": voices]
```

- [ ] **Step 3: Build**

```bash
bash build.sh
```
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/commands/voice.swift src/daemon/unified.swift
git commit -m "feat(voice): aos voice list supports --provider and --speakable-only"
```

---

### Task 20: Command — `aos voice assignments` (rename `leases`)

**Files:**
- Modify: `src/commands/voice.swift`

- [ ] **Step 1: Add `assignments` and keep `leases` as deprecated alias**

In `voiceCommand` switch:

```swift
case "assignments":
    response = sendEnvelopeRequest(service: "voice", action: "assignments", data: [:], autoStartBinary: CommandLine.arguments[0])
case "leases":
    FileHandle.standardError.write("Deprecation: aos voice leases is now aos voice assignments\n".data(using: .utf8)!)
    response = sendEnvelopeRequest(service: "voice", action: "assignments", data: [:], autoStartBinary: CommandLine.arguments[0])
```

- [ ] **Step 2: Update daemon dispatch to map both `assignments` and `leases` to `voiceAssignments()`**

In `unified.swift` voice action dispatch:

```swift
case "assignments", "leases":
    return ["assignments": coordinationBus.voiceAssignments()]
```

- [ ] **Step 3: Build**

```bash
bash build.sh
```
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/commands/voice.swift src/daemon/unified.swift
git commit -m "feat(voice): rename voice leases → voice assignments (alias kept one release)"
```

---

### Task 21: Command — `aos voice refresh`

**Files:**
- Modify: `src/commands/voice.swift`
- Modify: `src/daemon/unified.swift`

- [ ] **Step 1: Add `refresh` subcommand**

In `voiceCommand` switch:

```swift
case "refresh":
    response = sendEnvelopeRequest(service: "voice", action: "refresh", data: [:], autoStartBinary: CommandLine.arguments[0])
```

In daemon:

```swift
case "refresh":
    return ["voices": coordinationBus.voiceRefresh()]
```

In `coordination.swift`:

```swift
func voiceRefresh() -> [[String: Any]] {
    let snap = voiceRegistry.refresh()
    let allocatable = snap.filter { $0.isAllocatable }.map { $0.id }
    voiceAllocator.reseed(uris: allocatable)
    return snap.map { $0.dictionary() }
}
```

- [ ] **Step 2: Build**

```bash
bash build.sh
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/commands/voice.swift src/daemon/unified.swift src/daemon/coordination.swift
git commit -m "feat(voice): add aos voice refresh (re-enumerate + reseed allocator)"
```

---

### Task 22: Command — `aos voice providers`

**Files:**
- Modify: `src/commands/voice.swift`
- Modify: `src/daemon/unified.swift`
- Modify: `src/daemon/coordination.swift`

- [ ] **Step 1: Add CLI subcommand**

```swift
case "providers":
    response = sendEnvelopeRequest(service: "voice", action: "providers", data: [:], autoStartBinary: CommandLine.arguments[0])
```

- [ ] **Step 2: Add daemon dispatch**

```swift
case "providers":
    return ["providers": coordinationBus.voiceProviders()]
```

- [ ] **Step 3: Add coordination accessor**

```swift
func voiceProviders() -> [[String: Any]] {
    voiceRegistry.providersInfo().map { $0.dictionary() }
}
```

- [ ] **Step 4: Build**

```bash
bash build.sh
```
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/commands/voice.swift src/daemon/unified.swift src/daemon/coordination.swift
git commit -m "feat(voice): add aos voice providers (returns ProviderInfo[])"
```

---

### Task 23: IPC schema bumps + `daemon-ipc.md`

**Files:**
- Modify: `shared/schemas/daemon-request.schema.json`
- Modify: `shared/schemas/daemon-response.schema.json`
- Modify: `shared/schemas/daemon-ipc.md`

- [ ] **Step 1: Read current request schema voice section**

```bash
grep -n "voice" /Users/Michael/Code/agent-os/shared/schemas/daemon-request.schema.json | head -20
```

- [ ] **Step 2: Add new actions to request schema**

In the `actions` enum for the `voice` service, add: `"assignments"`, `"refresh"`, `"providers"`. Keep `"leases"` for one release.

- [ ] **Step 3: Add `VoiceRecord` shape to response schema**

In `daemon-response.schema.json`, define a `VoiceRecord` definition matching the Swift struct (id, provider, provider_voice_id, name, display_name?, locale?, language?, region?, gender, kind, quality_tier, tags, capabilities{local,streaming,ssml,speak_supported}, availability{installed,enabled,reachable}, metadata).

- [ ] **Step 4: Update `daemon-ipc.md`**

Add rows for `voice.assignments`, `voice.refresh`, `voice.providers`. Add deprecation note on `voice.leases`. Add error codes section noting `VOICE_NOT_FOUND` / `VOICE_NOT_SPEAKABLE` / `VOICE_NOT_ALLOCATABLE` for `voice.bind`.

- [ ] **Step 5: Run schema validator**

```bash
bash tests/daemon-ipc-voice.sh
```
Expected: passes against new schema.

- [ ] **Step 6: Commit**

```bash
git add shared/schemas/
git commit -m "schema(voice): add assignments/refresh/providers actions + VoiceRecord shape"
```

---

### Task 24: Command registry data — surface new subcommands in help

**Files:**
- Modify: `src/shared/command-registry-data.swift`

- [ ] **Step 1: Find current voice entries**

```bash
grep -n "voice" /Users/Michael/Code/agent-os/src/shared/command-registry-data.swift | head -20
```

- [ ] **Step 2: Add entries**

Add structured entries for `voice assignments`, `voice refresh`, `voice providers`. Mark `voice leases` deprecated. Update help summaries.

- [ ] **Step 3: Build**

```bash
bash build.sh
./aos voice --help
```
Expected: help text shows the new subcommands.

- [ ] **Step 4: Commit**

```bash
git add src/shared/command-registry-data.swift
git commit -m "docs(cli): add voice assignments/refresh/providers entries; mark leases deprecated"
```

---

### Task 25: Provider listing test

**Files:**
- Create: `tests/voice-providers.sh`

- [ ] **Step 1: Write test**

```bash
cat > tests/voice-providers.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-voice-providers"
aos_test_cleanup_prefix "$PREFIX"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"

export AOS_STATE_ROOT="$ROOT"
# No AOS_VOICE_TEST_PROVIDERS — assert canonical [system, elevenlabs] set.

cleanup() { aos_test_kill_root "$ROOT"; rm -rf "$ROOT"; }
trap cleanup EXIT

aos_test_start_daemon "$ROOT"

out=$(./aos voice providers --json 2>&1)
echo "$out" | python3 -c "
import json, sys
resp = json.loads(sys.stdin.read())
provs = resp['data']['providers']
names = sorted(p['name'] for p in provs)
assert 'system' in names and 'elevenlabs' in names, f'missing provider in {names}'
el = next(p for p in provs if p['name']=='elevenlabs')
assert el['voice_count'] >= 3, f'elevenlabs stub catalog too small: {el}'
assert el['enabled'] == True, 'elevenlabs should default-enabled'
assert el['availability']['reachable'] == True
print('ok')
"
EOF
chmod +x tests/voice-providers.sh
```

- [ ] **Step 2: Run test**

```bash
bash build.sh
bash tests/voice-providers.sh
```
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add tests/voice-providers.sh
git commit -m "test(voice): aos voice providers --json shape + defaults"
```

---

### Task 26: Bind error-code test (NOT_FOUND / NOT_SPEAKABLE / NOT_ALLOCATABLE)

**Files:**
- Modify: `tests/voice-bind.sh`

- [ ] **Step 1: Read existing test**

```bash
cat /Users/Michael/Code/agent-os/tests/voice-bind.sh 2>/dev/null | head -60
```

- [ ] **Step 2: Replace with expanded version**

```bash
cat > tests/voice-bind.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-voice-bind"
aos_test_cleanup_prefix "$PREFIX"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"

# Set env BEFORE starting daemon — daemon inherits it on fork.
# Mock provider is additive (alongside system + elevenlabs), see Task 7.
export AOS_STATE_ROOT="$ROOT"
export AOS_VOICE_TEST_PROVIDERS=mock

cleanup() { aos_test_kill_root "$ROOT"; rm -rf "$ROOT"; }
trap cleanup EXIT

mkdir -p "$ROOT/repo/voice"
aos_test_start_daemon "$ROOT"

SID="11111111-2222-3333-4444-555555555555"
./aos tell --register --session-id "$SID" --name bind-test >/dev/null

# Bind to non-existent URI → VOICE_NOT_FOUND.
err=$(./aos voice bind --session-id "$SID" --voice "voice://mock/nope" 2>&1 || true)
echo "$err" | grep -q '"code":"VOICE_NOT_FOUND"' || { echo "FAIL: missing VOICE_NOT_FOUND in $err" >&2; exit 1; }

# Real allocatable mock voice → success.
ok=$(./aos voice bind --session-id "$SID" --voice "voice://mock/mock-alpha" 2>&1)
# Success path: outer envelope is always "success"; success data contains
# "voice":{...} inline, while error data contains "error":{"code":...}.
# Use the inner "voice":{ marker as the success discriminator.
echo "$ok" | grep -q '"voice":{' || { echo "FAIL: bind ok: $ok" >&2; exit 1; }

# Disable that voice via policy and re-bind → VOICE_NOT_ALLOCATABLE.
cat > "$ROOT/repo/voice/policy.json" <<JSON
{"schema_version":1,"providers":{},"voices":{"disabled":["voice://mock/mock-alpha"],"promote":[]},"session_preferences":{}}
JSON
sleep 1  # let policy watcher fire
err=$(./aos voice bind --session-id "$SID" --voice "voice://mock/mock-alpha" 2>&1 || true)
echo "$err" | grep -q '"code":"VOICE_NOT_ALLOCATABLE"' || { echo "FAIL: missing VOICE_NOT_ALLOCATABLE in $err" >&2; exit 1; }

# ElevenLabs stub voices return VOICE_NOT_SPEAKABLE (provider always present
# alongside mock; no daemon restart needed).
err=$(./aos voice bind --session-id "$SID" --voice "voice://elevenlabs/21m00Tcm4TlvDq8ikWAM" 2>&1 || true)
echo "$err" | grep -q '"code":"VOICE_NOT_SPEAKABLE"' || { echo "FAIL: missing VOICE_NOT_SPEAKABLE in $err" >&2; exit 1; }

./aos tell --unregister --session-id "$SID" >/dev/null 2>&1 || true

echo "ok"
EOF
chmod +x tests/voice-bind.sh
```

- [ ] **Step 3: Run test**

```bash
bash build.sh
bash tests/voice-bind.sh
```
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add tests/voice-bind.sh
git commit -m "test(voice): bind covers all three error codes (NOT_FOUND/NOT_SPEAKABLE/NOT_ALLOCATABLE)"
```

---

### Task 27: Session allocation integration test

**Files:**
- Delete: `tests/voice-session-leases.sh`
- Create: `tests/voice-session-allocation.sh`

**Determinism setup.** The system provider enumerates whatever NSSpeechSynthesizer voices the test machine has installed, so the allocatable pool would otherwise be machine-dependent. Pre-write a `policy.json` that disables the system provider (and the elevenlabs stub, even though it's already excluded by `speak_supported=false`) **before** starting the daemon. With `AOS_VOICE_TEST_PROVIDERS=mock` enabled additively and the other two providers gated off via policy, the allocatable pool is exactly the 5 mock voices in known order:

  initial allocator deque: `[alpha, bravo, charlie, delta, echo]`

The mock fixture (Task 6) lists names in alphabetical order with `mock-alpha` as the only `premium`-tier entry; the registry snapshot sort (Task 7) is `(promoteOrder, providerRank, qualityWeight desc, name asc)`, so within the mock provider alpha is first (premium beats standard) and bravo..echo follow alphabetical. That shape is what the per-step deque traces below assume.

This test covers four named contract points:

1. **distinct-while-supply** — first 3 sessions (≤ pool size) get 3 distinct voices.
2. **bias-away** — bind moves the bound voice to back of deque; the next fresh registration's voice is *not* the just-bound voice and *is* the predictable LRU voice.
3. **over-capacity reuse** — registration beyond pool size wraps without refusal; allocator returns a voice rather than nil.
4. **restart reseed marks restored before serving new** — exact predicted post-restart voice for the next fresh session, distinguishable from the bug-state value an unmarked allocator would yield.

- [ ] **Step 1: Read old test for reference, then delete**

```bash
test -f tests/voice-session-leases.sh && cat tests/voice-session-leases.sh | head -40
git rm tests/voice-session-leases.sh
```

- [ ] **Step 2: Write new test**

```bash
cat > tests/voice-session-allocation.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-voice-session-allocation"
aos_test_cleanup_prefix "$PREFIX"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"

export AOS_STATE_ROOT="$ROOT"
export AOS_VOICE_TEST_PROVIDERS=mock

cleanup() { aos_test_kill_root "$ROOT"; rm -rf "$ROOT"; }
trap cleanup EXIT

# Pre-write policy.json that disables system + elevenlabs so the allocatable
# pool is exactly the 5 mock voices (alpha..echo) in known order. Daemon
# must not be running yet — VoicePolicyStore.load() is read on first use
# and cached, so this file must exist before the daemon comes up.
mkdir -p "$ROOT/repo/voice"
cat > "$ROOT/repo/voice/policy.json" <<JSON
{
  "schema_version": 1,
  "providers": {
    "system":     { "enabled": false },
    "elevenlabs": { "enabled": false }
  },
  "voices":              { "disabled": [], "promote": [] },
  "session_preferences": {}
}
JSON

aos_test_start_daemon "$ROOT"

S1="11111111-1111-1111-1111-111111111111"
S2="22222222-2222-2222-2222-222222222222"
S3="33333333-3333-3333-3333-333333333333"
S4="44444444-4444-4444-4444-444444444444"
S5="55555555-5555-5555-5555-555555555555"
S6="66666666-6666-6666-6666-666666666666"
S7="77777777-7777-7777-7777-777777777777"
S8="88888888-8888-8888-8888-888888888888"

V_ALPHA="voice://mock/mock-alpha"
V_BRAVO="voice://mock/mock-bravo"
V_CHARLIE="voice://mock/mock-charlie"
V_DELTA="voice://mock/mock-delta"
V_ECHO="voice://mock/mock-echo"

assignments_json() { ./aos voice assignments --json; }

voice_for() {
    local sid="$1"
    assignments_json | python3 -c "
import json, sys
sid = '$sid'
data = json.loads(sys.stdin.read())['data']['assignments']
match = next((e for e in data if e['session_id'] == sid and e.get('voice')), None)
print(match['voice']['id'] if match else '')
"
}

assert_eq() {
    local got="$1"; local want="$2"; local label="$3"
    if [[ "$got" != "$want" ]]; then
        echo "FAIL [$label]: got=$got want=$want" >&2
        exit 1
    fi
}

# -------------------------------------------------------------------------
# 1. distinct-while-supply
# Initial deque: [alpha, bravo, charlie, delta, echo]
# After S1.next() = alpha   ->  [bravo, charlie, delta, echo, alpha]
# After S2.next() = bravo   ->  [charlie, delta, echo, alpha, bravo]
# After S3.next() = charlie ->  [delta, echo, alpha, bravo, charlie]
# -------------------------------------------------------------------------
./aos tell --register --session-id "$S1" --name "sess-1" >/dev/null
./aos tell --register --session-id "$S2" --name "sess-2" >/dev/null
./aos tell --register --session-id "$S3" --name "sess-3" >/dev/null

assert_eq "$(voice_for $S1)" "$V_ALPHA"   "S1 picks alpha"
assert_eq "$(voice_for $S2)" "$V_BRAVO"   "S2 picks bravo"
assert_eq "$(voice_for $S3)" "$V_CHARLIE" "S3 picks charlie"
echo "distinct-while-supply ok"

# -------------------------------------------------------------------------
# 2. bias-away: bind S2 onto delta (an unused voice).
# bindVoice calls voiceAllocator.markUsed(delta), so delta moves to back.
# Deque before bind: [delta, echo, alpha, bravo, charlie]
# After markUsed(delta):  [echo, alpha, bravo, charlie, delta]
# Next fresh registration must NOT pick delta and MUST pick echo (LRU).
# -------------------------------------------------------------------------
./aos voice bind --session-id "$S2" --voice "$V_DELTA" >/dev/null
assert_eq "$(voice_for $S2)" "$V_DELTA" "S2 bind reflected"

./aos tell --register --session-id "$S4" --name "sess-4" >/dev/null
S4_VOICE="$(voice_for $S4)"
[[ "$S4_VOICE" != "$V_DELTA" ]] || { echo "FAIL [bias-away]: S4 picked just-bound voice $V_DELTA" >&2; exit 1; }
assert_eq "$S4_VOICE" "$V_ECHO" "S4 picks echo (LRU after bind moved delta to back)"
echo "bias-away ok"

# -------------------------------------------------------------------------
# 3. over-capacity reuse
# Deque after S4: [alpha, bravo, charlie, delta, echo]
# S5.next() = alpha   (REUSE: S1 also has alpha)
# S6.next() = bravo
# S7.next() = charlie (REUSE: S3 also has charlie)
# -------------------------------------------------------------------------
./aos tell --register --session-id "$S5" --name "sess-5" >/dev/null
./aos tell --register --session-id "$S6" --name "sess-6" >/dev/null
./aos tell --register --session-id "$S7" --name "sess-7" >/dev/null

assert_eq "$(voice_for $S5)" "$V_ALPHA"   "S5 wraps to alpha (over-cap)"
assert_eq "$(voice_for $S6)" "$V_BRAVO"   "S6 picks bravo"
assert_eq "$(voice_for $S7)" "$V_CHARLIE" "S7 wraps to charlie (over-cap)"

assignments_json | python3 -c "
import json, sys
data = json.loads(sys.stdin.read())['data']['assignments']
ids = [e['voice']['id'] for e in data if e.get('voice')]
assert len(ids) == 7, f'expected 7 assigned voices, got {ids}'
held = set(ids)
assert held <= {'$V_ALPHA','$V_BRAVO','$V_CHARLIE','$V_DELTA','$V_ECHO'}, f'unexpected voices in pool: {held}'
print('over-capacity reuse ok')
"

# -------------------------------------------------------------------------
# 4. restart reseed marks restored sessions before serving new
# Pre-restart per-session voices:
#   S1=alpha  S2=delta(bound)  S3=charlie  S4=echo
#   S5=alpha  S6=bravo  S7=charlie
# Reseed walks restored in (registeredAt ASC, sessionID ASC) order:
#   S1..S7 lexicographic on uuid -> S1, S2, S3, S4, S5, S6, S7.
#
# Trace the markUsed sequence on a fresh deque [alpha, bravo, charlie, delta, echo]:
#   markUsed(alpha)   -> [bravo, charlie, delta, echo, alpha]
#   markUsed(delta)   -> [bravo, charlie, echo, alpha, delta]
#   markUsed(charlie) -> [bravo, echo, alpha, delta, charlie]
#   markUsed(echo)    -> [bravo, alpha, delta, charlie, echo]
#   markUsed(alpha)   -> [bravo, delta, charlie, echo, alpha]
#   markUsed(bravo)   -> [delta, charlie, echo, alpha, bravo]
#   markUsed(charlie) -> [delta, echo, alpha, bravo, charlie]
#
# Final deque front = delta. So S8.next() = delta.
#
# Bug-detection: if reseed FORGOT to call markUsed for restored sessions,
# the deque after reseed would still be [alpha, bravo, charlie, delta, echo]
# and S8.next() would be alpha. The exact-equals assertion below distinguishes
# the two states.
# -------------------------------------------------------------------------
aos_test_kill_root "$ROOT"
aos_test_start_daemon "$ROOT"

./aos tell --register --session-id "$S8" --name "sess-8" >/dev/null
S8_VOICE="$(voice_for $S8)"
[[ "$S8_VOICE" != "$V_ALPHA" ]] || { echo "FAIL [restart-reseed]: S8 got front-of-unmarked-deque ($V_ALPHA); reseed did not mark restored" >&2; exit 1; }
assert_eq "$S8_VOICE" "$V_DELTA" "S8 picks delta (deterministic post-reseed LRU)"
echo "restart-reseed ok"

# -------------------------------------------------------------------------
# Post-restart bind survives + watcher coherence
# -------------------------------------------------------------------------
./aos voice bind --session-id "$S8" --voice "$V_CHARLIE" >/dev/null
assert_eq "$(voice_for $S8)" "$V_CHARLIE" "post-restart bind persists"
echo "post-restart bind ok"

for sid in "$S1" "$S2" "$S3" "$S4" "$S5" "$S6" "$S7" "$S8"; do
    ./aos tell --unregister --session-id "$sid" >/dev/null 2>&1 || true
done

echo "ok"
EOF
chmod +x tests/voice-session-allocation.sh
```

- [ ] **Step 3: Run test**

```bash
bash build.sh
bash tests/voice-session-allocation.sh
```
Expected output (final lines):
```
distinct-while-supply ok
bias-away ok
over-capacity reuse ok
restart-reseed ok
post-restart bind ok
ok
```

- [ ] **Step 4: Update CI manifest if any**

```bash
grep -rn "voice-session-leases" tests/ scripts/ .github/ 2>/dev/null
```
If hits, replace with `voice-session-allocation`.

- [ ] **Step 5: Commit**

```bash
git add -A tests/voice-session-leases.sh tests/voice-session-allocation.sh
git commit -m "test(voice): voice-session-allocation asserts exact LRU voices for distinct/bias-away/over-cap/restart"
```

---

### Task 28: Policy reload integration test

**Files:**
- Create: `tests/voice-policy-reload.sh`

This test covers the **full** policy-reload contract from spec Section 6,
not just the watcher-fires-twice surface:

1. After a disable, `voice list` reflects `availability.enabled = false`.
2. After a disable, the **allocator was reseeded** — a fresh registration
   does not receive the disabled voice. This is the load-bearing
   handlePolicyReload assertion that distinguishes a reload that updated
   policy state from one that also reseeded the deque.
3. A second atomic rewrite is observed (proves the parent-directory fd
   in Task 11 survived rewrite #1's write-tmp + remove + rename cycle).
4. Live sessions are not auto-reassigned on policy change.

Determinism setup matches Task 27: pre-write `policy.json` disabling the
system + elevenlabs providers so the allocatable pool is exactly the 5
mock voices in known order. With nothing registered yet, the initial
allocator deque is `[alpha, bravo, charlie, delta, echo]`. That makes
the post-disable fresh-session assignment exactly predictable.

- [ ] **Step 1: Write test**

```bash
cat > tests/voice-policy-reload.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-voice-policy-reload"
aos_test_cleanup_prefix "$PREFIX"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"

export AOS_STATE_ROOT="$ROOT"
export AOS_VOICE_TEST_PROVIDERS=mock

cleanup() { aos_test_kill_root "$ROOT"; rm -rf "$ROOT"; }
trap cleanup EXIT

V_ALPHA="voice://mock/mock-alpha"
V_BRAVO="voice://mock/mock-bravo"

# Pre-write policy with system + elevenlabs disabled so the allocatable pool
# is exactly the 5 mock voices. Daemon must not be running yet —
# VoicePolicyStore.load() caches on first read.
mkdir -p "$ROOT/repo/voice"
cat > "$ROOT/repo/voice/policy.json" <<JSON
{
  "schema_version": 1,
  "providers": {
    "system":     { "enabled": false },
    "elevenlabs": { "enabled": false }
  },
  "voices":              { "disabled": [], "promote": [] },
  "session_preferences": {}
}
JSON

aos_test_start_daemon "$ROOT"

availability_enabled() {
    local voice_id="$1"
    ./aos voice list --json | python3 -c "
import json, sys
voices = json.loads(sys.stdin.read())['data']['voices']
target = next((v for v in voices if v['id'] == '$voice_id'), None)
print('missing' if target is None else str(target['availability']['enabled']))
"
}

voice_for() {
    local sid="$1"
    ./aos voice assignments --json | python3 -c "
import json, sys
sid = '$sid'
data = json.loads(sys.stdin.read())['data']['assignments']
match = next((e for e in data if e['session_id'] == sid and e.get('voice')), None)
print(match['voice']['id'] if match else '')
"
}

assert_eq() {
    local got="$1"; local want="$2"; local label="$3"
    if [[ "$got" != "$want" ]]; then
        echo "FAIL [$label]: got=$got want=$want" >&2
        exit 1
    fi
}

# -------------------------------------------------------------------------
# Rewrite #1: disable mock-alpha. With reseed, the allocator deque drops
# alpha:
#   before: [alpha, bravo, charlie, delta, echo]
#   after:  [bravo, charlie, delta, echo]
#
# Use write-tmp + atomic rename — the parent-directory fd in Task 11 fires
# .write events for in-directory entry changes (create/remove/rename), NOT
# for in-place truncate+overwrite of an existing file. `cat > policy.json`
# would silently keep the old inode and miss the watcher entirely.
# -------------------------------------------------------------------------
cat > "$ROOT/repo/voice/policy.json.tmp" <<JSON
{
  "schema_version": 1,
  "providers": {
    "system":     { "enabled": false },
    "elevenlabs": { "enabled": false }
  },
  "voices":              { "disabled": ["$V_ALPHA"], "promote": [] },
  "session_preferences": {}
}
JSON
mv "$ROOT/repo/voice/policy.json.tmp" "$ROOT/repo/voice/policy.json"
sleep 1

state1="$(availability_enabled "$V_ALPHA")"
assert_eq "$state1" "False" "rewrite-1: voice list shows alpha availability.enabled=False"
echo "first-reload reflected in voice list"

# -------------------------------------------------------------------------
# Allocator-reseed proof. Register a fresh session AFTER the disable.
# The post-reseed deque front is bravo, so a correctly reseeded allocator
# must hand bravo to S1.
#
# Bug-detection: if handlePolicyReload updated voice list state but did
# NOT call voiceAllocator.reseed(), the deque would still be the original
# [alpha, bravo, charlie, delta, echo] and S1 would receive alpha — the
# very voice the policy just disabled. The exact-equals assertion below
# distinguishes the two states; the != assertion above it makes the
# failure mode explicit in the diagnostic output.
# -------------------------------------------------------------------------
SID="cccccccc-cccc-cccc-cccc-cccccccccccc"
./aos tell --register --session-id "$SID" --name policy-reload-test >/dev/null
held="$(voice_for "$SID")"
[[ "$held" != "$V_ALPHA" ]] || { echo "FAIL [reseed]: fresh session received disabled voice $V_ALPHA — handlePolicyReload did not reseed allocator" >&2; exit 1; }
assert_eq "$held" "$V_BRAVO" "rewrite-1: fresh session picks bravo (front of post-reseed deque)"
echo "first-reload reflected in allocator (reseed observed)"

# -------------------------------------------------------------------------
# Rewrite #2: re-enable alpha. This is the watcher-continuity check —
# rewrite #1 was a write-tmp + atomic rename that retired the original
# policy.json inode; only the parent-directory fd in Task 11 stays
# attached across that. A file-fd watcher would have detached and the
# assertion below would fail with state2 still "False".
#
# Same write-tmp + mv pattern as rewrite #1 (see comment there for why).
# -------------------------------------------------------------------------
cat > "$ROOT/repo/voice/policy.json.tmp" <<JSON
{
  "schema_version": 1,
  "providers": {
    "system":     { "enabled": false },
    "elevenlabs": { "enabled": false }
  },
  "voices":              { "disabled": [], "promote": [] },
  "session_preferences": {}
}
JSON
mv "$ROOT/repo/voice/policy.json.tmp" "$ROOT/repo/voice/policy.json"
sleep 1

state2="$(availability_enabled "$V_ALPHA")"
assert_eq "$state2" "True" "rewrite-2: voice list shows alpha availability.enabled=True (watcher survived atomic rename)"
echo "second-reload reflected (watcher survived atomic rename)"

# -------------------------------------------------------------------------
# Live session not auto-reassigned across either reload.
# -------------------------------------------------------------------------
after="$(voice_for "$SID")"
assert_eq "$after" "$held" "live session retains descriptor across both reloads"
echo "live session not auto-reassigned"

./aos tell --unregister --session-id "$SID" >/dev/null 2>&1 || true
echo "ok"
EOF
chmod +x tests/voice-policy-reload.sh
```

- [ ] **Step 2: Run test**

```bash
bash tests/voice-policy-reload.sh
```
Expected output (final lines):
```
first-reload reflected in voice list
first-reload reflected in allocator (reseed observed)
second-reload reflected (watcher survived atomic rename)
live session not auto-reassigned
ok
```

- [ ] **Step 3: Commit**

```bash
git add tests/voice-policy-reload.sh
git commit -m "test(voice): policy reload covers voice-list update + allocator reseed + watcher continuity + live-session retention"
```

---

## Checkpoint X: Final-response + telemetry

### Task 29: Final-response audit + integration test re-run

**Files:**
- Modify: `tests/voice-final-response.sh` (only if it currently asserts old descriptor shape)

- [ ] **Step 1: Read existing test**

```bash
cat /Users/Michael/Code/agent-os/tests/voice-final-response.sh 2>/dev/null | head -80
```

- [ ] **Step 2: Update assertions if voice id format references bare ids**

If the test inspects payload fields and references `com.apple.voice.*` directly (bare id form), update to expect the URI form `voice://system/com.apple.voice.*` — descriptor `id` is now URI, although `provider_voice_id` is still bare.

- [ ] **Step 3: Run test**

```bash
bash build.sh
bash tests/voice-final-response.sh
```
Expected: passes; observable behavior unchanged.

- [ ] **Step 4: Commit (only if assertions updated)**

```bash
git add tests/voice-final-response.sh
git commit -m "test(voice): final-response assertions accept new URI-form descriptor id"
```

If no test changes were needed, skip the commit and add a one-line note in the next commit.

---

### Task 30: Telemetry events test

**Files:**
- Create or modify: `tests/voice-telemetry.sh`

- [ ] **Step 1: Write test**

```bash
cat > tests/voice-telemetry.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-voice-telemetry"
aos_test_cleanup_prefix "$PREFIX"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"

export AOS_STATE_ROOT="$ROOT"
export AOS_VOICE_TEST_PROVIDERS=mock

cleanup() { aos_test_kill_root "$ROOT"; rm -rf "$ROOT"; }
trap cleanup EXIT

mkdir -p "$ROOT/repo/voice"

# Seed a non-allocatable preference for a session BEFORE daemon start so the
# allocator sees the disabled-voice preference on first registration.
SID="dddddddd-dddd-dddd-dddd-dddddddddddd"
cat > "$ROOT/repo/voice/policy.json" <<JSON
{"schema_version":1,"providers":{},"voices":{"disabled":["voice://mock/mock-bravo"],"promote":[]},"session_preferences":{"$SID":"voice://mock/mock-bravo"}}
JSON

aos_test_start_daemon "$ROOT"

./aos tell --register --session-id "$SID" --name telem-test >/dev/null

events="$ROOT/repo/voice-events.jsonl"
[[ -f "$events" ]] || { echo "FAIL: voice-events.jsonl missing" >&2; exit 1; }

grep -q '"kind":"preference_skipped"' "$events" || { echo "FAIL: missing preference_skipped event" >&2; exit 1; }
grep -q '"reason":"voice_not_allocatable"' "$events"

./aos tell --unregister --session-id "$SID" >/dev/null 2>&1 || true
echo "ok"
EOF
chmod +x tests/voice-telemetry.sh
```

- [ ] **Step 2: Run**

```bash
bash tests/voice-telemetry.sh
```
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add tests/voice-telemetry.sh
git commit -m "test(voice): preference_skipped telemetry event when stored pref non-allocatable"
```

---

### Task 31: Hook regression — confirm `.agents/hooks/final-response.sh` untouched

**Files:** none modified.

- [ ] **Step 1: Verify by inspection**

```bash
diff <(git show main:.agents/hooks/final-response.sh) .agents/hooks/final-response.sh && echo "unchanged"
```
Expected: `unchanged` (no diff).

- [ ] **Step 2: Re-run the hook end-to-end against a real session**

```bash
SID=$(./aos tell --register --session-id "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" --name hook-regress | grep -oE '[0-9a-f-]{36}')
echo '{"hook_event_name":"Stop","session_id":"'$SID'","transcript_path":"/tmp/empty.jsonl"}' | .agents/hooks/final-response.sh
./aos tell --unregister --session-id "$SID" >/dev/null 2>&1 || true
```
Expected: hook exits cleanly. No commit.

---

## Checkpoint Y: Docs, shim removal, lift `qualityTier`

### Task 32: Rewrite `docs/api/aos.md` voice section

**Files:**
- Modify: `docs/api/aos.md`

- [ ] **Step 1: Locate `## aos voice` and surrounding config table**

```bash
grep -n "## aos voice\|voice-assignments.json" /Users/Michael/Code/agent-os/docs/api/aos.md | head -10
```

- [ ] **Step 2: Replace section with new content**

Rewrite to cover:
- Registry-backed catalog + provider-pluggable architecture
- `system` + `elevenlabs` (stub) providers
- Allocator: rotation + cooldown variety pressure (no exclusivity)
- Subcommands: `list` (with `--provider`, `--speakable-only`), `assignments` (with `leases` deprecated alias), `bind`, `refresh`, `providers`, `final-response`
- Voice id format: `voice://<provider>/<provider_voice_id>` canonical; bare ids accepted on input
- `voice/policy.json` path and sectioned schema (providers / voices.disabled / voices.promote / session_preferences)
- One-shot migration from `coordination/voice-assignments.json` → `voice/policy.json`; legacy file renamed `.migrated`
- `--share` flag removed (no exclusivity to override)
- `final-response` ingress unchanged
- Three error codes for `bind`: VOICE_NOT_FOUND / VOICE_NOT_SPEAKABLE / VOICE_NOT_ALLOCATABLE

- [ ] **Step 3: Commit**

```bash
git add docs/api/aos.md
git commit -m "docs(api): rewrite aos voice section for registry/providers/allocator"
```

---

### Task 33: Sync `src/CLAUDE.md` voice examples + path reference

**Files:**
- Modify: `src/CLAUDE.md`

- [ ] **Step 1: Find voice examples and the path reference**

```bash
grep -n "voice leases\|voice-assignments.json\|aos voice" /Users/Michael/Code/agent-os/src/CLAUDE.md
```

- [ ] **Step 2: Replace examples and path reference**

- Replace `./aos voice leases` example with `./aos voice assignments`.
- Add `./aos voice refresh` and `./aos voice providers` examples.
- Replace the path mention `~/.config/aos/{mode}/coordination/voice-assignments.json` with `~/.config/aos/{mode}/voice/policy.json` and a one-line migration note pointing to `docs/api/aos.md`.
- Soften the wording about "round-robin" / "wrap when bank exhausted" to reflect rotation+cooldown.

- [ ] **Step 3: Commit**

```bash
git add src/CLAUDE.md
git commit -m "docs(src): sync voice examples + path reference for new registry/policy"
```

---

### Task 34: ARCHITECTURE.md one-line note

**Files:**
- Modify: `ARCHITECTURE.md`

- [ ] **Step 1: Find voice subsystem row**

```bash
grep -n "TTS, daemon-driven announcements\|voice/" /Users/Michael/Code/agent-os/ARCHITECTURE.md
```

- [ ] **Step 2: Append "registry-backed, provider-pluggable" note in the same row**

No row split. Just amend the description.

- [ ] **Step 3: Commit**

```bash
git add ARCHITECTURE.md
git commit -m "docs(arch): voice row notes registry-backed, provider-pluggable"
```

---

### Task 35: Delete `SessionVoiceBank` shim and lift `qualityTier`

**Files:**
- Modify: `src/voice/session-voice.swift`
- Modify: `src/voice/engine.swift`
- Modify: `src/voice/say.swift`
- Modify: `src/voice/policy.swift`
- Modify: `src/daemon/coordination.swift`
- Modify: `src/daemon/unified.swift`
- Modify: `shared/swift/ipc/runtime-paths.swift`

> **Audit note (added in plan patch):** the original file list omitted
> `src/daemon/unified.swift`, `src/daemon/coordination.swift`, and
> `src/voice/policy.swift`. Two distinct call-surface gaps:
>
> 1. The daemon's `routeForHumanAudience` calls
>    `SpeechEngine.availableVoice(id:)` and
>    `SpeechEngine.qualityTier(forVoiceID:)`, and constructs a
>    `SessionVoiceDescriptor` via the `init(voiceInfo:)` initializer.
>    All three dependencies disappear in Steps 1+2, so the daemon must
>    be lifted onto the registry first (Step 5 below).
>
> 2. `VoicePolicyStore.migrateLegacyAssignmentsIfNeeded()` (the active
>    one-shot upgrade path, called from `coordination.swift:43` and
>    `commands/voice.swift:33`) is the sole remaining caller of
>    `aosVoiceAssignmentsPath()`. The migration shim is NOT being
>    retired in this task — only the legacy `SessionVoiceBank` shim is.
>    Step 4 (helper deletion) must be preceded by inlining the path
>    literal into `policy.swift` so the migration code keeps building.
>
> Verify both surfaces before editing:
>
> ```bash
> grep -rn "SpeechEngine\.availableVoice\b\|SpeechEngine\.qualityTier\b\|SpeechEngine\.VoiceInfo\b\|SessionVoiceDescriptor(voiceInfo:" src/ shared/
> grep -rn "aosVoiceAssignmentsPath" src/ shared/ tests/
> ```
>
> Expected:
> - First grep: four sites — three in `unified.swift`, one in
>   `session-voice.swift` (the dead initializer itself).
> - Second grep: two sites — one definition in `runtime-paths.swift`,
>   one call in `policy.swift:116`. (No test references — tests
>   reference the literal `voice-assignments.json` filename only.)

- [ ] **Step 1: Delete `SessionVoiceBank` enum and the `init(voiceInfo:)` initializer**

Remove the entire `enum SessionVoiceBank { ... }` block from `src/voice/session-voice.swift`.

Also remove the `init(voiceInfo: SpeechEngine.VoiceInfo, ...)` initializer on `SessionVoiceDescriptor` (the surrounding struct retains its other initializers — `init(provider:id:...)` and `init(record:)`). The `voiceInfo` initializer depends on the `SpeechEngine.VoiceInfo` type that Step 2 deletes.

- [ ] **Step 2: Delete `SpeechEngine.VoiceInfo`, `availableVoice(id:)`, `qualityTier(forVoiceID:)`**

Delete from `src/voice/engine.swift`. Keep `availableVoices()` only if still used by `aos say --list-voices`.

- [ ] **Step 3: Update `aos say --list-voices` to use the registry**

Edit `src/voice/say.swift`:

```swift
// Was: SpeechEngine.availableVoices().map { ... }
// Now:
let store = VoicePolicyStore()
let registry = VoiceRegistry(policyLoader: { store.load() })
let records = registry.snapshot().filter { $0.provider == "system" }
// emit same legacy-shaped JSON for back-compat: provider, id (bare), name, language, gender, quality_tier
let listed = records.map { rec -> [String: Any] in
    return [
        "provider": rec.provider,
        "id": rec.provider_voice_id,
        "name": rec.name,
        "language": rec.locale ?? rec.language ?? "unknown",
        "gender": rec.gender,
        "quality_tier": rec.quality_tier
    ]
}
```

`--voice <id>` continues to accept bare ids — no change there.

- [ ] **Step 4: Inline the legacy path literal, then delete `aosVoiceAssignmentsPath()`**

The migration shim `VoicePolicyStore.migrateLegacyAssignmentsIfNeeded()` is the sole remaining caller of `aosVoiceAssignmentsPath()` (verified in the audit grep at the top of T35). The shim itself is NOT being retired here — it's the live one-shot upgrade path that any user upgrading from pre-#103 hits, called from `coordination.swift:43` and `commands/voice.swift:33`. So Step 4 must inline the path string into the migration code first, then drop the shared helper.

**Step 4a: Inline the legacy path literal into `policy.swift`**

Edit `src/voice/policy.swift` and find this line in `migrateLegacyAssignmentsIfNeeded()` (currently at line 116):

```swift
let legacyPath = aosVoiceAssignmentsPath()
```

Replace it with:

```swift
let legacyPath = "\(aosCoordinationDir())/voice-assignments.json"
```

`aosCoordinationDir()` is still alive (it has other callers). The migration shim now owns the only literal reference to the legacy filename, which matches its single-purpose role.

**Step 4b: Delete `aosVoiceAssignmentsPath()` from `runtime-paths.swift`**

Remove the `@available(*, deprecated, ...)` function entirely.

**Step 4c: Re-grep for stragglers**

```bash
grep -rn "aosVoiceAssignmentsPath\|voice-assignments.json" src/ shared/ tests/
```

Expected:
- Zero hits for `aosVoiceAssignmentsPath` anywhere.
- Hits for `voice-assignments.json` in exactly three places, all intentional:
    - `src/voice/policy.swift` — the inlined literal from Step 4a.
    - `src/CLAUDE.md` — the migration-prose paragraph added in Task 33,
      describing the one-shot upgrade (`coordination/voice-assignments.json
      files are migrated once and renamed .migrated`). Leave untouched.
    - `tests/voice-migration.sh` — testing the legacy filename. Leave
      untouched.

- [ ] **Step 5: Lift the daemon's voice-route fallback onto the registry**

The daemon `routeForHumanAudience` path used `SpeechEngine.availableVoice(id:)` to discover the configured/default voice and `SpeechEngine.qualityTier(forVoiceID:)` to compute its quality tier. Both vanish in Step 2.

The replacement uses `coordination.voiceRegistry`, which is the live, watcher-fed registry the daemon already owns — do NOT spin up a fresh `VoiceRegistry`. Add a thin lookup wrapper to `coordination.swift` and switch `unified.swift` to it.

**Step 5a: Add `voiceLookup(id:)` to `Coordination`**

Edit `src/daemon/coordination.swift` and add this method anywhere among the other voice methods (e.g. after `voiceProviders()` near line 273):

```swift
func voiceLookup(id: String) -> VoiceRecord? {
    let canonical = VoiceID.canonicalize(id)
    return voiceRegistry.lookup(canonical)
}
```

`VoiceID.canonicalize` already handles bare-id → `voice://system/<id>` promotion, so callers can pass either form (matches the form `currentConfig.voice.voice` may contain).

**Step 5b: Replace the `routeForHumanAudience` fallback in `unified.swift`**

In `src/daemon/unified.swift`, locate the `else if let discovered = SpeechEngine.availableVoice(id: voiceID)` block (currently at lines 1659-1670) and replace it with:

```swift
} else if let record = coordination.voiceLookup(id: voiceID) {
    route["voice"] = SessionVoiceDescriptor(record: record).dictionary()
} else {
    route["voice"] = SessionVoiceDescriptor(
        provider: "system",
        id: voiceID,
        name: voiceID,
        locale: "unknown",
        gender: "unknown",
        quality_tier: "unknown",
        available: false
    ).dictionary()
}
```

The `quality_tier: "unknown"` literal in the unavailable-voice branch is a deliberate behavior change: the old `SpeechEngine.qualityTier(forVoiceID:)` heuristic inferred the tier from substrings in the bare voice id (e.g. `.premium.` → `"premium"`). With the registry as the source of truth, an unavailable voice has no provider context to derive a tier from — the honest answer is `"unknown"`. Available voices route through the `voiceLookup` branch above and continue to report the real tier the provider published.

The surrounding context (`if let sessionVoice { ... }` branch and the trailing telemetry call) is unchanged.

**Step 5c: Re-grep to confirm zero stragglers**

```bash
grep -rn "SpeechEngine\.availableVoice\b\|SpeechEngine\.qualityTier\b\|SpeechEngine\.VoiceInfo\b\|SessionVoiceDescriptor(voiceInfo:" src/ shared/
```

Expected: no matches anywhere.

- [ ] **Step 6: Build**

```bash
bash build.sh
```
Expected: build succeeds with NO deprecation warnings on `SessionVoiceBank`.

- [ ] **Step 7: Re-run full voice test suite**

```bash
for t in tests/voice-*.sh tests/daemon-ipc-voice.sh; do
    [[ -f "$t" ]] || continue
    echo "== $t =="
    bash "$t"
done
```
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/voice/session-voice.swift src/voice/engine.swift src/voice/say.swift src/voice/policy.swift src/daemon/coordination.swift src/daemon/unified.swift shared/swift/ipc/runtime-paths.swift
git commit -m "refactor(voice): delete SessionVoiceBank shim + lift qualityTier into provider"
```

---

### Task 36: Final smoke + Issue #103 hygiene

**Files:** none modified.

- [ ] **Step 1: Run full voice + daemon-ipc test sweep**

```bash
bash build.sh
bash tests/voice-id-canonicalization.sh
bash tests/voice-registry-snapshot.sh
bash tests/voice-providers.sh
bash tests/voice-allocator.sh
bash tests/voice-migration.sh
bash tests/voice-bind.sh
bash tests/voice-session-allocation.sh
bash tests/voice-policy-reload.sh
bash tests/voice-final-response.sh
bash tests/voice-telemetry.sh
bash tests/daemon-ipc-voice.sh
```
Expected: all `ok`/exit 0.

- [ ] **Step 2: Verify clean grep of legacy references in production code**

```bash
grep -rn "SessionVoiceBank\|nextVoiceAssignmentIndex\|voice-assignments.json" src/ shared/ | grep -v "tests/" | grep -v ".migrated"
```
Expected: empty (or only internal-test fixture strings).

- [ ] **Step 3: Update Issue #103**

```bash
gh issue comment 103 --body "Closing as workstream complete: voice registry + provider abstraction + rotation/cooldown allocator landed on main. AC #5 (lease-style exclusivity) explicitly deviated — see spec at docs/superpowers/specs/2026-04-22-voice-registry-provider-allocation-design.md Section 1. Plan: docs/superpowers/plans/2026-04-22-voice-registry-provider-allocation.md."
gh issue close 103
```

(Skip the `gh` step if the human prefers to close issues manually — confirm before running.)

---

## Self-review notes

- **Spec coverage:** Section 1 in scope items map to Tasks 1-7 (registry/providers), 8-11 (policy + migration + watcher), 12 (allocator), 14-18 (coordination + speech path), 19-25 (commands + IPC + help), 30 (telemetry). Section 2 data flows covered by tasks 14-18. Section 3 ID format covered by Tasks 1, 26. Section 4 protocol + providers covered by 3-7. Section 5 policy file + migration covered by 9-10, sample policy edge cases by tests in 26-28. Section 6 allocator + commands covered by 12, 19-22. Section 7 testing covered by 1, 8, 10, 12, 25-28, 30. Section 8 audit confirmed by Task 31 (hook untouched), Task 35 (final shim deletion). Section 9 docs deliverables covered by 23-24, 32-34.
- **Open questions resolved:** All five plan-time decisions baked into tasks (file rename, separate watcher, sort fall-through documented in docs/api, internal name kept, mock provider in production target gated by env).
- **Type consistency:** `VoiceRecord.dictionary()` defined in Task 2 reused in Tasks 16, 21, 22. `VoiceID.parse` / `canonicalize` defined in Task 1 reused in Tasks 13, 15, 16, 18. `VoicePolicyStore` API methods (`load`, `reload`, `setPreferred`, `preferred`, `migrateLegacyAssignmentsIfNeeded`) defined in Tasks 9-10 used consistently in Tasks 11, 14-16. `VoicePolicy.empty` defined in Task 9 used in Task 11. Allocator API (`seed`, `reseed`, `next`, `markUsed`) defined in Task 12 used in 14, 15, 17, 21. `VoiceRegistry.allocatableSnapshot()` / `lookup()` defined in Task 7 used in Tasks 14, 16, 17.
- **Strangler safety:** Each checkpoint leaves `main` shippable. Old `aos voice leases` keeps working through Task 20, gets deprecation alias, finally folds into `assignments`. `voice-assignments.json` legacy file is migrated by Task 10 and remains as `.migrated` for forensic comfort.
- **Reload coherence:** `VoicePolicyWatcher` (Task 11) takes the bus-owned `VoicePolicyStore` via init, and the daemon (Task 17) wires the watcher with `coordinationBus.voicePolicyStore`. This is the single instance `VoiceRegistry`'s `policyLoader` reads through, so reload invalidates the right cache. The watcher uses a parent-directory fd (not a file fd) so a single `O_EVTONLY` source survives `VoicePolicyStore.save()`'s write-tmp + remove + rename cycle indefinitely — no reopen logic, no fd-lifecycle race.
- **Deterministic restore order:** `seedAllocatorAfterRestore()` (Task 14) sorts restored sessions by `(registeredAt ASC, sessionID ASC)` per spec Section 5, so reseed mark-used order is stable across restarts.
- **Allocation contract proofs (Task 27):** Test pre-writes `policy.json` disabling the system + elevenlabs providers so the allocatable pool is exactly the 5 mock voices in known order, then traces the deque step-by-step and asserts the **exact** voice each fresh registration receives at each phase: distinct-while-supply (S1=alpha, S2=bravo, S3=charlie), bias-away (after bind S2=delta, S4=echo not delta), over-capacity reuse (S5=alpha, S6=bravo, S7=charlie wrap), restart-reseed-marks-restored (S8=delta — distinguishable from the bug-state value alpha that an unmarked deque would yield).
- **Watcher continuity proof (Task 28):** Test rewrites `policy.json` twice in sequence and asserts the second rewrite is observed (`availability.enabled` flips from False back to True). A file-fd watcher would detach after the first atomic rename; only the parent-dir design picks up the second event.
