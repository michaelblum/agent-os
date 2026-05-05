# Voice Registry, Providers, and Allocation — Design

- **Date:** 2026-04-22
- **Issue:** [#103](../../../) — Replace hard-coded session voice bank with provider-agnostic voice registry and leasing system
- **Scope cut:** registry + system provider + ElevenLabs stub catalog + allocation rebuild + audit. Hook redesign and ElevenLabs synthesis deferred.
- **Status:** design — pending implementation

## 1. Overview and scope

Replace hard-coded `SessionVoiceBank` with a provider-agnostic `VoiceRegistry` backed by pluggable `VoiceProvider` implementations. Ship a `system` provider (macOS `NSSpeechSynthesizer`) and an `elevenlabs` stub catalog provider. Replace exclusivity-style assignment with a rotation-plus-cooldown allocator. Audit hook and final-response call sites in the same workstream; defer hook redesign.

### In scope (incremental checkpoints on `main`)

- `VoiceProvider` Swift protocol and an in-process `VoiceRegistry`.
- `system` provider wrapping `NSSpeechSynthesizer.availableVoices`.
- `elevenlabs` stub provider returning a fixed fixture catalog (no synthesis).
- Canonical URI voice ids: `voice://<provider>/<provider_voice_id>` plus helper functions.
- `voice/policy.json` (sectioned: `providers`, `voices`, `session_preferences`).
- Rotation-plus-cooldown allocator (FIFO deque, in-memory).
- `aos voice list` (voice-centric); `aos voice assignments` (session-centric, replaces `leases`); `aos voice refresh`; `aos voice providers`.
- `aos voice bind --session-id <sid> --voice <voice-id>` kept; semantics: assign now AND persist `session_preferences[sid] = preferred_voice_id`. The `--share` flag is removed because there is no exclusivity to override.
- Migration: legacy `voice-assignments.json` → `session_preferences`; legacy bare ids → URI ids on read.
- Audit section enumerating every call site that touches the old bank, voice ids, or related contracts.

### Out of scope

- ElevenLabs synthesis path (catalog stub only).
- Hook / final-response architectural redesign.
- `aos voice policy` CLI write surface (file editing in v1, intentional).
- Audition / preference history store.
- Persistent allocator state (in-memory only).
- Hot-swap when a preferred voice becomes available later.
- Dynamic provider registration.
- Per-channel / per-purpose voice routing.
- Concurrent-speech mixing.

### Deviation from issue body

Issue acceptance criterion #5 reads: "two active agents do not use the same voice at the same time unless explicitly allowed." Product steer is different: variety is preferred, duplicates among active sessions are acceptable, and operators add more voices if they want more variety. This design implements rotation-plus-cooldown for variety pressure without enforcing exclusivity. The issue's acceptance criteria should be updated to match.

## 2. Architecture and data flow

### Components

```
src/voice/
  registry.swift           ← VoiceRegistry + VoiceRecord + ID helpers
  provider.swift           ← VoiceProvider protocol + ProviderAvailability
  providers/
    system.swift           ← SystemVoiceProvider (NSSpeechSynthesizer)
    elevenlabs-stub.swift  ← ElevenLabsStubProvider (fixture catalog)
  policy.swift             ← VoicePolicy load/save (voice/policy.json)
  allocator.swift          ← VoiceAllocator (rotation deque + cooldown)
  session-voice.swift      ← shrunk: SessionVoiceDescriptor (built from VoiceRecord), render policy, final-response ingress (audit defers redesign)
  engine.swift             ← unchanged
  say.swift                ← unchanged
src/commands/voice.swift   ← extended: refresh, providers; assignments rename; bind without --share
src/daemon/coordination.swift ← rewritten voice sections: uses VoiceRegistry + VoiceAllocator instead of SessionVoiceBank
```

### Boundary rules

- `registry.swift`: stateless aggregation. `snapshot()` re-enumerates each call (system enumeration is millisecond-cheap; stub is constant), applies policy overlay, returns `[VoiceRecord]`. `refresh()` is a synonym-with-intent — re-enumerates and returns; v1 has no internal cache.
- `provider.swift`: protocol only — `name`, `enumerate()`, `availability`. No state.
- `policy.swift`: file I/O for `voice/policy.json`. Pure load/save plus section accessors. Owns `session_preferences` reads and writes.
- `allocator.swift`: session-agnostic. Owns rotation deque plus cooldown only. API: `seed(uris:)`, `next() -> URI?`, `markUsed(uri)`, `reseed(uris:)`.
- `coordination.swift`: orchestrator. On register: query `policy.preferred(sid)`; if URI present in registry snapshot AND record is allocatable → use plus `allocator.markUsed`; else `allocator.next()`. Owns session-to-voice descriptor construction. Persists nothing voice-specific in `coordination/sessions.json` beyond the resolved descriptor for snapshot-restore comfort; source of truth = policy plus allocator.
- `session-voice.swift`: thin shape only — `SessionVoiceDescriptor` constructed from `VoiceRecord` for IPC. Final-response ingress kept here (audit defers redesign).

### Data flow — assignment on session register

```
register session sid
  ↓
preferredURI = policy.preferred(sid)
  ↓
if preferredURI != nil AND registry.contains(preferredURI) AND record.isAllocatable:
    voice = preferredURI
    allocator.markUsed(voice)
else:
    if preferredURI != nil:
        emit voice-events.jsonl: {kind: "preference_skipped", session_id: sid, voice_id: preferredURI, reason: <why>}
    voice = allocator.next()    // automatically cools
descriptor = registry.lookup(voice)
sessions[sid].voice = descriptor
```

### Data flow — `aos voice list`

```
voice list
  ↓
coordination → registry.snapshot()
  ↓
registry: for each provider → enumerate() → map to VoiceRecord
            apply policy (disabled filter sets availability.enabled, promote list affects sort)
            return merged [VoiceRecord]
  ↓
coordination overlays current per-session assignment (current_session_ids)
  ↓
emit JSON
```

### Data flow — `aos voice bind --session-id sid --voice uri`

```
bind
  ↓
coordination
  ↓
canonicalize(uri)
  ↓
registry.contains(uri)? else error VOICE_NOT_FOUND
record.speak_supported? else error VOICE_NOT_SPEAKABLE
record.isAllocatable (enabled && installed && reachable)? else error VOICE_NOT_ALLOCATABLE
  ↓
policy.setPreferred(sid, uri)  (writes voice/policy.json)
  ↓
allocator.markUsed(uri)        (cooldown)
  ↓
update sessions[sid].voice descriptor in-place
  ↓
emit JSON
```

### Data flow — `aos voice refresh`

```
refresh
  ↓
coordination → registry.refresh()
  ↓
registry re-enumerates each provider, applies policy
  ↓
allocator.reseed(allocatableSnapshot())
  ↓
emit JSON snapshot
```

## 3. Voice record and ID format

### Canonical ID

`voice://<provider>/<provider_voice_id>`. The provider-voice-id suffix is treated as opaque after the `/`. No URL normalization. Case preserved exactly. Round-trip required.

### Helpers (in `registry.swift`)

```swift
enum VoiceID {
    static let prefix = "voice://"

    static func make(provider: String, providerVoiceID: String) -> String {
        precondition(!provider.contains("/"))
        precondition(!provider.isEmpty)
        precondition(!providerVoiceID.isEmpty)
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
}
```

Tests required:

- Round-trip `make` → `parse` for every voice in registry snapshot.
- Collision: same `provider_voice_id` under two providers yields distinct IDs.
- Bare legacy id (`com.apple.voice.premium.en-US.Ava`) is NOT a valid canonical id; migration handled separately.
- IDs containing `/` in `provider_voice_id` survive round-trip (defensive synthetic).

### Voice record (durable plus queryable shape)

```jsonc
{
  "id": "voice://system/com.apple.voice.premium.en-US.Ava",
  "provider": "system",
  "provider_voice_id": "com.apple.voice.premium.en-US.Ava",
  "name": "Ava",
  "display_name": "Ava (Premium)",
  "locale": "en-US",
  "language": "en",
  "region": "US",
  "gender": "female",
  "kind": "human",
  "quality_tier": "premium",
  "tags": [],
  "capabilities": {
    "local": true,
    "streaming": false,
    "ssml": false,
    "speak_supported": true
  },
  "availability": {
    "installed": true,
    "enabled": true,
    "reachable": true
  },
  "metadata": {}
}
```

### Field rules

- `id`, `provider`, `provider_voice_id`: required, all three; `id` MUST equal `make(provider, provider_voice_id)`.
- `name`: short label; `display_name` optional.
- `locale`: BCP-47-ish (`en-US`).
- `language` / `region`: derived by the registry when `locale` is parseable; providers may supply directly when locale is absent or non-standard.
- `gender`: `female` / `male` / `neutral` / `unknown`.
- `kind`: `human` / `character` / `unknown`.
- `quality_tier`: `premium` / `enhanced` / `standard` / `unknown`.
- `tags`: free-form provider strings; UI / policy may filter on these.
- `capabilities`: feature flags — providers fill known caps, omit unknown.
- `capabilities.speak_supported`: whether the daemon can synthesize speech for this voice in this version. `system` = `true`, `elevenlabs` stub = `false`. Allocator only chooses voices where this is `true`.
- `availability.installed`: voice present in provider catalog.
- `availability.reachable`: provider currently reachable (system always true; elevenlabs stub always true; future remote: ping/api-key gated).
- `availability.enabled`: operator-policy result. `false` if URI is in `voice/policy.json` `voices.disabled[]`, or if `providers.<name>.enabled = false`.
- `metadata`: provider-specific, JSON-safe passthrough for fields not normalized in v1. Opaque to registry and allocator. Providers MUST emit only JSON-compatible values; no framework objects.

### Visibility rule

Registry snapshot returns ALL discovered voices regardless of disabled state. `aos voice list` shows the full list (disabled voices visible for observability). Allocator filters to `enabled && installed && reachable && speak_supported` at selection time.

### Stored vs derived

No stored `sort.*` fields. Sort at query time:

1. `voices.promote[]` from policy (operator-pinned promotions).
2. Provider declared `providerRank` (lower = earlier).
3. `quality_tier`: premium > enhanced > standard > unknown.
4. `name` ASCII for stable tiebreak.

Dropped from issue's draft shape: `sort.provider_rank`, `sort.quality_rank`. All other fields kept.

## 4. Provider abstraction

### Protocol

```swift
protocol VoiceProvider {
    var name: String { get }              // "system", "elevenlabs", ...
    var providerRank: Int { get }         // sort weight; lower = earlier
    var availability: ProviderAvailability { get }
    func enumerate() -> [VoiceRecord]
}

struct ProviderAvailability {
    let reachable: Bool
    let reason: String?                   // optional human-readable when not reachable
}
```

`enumerate()` is synchronous in v1. System: millisecond-cheap. Stub: constant. Future remote providers either cache internally or expose async via a future protocol extension; deliberately deferred.

`enumerate()` returns whatever the provider knows. Registry overlays operator policy (disabled list, promote list) afterward to set `availability.enabled`.

`providerRank` is baked into the provider, not derived from registration order. Keeps sort stable across registration churn.

### Provider registration

Hardcoded list in `registry.swift`:

```swift
let providers: [VoiceProvider] = [
    SystemVoiceProvider(),       // rank 10
    ElevenLabsStubProvider()     // rank 20
]
```

No dynamic registration in v1. Future providers added by edit plus recompile.

### `SystemVoiceProvider`

- Wraps `NSSpeechSynthesizer.availableVoices`.
- Maps each `voiceName` to `VoiceRecord`:
  - `provider = "system"`
  - `provider_voice_id = voiceName.rawValue`
  - `id = VoiceID.make("system", provider_voice_id)`
  - `name`, `gender`, `locale` from `attributes(forVoice:)`
  - `quality_tier` from existing `SpeechEngine.qualityTier(forVoiceID:)` heuristic, lifted into provider
  - `language`, `region` derived from `locale`
  - `kind = "human"`
  - `capabilities = { local: true, streaming: false, ssml: false, speak_supported: true }`
  - `availability.installed = true`, `reachable = true`, `enabled` filled later by registry policy overlay
  - `metadata = {}`
- `availability.reachable = true` always — local API.
- `providerRank = 10`.

### `ElevenLabsStubProvider`

- Returns a hardcoded fixture `[VoiceRecord]`. Static table in Swift source, no JSON file in v1.
- Fixture content: 3-5 representative voices with realistic-shaped IDs (e.g. `21m00Tcm4TlvDq8ikWAM`) so future swap to live API is shape-compatible.
- Each record:
  - `provider = "elevenlabs"`
  - `kind`: mix of `human` and one `character`
  - `capabilities = { local: false, streaming: true, ssml: false, speak_supported: false }`
  - `availability.installed = true`, `reachable = true`, `enabled` via policy
  - `metadata.cost_class`, `metadata.voice_settings` — illustrative passthrough
- No synthesis path. Allocator never chooses these voices because `speak_supported = false`. `aos voice bind` to a stub URI returns `VOICE_NOT_SPEAKABLE`.
- `providerRank = 20`.
- `availability.reachable = true` (stub fakes reachability so it appears in normal listings; toggle to `false` in tests via env var to verify allocator filter).

### Test-only third provider (optional)

`MockVoiceProvider` in test target only — used by allocator tests to assert provider-rank sorting and reachability filtering without depending on system voice install state. Location decision deferred to plan (see Open Questions).

### Registry methods

```swift
class VoiceRegistry {
    func snapshot() -> [VoiceRecord]              // re-enumerate all + apply policy
    func lookup(_ uri: String) -> VoiceRecord?    // resolve URI → record or nil
    func contains(_ uri: String) -> Bool
    func providers() -> [ProviderInfo]            // for `aos voice providers`
    func refresh() -> [VoiceRecord]               // synonym of snapshot; explicit operator intent
}

struct ProviderInfo {
    let name: String
    let rank: Int
    let availability: ProviderAvailability
    let voice_count: Int
    let enabled: Bool                             // operator policy result
}
```

### `SessionVoiceBank` retirement

Kept temporarily during strangler migration as a thin shim:

```swift
@available(*, deprecated, message: "Use VoiceRegistry")
enum SessionVoiceBank {
    static func curatedVoices() -> [SessionVoiceDescriptor] {
        // adapter: registry.snapshot() filtered to enabled+installed+reachable+speak_supported,
        // mapped to legacy descriptor shape
    }
    static func voice(id: String) -> SessionVoiceDescriptor? { /* registry.lookup with bare-id upgrade */ }
    static func hasVoice(id: String) -> Bool { /* same */ }
}
```

Shim deleted in the final checkpoint of the workstream. Tests touching it migrated incrementally.

## 5. Policy file and migration

### File path

`~/.config/aos/{mode}/voice/policy.json`. Mode-scoped per repo convention.

### Schema (v1)

```jsonc
{
  "schema_version": 1,
  "providers": {
    // Entries default to { "enabled": true } if absent.
    // Example (commented) of an explicit override:
    //   "elevenlabs": { "enabled": false }
  },
  "voices": {
    "disabled": [
      "voice://system/com.apple.voice.compact.en-US.Samantha"
    ],
    "promote": [
      "voice://system/com.apple.voice.premium.en-US.Ava",
      "voice://system/com.apple.voice.premium.en-US.Zoe"
    ]
  },
  "session_preferences": {
    "019d97cc-2f15-7951-b0bd-3a271d7fb97c": "voice://system/com.apple.voice.premium.en-US.Ava"
  }
}
```

### Section semantics

- `providers[name].enabled`: when `false`, every voice from that provider has `availability.enabled = false`. Default `true` if section absent.
- `voices.disabled[]`: per-voice disable list (URI). Sets `availability.enabled = false`.
- `voices.promote[]`: ordered list, URIs that win sort tiebreaks above provider/quality rank. Promote does NOT override allocator filter — only sort order.
- `session_preferences[sid] = uri`: durable per-session preference. Written by `aos voice bind`. Cleared by removing the entry (manual edit; no CLI in v1).

### Preferred-voice resolution rule

`session_preferences` is a durable preference *hint*, not a force-assign override. On register / re-register, the daemon may apply a stored preference only when the corresponding record is allocatable: `enabled && installed && reachable && speak_supported`. Otherwise the entry is ignored for this assignment cycle and the allocator's rotation runs as if no preference existed. The preference stays in `policy.json` for future cycles where the voice may become allocatable again.

### Reload behavior

The daemon already watches `config.json` via `ConfigWatcher`. This work extends the watcher mechanism (not its current file scope) to also observe `voice/policy.json`. Implementation choice: either generalize `ConfigWatcher` to watch a list of files, or instantiate a second watcher specifically for `voice/policy.json`. On change:

- Registry snapshot becomes naturally fresh (next call re-applies policy).
- Allocator: re-seed from new enabled voice list, preserving relative deque order for voices still present, dropping removed voices, appending newly-enabled voices to back.
- Coordination: do NOT auto-reassign live sessions on policy change. Sessions keep their current descriptor until they re-register or a new explicit `bind` happens.

### Defaults when file absent

Treat as empty document with `schema_version: 1`. All providers enabled, no voices disabled, no promotions, no preferences.

### Atomic writes

Write `policy.json.tmp`, rename. Lock via existing coordination lock.

### Migration — legacy `voice-assignments.json` → `voice/policy.json`

One-shot, runs on coordination boot if `voice-assignments.json` exists AND `voice/policy.json` does not yet have a `session_preferences` section (or file absent). Steps:

1. Read legacy `voice-assignments.json`.
2. For each `{ session_id, voice_id }`:
   - Treat `voice_id` as a bare provider voice id under `system` provider.
   - Upgrade to URI: `VoiceID.make("system", legacy_voice_id)`.
3. Build `session_preferences` map.
4. Read existing `voice/policy.json` if present, or create empty doc.
5. Merge `session_preferences` into doc (legacy entries win on first migration since target was empty).
6. Write `voice/policy.json` atomically.
7. Rename `voice-assignments.json` → `voice-assignments.json.migrated`.

Drop legacy `nextVoiceAssignmentIndex`. The new allocator seeds from registry snapshot, not from a persisted index.

### Bare-id-on-read upgrade (defensive)

Anywhere the daemon reads a voice id from a payload (IPC `voice_id` arg, restored session snapshot, etc.), apply this normalization before lookup:

```swift
func canonicalize(_ rawID: String) -> String {
    if rawID.hasPrefix(VoiceID.prefix) { return rawID }
    return VoiceID.make(provider: "system", providerVoiceID: rawID)
}
```

This survives the migration window where external callers (test scripts, hooks, user shells) still pass bare ids.

### Migration tests

- Legacy file with mixed bare ids → produces `session_preferences` with URI ids.
- Migration is idempotent (second run with `.migrated` already present is a no-op).
- Migration preserves existing `voice/policy.json` content (other sections untouched).
- Bare-id lookup via `canonicalize` resolves to URI form.
- `aos voice bind --voice <bare-id>` accepts and persists URI form.

## 6. Allocator and command surface

### Allocator (`src/voice/allocator.swift`)

State (in-memory only):

```swift
class VoiceAllocator {
    private var deque: [String]              // URIs, front = next to allocate
    private let lock = NSLock()

    func seed(uris: [String])                // initial population, preserves order
    func reseed(uris: [String])              // policy/snapshot drift; preserve relative order of survivors, append newcomers to back
    func next() -> String?                   // pop front, append to back, return uri (nil if empty)
    func markUsed(_ uri: String)             // remove uri if present, append to back
}
```

### Seeding

On daemon start (after `restoreSessionsSnapshot`), coordination calls `allocator.seed(allocatableSnapshot())` where `allocatableSnapshot()` filters registry by `enabled && installed && reachable && speak_supported`. For every existing session in `sessions` with a non-nil voice descriptor, coordination calls `allocator.markUsed(descriptor.id)` in arrival order (`registered_at` ASC, then `session_id` ASC for stable tiebreak). This puts already-active voices at the back of the deque, biasing new registrations toward voices not currently in use.

### Reseed on policy / refresh

When `voice/policy.json` changes or `aos voice refresh` runs:

1. Compute new allocatable URI set.
2. Build new deque: walk current deque, drop URIs not in new set; then append URIs in new set that weren't in current deque (provider-rank, then quality_tier order for stable insertion).
3. Replace deque atomically.
4. Do NOT touch live session voice descriptors. Only future `next()` calls see the new state.

### Empty deque and fallback delivery

Two distinct concepts:

- **Registry assignment** = a voice the allocator chose for a session. Reflected in `sessions[sid].voice` and `aos voice assignments`. May be `null` when no allocatable voice exists.
- **Fallback delivery voice** = the system default used by the daemon TTS path when a session has no assigned voice (or, defensively, when the assigned voice points at a non-speakable record).

Rules:

- `voice = nil` is the truthful state — `aos voice assignments` reports it as `null`. Allocator does not invent a phantom assignment.
- Daemon `announce()` and `tell human --from-session-id <sid>` paths resolve a target via `descriptor?.id ?? SpeechEngine.resolvedDefaultVoiceID` for resilience. Fallback delivery voice is NOT registry state, NOT subject to rotation/cooldown, NOT visible in `voice list` overlays.
- **Engine handoff:** speech paths convert registry URI ids back to raw provider voice ids via `VoiceID.parse(uri)?.providerVoiceID` before calling `SpeechEngine.setVoice` / `SpeechEngine(voice:)`. The fallback delivery target returned by `SpeechEngine.resolvedDefaultVoiceID` is already a raw engine id and bypasses parsing. `SpeechEngine` itself never sees URI form.
- Telemetry: append `voice-events.jsonl` event `{ kind: "fallback_voice_used", session_id, fallback_voice_id, reason: <"no_allocatable_voice" | "assigned_voice_not_speakable"> }`.

### Command surface (`src/commands/voice.swift`)

```
aos voice list
aos voice list --json
aos voice list --provider system
aos voice list --speakable-only
```

Voice-centric. Each entry = full `VoiceRecord` plus `current_session_ids: [sid,...]` overlay (sessions whose live descriptor.id matches).

Default sort: promote list → provider rank → quality tier → name. Default behavior shows ALL discovered voices including disabled. `--speakable-only` filters to allocator-eligible. `--provider <name>` narrows by provider.

```
aos voice assignments
aos voice assignments --json
```

Session-centric. Each entry: `{ session_id, name?, role, harness, voice: VoiceRecord | null }`. Sorted by `registered_at` ASC.

Replaces `aos voice leases`. Old name kept one release as deprecated alias — emits `Deprecation: aos voice leases is now aos voice assignments` to stderr, then runs the same handler.

```
aos voice bind --session-id <sid> --voice <uri-or-bare-id>
```

Resolves `--voice` through `canonicalize()` so bare ids still work. Validates full allocatability — three distinct error codes:

- `VOICE_NOT_FOUND` — not present in registry snapshot.
- `VOICE_NOT_SPEAKABLE` — present but `capabilities.speak_supported = false` (e.g. ElevenLabs stub voices in v1).
- `VOICE_NOT_ALLOCATABLE` — present and speakable, but `enabled && installed && reachable` is false (operator-disabled, missing install, or provider unreachable). Distinct from `VOICE_NOT_SPEAKABLE` so callers can tell "this voice can never speak in v1" from "this voice could speak but policy/availability blocks it right now."

On success: persists `session_preferences[sid] = uri` to `voice/policy.json`. Updates live session descriptor in place. Calls `allocator.markUsed(uri)` to cool. Returns `{ status: "ok", session_id, voice: VoiceRecord }`. Bind validation matches the preferred-voice resolution rule in Section 5 — only allocatable voices may be assigned, whether by allocator rotation or operator override.

```
aos voice refresh
aos voice refresh --json
```

Forces registry re-enumeration. Calls `allocator.reseed(allocatableSnapshot())`. Returns the fresh snapshot (full `[VoiceRecord]`).

```
aos voice providers
aos voice providers --json
```

Returns `[ProviderInfo]`.

```
aos voice final-response --harness <h> --session-id <sid>
```

Unchanged ingress path. Audit confirms compatibility — payload resolution untouched, just resolves voice through new descriptor source.

### IPC schema impact

`daemon-request.schema.json` envelope already supports the `voice` service. New actions added: `assignments`, `refresh`, `providers`. Existing actions kept. `leases` action retained as alias of `assignments` for one release. `daemon-response.schema.json` adds the `VoiceRecord` shape; descriptor stays as projection wrapper.

### Help text and operator surface

`aos voice --help` updates: `assignments` listed primary, `leases` shown with `(deprecated)` tag. `policy` documented as file-based v1 with explicit pointer to `voice/policy.json` path.

## 7. Testing

### Voice ID canonicalization

`tests/voice-id-canonicalization.sh`:

- `VoiceID.make` / `parse` round-trip for sample URIs.
- Same `provider_voice_id` under two providers → distinct canonical URIs.
- Bare legacy id → `canonicalize()` upgrades to `voice://system/<id>`.
- URI with `/` in suffix (defensive synthetic) → round-trip preserved.
- Invalid URIs (`voice://`, `voice://foo`, `voice:foo/bar`, empty) → `parse` returns nil.

### Registry snapshot

`tests/voice-registry-snapshot.sh` (uses `AOS_VOICE_TEST_PROVIDERS=mock` to swap registry to `MockVoiceProvider`):

- `aos voice list --json` returns expected fixture.
- Provider rank ordering: mock-rank-5 voices appear before mock-rank-50.
- Quality-tier secondary sort within rank.
- `voices.promote[]` from policy → promoted voices appear ahead.
- Disabled voices remain visible but `availability.enabled = false`.
- `--speakable-only` filter excludes stub voices and disabled voices.
- `--provider <name>` narrows correctly.

### Providers listing

`tests/voice-providers.sh`:

- `aos voice providers --json` returns ordered providers with rank, voice_count, availability.
- ElevenLabs stub appears with `voice_count >= 3`, `reachable = true`, `enabled = true` by default.
- After setting `providers.elevenlabs.enabled = false` in policy, listing reflects it AND its voices show `availability.enabled = false`.

### Allocator unit

`tests/voice-allocator.sh`:

- Seed deque [A, B, C]; three `next()` calls return A, B, C; deque rotates each time.
- After A, B, C allocated, fourth `next()` returns A again (wrap).
- `markUsed(B)` after seed [A, B, C]: deque becomes [A, C, B]; next `next()` returns A.
- `reseed`: deque [A, B, C] reseeded with [B, C, D] → [B, C, D] (A dropped, D appended; B, C order preserved).
- Empty seed → `next()` returns nil.

### Migration

`tests/voice-migration.sh`:

- Pre-state: `voice-assignments.json` with two `{session_id, voice_id}` entries (bare ids), no `voice/policy.json`.
- After daemon boot: `voice/policy.json` exists with `session_preferences` containing URI-form ids; `voice-assignments.json.migrated` exists; original gone.
- Re-running migration is a no-op.
- Pre-existing `voice/policy.json` with other sections preserved through migration.
- `aos voice bind --voice <bare-id>` → persists URI form.

### Allocator integration with coordination

`tests/voice-session-allocation.sh` (replaces `tests/voice-session-leases.sh` content; file rename or in-place rewrite resolved at plan time):

- Two sessions register sequentially → get the first two distinct voices in the current deque, when at least two allocatable voices exist.
- More sessions registered than voices → later sessions reuse cooled voices; contract is rotation bias, not uniqueness.
- `aos voice bind` for session A → preference persisted, voice cooled, descriptor updated.
- Daemon restart: sessions restored; allocator reseeded; already-restored active voices are marked-used in `registered_at` order before the next new registration's `next()` call, biasing fresh registrations away from in-use voices when alternatives exist. No assertion of zero collisions.
- `voice-assignments.json` migration runs on boot if legacy file present.

### Bind / preference edge cases

`tests/voice-bind.sh` (existing file, expanded):

- Bind to non-existent URI → `VOICE_NOT_FOUND`.
- Bind to stub URI (`speak_supported = false`) → `VOICE_NOT_SPEAKABLE`.
- Bind to disabled URI (in `voices.disabled[]`) → `VOICE_NOT_ALLOCATABLE`.
- Bind to URI whose provider has `providers.<name>.enabled = false` → `VOICE_NOT_ALLOCATABLE`.
- Bind to URI whose provider is currently `reachable = false` (mock toggled in test) → `VOICE_NOT_ALLOCATABLE`.
- Bind succeeds → `voice/policy.json` updated, `aos voice assignments --json` reflects new voice.
- Re-bind same session to different voice → preference replaces.

### Policy reload

`tests/voice-policy-reload.sh` (new):

- Daemon running; modify `voice/policy.json` to disable a voice currently assigned to session A.
- Wait for watcher fire.
- `aos voice list --json` reflects `availability.enabled = false` for that voice.
- Session A's descriptor unchanged (no auto-reassign).
- Allocator deque no longer contains the disabled voice.
- New session registers → does not get the disabled voice.

### Final-response compatibility

`tests/voice-final-response.sh` (existing):

- Hook payload → daemon resolves session voice via new descriptor source.
- Final-response speech uses the session's allocator-assigned voice.
- Output telemetry event shape unchanged.

### Telemetry events

`tests/voice-telemetry.sh` (existing, expanded):

- `preference_skipped` event emitted when stored preference points at non-allocatable voice.
- `fallback_voice_used` event emitted when allocator returns nil.
- `voice-events.jsonl` schema unchanged for existing event kinds.

### Test-only env contract

`AOS_TEST_VOICE_BANK_IDS` env (current) replaced by `AOS_VOICE_TEST_PROVIDERS` (new) which swaps registry providers to `MockVoiceProvider`. Cleaner: tests no longer depend on which Apple voices are installed on the runner.

### Schema validation

- `shared/schemas/daemon-request.schema.json` updated for new `voice` actions.
- `shared/schemas/daemon-response.schema.json` updated for `VoiceRecord` envelope.
- `tests/daemon-ipc-voice.sh` re-validates against new schema.

## 8. Audit — call sites touching the old voice bank, voice ids, or related contracts

Format: file / old assumption / action / verdict.

| File / call site | Old assumption | Action | Verdict |
|---|---|---|---|
| `src/voice/session-voice.swift` `enum SessionVoiceBank` | Hardcoded `preferredVoices` matcher list, `curatedVoices()` filters system-only "premium\|enhanced en-*", returns `[SessionVoiceDescriptor]` | Replace with adapter shim during strangler; final checkpoint deletes the enum | migrated |
| `src/voice/session-voice.swift` `SessionVoiceDescriptor` | Init from `SpeechEngine.VoiceInfo` (system-shaped) | Add init from `VoiceRecord`; keep legacy init during shim window; remove with shim | migrated |
| `src/voice/session-voice.swift` `applyTestBankOverride` (`AOS_TEST_VOICE_BANK_IDS`) | Filters curated bank by env var of bare ids | Replace with `AOS_VOICE_TEST_PROVIDERS` env that swaps registry's provider list to mock; old env deleted, no compat | migrated |
| `src/voice/session-voice.swift` `renderSpeechText`, `effectiveSpeechCancelKeyCode`, `FinalResponseIngress`, `resolve*FinalResponseTranscript` | Render policy and hook ingress orthogonal to voice bank — payload resolution is harness-shape, not voice-shape | No code change. Verify no implicit dependency on `SessionVoiceBank.curatedVoices()` from these helpers | compatible as-is |
| `src/voice/engine.swift` `SpeechEngine.VoiceInfo` plus `availableVoices()` plus `qualityTier(forVoiceID:)` | Shape used by `SessionVoiceBank` AND directly by `aos say --list-voices` | Keep `availableVoices()` for `aos say --list-voices` (back-compat output); also called by `SystemVoiceProvider` internally with same data, mapped to `VoiceRecord`. `qualityTier(...)` lifted into provider, then deleted from engine. `VoiceInfo` deleted with `SessionVoiceBank` shim | migrated |
| `src/voice/engine.swift` `SpeechEngine` core (init/speak/stop/setVoice/setRate) | Voice id is a bare provider id passed to `NSSpeechSynthesizer.VoiceName` | No code change. New code that resolves voice for speech extracts `provider_voice_id` via `VoiceID.parse(uri)` before calling `setVoice`. `SpeechEngine` itself stays Apple-shaped because it IS the system synthesis driver | compatible as-is |
| `src/voice/say.swift` `sayCommand` | `--list-voices` prints `SpeechEngine.availableVoices()` (system shape); `--voice` accepts bare id | Keep behavior unchanged for back-compat. `--voice` accepts both bare id and URI (URI parsed → suffix used) | compatible as-is |
| `src/commands/voice.swift` `voiceCommand` plus `voiceBindEnvelope` plus `voiceFinalResponseEnvelope` | Subcommands: `list`, `leases`, `bind`, `final-response`. `bind` validates against `SessionVoiceBank` | Add `assignments` (alias of new flow), `refresh`, `providers`. Keep `leases` as deprecated alias one release. `bind` validates against registry plus `speak_supported`; `--share` not introduced | migrated |
| `src/daemon/coordination.swift` `voiceAssignments` plus `nextVoiceAssignmentIndex` plus `restoreVoiceAssignments` plus `persistVoiceAssignmentsLocked` plus `assignVoiceLocked` plus `repairVoiceLeasesLocked` plus `repairVoiceAssignmentsLocked` plus `restoredVoice` | Round-robin index over `SessionVoiceBank.curatedVoices()`; durable `voiceAssignments[sid]=voiceID` file at `voice-assignments.json` | Replace map with `policy.session_preferences` reads/writes via new `policy.swift`. Replace `assignVoiceLocked` with new register flow. Delete `nextVoiceAssignmentIndex`. Delete `repair*` helpers. `restoredVoice` adapted to canonicalize ids before lookup | migrated |
| `src/daemon/coordination.swift` `voiceCatalog()` plus `voiceLeases()` plus `bindVoice(...)` | Returns `SessionVoiceBank.curatedVoices()` shape with overlay; bind goes through `SessionVoiceBank.voice(id:)` | `voiceCatalog()` → returns `[VoiceRecord]` with `current_session_ids` overlay. `voiceLeases()` → renamed `voiceAssignments()`. `bindVoice(...)` → registry lookup plus speakable check plus policy.set plus allocator.markUsed plus descriptor refresh | migrated |
| `src/daemon/coordination.swift` `SessionInfo.voice` field | Stored as `SessionVoiceDescriptor` with init from `VoiceInfo` | Field stays `SessionVoiceDescriptor?`; descriptor now constructed from `VoiceRecord` via new init. No structural change to `SessionInfo` | compatible as-is |
| `src/daemon/unified.swift` `announce(...)` plus voice config change handlers plus `speechEngine` init | Uses `currentConfig.voice.voice` (raw string) for default; `speechEngine.setVoice(voiceID)` with bare id | Add canonicalize/parse step: if `currentConfig.voice.voice` is URI form, parse and pass suffix to `setVoice`. If bare, pass as-is. Same handling for `setVoice(_:)` callers. No semantic change | compatible as-is |
| `src/daemon/unified.swift` final-response speech path (action handler `voice-final-response`) | Resolves session voice via `coordination.voiceCatalog()`/`SessionInfo.voice` → speaks via `SpeechEngine` | Resolution path stays. New session voice descriptor source = registry-backed but same shape. Verify no field deletion that breaks downstream | compatible as-is |
| `src/shared/command-registry-data.swift` voice command entries | Lists `voice list`, `voice leases`, `voice bind`, `voice final-response` | Add entries for `voice assignments`, `voice refresh`, `voice providers`. Mark `voice leases` deprecated. Update help strings | migrated |
| `shared/swift/ipc/runtime-paths.swift` `aosVoiceAssignmentsPath()` | Returns `coordination/voice-assignments.json`; consumed by `CoordinationBus` for legacy durable map | Add `aosVoicePolicyPath()` returning `voice/policy.json`. Keep `aosVoiceAssignmentsPath()` for migration-read window only with `@available(*, deprecated, message: "Used only by one-shot migration. Remove with shim.")`. Delete in final strangler checkpoint | migrated |
| `shared/schemas/daemon-ipc.md` | Documents `voice.list`, `voice.leases`, `voice.bind`, `voice.final_response` | Add `voice.assignments`, `voice.refresh`, `voice.providers`. Mark `voice.leases` deprecated alias one release. Update `voice.bind` row to note URI/bare-id acceptance plus error codes | migrated |
| `.agents/hooks/final-response.sh` | Pipes hook input to `aos voice final-response` | No change. Daemon-side resolution adapted, hook payload contract unchanged | compatible as-is |
| `.agents/hooks/session-start.sh`, `session-stop.sh`, `check-messages.sh`, `pre-tool-use.sh`, `post-tool-use.sh`, `pre-compact.sh`, `git-health.sh`, `aos-agent-policy.py` | None reference voice bank, voice ids, or `aos voice` directly (verified by grep) | None | compatible as-is |
| `tests/voice-session-leases.sh` | Codifies old wraparound-collision behavior; uses `AOS_TEST_VOICE_BANK_IDS` | Rewritten to assert new rotation+cooldown contract. Renamed file → content per Section 7 (`voice-session-allocation.sh` semantics; file path retained for CI continuity OR renamed in CI manifest pass) | migrated |
| `tests/voice-bind.sh` | Tests bind against curated bank with bare ids | Expanded per Section 7 | migrated |
| `tests/voice-final-response.sh` | Asserts session-leased voice speaks final response | Re-runs unchanged; verifies new descriptor source produces same observable output | compatible as-is |
| `tests/voice-telemetry.sh` | Existing voice-events.jsonl shape | Expanded per Section 7 | migrated |
| `tests/daemon-ipc-voice.sh` | Validates IPC schema for voice service | Re-validates after schema bump | migrated |
| `docs/api/aos.md` `## aos voice` section plus voice config keys table | Documents curated bank, leases, round-robin assignment, durable assignments path `coordination/voice-assignments.json` | Rewrite section: registry-backed catalog, providers (`system` plus `elevenlabs` stub), allocator rotation+cooldown, `assignments` rename (with `leases` deprecated callout), `voice/policy.json` path explicitly replacing `coordination/voice-assignments.json` plus one-shot migration note plus `.migrated` rename behavior, `--share` removed, `final-response` ingress unchanged, voice id format change (URI canonical, bare accepted on input) | migrated |
| `src/CLAUDE.md` voice command examples plus voice-assignments path reference | Same examples as docs/api; line 210 references `coordination/voice-assignments.json` as durable assignment store | Sync after docs/api: replace `voice leases` example with `voice assignments`, add new examples for `refresh`/`providers`, replace `coordination/voice-assignments.json` reference with `voice/policy.json` plus one-line migration note pointing to docs/api | migrated |
| `ARCHITECTURE.md` voice subsystem rows | "TTS, daemon-driven announcements, config-driven voice/rate. STT planned" | Add registry/provider note in same row; no row split needed v1 | migrated |
| `shared/schemas/daemon-request.schema.json` voice service actions | `list`, `leases`, `bind`, `final_response` | Add `assignments`, `refresh`, `providers`. Keep `leases` for deprecation window | migrated |
| `shared/schemas/daemon-response.schema.json` voice payload shapes | Curated bank descriptor shape | Add `VoiceRecord` shape; descriptor stays as projection wrapper | migrated |
| Issue #103 acceptance criteria | "two active agents do not use the same voice... unless explicitly allowed" | Deferred — recommend updating issue text to match product steer (rotation+cooldown variety pressure, no exclusivity guarantee). Section 1 explicitly notes deviation. | deferred |

Categories summary: migrated 18 / compatible-as-is 7 / deferred 1.

## 9. Out of scope, docs, open questions, AC mapping

### Out of scope (this design / first workstream)

- ElevenLabs synthesis path. Stub provider returns catalog only.
- Hook / final-response architectural redesign. Audit confirms current path stays compatible.
- `aos voice policy` CLI write surface. v1 = file-edit plus watcher reload.
- Audition / preference history store.
- Persistent allocator / cooldown state. Deque is in-memory.
- Hot-swap on preferred-voice availability change. Re-register or re-bind to pick up.
- Dynamic provider registration. Providers list is hardcoded in `registry.swift`.
- Per-channel / per-purpose voice routing. All speech for a session uses the same assigned voice.
- Concurrent-speech mixing. `SpeechEngine` is single-stream.

### Documentation deliverables

- `docs/api/aos.md` `## aos voice` section rewritten.
- `src/CLAUDE.md` voice command examples plus path reference updated.
- `ARCHITECTURE.md` voice row gets a one-line "registry-backed, provider-pluggable" note. No row split.
- `shared/schemas/daemon-ipc.md` updated for new actions plus deprecation alias.
- `shared/schemas/daemon-request.schema.json` plus `daemon-response.schema.json` bumped.
- This design doc lives at `docs/superpowers/specs/2026-04-22-voice-registry-provider-allocation-design.md`.
- No separate audit doc (audit lives in this spec).

### Open questions (deferred to plan / implementation)

1. `tests/voice-session-leases.sh` file rename vs in-place rewrite. Plan task: check CI manifest cost; rename to `voice-session-allocation.sh` if cheap, else rewrite content under existing name with comment header noting the new contract.
2. `ConfigWatcher` extension shape. Generalize the watcher to accept a list of files vs. instantiate a second watcher for `voice/policy.json`. Plan task picks based on existing watcher complexity.
3. `aos voice list` default sort tiebreak when promote list is partial. When `voices.promote` lists 2 of 5 voices, the unlisted 3 fall through to provider-rank → quality-tier → name. Confirm operator expectation; document as such.
4. Coordination `voiceCatalog()` method renaming. Either rename to `voiceList()` for symmetry with command, or keep `voiceCatalog()` as the in-process API name. Not user-visible.
5. `MockVoiceProvider` location. Test target only, but Swift's test target setup in this repo isn't pure XCTest. Plan task picks: new file under `src/voice/providers/` guarded by `#if AOS_TEST` build flag, or shell-test-driven with `AOS_VOICE_TEST_PROVIDERS=mock` toggle that the production registry honors at startup.

### Acceptance criteria mapping (vs issue #103)

| AC # | Issue text | Status |
|---|---|---|
| 1 | `aos voice list` backed by registry | addressed by this design (Section 6) |
| 2 | Provider-agnostic abstraction | addressed by this design (Section 4) |
| 3 | One local plus one stub external provider | addressed by this design (Section 4: system plus elevenlabs-stub) |
| 4 | Voice metadata supports filter/sort/categorization | addressed by this design (Section 3 record plus Section 6 `--provider`/`--speakable-only`) |
| 5 | Leasing prevents duplicate voice use among active agents by default | explicitly deviated (Section 1: rotation-plus-cooldown variety pressure, no exclusivity guarantee) — recommend updating issue text |
| 6 | Existing session assignment migrated onto new registry IDs | addressed by this design (Section 5 migration plus bare-id canonicalization) |
| 7 | Hook/final-response call sites audited | addressed by this design (Section 8) |
| 8 | Docs updated at API plus architecture boundaries | planned in this workstream (Section 9 docs deliverables) |
