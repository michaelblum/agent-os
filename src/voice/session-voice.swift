import Foundation
import NaturalLanguage

struct SessionVoiceDescriptor: Codable {
    let provider: String
    let id: String
    let name: String
    let locale: String
    let gender: String
    let quality_tier: String
    let available: Bool
    let lease_session_id: String?
    let lease_session_name: String?

    init(
        provider: String,
        id: String,
        name: String,
        locale: String,
        gender: String,
        quality_tier: String,
        available: Bool = true,
        lease_session_id: String? = nil,
        lease_session_name: String? = nil
    ) {
        self.provider = provider
        self.id = id
        self.name = name
        self.locale = locale
        self.gender = gender
        self.quality_tier = quality_tier
        self.available = available
        self.lease_session_id = lease_session_id
        self.lease_session_name = lease_session_name
    }

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

    func withLease(sessionID: String?, sessionName: String?) -> SessionVoiceDescriptor {
        SessionVoiceDescriptor(
            provider: provider,
            id: id,
            name: name,
            locale: locale,
            gender: gender,
            quality_tier: quality_tier,
            available: available,
            lease_session_id: sessionID,
            lease_session_name: sessionName
        )
    }

    func dictionary() -> [String: Any] {
        var payload: [String: Any] = [
            "provider": provider,
            "id": id,
            "name": name,
            "locale": locale,
            "gender": gender,
            "quality_tier": quality_tier,
            "available": available
        ]
        if let lease_session_id {
            payload["lease_session_id"] = lease_session_id
        }
        if let lease_session_name {
            payload["lease_session_name"] = lease_session_name
        }
        return payload
    }
}

struct VoiceRenderResult {
    let text: String
    let purpose: String?
    let style: String
    let fallback_style: String?

    func dictionary() -> [String: Any] {
        var payload: [String: Any] = [
            "text": text,
            "style": style,
            "characters": text.count
        ]
        if let purpose {
            payload["purpose"] = purpose
        }
        if let fallback_style {
            payload["fallback_style"] = fallback_style
        }
        return payload
    }
}

func effectiveSpeechCancelKeyCode(config: AosConfig) -> UInt16? {
    if let controls = config.voice.controls, let cancel = controls.cancel {
        return cancel.key_code
    }
    return config.hotkeys?.cancel_speech ?? 53
}

func renderSpeechText(rawText: String, purpose: String?, config: AosConfig) -> VoiceRenderResult {
    let trimmed = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
        return VoiceRenderResult(text: "", purpose: purpose, style: "empty", fallback_style: nil)
    }

    guard purpose == "final_response" else {
        return VoiceRenderResult(text: trimmed, purpose: purpose, style: "full", fallback_style: nil)
    }

    let policy = effectiveFinalResponsePolicy(config)
    switch policy.style {
    case "full":
        return VoiceRenderResult(text: trimmed, purpose: purpose, style: "full", fallback_style: nil)
    case "last_n_chars":
        return VoiceRenderResult(
            text: tailCharacters(trimmed, count: policy.last_n_chars),
            purpose: purpose,
            style: "last_n_chars",
            fallback_style: nil
        )
    default:
        if let sentence = lastSentence(from: trimmed) {
            return VoiceRenderResult(text: sentence, purpose: purpose, style: "last_sentence", fallback_style: nil)
        }
        return VoiceRenderResult(
            text: tailCharacters(trimmed, count: policy.last_n_chars),
            purpose: purpose,
            style: "last_sentence",
            fallback_style: "last_n_chars"
        )
    }
}

private func lastSentence(from text: String) -> String? {
    let tokenizer = NLTokenizer(unit: .sentence)
    tokenizer.string = text

    var last: String?
    tokenizer.enumerateTokens(in: text.startIndex..<text.endIndex) { range, _ in
        let sentence = text[range].trimmingCharacters(in: .whitespacesAndNewlines)
        if !sentence.isEmpty {
            last = sentence
        }
        return true
    }
    return last
}

private func tailCharacters(_ text: String, count: Int) -> String {
    guard count > 0, text.count > count else { return text }
    return String(text.suffix(count)).trimmingCharacters(in: .whitespacesAndNewlines)
}

private func effectiveFinalResponsePolicy(_ config: AosConfig) -> (style: String, last_n_chars: Int) {
    let configured = config.voice.policies?.final_response
    let style = configured?.style?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "last_sentence"
    let lastNChars = max(1, configured?.last_n_chars ?? 400)
    return (style, lastNChars)
}

struct FinalResponseIngress {
    let sessionID: String?
    let harness: String
    let message: String?
    let transcriptPath: String?
    let messageSource: String?

    func dictionary() -> [String: Any] {
        var payload: [String: Any] = ["harness": harness]
        if let sessionID {
            payload["session_id"] = sessionID
        }
        if let transcriptPath {
            payload["transcript_path"] = transcriptPath
        }
        if let messageSource {
            payload["message_source"] = messageSource
        }
        return payload
    }
}

private struct FinalResponseTranscriptResolution {
    let text: String
    let source: String
}

func resolveFinalResponseIngress(
    explicitSessionID: String?,
    explicitHarness: String?,
    hookPayload: Any?
) -> FinalResponseIngress {
    let payload = hookPayload as? [String: Any] ?? [:]
    let harness = (
        normalizeNonEmpty(explicitHarness)
        ?? extractString(payload, paths: [["harness"], ["provider"], ["payload", "harness"]])
        ?? "unknown"
    )
    let transcriptPath = extractString(payload, paths: [["transcript_path"], ["payload", "transcript_path"]])
    let sessionID = (
        normalizeNonEmpty(explicitSessionID)
        ?? extractString(payload, paths: [["session_id"], ["thread_id"], ["payload", "session_id"], ["payload", "thread_id"]])
        ?? sessionIDFromTranscriptPath(transcriptPath)
    )

    if let directMessage = extractString(payload, paths: [
        ["last_assistant_message"],
        ["assistant_message"],
        ["final_assistant_message"],
        ["payload", "last_assistant_message"],
        ["payload", "assistant_message"],
        ["message", "text"],
        ["last_message", "text"]
    ]) {
        return FinalResponseIngress(
            sessionID: sessionID,
            harness: harness,
            message: directMessage,
            transcriptPath: transcriptPath,
            messageSource: "direct"
        )
    }

    if let transcriptPath,
       let resolved = resolveFinalResponseTranscript(path: transcriptPath, harness: harness) {
        return FinalResponseIngress(
            sessionID: sessionID,
            harness: harness,
            message: resolved.text,
            transcriptPath: transcriptPath,
            messageSource: resolved.source
        )
    }

    return FinalResponseIngress(
        sessionID: sessionID,
        harness: harness,
        message: nil,
        transcriptPath: transcriptPath,
        messageSource: nil
    )
}

private func normalizeNonEmpty(_ value: String?) -> String? {
    guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
    return value
}

private func extractString(_ payload: [String: Any], paths: [[String]]) -> String? {
    for path in paths {
        if let value = nestedString(payload, path: path) {
            return value
        }
    }
    return nil
}

private func nestedString(_ payload: [String: Any], path: [String]) -> String? {
    var current: Any = payload
    for key in path {
        guard let dict = current as? [String: Any], let next = dict[key] else { return nil }
        current = next
    }
    guard let text = current as? String else { return nil }
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
}

private func sessionIDFromTranscriptPath(_ transcriptPath: String?) -> String? {
    guard let transcriptPath = normalizeNonEmpty(transcriptPath) else { return nil }
    let pattern = #"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"#
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
    let range = NSRange(transcriptPath.startIndex..<transcriptPath.endIndex, in: transcriptPath)
    let matches = regex.matches(in: transcriptPath, options: [], range: range)
    guard let match = matches.last, let swiftRange = Range(match.range, in: transcriptPath) else { return nil }
    return String(transcriptPath[swiftRange])
}

private func resolveFinalResponseTranscript(path: String, harness: String) -> FinalResponseTranscriptResolution? {
    switch harness {
    case "codex":
        return resolveCodexFinalResponseTranscript(path: path)
    case "claude-code":
        return resolveClaudeFinalResponseTranscript(path: path)
    case "gemini":
        return nil
    default:
        return resolveCodexFinalResponseTranscript(path: path) ?? resolveClaudeFinalResponseTranscript(path: path)
    }
}

private func resolveCodexFinalResponseTranscript(path: String) -> FinalResponseTranscriptResolution? {
    guard let content = try? String(contentsOfFile: path, encoding: .utf8) else { return nil }

    var lastAny: String?
    var lastFinal: String?
    var lastTaskComplete: String?

    for rawLine in content.split(whereSeparator: \.isNewline) {
        let line = String(rawLine).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !line.isEmpty, let data = line.data(using: .utf8) else { continue }
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let payload = obj["payload"] as? [String: Any] else { continue }

        if let type = obj["type"] as? String, type == "event_msg",
           let payloadType = payload["type"] as? String, payloadType == "task_complete",
           let text = normalizeNonEmpty(payload["last_agent_message"] as? String) {
            lastTaskComplete = text
            continue
        }

        guard let type = obj["type"] as? String, type == "response_item" else { continue }
        guard let payloadType = payload["type"] as? String, payloadType == "message" else { continue }
        guard let role = payload["role"] as? String, role == "assistant" else { continue }
        guard let text = codexTranscriptContentText(payload["content"]) else { continue }

        lastAny = text
        if let phase = payload["phase"] as? String, phase == "final_answer" {
            lastFinal = text
        }
    }

    if let lastTaskComplete {
        return FinalResponseTranscriptResolution(text: lastTaskComplete, source: "codex.task_complete")
    }
    if let lastFinal {
        return FinalResponseTranscriptResolution(text: lastFinal, source: "codex.final_answer")
    }
    if let lastAny {
        return FinalResponseTranscriptResolution(text: lastAny, source: "codex.assistant")
    }
    return nil
}

private func codexTranscriptContentText(_ content: Any?) -> String? {
    guard let items = content as? [[String: Any]] else { return nil }
    let parts = items.compactMap { item -> String? in
        guard let type = item["type"] as? String, type == "output_text" else { return nil }
        return normalizeNonEmpty(item["text"] as? String)
    }
    guard !parts.isEmpty else { return nil }
    return parts.joined(separator: "\n")
}

private func claudeTranscriptContentText(_ content: Any?) -> String? {
    guard let items = content as? [[String: Any]] else { return nil }
    let parts = items.compactMap { item -> String? in
        guard let type = item["type"] as? String, type == "text" else { return nil }
        return normalizeNonEmpty(item["text"] as? String)
    }
    guard !parts.isEmpty else { return nil }
    return parts.joined(separator: "\n\n")
}

private func resolveClaudeFinalResponseTranscript(path: String) -> FinalResponseTranscriptResolution? {
    guard let content = try? String(contentsOfFile: path, encoding: .utf8) else { return nil }
    var lastAny: String?

    for rawLine in content.split(whereSeparator: \.isNewline) {
        let line = String(rawLine).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !line.isEmpty, let data = line.data(using: .utf8) else { continue }
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }

        if let sidechain = obj["isSidechain"] as? Bool, sidechain { continue }
        guard let type = obj["type"] as? String, type == "assistant" else { continue }
        guard let message = obj["message"] as? [String: Any] else { continue }
        if let text = claudeTranscriptContentText(message["content"]) {
            lastAny = text
        }
    }

    guard let lastAny else { return nil }
    return FinalResponseTranscriptResolution(text: lastAny, source: "claude.assistant")
}
